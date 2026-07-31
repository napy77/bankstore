import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { signStaffToken, requireStaff, type StaffRole } from "../middleware/staff.js";

export const staffAuthRouter = Router();

const loginSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase().trim()),
  password: z.string().min(1),
});

/** POST /api/staff/login — entrada al panel de plataforma y de comercio */
staffAuthRouter.post("/login", async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const { rows } = await pool.query(
      `SELECT s.id, s.email, s.name, s.role, s.merchant_id, s.password_hash, s.active,
              m.status AS merchant_status, m.trade_name
       FROM staff_users s
       LEFT JOIN merchants m ON m.id = s.merchant_id
       WHERE s.email = $1`,
      [body.email]
    );
    const staff = rows[0];

    // Se compara siempre, exista o no la cuenta, para que el tiempo de
    // respuesta no delate qué emails son de back-office.
    const hash = staff?.password_hash ?? "$2a$12$" + "x".repeat(53);
    const okPassword = await bcrypt.compare(body.password, hash);
    if (!staff || !okPassword) throw new HttpError(401, "Email o contraseña incorrectos");

    if (!staff.active) throw new HttpError(403, "La cuenta está deshabilitada");
    // Un comercio suspendido no opera: ni publica ni ve órdenes.
    if (staff.merchant_id && staff.merchant_status !== "active") {
      throw new HttpError(403, `El comercio está ${staff.merchant_status}`);
    }

    await pool.query("UPDATE staff_users SET last_login_at = now() WHERE id = $1", [staff.id]);

    res.json({
      token: signStaffToken({
        staffId: staff.id,
        email: staff.email,
        name: staff.name,
        role: staff.role as StaffRole,
        merchantId: staff.merchant_id,
      }),
      user: {
        id: staff.id,
        email: staff.email,
        name: staff.name,
        role: staff.role,
        merchantId: staff.merchant_id,
        merchantName: staff.trade_name ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/staff/me */
staffAuthRouter.get("/me", requireStaff, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.email, s.name, s.role, s.merchant_id, m.trade_name
       FROM staff_users s LEFT JOIN merchants m ON m.id = s.merchant_id
       WHERE s.id = $1 AND s.active`,
      [req.staff.staffId]
    );
    if (!rows[0]) throw new HttpError(401, "La cuenta ya no está activa");
    const s = rows[0];
    res.json({
      id: s.id, email: s.email, name: s.name, role: s.role,
      merchantId: s.merchant_id, merchantName: s.trade_name ?? null,
    });
  } catch (err) {
    next(err);
  }
});
