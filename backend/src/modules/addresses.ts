import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { HttpError } from "../middleware/error.js";

export const addressesRouter = Router();

/**
 * Libreta de direcciones del comprador.
 *
 * Todo filtra por el userId del token: una dirección es de quien la cargó y de
 * nadie más.
 */

export const addressSchema = z.object({
  label: z.string().max(40).trim().nullable().default(null),
  recipient: z.string().min(2).max(80).trim(),
  phone: z.string().max(30).trim().nullable().default(null),
  street: z.string().min(2).max(120).trim(),
  number: z.string().min(1).max(20).trim(),
  floorApt: z.string().max(30).trim().nullable().default(null),
  zip: z.string().min(3).max(12).trim(),
  city: z.string().min(2).max(80).trim(),
  province: z.string().min(2).max(80).trim(),
  notes: z.string().max(200).trim().nullable().default(null),
  isDefault: z.boolean().default(false),
});

export function serializeAddress(a: Record<string, any>) {
  return {
    id: a.id,
    label: a.label,
    recipient: a.recipient,
    phone: a.phone,
    street: a.street,
    number: a.number,
    floorApt: a.floor_apt,
    zip: a.zip,
    city: a.city,
    province: a.province,
    notes: a.notes,
    isDefault: a.is_default,
  };
}

/** GET /api/addresses */
addressesRouter.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM user_addresses WHERE user_id = $1
       ORDER BY is_default DESC, created_at DESC`,
      [req.auth.userId]
    );
    res.json(rows.map(serializeAddress));
  } catch (err) {
    next(err);
  }
});

/** POST /api/addresses */
addressesRouter.post("/", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = addressSchema.parse(req.body);
    await client.query("BEGIN");

    // La primera dirección queda como predeterminada aunque no lo pidan: si no,
    // el checkout no tendría ninguna preseleccionada.
    const { rows: existentes } = await client.query(
      "SELECT COUNT(*)::int AS n FROM user_addresses WHERE user_id = $1",
      [req.auth.userId]
    );
    const esDefault = body.isDefault || existentes[0].n === 0;

    if (esDefault) {
      // El índice único parcial no deja dos predeterminadas: hay que bajar la
      // anterior antes de subir la nueva.
      await client.query(
        "UPDATE user_addresses SET is_default = false WHERE user_id = $1 AND is_default",
        [req.auth.userId]
      );
    }

    const { rows } = await client.query(
      `INSERT INTO user_addresses (user_id, label, recipient, phone, street, number,
                                   floor_apt, zip, city, province, notes, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.auth.userId, body.label, body.recipient, body.phone, body.street, body.number,
       body.floorApt, body.zip, body.city, body.province, body.notes, esDefault]
    );
    await client.query("COMMIT");
    res.status(201).json(serializeAddress(rows[0]));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

/** PATCH /api/addresses/:id */
addressesRouter.patch("/:id", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = addressSchema.partial().parse(req.body);
    await client.query("BEGIN");

    if (body.isDefault) {
      await client.query(
        "UPDATE user_addresses SET is_default = false WHERE user_id = $1 AND is_default",
        [req.auth.userId]
      );
    }

    const campos: Record<string, unknown> = {};
    if (body.label !== undefined) campos.label = body.label;
    if (body.recipient !== undefined) campos.recipient = body.recipient;
    if (body.phone !== undefined) campos.phone = body.phone;
    if (body.street !== undefined) campos.street = body.street;
    if (body.number !== undefined) campos.number = body.number;
    if (body.floorApt !== undefined) campos.floor_apt = body.floorApt;
    if (body.zip !== undefined) campos.zip = body.zip;
    if (body.city !== undefined) campos.city = body.city;
    if (body.province !== undefined) campos.province = body.province;
    if (body.notes !== undefined) campos.notes = body.notes;
    if (body.isDefault !== undefined) campos.is_default = body.isDefault;
    if (!Object.keys(campos).length) throw new HttpError(400, "No mandaste nada para cambiar");

    const sets = Object.keys(campos).map((k, i) => `${k} = $${i + 3}`);
    // El WHERE lleva user_id: una dirección ajena no actualiza nada y devuelve
    // 404 sin revelar que existe.
    const { rows } = await client.query(
      `UPDATE user_addresses SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [Number(req.params.id), req.auth.userId, ...Object.values(campos)]
    );
    if (!rows[0]) throw new HttpError(404, "Dirección no encontrada");

    await client.query("COMMIT");
    res.json(serializeAddress(rows[0]));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/addresses/:id
 * La orden guarda una copia del domicilio, así que borrar la dirección no
 * afecta a los remitos ya emitidos.
 */
addressesRouter.delete("/:id", async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM user_addresses WHERE id = $1 AND user_id = $2",
      [Number(req.params.id), req.auth.userId]
    );
    if (!rowCount) throw new HttpError(404, "Dirección no encontrada");
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
