import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { config } from "../config.js";
import { quote } from "../lib/installments.js";
import { applyCaps, resolveBenefit, type AgreementRow, type ProductOfferRow } from "../lib/agreements.js";
import { round2 } from "../lib/money.js";
import { breakdown } from "../lib/units.js";
import { addressSchema } from "./addresses.js";

export const ordersRouter = Router();

/**
 * Checkout del marketplace.
 *
 * Dos reglas que no se negocian:
 *
 *  1. El cliente manda QUÉ quiere comprar (producto, cantidad, tarjeta,
 *     cuotas) y nada más. Precio, interés, cuota, reintegro y comisión los
 *     calcula el servidor leyendo la base.
 *
 *  2. El pago es UNO solo —una tarjeta, un plan de cuotas, un resumen— pero
 *     por debajo la orden se parte en una sub-orden por comercio, que es la
 *     unidad de despacho y de liquidación. El comprador ve una compra; cada
 *     comercio ve la suya.
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
    .max(30),
  cardId: z.coerce.number().int(),
  installments: z.coerce.number().int().min(1).max(24),
  idempotencyKey: z.string().min(8).max(64).optional(),
  /**
   * A dónde se despacha. Se acepta el id de una dirección ya guardada o los
   * datos sueltos; en el segundo caso se guarda también en la libreta, porque
   * quien compra una vez suele volver a comprar al mismo lugar.
   *
   * Es obligatorio para productos físicos: sin esto el comercio no sabe adónde
   * mandar. Los servicios (hotel, spa) no lo necesitan.
   */
  addressId: z.coerce.number().int().optional(),
  shipping: addressSchema.omit({ isDefault: true }).partial({ label: true, phone: true, floorApt: true, notes: true }).optional(),
});

/** Fila de products + las condiciones comerciales del comercio dueño. */
interface ProductoConComercio {
  id: string;
  name: string;
  price: number;
  original_price: number | null;
  category_id: string;
  stock: number;
  iva_rate: number;
  kind: string;
  merchant_id: string;
  merchant_status: string;
  trade_name: string;
  commission_percent: number;
  absorbs_installment_cost: boolean;
  settlement_days: number;
}

interface LineaResuelta {
  product: ProductoConComercio;
  quantity: number;
  /** Total de la línea a precio final, con IVA. */
  lineTotal: number;
  /** Desglose congelado al momento de la venta. */
  ivaRate: number;
  unitNet: number;
  lineIva: number;
  maxCuotas: number;
}

/** POST /api/orders */
ordersRouter.post("/", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = checkoutSchema.parse(req.body);
    const userId = req.auth.userId;

    if (body.idempotencyKey) {
      const { rows } = await pool.query(
        "SELECT id FROM orders WHERE user_id = $1 AND idempotency_key = $2",
        [userId, body.idempotencyKey]
      );
      if (rows[0]) {
        res.status(200).json({ ...(await getOrder(rows[0].id, userId)), duplicated: true });
        return;
      }
    }

    await client.query("BEGIN");

    // ── Tarjeta ──────────────────────────────────────────────────────────────
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

    // Sólo se puede comprar de comercios activos: uno suspendido no vende
    // aunque su catálogo siga publicado.
    const { rows: products } = await client.query<ProductoConComercio>(
      `SELECT p.id, p.name, p.price, p.original_price, p.category_id, p.stock, p.iva_rate,
              p.kind, p.merchant_id,
              m.status AS merchant_status, m.trade_name, m.commission_percent,
              m.absorbs_installment_cost, m.settlement_days
       FROM products p JOIN merchants m ON m.id = p.merchant_id
       WHERE p.id = ANY($1) AND p.active
       ORDER BY p.id
       FOR UPDATE OF p`,
      [productIds]
    );
    if (products.length !== productIds.length) {
      throw new HttpError(400, "Alguno de los productos ya no está disponible");
    }
    const suspendido = products.find((p) => p.merchant_status !== "active");
    if (suspendido) {
      throw new HttpError(400, `"${suspendido.name}" no está disponible en este momento`);
    }
    const byId = new Map(products.map((p) => [p.id, p]));

    // ── Acuerdos del banco de la tarjeta ─────────────────────────────────────
    const merchantIds = [...new Set(products.map((p) => p.merchant_id))];
    const { rows: agreements } = await client.query<AgreementRow>(
      `SELECT id, bank_id, merchant_id, category_id, max_cuotas, discount_percent,
              cap_amount, description, priority
       FROM bank_agreements
       WHERE bank_id = $1 AND active
         AND (merchant_id IS NULL OR merchant_id = ANY($2))
         AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
         AND (valid_to   IS NULL OR valid_to   >= CURRENT_DATE)`,
      [card.bank_id, merchantIds]
    );
    const { rows: offers } = await client.query<ProductOfferRow>(
      `SELECT product_id, bank_id, max_cuotas, discount_percent, extra_reintegro_percent
       FROM product_bank_offers WHERE product_id = ANY($1) AND bank_id = $2`,
      [productIds, card.bank_id]
    );

    // ── Precios y beneficios, línea por línea ────────────────────────────────
    let subtotalLista = 0;   // a precio tachado, para mostrar el ahorro
    let saleTotal = 0;       // lo que se financia
    const reintegroLines: { capKey: string; amount: number; capAmount: number | null }[] = [];
    const lineas: LineaResuelta[] = [];

    // El plan sin interés del carrito es el del producto MÁS restrictivo. Si un
    // ítem sólo tiene 6 cuotas, no se pueden dar 24 por el carrito entero: el
    // banco no lo bancaría y alguien tendría que comerse la diferencia.
    let maxInterestFree = Infinity;

    for (const item of body.items) {
      const product = byId.get(item.productId)!;
      if (product.stock < item.quantity) {
        throw new HttpError(400, `Stock insuficiente de "${product.name}" (quedan ${product.stock})`);
      }
      const lineTotal = round2(product.price * item.quantity);
      subtotalLista = round2(subtotalLista + (product.original_price ?? product.price) * item.quantity);
      saleTotal = round2(saleTotal + lineTotal);

      const benefit = resolveBenefit(
        card.bank_id,
        product.merchant_id,
        product.category_id,
        offers.find((o) => o.product_id === product.id),
        agreements
      );
      maxInterestFree = Math.min(maxInterestFree, benefit.maxCuotas);
      reintegroLines.push({
        capKey: benefit.capKey,
        amount: round2(lineTotal * benefit.reintegroPercent),
        capAmount: benefit.capAmount,
      });

      // El desglose se calcula acá y se congela: la alícuota del producto
      // puede cambiar mañana y el comprobante tiene que seguir igual.
      const ivaRate = Number(product.iva_rate);
      const unitario = breakdown(product.price, ivaRate);
      const unitNet = unitario.net;
      // El IVA de la línea es por diferencia contra el total final, no
      // multiplicando el IVA unitario: así neto + IVA da exactamente el total,
      // sin un centavo de arrastre por redondear en cada unidad.
      const lineIva = round2(lineTotal - unitNet * item.quantity);

      lineas.push({
        product, quantity: item.quantity, lineTotal,
        ivaRate, unitNet, lineIva,
        maxCuotas: benefit.maxCuotas,
      });
    }
    if (maxInterestFree === Infinity) maxInterestFree = 1;

    const financing = quote({
      amount: saleTotal,
      installments: body.installments,
      maxInterestFree,
      tna: config.finance.tnaDefault,
      vatRate: config.finance.ivaSobreIntereses,
    });

    if (Number(card.available_limit) < financing.totalAmount) {
      throw new HttpError(
        400,
        `El límite disponible de la tarjeta ($${Number(card.available_limit).toLocaleString("es-AR")}) ` +
          `no alcanza para $${financing.totalAmount.toLocaleString("es-AR")}`
      );
    }

    // ── Domicilio de entrega ─────────────────────────────────────────────────
    // Sólo hace falta si hay algo que despachar. Un carrito de puros servicios
    // (hotel, spa) no lo necesita, y exigirlo sería pedir un dato que no se usa.
    const hayFisicos = lineas.some((l) => l.product.kind !== "service");
    let direccion: Record<string, any> | null = null;

    if (body.addressId !== undefined) {
      const { rows } = await client.query(
        "SELECT * FROM user_addresses WHERE id = $1 AND user_id = $2",
        [body.addressId, userId]
      );
      if (!rows[0]) throw new HttpError(404, "Esa dirección no está en tu libreta");
      direccion = rows[0];
    } else if (body.shipping) {
      // Dirección nueva: se guarda en la libreta y se usa. Si es la primera,
      // queda como predeterminada.
      const { rows: cuantas } = await client.query(
        "SELECT COUNT(*)::int AS n FROM user_addresses WHERE user_id = $1",
        [userId]
      );
      const sh = body.shipping;
      const { rows } = await client.query(
        `INSERT INTO user_addresses (user_id, label, recipient, phone, street, number,
                                     floor_apt, zip, city, province, notes, is_default)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [userId, sh.label ?? null, sh.recipient, sh.phone ?? null, sh.street, sh.number,
         sh.floorApt ?? null, sh.zip, sh.city, sh.province, sh.notes ?? null,
         cuantas[0].n === 0]
      );
      direccion = rows[0];
    }

    if (hayFisicos && !direccion) {
      throw new HttpError(400, "Falta el domicilio de entrega");
    }

    const reintegro = applyCaps(reintegroLines);

    // Totales fiscales. El neto sale de sumar las líneas y el IVA por
    // diferencia contra el total, para que neto + IVA cierre exacto.
    const netoTotal = round2(lineas.reduce((a, l) => a + l.unitNet * l.quantity, 0));
    const ivaTotal = round2(saleTotal - netoTotal);

    // ── Reparto por comercio ─────────────────────────────────────────────────
    // El costo de las cuotas sin interés se prorratea según cuánto puso cada
    // comercio en la orden. Un comercio que aportó el 30% del carrito se come
    // el 30% del costo financiero, no la mitad por ser dos.
    const porComercio = new Map<string, { lineas: LineaResuelta[]; subtotal: number }>();
    for (const linea of lineas) {
      const acc = porComercio.get(linea.product.merchant_id) ?? { lineas: [], subtotal: 0 };
      acc.lineas.push(linea);
      acc.subtotal = round2(acc.subtotal + linea.lineTotal);
      porComercio.set(linea.product.merchant_id, acc);
    }

    // Cuando las cuotas son sin interés el banco no cobra recargo, pero el
    // costo existe igual: es la quita que el comercio acepta a cambio de la
    // promo. Se estima con lo que habría costado financiar ese monto.
    const costoFinancieroTotal = financing.interestFree
      ? round2(
          quote({
            amount: saleTotal,
            installments: body.installments,
            maxInterestFree: 0,
            tna: config.finance.tnaDefault,
            vatRate: config.finance.ivaSobreIntereses,
          }).interestAmount
        )
      : 0;

    // ── Escritura ────────────────────────────────────────────────────────────
    for (const linea of lineas) {
      await client.query("UPDATE products SET stock = stock - $2, updated_at = now() WHERE id = $1", [
        linea.product.id, linea.quantity,
      ]);
    }
    await client.query("UPDATE cards SET available_limit = available_limit - $2 WHERE id = $1", [
      card.id, financing.totalAmount,
    ]);

    const {
      rows: [{ next_number }],
    } = await client.query("SELECT COALESCE(MAX(order_number), 0) + 1 AS next_number FROM orders");

    const {
      rows: [order],
    } = await client.query(
      `INSERT INTO orders (order_number, user_id, card_id, bank_id, bank_name, card_brand, card_last4,
                           installments, subtotal, discount_amount, total_amount, interest_amount,
                           installment_amount, reintegro_amount, tna, tea, cft,
                           idempotency_key, merchant_count,
                           net_amount, iva_amount, iva_interes_amount,
                           shipping_address_id, ship_recipient, ship_phone, ship_street,
                           ship_number, ship_floor_apt, ship_zip, ship_city, ship_province,
                           ship_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
               $23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
       RETURNING id`,
      [
        next_number, userId, card.id, card.bank_id, card.bank_name, card.brand, card.last4,
        body.installments, subtotalLista, round2(subtotalLista - saleTotal), financing.totalAmount,
        financing.interestAmount, financing.installmentAmount, reintegro,
        financing.tna, financing.tea, financing.cft, body.idempotencyKey ?? null,
        porComercio.size,
        netoTotal, ivaTotal,
        // El IVA del crédito es otro hecho imponible: no es el del producto,
        // es el de la financiación. Ya se calculaba para el CFT.
        financing.vatAmount,
        // El domicilio se COPIA además de referenciarse: si el comprador lo
        // edita o lo borra, el remito ya emitido tiene que seguir igual.
        direccion?.id ?? null,
        direccion?.recipient ?? null, direccion?.phone ?? null,
        direccion?.street ?? null, direccion?.number ?? null,
        direccion?.floor_apt ?? null, direccion?.zip ?? null,
        direccion?.city ?? null, direccion?.province ?? null,
        direccion?.notes ?? null,
      ]
    );

    for (const [merchantId, grupo] of porComercio) {
      // Las condiciones vienen del mismo JOIN: todas las líneas de este grupo
      // son del mismo comercio, así que alcanza con mirar la primera.
      const merchant = grupo.lineas[0]!.product;
      const commissionPercent = Number(merchant.commission_percent);
      const commissionAmount = round2(grupo.subtotal * commissionPercent);

      const netoComercio = round2(grupo.lineas.reduce((a, l) => a + l.unitNet * l.quantity, 0));
      const ivaComercio = round2(grupo.subtotal - netoComercio);

      const participacion = saleTotal === 0 ? 0 : grupo.subtotal / saleTotal;
      const installmentCost = merchant.absorbs_installment_cost
        ? round2(costoFinancieroTotal * participacion)
        : 0;

      const payout = round2(grupo.subtotal - commissionAmount - installmentCost);

      // Numeración propia de cada comercio, la que usa para su gestión interna.
      const {
        rows: [{ next_mo }],
      } = await client.query(
        "SELECT COALESCE(MAX(merchant_order_number), 0) + 1 AS next_mo FROM merchant_orders WHERE merchant_id = $1",
        [merchantId]
      );

      const {
        rows: [mo],
      } = await client.query(
        `INSERT INTO merchant_orders (order_id, merchant_id, merchant_order_number, subtotal,
                                      net_subtotal, iva_subtotal,
                                      commission_percent, commission_amount, installment_cost,
                                      payout_amount, settlement_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CURRENT_DATE + $11::int)
         RETURNING id`,
        [order.id, merchantId, next_mo, grupo.subtotal, netoComercio, ivaComercio,
         commissionPercent, commissionAmount, installmentCost, payout, merchant.settlement_days]
      );

      for (const linea of grupo.lineas) {
        await client.query(
          `INSERT INTO order_items (order_id, merchant_order_id, product_id, product_name,
                                    quantity, unit_price, iva_rate, unit_price_net, iva_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [order.id, mo.id, linea.product.id, linea.product.name, linea.quantity,
           linea.product.price, linea.ivaRate, linea.unitNet, linea.lineIva]
        );
      }
    }

    await client.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, payload)
       VALUES ($1,'order.create','orders',$2,$3)`,
      [userId, String(order.id),
       JSON.stringify({ total: financing.totalAmount, installments: body.installments,
                        comercios: [...porComercio.keys()] })]
    );

    await client.query("COMMIT");
    res.status(201).json(await getOrder(order.id, userId));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
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
  const { rows } = await pool.query("SELECT * FROM orders WHERE id = $1 AND user_id = $2", [
    orderId, userId,
  ]);
  const order = rows[0];
  if (!order) return null;

  // El comprador ve una sola compra, pero agrupada por comercio: es lo que
  // necesita para saber quién le despacha cada cosa.
  const { rows: grupos } = await pool.query(
    `SELECT mo.id, mo.merchant_id, m.trade_name, mo.merchant_order_number, mo.status,
            mo.subtotal, mo.net_subtotal, mo.iva_subtotal,
            COALESCE(json_agg(json_build_object(
              'productId', i.product_id, 'productName', i.product_name,
              'quantity', i.quantity, 'price', i.unit_price,
              'ivaRate', i.iva_rate, 'unitPriceNet', i.unit_price_net,
              'ivaAmount', i.iva_amount
            ) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
     FROM merchant_orders mo
     JOIN merchants m ON m.id = mo.merchant_id
     LEFT JOIN order_items i ON i.merchant_order_id = mo.id
     WHERE mo.order_id = $1
     GROUP BY mo.id, m.trade_name
     ORDER BY m.trade_name`,
    [orderId]
  );

  return {
    id: order.id,
    orderNumber: order.order_number,
    date: order.created_at,
    status: order.status,
    merchants: grupos.map((g) => ({
      merchantId: g.merchant_id,
      merchantName: g.trade_name,
      merchantOrderNumber: g.merchant_order_number,
      status: g.status,
      subtotal: g.subtotal,
      netSubtotal: g.net_subtotal,
      ivaSubtotal: g.iva_subtotal,
      items: g.items,
    })),
    // Aplanado, para el comprobante y para quien no le interesa el corte.
    items: grupos.flatMap((g) => g.items),
    cardUsed: {
      bankName: order.bank_name,
      brand: order.card_brand,
      cardNumber: `•••• •••• •••• ${order.card_last4}`,
    },
    installments: order.installments,
    subtotal: order.subtotal,
    discountAmount: order.discount_amount,
    totalAmount: order.total_amount,
    // Desglose fiscal, congelado al momento de la venta.
    taxes: {
      net: order.net_amount,
      iva: order.iva_amount,
      // El IVA sobre los intereses es otro hecho imponible: el del crédito,
      // no el del producto. Va aparte para que el comprobante no los mezcle.
      ivaInteres: order.iva_interes_amount,
    },
    interestAmount: order.interest_amount,
    installmentPrice: order.installment_amount,
    reintegroAmount: order.reintegro_amount,
    tna: order.tna,
    tea: order.tea,
    cft: order.cft,
    // El domicilio congelado al vender. Null en compras de puros servicios.
    shipping: order.ship_street ? {
      recipient: order.ship_recipient,
      phone: order.ship_phone,
      street: order.ship_street,
      number: order.ship_number,
      floorApt: order.ship_floor_apt,
      zip: order.ship_zip,
      city: order.ship_city,
      province: order.ship_province,
      notes: order.ship_notes,
    } : null,
  };
}

/** GET /api/orders — historial de compras */
ordersRouter.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.order_number, o.created_at, o.total_amount, o.installments,
              o.installment_amount, o.reintegro_amount, o.bank_name, o.card_brand,
              o.card_last4, o.merchant_count,
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
