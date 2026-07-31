import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { HttpError } from "../middleware/error.js";

export const adminRouter = Router();

/**
 * Administración de la plataforma. Todo lo de acá lo usa el operador del
 * marketplace (el banco), no los comercios.
 *
 * El router entero cuelga de requirePlatformAdmin en index.ts, así que ningún
 * endpoint vuelve a chequear el rol: si llegaste hasta acá, sos plataforma.
 */

const slug = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Sólo minúsculas, números y guiones");

async function auditar(
  staffId: number,
  action: string,
  entity: string,
  entityId: string,
  payload?: unknown
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (staff_user_id, action, entity, entity_id, payload)
     VALUES ($1,$2,$3,$4,$5)`,
    [staffId, action, entity, entityId, payload ? JSON.stringify(payload) : null]
  );
}

// ── Comercios ────────────────────────────────────────────────────────────────

const merchantSchema = z.object({
  id: slug,
  legalName: z.string().min(2).max(120).trim(),
  tradeName: z.string().min(2).max(80).trim(),
  taxId: z.string().max(20).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(30).optional(),
  // Se reciben como porcentaje (8 = 8%) porque es como lo piensa quien lo
  // carga; a fracción se convierte acá, una sola vez.
  commissionPercent: z.coerce.number().min(0).max(100).default(0),
  absorbsInstallmentCost: z.boolean().default(true),
  settlementDays: z.coerce.number().int().min(0).max(180).default(30),
  categories: z.array(z.string()).default([]),
});

function serializeMerchant(m: Record<string, any>) {
  return {
    id: m.id,
    legalName: m.legal_name,
    tradeName: m.trade_name,
    taxId: m.tax_id,
    status: m.status,
    contactEmail: m.contact_email,
    contactPhone: m.contact_phone,
    commissionPercent: Number(m.commission_percent) * 100,
    absorbsInstallmentCost: m.absorbs_installment_cost,
    settlementDays: m.settlement_days,
    categories: m.categories ?? [],
    productCount: m.product_count ?? undefined,
    createdAt: m.created_at,
  };
}

/** GET /api/admin/merchants */
adminRouter.get("/merchants", async (req, res, next) => {
  try {
    const status = z.enum(["draft", "active", "suspended"]).optional().parse(req.query.status);
    const { rows } = await pool.query(
      `SELECT m.*,
              COALESCE(ARRAY_AGG(DISTINCT mc.category_id)
                       FILTER (WHERE mc.category_id IS NOT NULL), '{}') AS categories,
              (SELECT COUNT(*)::int FROM products p WHERE p.merchant_id = m.id AND p.active) AS product_count
       FROM merchants m
       LEFT JOIN merchant_categories mc ON mc.merchant_id = m.id
       WHERE ($1::text IS NULL OR m.status = $1)
       GROUP BY m.id ORDER BY m.trade_name`,
      [status ?? null]
    );
    res.json(rows.map(serializeMerchant));
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/merchants — alta de comercio */
adminRouter.post("/merchants", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = merchantSchema.parse(req.body);
    await client.query("BEGIN");

    const exists = await client.query("SELECT 1 FROM merchants WHERE id = $1", [body.id]);
    if (exists.rowCount) throw new HttpError(409, `Ya existe un comercio con el id "${body.id}"`);

    if (body.categories.length) {
      const { rows: valid } = await client.query(
        "SELECT id FROM product_categories WHERE id = ANY($1)",
        [body.categories]
      );
      if (valid.length !== body.categories.length) {
        const conocidas = new Set(valid.map((r) => r.id));
        const malas = body.categories.filter((c) => !conocidas.has(c));
        throw new HttpError(400, `Categorías inexistentes: ${malas.join(", ")}`);
      }
    }

    const { rows } = await client.query(
      `INSERT INTO merchants (id, legal_name, trade_name, tax_id, contact_email, contact_phone,
                              commission_percent, absorbs_installment_cost, settlement_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [body.id, body.legalName, body.tradeName, body.taxId ?? null, body.contactEmail ?? null,
       body.contactPhone ?? null, body.commissionPercent / 100,
       body.absorbsInstallmentCost, body.settlementDays]
    );
    for (const cat of body.categories) {
      await client.query("INSERT INTO merchant_categories VALUES ($1,$2)", [body.id, cat]);
    }

    await client.query("COMMIT");
    await auditar(req.staff.staffId, "merchant.create", "merchants", body.id, { tradeName: body.tradeName });
    // Nace en 'draft': no vende hasta que la plataforma lo active a propósito.
    res.status(201).json(serializeMerchant({ ...rows[0], categories: body.categories }));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

/** GET /api/admin/merchants/:id */
adminRouter.get("/merchants/:id", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*,
              COALESCE(ARRAY_AGG(DISTINCT mc.category_id)
                       FILTER (WHERE mc.category_id IS NOT NULL), '{}') AS categories,
              (SELECT COUNT(*)::int FROM products p WHERE p.merchant_id = m.id AND p.active) AS product_count
       FROM merchants m
       LEFT JOIN merchant_categories mc ON mc.merchant_id = m.id
       WHERE m.id = $1 GROUP BY m.id`,
      [req.params.id]
    );
    if (!rows[0]) throw new HttpError(404, "Comercio no encontrado");
    res.json(serializeMerchant(rows[0]));
  } catch (err) {
    next(err);
  }
});

const merchantPatchSchema = merchantSchema.partial().omit({ id: true }).extend({
  status: z.enum(["draft", "active", "suspended"]).optional(),
});

/** PATCH /api/admin/merchants/:id */
adminRouter.patch("/merchants/:id", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = merchantPatchSchema.parse(req.body);
    await client.query("BEGIN");

    const { rows: current } = await client.query(
      "SELECT * FROM merchants WHERE id = $1 FOR UPDATE",
      [req.params.id]
    );
    if (!current[0]) throw new HttpError(404, "Comercio no encontrado");

    const campos: Record<string, unknown> = {};
    if (body.legalName !== undefined) campos.legal_name = body.legalName;
    if (body.tradeName !== undefined) campos.trade_name = body.tradeName;
    if (body.taxId !== undefined) campos.tax_id = body.taxId;
    if (body.contactEmail !== undefined) campos.contact_email = body.contactEmail;
    if (body.contactPhone !== undefined) campos.contact_phone = body.contactPhone;
    if (body.commissionPercent !== undefined) campos.commission_percent = body.commissionPercent / 100;
    if (body.absorbsInstallmentCost !== undefined) campos.absorbs_installment_cost = body.absorbsInstallmentCost;
    if (body.settlementDays !== undefined) campos.settlement_days = body.settlementDays;
    if (body.status !== undefined) campos.status = body.status;

    if (Object.keys(campos).length) {
      const sets = Object.keys(campos).map((k, i) => `${k} = $${i + 2}`);
      await client.query(
        `UPDATE merchants SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`,
        [req.params.id, ...Object.values(campos)]
      );
    }

    if (body.categories !== undefined) {
      // Quitarle una categoría a un comercio que ya publicó ahí dejaría esos
      // productos en un estado que el trigger prohíbe. Se avisa en vez de
      // romper por debajo.
      const { rows: enUso } = await client.query(
        `SELECT DISTINCT category_id FROM products
         WHERE merchant_id = $1 AND active AND NOT (category_id = ANY($2))`,
        [req.params.id, body.categories]
      );
      if (enUso.length) {
        throw new HttpError(
          400,
          `No puedo quitar ${enUso.map((r) => r.category_id).join(", ")}: el comercio tiene productos activos ahí. ` +
            "Despublicalos primero."
        );
      }
      await client.query("DELETE FROM merchant_categories WHERE merchant_id = $1", [req.params.id]);
      for (const cat of body.categories) {
        await client.query("INSERT INTO merchant_categories VALUES ($1,$2)", [req.params.id, cat]);
      }
    }

    await client.query("COMMIT");
    await auditar(req.staff.staffId, "merchant.update", "merchants", req.params.id, body);

    const { rows } = await pool.query(
      `SELECT m.*, COALESCE(ARRAY_AGG(DISTINCT mc.category_id)
              FILTER (WHERE mc.category_id IS NOT NULL), '{}') AS categories
       FROM merchants m LEFT JOIN merchant_categories mc ON mc.merchant_id = m.id
       WHERE m.id = $1 GROUP BY m.id`,
      [req.params.id]
    );
    res.json(serializeMerchant(rows[0]));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ── Usuarios de comercio ─────────────────────────────────────────────────────

const staffSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase().trim()),
  password: z.string().min(10, "Para el back-office pedimos al menos 10 caracteres"),
  name: z.string().min(2).max(80).trim(),
  role: z.enum(["platform_admin", "merchant_admin", "merchant_staff"]),
  merchantId: z.string().nullable().default(null),
});

/** POST /api/admin/staff — crear usuario de plataforma o de comercio */
adminRouter.post("/staff", async (req, res, next) => {
  try {
    const body = staffSchema.parse(req.body);

    // La base tiene el mismo CHECK, pero un 400 con explicación es más útil
    // que un 500 con un error de constraint.
    if (body.role === "platform_admin" && body.merchantId) {
      throw new HttpError(400, "Un administrador de plataforma no pertenece a ningún comercio");
    }
    if (body.role !== "platform_admin" && !body.merchantId) {
      throw new HttpError(400, "Un usuario de comercio necesita un merchantId");
    }
    if (body.merchantId) {
      const m = await pool.query("SELECT 1 FROM merchants WHERE id = $1", [body.merchantId]);
      if (!m.rowCount) throw new HttpError(404, "Ese comercio no existe");
    }

    const exists = await pool.query("SELECT 1 FROM staff_users WHERE email = $1", [body.email]);
    if (exists.rowCount) throw new HttpError(409, "Ya hay un usuario con ese email");

    const hash = await bcrypt.hash(body.password, 12);
    const { rows } = await pool.query(
      `INSERT INTO staff_users (email, password_hash, name, role, merchant_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, email, name, role, merchant_id, created_at`,
      [body.email, hash, body.name, body.role, body.merchantId]
    );
    await auditar(req.staff.staffId, "staff.create", "staff_users", String(rows[0].id), {
      email: body.email, role: body.role, merchantId: body.merchantId,
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/staff */
adminRouter.get("/staff", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.email, s.name, s.role, s.merchant_id, s.active, s.last_login_at,
              m.trade_name AS merchant_name
       FROM staff_users s LEFT JOIN merchants m ON m.id = s.merchant_id
       WHERE ($1::text IS NULL OR s.merchant_id = $1)
       ORDER BY s.created_at DESC`,
      [(req.query.merchantId as string) ?? null]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/admin/staff/:id — habilitar o deshabilitar */
adminRouter.patch("/staff/:id", async (req, res, next) => {
  try {
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    const id = Number(req.params.id);
    if (id === req.staff.staffId && !active) {
      throw new HttpError(400, "No podés deshabilitar tu propia cuenta");
    }
    const { rowCount } = await pool.query("UPDATE staff_users SET active = $2 WHERE id = $1", [id, active]);
    if (!rowCount) throw new HttpError(404, "Usuario no encontrado");
    await auditar(req.staff.staffId, "staff.update", "staff_users", req.params.id, { active });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ── Acuerdos bancarios ───────────────────────────────────────────────────────

const agreementSchema = z.object({
  bankId: z.string(),
  merchantId: z.string().nullable().default(null),
  categoryId: z.string().nullable().default(null),
  maxCuotas: z.coerce.number().int().min(1).max(24),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  capAmount: z.coerce.number().nonnegative().nullable().default(null),
  description: z.string().max(200).default(""),
  priority: z.coerce.number().int().default(0),
  validFrom: z.string().date().nullable().default(null),
  validTo: z.string().date().nullable().default(null),
  active: z.boolean().default(true),
});

function serializeAgreement(a: Record<string, any>) {
  return {
    id: a.id,
    bankId: a.bank_id,
    bankName: a.bank_name,
    merchantId: a.merchant_id,
    merchantName: a.merchant_name,
    categoryId: a.category_id,
    maxCuotas: a.max_cuotas,
    discountPercent: Number(a.discount_percent) * 100,
    capAmount: a.cap_amount,
    description: a.description,
    priority: a.priority,
    validFrom: a.valid_from,
    validTo: a.valid_to,
    active: a.active,
    // Para que en el panel se vea de un vistazo por qué un acuerdo le gana a
    // otro, sin tener que deducirlo de los NULL.
    alcance: a.merchant_id
      ? a.category_id ? "comercio + categoría" : "comercio"
      : a.category_id ? "categoría" : "global",
  };
}

/** GET /api/admin/agreements */
adminRouter.get("/agreements", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, b.name AS bank_name, m.trade_name AS merchant_name
       FROM bank_agreements a
       JOIN banks b ON b.id = a.bank_id
       LEFT JOIN merchants m ON m.id = a.merchant_id
       WHERE ($1::text IS NULL OR a.merchant_id = $1)
         AND ($2::text IS NULL OR a.bank_id = $2)
       ORDER BY b.name,
                (a.merchant_id IS NOT NULL)::int * 2 + (a.category_id IS NOT NULL)::int DESC,
                a.priority DESC`,
      [(req.query.merchantId as string) ?? null, (req.query.bankId as string) ?? null]
    );
    res.json(rows.map(serializeAgreement));
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/agreements */
adminRouter.post("/agreements", async (req, res, next) => {
  try {
    const body = agreementSchema.parse(req.body);

    const bank = await pool.query("SELECT 1 FROM banks WHERE id = $1", [body.bankId]);
    if (!bank.rowCount) throw new HttpError(404, "Ese banco no existe");
    if (body.merchantId) {
      const m = await pool.query("SELECT 1 FROM merchants WHERE id = $1", [body.merchantId]);
      if (!m.rowCount) throw new HttpError(404, "Ese comercio no existe");
    }
    if (body.categoryId) {
      const c = await pool.query("SELECT 1 FROM product_categories WHERE id = $1", [body.categoryId]);
      if (!c.rowCount) throw new HttpError(404, "Esa categoría no existe");
    }
    // Si el acuerdo apunta a comercio y categoría, la categoría tiene que
    // estar habilitada para ese comercio o el acuerdo no se aplicaría nunca.
    if (body.merchantId && body.categoryId) {
      const habilitada = await pool.query(
        "SELECT 1 FROM merchant_categories WHERE merchant_id = $1 AND category_id = $2",
        [body.merchantId, body.categoryId]
      );
      if (!habilitada.rowCount) {
        throw new HttpError(400, "Ese comercio no tiene habilitada esa categoría: el acuerdo nunca se aplicaría");
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO bank_agreements (bank_id, merchant_id, category_id, max_cuotas, discount_percent,
                                    cap_amount, description, priority, valid_from, valid_to, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [body.bankId, body.merchantId, body.categoryId, body.maxCuotas, body.discountPercent / 100,
       body.capAmount, body.description, body.priority, body.validFrom, body.validTo, body.active]
    );
    await auditar(req.staff.staffId, "agreement.create", "bank_agreements", String(rows[0].id), body);
    res.status(201).json(serializeAgreement(rows[0]));
  } catch (err) {
    if (typeof err === "object" && err && (err as { code?: string }).code === "23505") {
      next(new HttpError(409, "Ya hay un acuerdo con ese mismo alcance (banco, comercio y categoría)"));
      return;
    }
    next(err);
  }
});

/** PATCH /api/admin/agreements/:id */
adminRouter.patch("/agreements/:id", async (req, res, next) => {
  try {
    const body = agreementSchema.partial().omit({ bankId: true, merchantId: true, categoryId: true }).parse(req.body);
    const campos: Record<string, unknown> = {};
    if (body.maxCuotas !== undefined) campos.max_cuotas = body.maxCuotas;
    if (body.discountPercent !== undefined) campos.discount_percent = body.discountPercent / 100;
    if (body.capAmount !== undefined) campos.cap_amount = body.capAmount;
    if (body.description !== undefined) campos.description = body.description;
    if (body.priority !== undefined) campos.priority = body.priority;
    if (body.validFrom !== undefined) campos.valid_from = body.validFrom;
    if (body.validTo !== undefined) campos.valid_to = body.validTo;
    if (body.active !== undefined) campos.active = body.active;
    if (!Object.keys(campos).length) throw new HttpError(400, "No mandaste nada para cambiar");

    const sets = Object.keys(campos).map((k, i) => `${k} = $${i + 2}`);
    const { rowCount } = await pool.query(
      `UPDATE bank_agreements SET ${sets.join(", ")} WHERE id = $1`,
      [Number(req.params.id), ...Object.values(campos)]
    );
    if (!rowCount) throw new HttpError(404, "Acuerdo no encontrado");
    await auditar(req.staff.staffId, "agreement.update", "bank_agreements", req.params.id, body);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/admin/agreements/:id */
adminRouter.delete("/agreements/:id", async (req, res, next) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM bank_agreements WHERE id = $1", [
      Number(req.params.id),
    ]);
    if (!rowCount) throw new HttpError(404, "Acuerdo no encontrado");
    await auditar(req.staff.staffId, "agreement.delete", "bank_agreements", req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ── Categorías y bancos ──────────────────────────────────────────────────────

const categorySchema = z.object({
  id: slug,
  name: z.string().min(2).max(60).trim(),
  parentId: z.string().nullable().default(null),
});

/** POST /api/admin/categories */
adminRouter.post("/categories", async (req, res, next) => {
  try {
    const body = categorySchema.parse(req.body);
    if (body.parentId) {
      const p = await pool.query("SELECT 1 FROM product_categories WHERE id = $1", [body.parentId]);
      if (!p.rowCount) throw new HttpError(404, "La categoría padre no existe");
    }
    const { rows } = await pool.query(
      `INSERT INTO product_categories (id, name, parent_id) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO NOTHING RETURNING *`,
      [body.id, body.name, body.parentId]
    );
    if (!rows[0]) throw new HttpError(409, "Ya existe una categoría con ese id");
    await auditar(req.staff.staffId, "category.create", "product_categories", body.id);
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

const bankSchema = z.object({
  id: slug,
  name: z.string().min(2).max(60).trim(),
  logoColor: z.string().max(120).default(""),
  accentColor: z.string().max(120).default(""),
  textColor: z.string().max(120).default(""),
});

/** POST /api/admin/banks */
adminRouter.post("/banks", async (req, res, next) => {
  try {
    const body = bankSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO banks (id, name, logo_color, accent_color, text_color)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING RETURNING *`,
      [body.id, body.name, body.logoColor, body.accentColor, body.textColor]
    );
    if (!rows[0]) throw new HttpError(409, "Ya existe un banco con ese id");
    await auditar(req.staff.staffId, "bank.create", "banks", body.id);
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ── Órdenes de toda la plataforma ────────────────────────────────────────────

/** GET /api/admin/orders */
adminRouter.get("/orders", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.order_number, o.created_at, o.total_amount, o.installments,
              o.bank_name, o.card_last4, o.merchant_count, u.email AS customer_email,
              COALESCE(ARRAY_AGG(mo.merchant_id), '{}') AS merchants
       FROM orders o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN merchant_orders mo ON mo.order_id = o.id
       WHERE ($1::text IS NULL OR EXISTS (
               SELECT 1 FROM merchant_orders x WHERE x.order_id = o.id AND x.merchant_id = $1))
       GROUP BY o.id, u.email
       ORDER BY o.created_at DESC LIMIT 200`,
      [(req.query.merchantId as string) ?? null]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/settlements
 * Cuánto hay que pagarle a cada comercio y cuánto retuvo el marketplace.
 */
adminRouter.get("/settlements", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT mo.merchant_id, m.trade_name,
              COUNT(*)::int          AS ordenes,
              SUM(mo.subtotal)          AS bruto,
              SUM(mo.commission_amount) AS comision,
              SUM(mo.installment_cost)  AS costo_cuotas,
              SUM(mo.payout_amount)     AS a_pagar
       FROM merchant_orders mo
       JOIN merchants m ON m.id = mo.merchant_id
       WHERE mo.status <> 'cancelled'
         AND ($1::date IS NULL OR mo.created_at >= $1)
         AND ($2::date IS NULL OR mo.created_at < $2::date + 1)
       GROUP BY mo.merchant_id, m.trade_name
       ORDER BY a_pagar DESC`,
      [(req.query.from as string) ?? null, (req.query.to as string) ?? null]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});
