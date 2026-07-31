import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { config } from "../config.js";
import { quote, availableInstallments } from "../lib/installments.js";
import { resolveBenefit, type BankPromoRow, type ProductOfferRow } from "../lib/promos.js";

export const catalogRouter = Router();

/**
 * El catálogo es público: se puede mirar la tienda sin cuenta. Los beneficios
 * concretos dependen de la tarjeta, así que el listado devuelve además la
 * MEJOR oferta disponible de todos los bancos, que es el gancho de la card.
 */

const listQuerySchema = z.object({
  category: z.string().optional(),
  search: z.string().max(120).optional(),
  sort: z.enum(["relevance", "price_asc", "price_desc", "discount", "cuotas"]).default("relevance"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

interface ProductRow {
  id: string;
  name: string;
  description: string;
  price: number;
  original_price: number | null;
  category_id: string;
  rating: number;
  reviews_count: number;
  image: string;
  stock: number;
  specs: string[];
  features: string[];
}

/** Las ofertas de todos los productos pedidos, en una sola consulta. */
async function offersFor(productIds: string[]): Promise<Map<string, ProductOfferRow[]>> {
  const map = new Map<string, ProductOfferRow[]>();
  if (productIds.length === 0) return map;
  const { rows } = await pool.query<ProductOfferRow>(
    `SELECT product_id, bank_id, max_cuotas, discount_percent, extra_reintegro_percent
     FROM product_bank_offers WHERE product_id = ANY($1)`,
    [productIds]
  );
  for (const row of rows) {
    const list = map.get(row.product_id) ?? [];
    list.push(row);
    map.set(row.product_id, list);
  }
  return map;
}

async function activePromos(): Promise<BankPromoRow[]> {
  const { rows } = await pool.query<BankPromoRow>(
    `SELECT bank_id, category_id, max_cuotas, discount_percent, cap_amount, description
     FROM bank_promos
     WHERE (valid_from IS NULL OR valid_from <= CURRENT_DATE)
       AND (valid_to   IS NULL OR valid_to   >= CURRENT_DATE)`
  );
  return rows;
}

/**
 * La oferta más atractiva para mostrar en la card. "Mejor" es primero más
 * cuotas sin interés y después más reintegro: es el orden en el que el
 * cliente compara, y es el que usa el cartel del prototipo.
 */
function bestBenefit(
  product: ProductRow,
  offers: ProductOfferRow[],
  promos: BankPromoRow[],
  bankNames: Map<string, string>
) {
  const bankIds = new Set([...offers.map((o) => o.bank_id), ...promos.map((p) => p.bank_id)]);
  let best = null as null | { bankId: string; bankName: string; maxCuotas: number; reintegroPercent: number };

  for (const bankId of bankIds) {
    const offer = offers.find((o) => o.bank_id === bankId);
    const promo = promos.find((p) => p.bank_id === bankId && p.category_id === product.category_id);
    const benefit = resolveBenefit(bankId, product.category_id, offer, promo);
    if (benefit.source === "none") continue;
    const candidate = {
      bankId,
      bankName: bankNames.get(bankId) ?? bankId,
      maxCuotas: benefit.maxCuotas,
      reintegroPercent: benefit.reintegroPercent,
    };
    if (
      !best ||
      candidate.maxCuotas > best.maxCuotas ||
      (candidate.maxCuotas === best.maxCuotas && candidate.reintegroPercent > best.reintegroPercent)
    ) {
      best = candidate;
    }
  }
  return best;
}

/** GET /api/catalog/products */
catalogRouter.get("/products", async (req, res, next) => {
  try {
    const q = listQuerySchema.parse(req.query);

    const where: string[] = ["p.active"];
    const params: unknown[] = [];
    if (q.category && q.category !== "all") {
      params.push(q.category);
      where.push(`p.category_id = $${params.length}`);
    }
    if (q.search) {
      params.push(q.search);
      // websearch_to_tsquery tolera lo que la gente escribe de verdad
      // ("tv samsung 65") sin explotar con la sintaxis de tsquery.
      where.push(
        `to_tsvector('spanish', p.name || ' ' || p.description) @@ websearch_to_tsquery('spanish', $${params.length})`
      );
    }

    const orderBy = {
      relevance: "p.reviews_count DESC, p.rating DESC",
      price_asc: "p.price ASC",
      price_desc: "p.price DESC",
      // Mayor descuento sobre el precio de lista
      discount: "COALESCE((p.original_price - p.price) / NULLIF(p.original_price, 0), 0) DESC",
      cuotas: "max_cuotas DESC NULLS LAST",
    }[q.sort];

    params.push(q.limit, q.offset);
    const { rows } = await pool.query<ProductRow & { max_cuotas: number | null; total: number }>(
      `SELECT p.*,
              (SELECT MAX(o.max_cuotas) FROM product_bank_offers o WHERE o.product_id = p.id) AS max_cuotas,
              COUNT(*) OVER () AS total
       FROM products p
       WHERE ${where.join(" AND ")}
       ORDER BY ${orderBy}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const promos = await activePromos();
    const offers = await offersFor(rows.map((r) => r.id));
    const { rows: banks } = await pool.query<{ id: string; name: string }>(
      "SELECT id, name FROM banks WHERE active"
    );
    const bankNames = new Map(banks.map((b) => [b.id, b.name]));

    res.json({
      total: rows[0]?.total ?? 0,
      items: rows.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.price,
        originalPrice: p.original_price,
        category: p.category_id,
        rating: p.rating,
        reviewsCount: p.reviews_count,
        image: p.image,
        stock: p.stock,
        specs: p.specs,
        features: p.features,
        bestOffer: bestBenefit(p, offers.get(p.id) ?? [], promos, bankNames),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/catalog/products/:id
 * Detalle con el beneficio resuelto para cada banco, para que el frontend
 * pueda pintar el simulador sin volver a pedir nada.
 */
catalogRouter.get("/products/:id", async (req, res, next) => {
  try {
    const { rows } = await pool.query<ProductRow>(
      "SELECT * FROM products WHERE id = $1 AND active",
      [req.params.id]
    );
    const product = rows[0];
    if (!product) throw new HttpError(404, "Producto no encontrado");

    const promos = await activePromos();
    const offers = (await offersFor([product.id])).get(product.id) ?? [];
    const { rows: banks } = await pool.query<{ id: string; name: string }>(
      "SELECT id, name FROM banks WHERE active ORDER BY name"
    );

    const benefits = banks
      .map((bank) => {
        const benefit = resolveBenefit(
          bank.id,
          product.category_id,
          offers.find((o) => o.bank_id === bank.id),
          promos.find((p) => p.bank_id === bank.id && p.category_id === product.category_id)
        );
        return { ...benefit, bankId: bank.id, bankName: bank.name };
      })
      .filter((b) => b.source !== "none");

    res.json({
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price,
      originalPrice: product.original_price,
      category: product.category_id,
      rating: product.rating,
      reviewsCount: product.reviews_count,
      image: product.image,
      stock: product.stock,
      specs: product.specs,
      features: product.features,
      benefits,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/catalog/banks — bancos con sus promos vigentes */
catalogRouter.get("/banks", async (_req, res, next) => {
  try {
    const { rows: banks } = await pool.query(
      "SELECT id, name, logo_color, accent_color, text_color FROM banks WHERE active ORDER BY name"
    );
    const promos = await activePromos();
    res.json(
      banks.map((b) => ({
        id: b.id,
        name: b.name,
        logoColor: b.logo_color,
        accentColor: b.accent_color,
        textColor: b.text_color,
        promos: promos
          .filter((p) => p.bank_id === b.id)
          .map((p) => ({
            category: p.category_id,
            maxCuotas: p.max_cuotas,
            discountPercent: p.discount_percent,
            capAmount: p.cap_amount,
            description: p.description,
          })),
      }))
    );
  } catch (err) {
    next(err);
  }
});

/** GET /api/catalog/categories */
catalogRouter.get("/categories", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, COUNT(p.id)::int AS product_count
       FROM product_categories c
       LEFT JOIN products p ON p.category_id = c.id AND p.active
       GROUP BY c.id, c.name ORDER BY c.name`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/catalog/simulate
 * Simulador de cuotas. Es público a propósito: el cliente tiene que poder ver
 * el costo financiero antes de crearse una cuenta. Devuelve el mismo cálculo
 * que después usa el checkout, así el número que vio es el que paga.
 */
const simulateSchema = z.object({
  productId: z.string(),
  quantity: z.coerce.number().int().min(1).max(20).default(1),
  bankId: z.string(),
  installments: z.coerce.number().int().min(1).max(24).optional(),
});

catalogRouter.post("/simulate", async (req, res, next) => {
  try {
    const body = simulateSchema.parse(req.body);
    const { rows } = await pool.query<ProductRow>(
      "SELECT * FROM products WHERE id = $1 AND active",
      [body.productId]
    );
    const product = rows[0];
    if (!product) throw new HttpError(404, "Producto no encontrado");

    const promos = await activePromos();
    const offers = (await offersFor([product.id])).get(product.id) ?? [];
    const benefit = resolveBenefit(
      body.bankId,
      product.category_id,
      offers.find((o) => o.bank_id === body.bankId),
      promos.find((p) => p.bank_id === body.bankId && p.category_id === product.category_id)
    );

    const amount = product.price * body.quantity;
    // Por defecto se muestra el plan más largo sin interés, que es el que el
    // cliente quiere ver.
    const installments = body.installments ?? Math.max(benefit.maxCuotas, 1);

    const result = quote({
      amount,
      installments,
      maxInterestFree: benefit.maxCuotas,
      tna: config.finance.tnaDefault,
      vatRate: config.finance.ivaSobreIntereses,
    });

    const grossReintegro = amount * benefit.reintegroPercent;
    const reintegro =
      benefit.capAmount === null ? grossReintegro : Math.min(grossReintegro, benefit.capAmount);

    res.json({
      product: { id: product.id, name: product.name, price: product.price },
      quantity: body.quantity,
      benefit,
      options: availableInstallments(benefit.maxCuotas),
      quote: result,
      reintegro: {
        amount: Math.round(reintegro * 100) / 100,
        percent: benefit.reintegroPercent,
        capped: benefit.capAmount !== null && grossReintegro > benefit.capAmount,
        capAmount: benefit.capAmount,
      },
      // Lo que realmente termina costando una vez acreditado el reintegro.
      netCost: Math.round((result.totalAmount - reintegro) * 100) / 100,
    });
  } catch (err) {
    next(err);
  }
});
