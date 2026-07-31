import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { requireApiKey } from "../middleware/apikey.js";
import { productInputSchema, upsertProduct, serializeProduct, traducirErrorDeCategoria } from "../lib/products.js";

export const integrationRouter = Router();

/**
 * API de integración para el sistema del comercio (/api/v1).
 *
 * Se autentica con X-API-Key, no con JWT: no hay una persona sentada, hay un
 * ERP corriendo un cron. Va versionada desde el arranque porque acá sí importa
 * no romperle la integración a un comercio sin avisar: si algo tiene que
 * cambiar de forma incompatible, aparece /api/v2 y v1 sigue andando.
 *
 * El comercio SIEMPRE sale de la clave (req.apiKey.merchantId). Ningún
 * endpoint acepta un merchantId por parámetro.
 */

/** GET /api/v1/ping — para que el comercio verifique su clave */
integrationRouter.get("/ping", requireApiKey("catalog:write"), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.trade_name, m.status,
              COALESCE(ARRAY_AGG(mc.category_id) FILTER (WHERE mc.category_id IS NOT NULL), '{}') AS categories
       FROM merchants m LEFT JOIN merchant_categories mc ON mc.merchant_id = m.id
       WHERE m.id = $1 GROUP BY m.id`,
      [req.apiKey.merchantId]
    );
    const m = rows[0];
    res.json({
      ok: true,
      merchant: { id: m.id, tradeName: m.trade_name, status: m.status },
      // Se devuelven las categorías habilitadas para que la integración sepa
      // con qué valores puede mandar categoryId sin tener que adivinar.
      categoriesPermitidas: m.categories,
      scopes: req.apiKey.scopes,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/products
 * Sincronización de catálogo. Idempotente por SKU: mandar lo mismo dos veces
 * deja el mismo estado, que es lo que necesita un cron que corre cada hora.
 *
 * Acepta hasta 500 productos por llamada. Devuelve el resultado por SKU en vez
 * de fallar entero: si un producto tiene la categoría mal, se rechaza ese y
 * los otros 499 entran igual. Un lote que falla completo por un renglón malo
 * es una pesadilla para el que integra.
 */
const bulkSchema = z.object({
  products: z.array(productInputSchema).min(1).max(500),
});

integrationRouter.put("/products", requireApiKey("catalog:write"), async (req, res, next) => {
  try {
    const body = bulkSchema.parse(req.body);
    const merchantId = req.apiKey.merchantId;

    const duplicados = body.products
      .map((p) => p.sku)
      .filter((sku, i, arr) => arr.indexOf(sku) !== i);
    if (duplicados.length) {
      throw new HttpError(400, `SKU repetidos en el lote: ${[...new Set(duplicados)].join(", ")}`);
    }

    const ok: { sku: string; id: string; created: boolean }[] = [];
    const errores: { sku: string; error: string }[] = [];

    for (const input of body.products) {
      // Una transacción por producto: así el error de uno no arrastra a los
      // que ya entraron bien.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { row, created } = await upsertProduct(client, merchantId, input);
        await client.query("COMMIT");
        ok.push({ sku: input.sku, id: row.id, created });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        const traducido = traducirErrorDeCategoria(err);
        errores.push({
          sku: input.sku,
          error: traducido instanceof HttpError ? traducido.message : "No se pudo guardar",
        });
        if (!(traducido instanceof HttpError)) console.error(`[v1/products] ${input.sku}:`, err);
      } finally {
        client.release();
      }
    }

    // 207 Multi-Status cuando hubo de las dos: el que integra tiene que poder
    // distinguir "entró todo" de "entró una parte" sin parsear el cuerpo.
    res.status(errores.length ? (ok.length ? 207 : 400) : 200).json({
      recibidos: body.products.length,
      creados: ok.filter((r) => r.created).length,
      actualizados: ok.filter((r) => !r.created).length,
      rechazados: errores.length,
      resultados: ok,
      errores,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/stock
 * Actualización sólo de stock, que es lo que un depósito manda seguido.
 * Separado del catálogo para que el cron de stock corra cada 5 minutos sin
 * tener que mandar el producto entero.
 */
const stockSchema = z.object({
  items: z.array(z.object({
    sku: z.string().min(1).max(60),
    stock: z.coerce.number().int().min(0),
  })).min(1).max(1000),
});

integrationRouter.patch("/stock", requireApiKey("stock:write"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = stockSchema.parse(req.body);
    const merchantId = req.apiKey.merchantId;

    await client.query("BEGIN");
    const actualizados: string[] = [];
    const noEncontrados: string[] = [];

    for (const item of body.items) {
      const { rowCount } = await client.query(
        "UPDATE products SET stock = $3, updated_at = now() WHERE merchant_id = $1 AND sku = $2",
        [merchantId, item.sku, item.stock]
      );
      if (rowCount) actualizados.push(item.sku);
      else noEncontrados.push(item.sku);
    }
    await client.query("COMMIT");

    res.json({
      actualizados: actualizados.length,
      noEncontrados,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

/** GET /api/v1/products — el catálogo tal como lo tenemos nosotros */
integrationRouter.get("/products", requireApiKey("catalog:write"), async (req, res, next) => {
  try {
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const { rows } = await pool.query(
      `SELECT *, COUNT(*) OVER () AS total FROM products
       WHERE merchant_id = $1 ORDER BY sku LIMIT $2 OFFSET $3`,
      [req.apiKey.merchantId, q.limit, q.offset]
    );
    res.json({ total: rows[0]?.total ?? 0, items: rows.map(serializeProduct) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/orders
 * Las ventas del comercio, para que su sistema arme el remito. Por ahora se
 * consulta; la notificación push (webhooks) queda para más adelante.
 */
integrationRouter.get("/orders", requireApiKey("orders:read"), async (req, res, next) => {
  try {
    const q = z.object({
      status: z.enum(["pending", "accepted", "shipped", "delivered", "cancelled"]).optional(),
      since: z.string().datetime().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query);

    const { rows } = await pool.query(
      `SELECT mo.id, mo.merchant_order_number, mo.status, mo.subtotal,
              mo.payout_amount, mo.created_at,
              o.order_number, o.installments,
              COALESCE(json_agg(json_build_object(
                'sku', p.sku, 'productId', i.product_id, 'name', i.product_name,
                'quantity', i.quantity, 'unitPrice', i.unit_price
              )) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
       FROM merchant_orders mo
       JOIN orders o ON o.id = mo.order_id
       LEFT JOIN order_items i ON i.merchant_order_id = mo.id
       LEFT JOIN products p ON p.id = i.product_id
       WHERE mo.merchant_id = $1
         AND ($2::text IS NULL OR mo.status = $2)
         AND ($3::timestamptz IS NULL OR mo.created_at >= $3)
       GROUP BY mo.id, o.order_number, o.installments
       ORDER BY mo.created_at DESC LIMIT $4`,
      [req.apiKey.merchantId, q.status ?? null, q.since ?? null, q.limit]
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});
