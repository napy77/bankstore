import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { signToken } from "../middleware/auth.js";

export const authRouter = Router();

const credentialsSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase().trim()),
  password: z.string().min(8, "La contraseña necesita al menos 8 caracteres"),
});

const registerSchema = credentialsSchema.extend({
  name: z.string().min(2).max(80).trim(),
});

authRouter.post("/register", async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    const exists = await pool.query("SELECT 1 FROM users WHERE email = $1", [body.email]);
    if (exists.rowCount) throw new HttpError(409, "Ya hay una cuenta con ese email");

    const hash = await bcrypt.hash(body.password, 12);
    const {
      rows: [user],
    } = await pool.query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)
       RETURNING id, email, name`,
      [body.email, hash, body.name]
    );
    res.status(201).json({
      token: signToken({ userId: user.id, email: user.email, name: user.name }),
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const body = credentialsSchema.parse(req.body);
    const { rows } = await pool.query(
      "SELECT id, email, name, password_hash FROM users WHERE email = $1",
      [body.email]
    );
    const user = rows[0];

    // Se compara el hash aunque el usuario no exista, contra un dummy con el
    // mismo costo. Si respondiéramos al toque cuando no hay cuenta, el tiempo
    // de respuesta delataría qué emails están registrados.
    const hash = user?.password_hash ?? "$2a$12$" + "x".repeat(53);
    const okPassword = await bcrypt.compare(body.password, hash);

    if (!user || !okPassword) throw new HttpError(401, "Email o contraseña incorrectos");

    res.json({
      token: signToken({ userId: user.id, email: user.email, name: user.name }),
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/auth/me — para que el frontend valide el token guardado. */
authRouter.get("/me", async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new HttpError(401, "Token requerido");
    const { verify } = await import("jsonwebtoken");
    const { config } = await import("../config.js");
    const payload = verify(header.slice(7), config.jwtSecret) as { userId: number };
    const { rows } = await pool.query("SELECT id, email, name FROM users WHERE id = $1", [
      payload.userId,
    ]);
    if (!rows[0]) throw new HttpError(401, "La cuenta ya no existe");
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof HttpError) return next(err);
    next(new HttpError(401, "Token inválido o expirado"));
  }
});
