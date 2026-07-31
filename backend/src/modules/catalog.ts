import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { config } from "../config.js";
import { quote, availableInstallments } from "../lib/installments.js";
import { resolveBenefit, type AgreementRow, type ProductOfferRow } from "../lib/agreements.js";

export const catalogRouter = Router();

/**
 * Vidriera pública del marketplace. Se puede mirar sin cuenta.
 *
 * Sólo se publica lo que está activo por partida doble: producto activo Y
 * comercio activo. Suspender un comercio tiene que sacarle todo el catálogo de
 * la vidriera al instante, sin tener que despublicar producto por producto.
 */

interface ProductRow {
  id: string;
  name: string;
  description: string;
  price: number;
  original_price: number | null;
  category_id: string;
  merchant_id: string;
  trade_name: string;
  kind: string;
  rating: number;
  reviews_count: number;
  image: string;
  stock: number;
  specs: string[];
  features: string[];
}

const PUBLICABLE = "p.active AND m.status = 'active'";

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

async function activeAgreements(): Promise<AgreementRow[]> {
  const { rows } = await pool.query<AgreementRow>(
    `SELECT id, bank_id, merchant_id, category_id, max_cuotas, discount_percent,
            cap_amount, description, priority
     FROM bank_agreements
     WHERE active
       AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
       AND (valid_to   IS NULL OR valid_to   >= CURRENT_DATE)`
  );
  return rows;
}

/**
 * La oferta más atractiva para el cartel de la card. "Mejor" es primero más
 * cuotas sin interés y después más reintegro: es el orden en el que compara
 * el cliente.
 *
 * Ojo con la diferencia respecto de resolveBenefit: acá se busca el mejor
 * ENTRE BANCOS (el cliente todavía no eligió tarjeta), mientras que dentro de
 * cada banco sigue mandando la especificidad del acuerdo.
 */
function bestBenefit(
  product: ProductRow,
  offers: ProductOfferRow[],
  agreements: AgreementRow[],
  bankNames: Map<string, string>
) {
  const bankIds = new Set([...offers.map((o) => o.bank_id), ...agreements.map((a) => a.bank_id)]);
  let best = null as null | {
    bankId: string; bankName: string; maxCuotas: number; reintegroPercent: number;
  };

  for (const bankId of bankIds) {
    const benefit = resolveBenefit(
      bankId,
      product.merchant_id,
      product.category_id,
      offers.find((o) => o.bank_id === bankId),
      agreements
    );
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

function serializePublic(p: ProductRow) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price,
    originalPrice: p.original_price,
    category: p.category_id,
    kind: p.kind,
    merchant: { id: p.merchant_id, name: p.trade_name },
    rating: p.rating,
    reviewsCount: p.reviews_count,
    image: p.image,
    stock: p.stock,
    specs: p.specs,
    features: p.features,
  };
}

// ── Listado ──────────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  category: z.string().optional(),
  merchant: z.string().optional(),
  search: z.string().max(120).optional(),
  sort: z.enum(["relevance", "price_asc", "price_desc", "discount", "cuotas"]).default("relevance"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/catalog/products */
catalogRouter.get("/products", async (req, res, next) => {
  try {
    const q = listQuerySchema.parse(req.query);

    const where: string[] = [PUBLICABLE];
    const params: unknown[] = [];
    if (q.category && q.category !== "all") {
      params.push(q.category);
      where.push(`p.category_id = $${params.length}`);
    }
    if (q.merchant) {
      params.push(q.merchant);
      where.push(`p.merchant_id = $${params.length}`);
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
      discount: "COALESCE((p.original_price - p.price) / NULLIF(p.original_price, 0), 0) DESC",
      cuotas: "max_cuotas DESC NULLS LAST",
    }[q.sort];

    params.push(q.limit, q.offset);
    const { rows } = await pool.query<ProductRow & { max_cuotas: number | null; total: number }>(
      `SELECT p.*, m.trade_name,
              (SELECT MAX(o.max_cuotas) FROM product_bank_offers o WHERE o.product_id = p.id) AS max_cuotas,
              COUNT(*) OVER () AS total
       FROM products p JOIN merchants m ON m.id = p.merchant_id
       WHERE ${where.join(" AND ")}
       ORDER BY ${orderBy}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const agreements = await activeAgreements();
    const offers = await offersFor(rows.map((r) => r.id));
    const { rows: banks } = await pool.query<{ id: string; name: string }>(
      "SELECT id, name FROM banks WHERE active"
    );
    const bankNames = new Map(banks.map((b) => [b.id, b.name]));

    res.json({
      total: rows[0]?.total ?? 0,
      items: rows.map((p) => ({
        ...serializePublic(p),
        bestOffer: bestBenefit(p, offers.get(p.id) ?? [], agreements, bankNames),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/catalog/products/:id — detalle con el beneficio de cada banco */
catalogRouter.get("/products/:id", async (req, res, next) => {
  try {
    const { rows } = await pool.query<ProductRow>(
      `SELECT p.*, m.trade_name FROM products p JOIN merchants m ON m.id = p.merchant_id
       WHERE p.id = $1 AND ${PUBLICABLE}`,
      [req.params.id]
    );
    const product = rows[0];
    if (!product) throw new HttpError(404, "Producto no encontrado");

    const agreements = await activeAgreements();
    const offers = (await offersFor([product.id])).get(product.id) ?? [];
    const { rows: banks } = await pool.query<{ id: string; name: string }>(
      "SELECT id, name FROM banks WHERE active ORDER BY name"
    );

    const benefits = banks
      .map((bank) => ({
        ...resolveBenefit(
          bank.id,
          product.merchant_id,
          product.category_id,
          offers.find((o) => o.bank_id === bank.id),
          agreements
        ),
        bankId: bank.id,
        bankName: bank.name,
      }))
      .filter((b) => b.source !== "none");

    res.json({ ...serializePublic(product), benefits });
  } catch (err) {
    next(err);
  }
});

// ── Comercios, bancos y categorías ───────────────────────────────────────────

/** GET /api/catalog/merchants — las tiendas de la vidriera */
catalogRouter.get("/merchants", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.trade_name,
              COUNT(p.id)::int AS product_count,
              COALESCE(ARRAY_AGG(DISTINCT p.category_id)
                       FILTER (WHERE p.category_id IS NOT NULL), '{}') AS categories
       FROM merchants m
       LEFT JOIN products p ON p.merchant_id = m.id AND p.active
       WHERE m.status = 'active'
       GROUP BY m.id
       HAVING COUNT(p.id) > 0
       ORDER BY m.trade_name`
    );
    res.json(rows.map((m) => ({
      id: m.id, name: m.trade_name,
      productCount: m.product_count, categories: m.categories,
    })));
  } catch (err) {
    next(err);
  }
});

/** GET /api/catalog/banks — bancos con sus acuerdos vigentes */
catalogRouter.get("/banks", async (_req, res, next) => {
  try {
    const { rows: banks } = await pool.query(
      "SELECT id, name, logo_color, accent_color, text_color FROM banks WHERE active ORDER BY name"
    );
    const agreements = await activeAgreements();
    res.json(
      banks.map((b) => ({
        id: b.id,
        name: b.name,
        logoColor: b.logo_color,
        accentColor: b.accent_color,
        textColor: b.text_color,
        promos: agreements
          .filter((a) => a.bank_id === b.id)
          .map((a) => ({
            category: a.category_id,
            merchantId: a.merchant_id,
            maxCuotas: a.max_cuotas,
            discountPercent: a.discount_percent,
            capAmount: a.cap_amount,
            description: a.description,
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
      `SELECT c.id, c.name, c.parent_id,
              COUNT(p.id)::int AS product_count
       FROM product_categories c
       LEFT JOIN products p ON p.category_id = c.id AND p.active
       LEFT JOIN merchants m ON m.id = p.merchant_id AND m.status = 'active'
       WHERE c.active
       GROUP BY c.id ORDER BY c.name`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── Simulador ────────────────────────────────────────────────────────────────

const simulateSchema = z.object({
  productId: z.string(),
  quantity: z.coerce.number().int().min(1).max(20).default(1),
  bankId: z.string(),
  installments: z.coerce.number().int().min(1).max(24).optional(),
});

/**
 * POST /api/catalog/simulate
 * Público a propósito: el cliente tiene que poder ver el costo financiero
 * antes de crearse una cuenta. Usa el mismo cálculo que el checkout, así el
 * número que vio es el que paga.
 */
catalogRouter.post("/simulate", async (req, res, next) => {
  try {
    const body = simulateSchema.parse(req.body);
    const { rows } = await pool.query<ProductRow>(
      `SELECT p.*, m.trade_name FROM products p JOIN merchants m ON m.id = p.merchant_id
       WHERE p.id = $1 AND ${PUBLICABLE}`,
      [body.productId]
    );
    const product = rows[0];
    if (!product) throw new HttpError(404, "Producto no encontrado");

    const agreements = await activeAgreements();
    const offers = (await offersFor([product.id])).get(product.id) ?? [];
    const benefit = resolveBenefit(
      body.bankId,
      product.merchant_id,
      product.category_id,
      offers.find((o) => o.bank_id === body.bankId),
      agreements
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
      product: {
        id: product.id, name: product.name, price: product.price,
        merchant: { id: product.merchant_id, name: product.trade_name },
      },
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
      netCost: Math.round((result.totalAmount - reintegro) * 100) / 100,
    });
  } catch (err) {
    next(err);
  }
});
