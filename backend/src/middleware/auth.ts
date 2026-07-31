import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface AuthPayload {
  userId: number;
  email: string;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth: AuthPayload;
    }
  }
}

/**
 * Los tokens de comprador llevan audiencia 'customer' y los de back-office
 * 'staff' (ver middleware/staff.ts). Es lo que impide que uno sirva para el
 * otro aunque compartan el secreto de firma.
 */
export const CUSTOMER_AUDIENCE = "bankstore:customer";

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: "12h",
    audience: CUSTOMER_AUDIENCE,
  });
}

/**
 * El userId sale siempre del token, nunca de un parámetro de la request.
 * Es lo único que separa la billetera de un usuario de la de otro: si algún
 * endpoint aceptara user_id por body, cualquiera podría leer las tarjetas
 * ajenas mandando otro número.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Token requerido" });
    return;
  }
  try {
    req.auth = jwt.verify(header.slice(7), config.jwtSecret, {
      audience: CUSTOMER_AUDIENCE,
    }) as AuthPayload;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido o expirado" });
  }
}
