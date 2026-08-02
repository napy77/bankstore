import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { requireMerchantAdmin } from "../middleware/staff.js";
import { generateApiKey } from "../middleware/apikey.js";
import {
  productInputSchema, upsertProduct, serializeProduct, traducirErrorDeCategoria,
} from "../lib/products.js";

export const merchantRouter = Router();

/**
 * Panel del comercio.
 *
 * Todo el router cuelga de requireMerchant, así que req.staff.merchantId
 * siempre está. Cada consulta filtra por ese id y nunca por uno que venga del
 * cliente: es lo único que separa el catálogo de Electro 1 del de Electro 2.
 */

function miComercio(req: { staff: { merchantId: string | null } }): string {
  // requireMerchant ya garantiza que no sea null; esto es para el tipo.
  if (!req.staff.merchantId) throw new HttpError(403, "Falta el comercio en el token");
  return req.staff.merchantId;
}

// ── Perfil ───────────────────────────────────────────────────────────────────

/** GET /api/merchant/profile — lo que el comercio puede ver de sí mismo */
merchantRouter.get("/profile", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.trade_name, m.legal_name, m.tax_id, m.status,
              m.commission_percent, m.absorbs_installment_cost, m.settlement_days,
              COALESCE(ARRAY_AGG(DISTINCT mc.category_id)
                       FILTER (WHERE mc.category_id IS NOT NULL), '{}') AS categories
       FROM merchants m LEFT JOIN merchant_categories mc ON mc.merchant_id = m.id
       WHERE m.id = $1 GROUP BY m.id`,
      [miComercio(req)]
    );
    if (!rows[0]) throw new HttpError(404, "Comercio no encontrado");
    const m = rows[0];
    // Habilitar un nodo habilita su rama entera (ver migración 005), así que
    // el panel necesita las hojas resueltas para poder ofrecerlas en el alta.
    const { rows: permitidas } = await pool.query(
      `SELECT DISTINCT d.id
       FROM merchant_categories mc, categorias_descendientes(mc.category_id) d
       WHERE mc.merchant_id = $1`,
      [miComercio(req)]
    );
    res.json({
      id: m.id, tradeName: m.trade_name, legalName: m.legal_name, taxId: m.tax_id,
      status: m.status,
      // Las condiciones se muestran pero no se editan: las fija la plataforma.
      commissionPercent: Number(m.commission_percent) * 100,
      absorbsInstallmentCost: m.absorbs_installment_cost,
      settlementDays: m.settlement_days,
      categories: m.categories,
      // Todas las categorías donde puede publicar, ya expandidas.
      allowedCategories: permitidas.map((c) => c.id),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/merchant/agreements — qué beneficios bancarios le aplican */
merchantRouter.get("/agreements", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.bank_id, b.name AS bank_name, a.category_id, a.max_cuotas,
              a.discount_percent, a.cap_amount, a.description, a.valid_from, a.valid_to,
              (a.merchant_id IS NOT NULL) AS exclusivo
       FROM bank_agreements a JOIN banks b ON b.id = a.bank_id
       WHERE a.active
         AND (a.merchant_id IS NULL OR a.merchant_id = $1)
         AND (a.valid_from IS NULL OR a.valid_from <= CURRENT_DATE)
         AND (a.valid_to   IS NULL OR a.valid_to   >= CURRENT_DATE)
       ORDER BY b.name, a.category_id NULLS FIRST`,
      [miComercio(req)]
    );
    res.json(rows.map((a) => ({
      id: a.id, bankId: a.bank_id, bankName: a.bank_name, categoryId: a.category_id,
      maxCuotas: a.max_cuotas, discountPercent: Number(a.discount_percent) * 100,
      capAmount: a.cap_amount, description: a.description,
      validFrom: a.valid_from, validTo: a.valid_to,
      exclusivo: a.exclusivo,
    })));
  } catch (err) {
    next(err);
  }
});

// ── Catálogo propio ──────────────────────────────────────────────────────────

/** GET /api/merchant/products */
merchantRouter.get("/products", async (req, res, next) => {
  try {
    const q = z.object({
      search: z.string().max(120).optional(),
      active: z.enum(["true", "false"]).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const { rows } = await pool.query(
      `SELECT p.*, b.name AS brand_name,
              COUNT(*) OVER () AS total,
              -- Los bultos se traen con el producto: el panel los edita en la
              -- misma pantalla y pedirlos aparte sería una request por fila.
              COALESCE((
                SELECT json_agg(json_build_object(
                         'seq', pk.seq, 'heightMm', pk.height_mm, 'widthMm', pk.width_mm,
                         'lengthMm', pk.length_mm, 'weightG', pk.weight_g) ORDER BY pk.seq)
                FROM product_packages pk WHERE pk.product_id = p.id), '[]') AS packages
       FROM products p
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE p.merchant_id = $1
         AND ($2::text IS NULL OR p.name ILIKE '%' || $2 || '%' OR p.sku ILIKE '%' || $2 || '%')
         AND ($3::boolean IS NULL OR p.active = $3)
       ORDER BY p.updated_at DESC LIMIT $4 OFFSET $5`,
      [miComercio(req), q.search ?? null, q.active === undefined ? null : q.active === "true",
       q.limit, q.offset]
    );
    res.json({ total: rows[0]?.total ?? 0, items: rows.map(serializeProduct) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/merchant/products — alta o actualización por SKU */
merchantRouter.post("/products", requireMerchantAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = productInputSchema.parse(req.body);
    await client.query("BEGIN");
    const { row, created } = await upsertProduct(client, miComercio(req), input);
    await client.query("COMMIT");
    res.status(created ? 201 : 200).json(serializeProduct(row));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(traducirErrorDeCategoria(err));
  } finally {
    client.release();
  }
});

/** PATCH /api/merchant/products/:id — cambios puntuales (precio, stock, baja) */
const productPatchSchema = z.object({
  name: z.string().min(2).max(160).trim().optional(),
  description: z.string().max(2000).optional(),
  price: z.coerce.number().positive().optional(),
  originalPrice: z.coerce.number().positive().nullable().optional(),
  stock: z.coerce.number().int().min(0).optional(),
  active: z.boolean().optional(),
  image: z.string().max(300).optional(),
});

merchantRouter.patch("/products/:id", requireMerchantAdmin, async (req, res, next) => {
  try {
    const body = productPatchSchema.parse(req.body);
    const campos: Record<string, unknown> = {};
    if (body.name !== undefined) campos.name = body.name;
    if (body.description !== undefined) campos.description = body.description;
    if (body.price !== undefined) campos.price = body.price;
    if (body.originalPrice !== undefined) campos.original_price = body.originalPrice;
    if (body.stock !== undefined) campos.stock = body.stock;
    if (body.active !== undefined) campos.active = body.active;
    if (body.image !== undefined) campos.image = body.image;
    if (!Object.keys(campos).length) throw new HttpError(400, "No mandaste nada para cambiar");

    const sets = Object.keys(campos).map((k, i) => `${k} = $${i + 3}`);
    // El WHERE lleva merchant_id: si el id es de otro comercio, no actualiza
    // nada y devuelve 404 sin revelar que el producto existe.
    const { rows } = await pool.query(
      `UPDATE products SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $1 AND merchant_id = $2 RETURNING *`,
      [req.params.id, miComercio(req), ...Object.values(campos)]
    );
    if (!rows[0]) throw new HttpError(404, "Producto no encontrado en tu catálogo");
    res.json(serializeProduct(rows[0]));
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/merchant/products/:id
 * Baja lógica: el producto puede estar en órdenes viejas, así que no se borra.
 */
merchantRouter.delete("/products/:id", requireMerchantAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      "UPDATE products SET active = false, updated_at = now() WHERE id = $1 AND merchant_id = $2",
      [req.params.id, miComercio(req)]
    );
    if (!rowCount) throw new HttpError(404, "Producto no encontrado en tu catálogo");
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ── Órdenes propias ──────────────────────────────────────────────────────────

/** GET /api/merchant/orders */
merchantRouter.get("/orders", async (req, res, next) => {
  try {
    const status = z
      .enum(["pending", "accepted", "shipped", "delivered", "cancelled"])
      .optional()
      .parse(req.query.status);

    const { rows } = await pool.query(
      `SELECT mo.id, mo.merchant_order_number, mo.status, mo.subtotal,
              mo.commission_amount, mo.installment_cost, mo.payout_amount,
              mo.settlement_date, mo.created_at,
              o.order_number, o.installments, o.bank_name, o.card_last4,
              u.name AS customer_name
       FROM merchant_orders mo
       JOIN orders o ON o.id = mo.order_id
       JOIN users u  ON u.id = o.user_id
       WHERE mo.merchant_id = $1 AND ($2::text IS NULL OR mo.status = $2)
       ORDER BY mo.created_at DESC LIMIT 200`,
      [miComercio(req), status ?? null]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/** GET /api/merchant/orders/:id — detalle con los ítems */
merchantRouter.get("/orders/:id", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT mo.*, o.order_number, o.installments, o.bank_name, o.card_last4,
              u.name AS customer_name, u.email AS customer_email
       FROM merchant_orders mo
       JOIN orders o ON o.id = mo.order_id
       JOIN users u  ON u.id = o.user_id
       WHERE mo.id = $1 AND mo.merchant_id = $2`,
      [Number(req.params.id), miComercio(req)]
    );
    if (!rows[0]) throw new HttpError(404, "Orden no encontrada");
    const { rows: items } = await pool.query(
      "SELECT product_id, product_name, quantity, unit_price FROM order_items WHERE merchant_order_id = $1",
      [Number(req.params.id)]
    );
    res.json({ ...rows[0], items });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/merchant/orders/:id — avanzar el estado del despacho */
const TRANSICIONES: Record<string, string[]> = {
  pending: ["accepted", "cancelled"],
  accepted: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

merchantRouter.patch("/orders/:id", requireMerchantAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { status } = z
      .object({ status: z.enum(["accepted", "shipped", "delivered", "cancelled"]) })
      .parse(req.body);

    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT * FROM merchant_orders WHERE id = $1 AND merchant_id = $2 FOR UPDATE",
      [Number(req.params.id), miComercio(req)]
    );
    const orden = rows[0];
    if (!orden) throw new HttpError(404, "Orden no encontrada");

    // La máquina de estados evita cosas como pasar de 'delivered' a 'pending'
    // o cancelar algo que ya se entregó.
    if (!TRANSICIONES[orden.status]?.includes(status)) {
      throw new HttpError(400, `No se puede pasar de "${orden.status}" a "${status}"`);
    }

    // Cancelar devuelve la mercadería al stock. Si no, el comercio cancela y
    // el stock queda descontado para siempre.
    if (status === "cancelled") {
      const { rows: items } = await client.query(
        "SELECT product_id, quantity FROM order_items WHERE merchant_order_id = $1",
        [orden.id]
      );
      for (const item of items) {
        await client.query("UPDATE products SET stock = stock + $2 WHERE id = $1", [
          item.product_id, item.quantity,
        ]);
      }
    }

    await client.query(
      "UPDATE merchant_orders SET status = $2, updated_at = now() WHERE id = $1",
      [orden.id, status]
    );
    await client.query(
      `INSERT INTO audit_log (staff_user_id, merchant_id, action, entity, entity_id, payload)
       VALUES ($1,$2,'merchant_order.status','merchant_orders',$3,$4)`,
      [req.staff.staffId, miComercio(req), String(orden.id),
       JSON.stringify({ de: orden.status, a: status })]
    );
    await client.query("COMMIT");
    res.json({ id: orden.id, status });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ── Claves de API ────────────────────────────────────────────────────────────

/** GET /api/merchant/api-keys — sin el secreto, que no se puede recuperar */
merchantRouter.get("/api-keys", requireMerchantAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, key_prefix, scopes, last_used_at, revoked_at, created_at
       FROM merchant_api_keys WHERE merchant_id = $1 ORDER BY created_at DESC`,
      [miComercio(req)]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/** POST /api/merchant/api-keys — el secreto se devuelve UNA vez */
merchantRouter.post("/api-keys", requireMerchantAdmin, async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(2).max(60).trim(),
      scopes: z.array(z.enum(["catalog:write", "stock:write", "orders:read"]))
        .min(1).default(["catalog:write", "stock:write", "orders:read"]),
    }).parse(req.body);

    const activas = await pool.query(
      "SELECT COUNT(*)::int AS n FROM merchant_api_keys WHERE merchant_id = $1 AND revoked_at IS NULL",
      [miComercio(req)]
    );
    if (activas.rows[0].n >= 10) {
      throw new HttpError(400, "Ya tenés 10 claves activas: revocá alguna antes de crear otra");
    }

    const key = generateApiKey();
    const { rows } = await pool.query(
      `INSERT INTO merchant_api_keys (merchant_id, name, key_prefix, key_hash, scopes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, key_prefix, scopes, created_at`,
      [miComercio(req), body.name, key.prefix, key.hash, body.scopes, req.staff.staffId]
    );

    res.status(201).json({
      ...rows[0],
      key: key.plaintext,
      aviso: "Guardala ahora: es la única vez que se muestra. Si la perdés, revocala y creá otra.",
    });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/merchant/api-keys/:id — revocar */
merchantRouter.delete("/api-keys/:id", requireMerchantAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE merchant_api_keys SET revoked_at = now()
       WHERE id = $1 AND merchant_id = $2 AND revoked_at IS NULL`,
      [Number(req.params.id), miComercio(req)]
    );
    if (!rowCount) throw new HttpError(404, "Clave no encontrada o ya revocada");
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
