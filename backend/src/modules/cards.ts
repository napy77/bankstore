import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { HttpError } from "../middleware/error.js";

export const cardsRouter = Router();

/**
 * Billetera del usuario.
 *
 * Acá NO entra el número completo de la tarjeta. El endpoint de alta acepta el
 * PAN sólo para validarlo con Luhn, deducir la marca y quedarse con los
 * últimos 4; el resto se descarta antes de tocar la base. Ver el comentario de
 * la tabla `cards` en 001_initial.sql.
 */

/** Algoritmo de Luhn: descarta los números tipeados mal, no valida que exista. */
function luhnValid(pan: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = pan.length - 1; i >= 0; i--) {
    let digit = pan.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) return false;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function detectBrand(pan: string): "visa" | "mastercard" | "amex" | "cabal" | null {
  if (/^4/.test(pan)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(pan)) return "mastercard";
  if (/^3[47]/.test(pan)) return "amex";
  if (/^(58|60|6042|6043|6044)/.test(pan)) return "cabal";
  return null;
}

const addCardSchema = z.object({
  // Se acepta con espacios o guiones, como lo tipea la gente.
  cardNumber: z
    .string()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .refine((v) => /^[0-9]{13,19}$/.test(v), "El número de tarjeta no es válido")
    .refine(luhnValid, "El número de tarjeta no pasa la validación"),
  holderName: z.string().min(2).max(60).trim().toUpperCase(),
  expiryMonth: z.coerce.number().int().min(1).max(12),
  expiryYear: z.coerce.number().int().min(2024).max(2100),
  bankId: z.string(),
  displayName: z.string().min(2).max(60).trim(),
  tier: z.enum(["black", "signature", "platinum", "gold", "classic"]).default("classic"),
  creditLimit: z.coerce.number().nonnegative().default(0),
  colorTheme: z.enum(["navy", "black", "platinum", "gold", "red", "teal"]).default("navy"),
});

function serializeCard(row: Record<string, unknown>) {
  return {
    id: row.id,
    bankId: row.bank_id,
    bankName: row.display_name,
    holderName: row.holder_name,
    // El frontend espera el formato enmascarado que ya dibuja la tarjeta.
    cardNumber: `•••• •••• •••• ${row.last4}`,
    last4: row.last4,
    brand: row.brand,
    tier: row.tier,
    expiryDate: `${String(row.expiry_month).padStart(2, "0")}/${String(row.expiry_year).slice(-2)}`,
    limit: row.credit_limit,
    availableLimit: row.available_limit,
    colorTheme: row.color_theme,
  };
}

/** GET /api/cards — billetera del usuario del token */
cardsRouter.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM cards WHERE user_id = $1 ORDER BY created_at",
      [req.auth.userId]
    );
    res.json(rows.map(serializeCard));
  } catch (err) {
    next(err);
  }
});

/** POST /api/cards — vincular una tarjeta */
cardsRouter.post("/", async (req, res, next) => {
  try {
    const body = addCardSchema.parse(req.body);

    const brand = detectBrand(body.cardNumber);
    if (!brand) throw new HttpError(400, "No reconocemos esa marca de tarjeta");

    // Una tarjeta vencida no sirve para comprar; mejor rechazarla al vincular
    // que dejar que falle recién en el checkout.
    const now = new Date();
    const expiry = new Date(body.expiryYear, body.expiryMonth, 0, 23, 59, 59);
    if (expiry < now) throw new HttpError(400, "La tarjeta está vencida");

    const bank = await pool.query("SELECT 1 FROM banks WHERE id = $1 AND active", [body.bankId]);
    if (!bank.rowCount) throw new HttpError(400, "Ese banco no está disponible");

    const last4 = body.cardNumber.slice(-4);
    // A partir de acá el PAN completo ya no se usa nunca más.

    const { rows } = await pool.query(
      `INSERT INTO cards (user_id, bank_id, display_name, holder_name, last4, brand, tier,
                          expiry_month, expiry_year, credit_limit, available_limit, color_theme)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11)
       ON CONFLICT (user_id, bank_id, last4, brand) DO NOTHING
       RETURNING *`,
      [
        req.auth.userId, body.bankId, body.displayName, body.holderName, last4, brand,
        body.tier, body.expiryMonth, body.expiryYear, body.creditLimit, body.colorTheme,
      ]
    );
    if (!rows[0]) throw new HttpError(409, "Esa tarjeta ya está en tu billetera");

    res.status(201).json(serializeCard(rows[0]));
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/cards/:id */
cardsRouter.delete("/:id", async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM cards WHERE id = $1 AND user_id = $2",
      [Number(req.params.id), req.auth.userId]
    );
    if (!rowCount) throw new HttpError(404, "Tarjeta no encontrada");
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
