import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { config } from "../config.js";
import { quote } from "../lib/installments.js";
import { applyCaps, resolveBenefit, type BankPromoRow, type ProductOfferRow } from "../lib/promos.js";
import { round2 } from "../lib/money.js";

export const ordersRouter = Router();

/**
 * Checkout.
 *
 * Regla que no se negocia: el cliente manda QUÉ quiere comprar (producto,
 * cantidad, tarjeta, cuotas) y nada más. El precio, el descuento, el interés,
 * la cuota y el reintegro los calcula el servidor leyendo la base. Si el
 * frontend mandara los montos, cualquiera con la consola abierta compraría el
 * televisor a $1.
 */

const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string(),
        quantity: z.coerce.number().int().min(1).max(20),
      })
    )
    .min(1, "El carrito está vacío")
    .max(20),
  cardId: z.coerce.number().int(),
  installments: z.coerce.number().int().min(1).max(24),
  /**
   * Clave del intento de compra, generada por el frontend. Si el usuario hace
   * doble click o se corta la red y reintenta, la segunda request devuelve la
   * orden que ya se creó en vez de cobrar dos veces.
   */
  idempotencyKey: z.string().min(8).max(64).optional(),
});

/** POST /api/orders */
ordersRouter.post("/", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = checkoutSchema.parse(req.body);
    const userId = req.auth.userId;

    // Se chequea antes de abrir la transacción: si ya existe, no hay nada que
    // bloquear ni escribir.
    if (body.idempotencyKey) {
      const { rows } = await pool.query(
        "SELECT id, order_number FROM orders WHERE user_id = $1 AND idempotency_key = $2",
        [userId, body.idempotencyKey]
      );
      if (rows[0]) {
        res.status(200).json({ ...(await getOrder(rows[0].id, userId)), duplicated: true });
        return;
      }
    }

    await client.query("BEGIN");

    // ── Tarjeta ──────────────────────────────────────────────────────────────
    // FOR UPDATE: dos compras simultáneas con la misma tarjeta no pueden leer
    // el mismo límite disponible y gastarlo dos veces.
    const { rows: cardRows } = await client.query(
      `SELECT c.*, b.name AS bank_name
       FROM cards c JOIN banks b ON b.id = c.bank_id
       WHERE c.id = $1 AND c.user_id = $2 FOR UPDATE OF c`,
      [body.cardId, userId]
    );
    const card = cardRows[0];
    if (!card) throw new HttpError(404, "Tarjeta no encontrada en tu billetera");

    const expiry = new Date(card.expiry_year, card.expiry_month, 0, 23, 59, 59);
    if (expiry < new Date()) throw new HttpError(400, "Esa tarjeta está vencida");

    // ── Productos ────────────────────────────────────────────────────────────
    const productIds = body.items.map((i) => i.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new HttpError(400, "Hay productos repetidos: mandá una sola línea por producto");
    }

    const { rows: products } = await client.query(
      `SELECT id, name, price, original_price, category_id, stock
       FROM products WHERE id = ANY($1) AND active FOR UPDATE`,
      [productIds]
    );
    if (products.length !== productIds.length) {
      throw new HttpError(400, "Alguno de los productos ya no está disponible");
    }
    const byId = new Map(products.map((p) => [p.id, p]));

    const { rows: promos } = await client.query<BankPromoRow>(
      `SELECT bank_id, category_id, max_cuotas, discount_percent, cap_amount, description
       FROM bank_promos
       WHERE bank_id = $1
         AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
         AND (valid_to   IS NULL OR valid_to   >= CURRENT_DATE)`,
      [card.bank_id]
    );
    const { rows: offers } = await client.query<ProductOfferRow>(
      `SELECT product_id, bank_id, max_cuotas, discount_percent, extra_reintegro_percent
       FROM product_bank_offers WHERE product_id = ANY($1) AND bank_id = $2`,
      [productIds, card.bank_id]
    );

    // ── Precios y beneficios ─────────────────────────────────────────────────
    let subtotal = 0;      // a precio de lista (original_price), para mostrar el ahorro
    let saleTotal = 0;     // lo que se financia
    const reintegroLines: { categoryId: string; amount: number; capAmount: number | null }[] = [];
    // El plan de cuotas sin interés del carrito es el del producto más
    // restrictivo: no se puede dar 24 cuotas por un item que sólo tiene 6.
    let maxInterestFree = Infinity;

    const lines = body.items.map((item) => {
      const product = byId.get(item.productId)!;
      if (product.stock < item.quantity) {
        throw new HttpError(400, `Stock insuficiente de "${product.name}" (quedan ${product.stock})`);
      }
      const lineTotal = round2(product.price * item.quantity);
      subtotal = round2(subtotal + (product.original_price ?? product.price) * item.quantity);
      saleTotal = round2(saleTotal + lineTotal);

      const benefit = resolveBenefit(
        card.bank_id,
        product.category_id,
        offers.find((o) => o.product_id === product.id),
        promos.find((p) => p.category_id === product.category_id)
      );
      maxInterestFree = Math.min(maxInterestFree, benefit.maxCuotas);
      reintegroLines.push({
        categoryId: product.category_id,
        amount: round2(lineTotal * benefit.reintegroPercent),
        capAmount: benefit.capAmount,
      });

      return { product, quantity: item.quantity, unitPrice: product.price };
    });

    if (maxInterestFree === Infinity) maxInterestFree = 1;

    const financing = quote({
      amount: saleTotal,
      installments: body.installments,
      maxInterestFree,
      tna: config.finance.tnaDefault,
      vatRate: config.finance.ivaSobreIntereses,
    });

    // El límite se consume por el total financiado, no por el precio de lista:
    // los intereses también ocupan límite en la tarjeta.
    if (Number(card.available_limit) < financing.totalAmount) {
      throw new HttpError(
        400,
        `El límite disponible de la tarjeta ($${Number(card.available_limit).toLocaleString("es-AR")}) ` +
          `no alcanza para $${financing.totalAmount.toLocaleString("es-AR")}`
      );
    }

    const reintegro = applyCaps(reintegroLines);

    // ── Escritura ────────────────────────────────────────────────────────────
    for (const line of lines) {
      await client.query("UPDATE products SET stock = stock - $2, updated_at = now() WHERE id = $1", [
        line.product.id,
        line.quantity,
      ]);
    }
    await client.query("UPDATE cards SET available_limit = available_limit - $2 WHERE id = $1", [
      card.id,
      financing.totalAmount,
    ]);

    const {
      rows: [{ next_number }],
    } = await client.query("SELECT COALESCE(MAX(order_number), 0) + 1 AS next_number FROM orders");

    const {
      rows: [order],
    } = await client.query(
      `INSERT INTO orders (order_number, user_id, card_id, bank_id, bank_name, card_brand, card_last4,
                           installments, subtotal, discount_amount, total_amount, interest_amount,
                           installment_amount, reintegro_amount, tna, tea, cft, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id`,
      [
        next_number, userId, card.id, card.bank_id, card.bank_name, card.brand, card.last4,
        body.installments, subtotal, round2(subtotal - saleTotal), financing.totalAmount,
        financing.interestAmount, financing.installmentAmount, reintegro,
        financing.tna, financing.tea, financing.cft, body.idempotencyKey ?? null,
      ]
    );

    for (const line of lines) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price)
         VALUES ($1,$2,$3,$4,$5)`,
        [order.id, line.product.id, line.product.name, line.quantity, line.unitPrice]
      );
    }

    await client.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, payload)
       VALUES ($1,'order.create','orders',$2,$3)`,
      [userId, String(order.id), JSON.stringify({ total: financing.totalAmount, installments: body.installments })]
    );

    await client.query("COMMIT");
    res.status(201).json(await getOrder(order.id, userId));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    // Si dos requests idénticas entran a la vez, la segunda choca contra el
    // UNIQUE de idempotency_key. No es un error: es la protección funcionando.
    if (typeof err === "object" && err && (err as { code?: string }).code === "23505") {
      next(new HttpError(409, "Esa compra ya se está procesando"));
      return;
    }
    next(err);
  } finally {
    client.release();
  }
});

async function getOrder(orderId: number, userId: number) {
  const { rows } = await pool.query(
    "SELECT * FROM orders WHERE id = $1 AND user_id = $2",
    [orderId, userId]
  );
  const order = rows[0];
  if (!order) return null;
  const { rows: items } = await pool.query(
    "SELECT product_id, product_name, quantity, unit_price FROM order_items WHERE order_id = $1",
    [orderId]
  );
  return {
    id: order.id,
    orderNumber: order.order_number,
    date: order.created_at,
    status: order.status,
    items: items.map((i) => ({
      productId: i.product_id,
      productName: i.product_name,
      quantity: i.quantity,
      price: i.unit_price,
    })),
    cardUsed: {
      bankName: order.bank_name,
      brand: order.card_brand,
      cardNumber: `•••• •••• •••• ${order.card_last4}`,
    },
    installments: order.installments,
    subtotal: order.subtotal,
    discountAmount: order.discount_amount,
    totalAmount: order.total_amount,
    interestAmount: order.interest_amount,
    installmentPrice: order.installment_amount,
    reintegroAmount: order.reintegro_amount,
    tna: order.tna,
    tea: order.tea,
    cft: order.cft,
  };
}

/** GET /api/orders — historial de compras */
ordersRouter.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.order_number, o.created_at, o.total_amount, o.installments,
              o.installment_amount, o.reintegro_amount, o.bank_name, o.card_brand, o.card_last4,
              COUNT(i.id)::int AS item_count
       FROM orders o LEFT JOIN order_items i ON i.order_id = o.id
       WHERE o.user_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC LIMIT 100`,
      [req.auth.userId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/** GET /api/orders/:id — comprobante */
ordersRouter.get("/:id", async (req, res, next) => {
  try {
    const order = await getOrder(Number(req.params.id), req.auth.userId);
    if (!order) throw new HttpError(404, "Compra no encontrada");
    res.json(order);
  } catch (err) {
    next(err);
  }
});
