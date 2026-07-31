import type { Request, Response, NextFunction } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { pool } from "../db.js";
import { HttpError } from "./error.js";

/**
 * Autenticación de los sistemas de los comercios.
 *
 * La clave se muestra UNA sola vez, al crearla. En la base va sólo el hash,
 * igual que una contraseña: si alguien se lleva un dump, no se lleva claves
 * usables. El prefijo se guarda en claro nada más que para poder listarlas e
 * identificarlas en los logs.
 *
 * Formato:  bsk_<prefijo 8>_<secreto 32>
 *           └── "bankstore key", para que se reconozca si aparece pegada en
 *               un ticket o commiteada por error.
 */

export interface ApiKeyContext {
  keyId: number;
  merchantId: string;
  scopes: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey: ApiKeyContext;
    }
  }
}

export interface GeneratedKey {
  /** Se le muestra al comercio una vez y no se puede recuperar. */
  plaintext: string;
  prefix: string;
  hash: string;
}

export function generateApiKey(): GeneratedKey {
  const prefix = randomBytes(4).toString("hex");          // 8 caracteres
  const secret = randomBytes(24).toString("base64url");   // ~32 caracteres
  const plaintext = `bsk_${prefix}_${secret}`;
  return { plaintext, prefix: `bsk_${prefix}`, hash: hashKey(plaintext) };
}

/**
 * SHA-256 a secas, sin bcrypt. Suena a poco al lado de una contraseña, pero el
 * caso es distinto: esta clave son 24 bytes aleatorios, no algo que alguien
 * pueda adivinar con un diccionario. Lo que sí importa es que el hash sea
 * rápido, porque se calcula en CADA request de la integración; bcrypt con
 * costo 12 metería ~250 ms por llamada.
 */
function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Exige una API key válida y deja el comercio en req.apiKey.
 *
 * Igual que con los tokens de staff: el merchantId sale SIEMPRE de la clave,
 * nunca de la URL. Una clave de Electro 1 no puede tocar el catálogo de
 * Electro 2 aunque mande su id en el body.
 */
export function requireApiKey(scope: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = req.headers["x-api-key"];
      const presented = Array.isArray(raw) ? raw[0] : raw;
      if (!presented) throw new HttpError(401, "Falta el header X-API-Key");

      const parts = presented.split("_");
      if (parts.length !== 3 || parts[0] !== "bsk") {
        throw new HttpError(401, "El formato de la clave no es válido");
      }
      const prefix = `bsk_${parts[1]}`;

      const { rows } = await pool.query(
        `SELECT k.id, k.merchant_id, k.key_hash, k.scopes, k.revoked_at, m.status
         FROM merchant_api_keys k
         JOIN merchants m ON m.id = k.merchant_id
         WHERE k.key_prefix = $1`,
        [prefix]
      );
      const key = rows[0];
      // Mismo mensaje para "no existe" y "no coincide": si distinguiéramos,
      // se podría enumerar qué prefijos son válidos.
      if (!key || !safeEqualHex(key.key_hash, hashKey(presented))) {
        throw new HttpError(401, "Clave inválida");
      }
      if (key.revoked_at) throw new HttpError(401, "Esa clave fue revocada");
      if (key.status !== "active") {
        throw new HttpError(403, `El comercio está ${key.status}: la integración está deshabilitada`);
      }
      if (!key.scopes.includes(scope)) {
        throw new HttpError(403, `Esta clave no tiene el permiso "${scope}"`);
      }

      // Sirve para detectar integraciones muertas y para saber si una clave
      // que se quiere revocar todavía está en uso. Sin await: que una escritura
      // de telemetría no meta latencia en el camino de la request.
      pool
        .query("UPDATE merchant_api_keys SET last_used_at = now() WHERE id = $1", [key.id])
        .catch(() => {});

      req.apiKey = { keyId: key.id, merchantId: key.merchant_id, scopes: key.scopes };
      next();
    } catch (err) {
      next(err);
    }
  };
}
