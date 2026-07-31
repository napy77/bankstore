import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { HttpError } from "./error.js";

export type StaffRole = "platform_admin" | "merchant_admin" | "merchant_staff";

export interface StaffPayload {
  staffId: number;
  email: string;
  name: string;
  role: StaffRole;
  /** null sólo para platform_admin. */
  merchantId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff: StaffPayload;
    }
  }
}

/**
 * Los tokens de back-office se firman con audiencia 'staff' y los de los
 * compradores con 'customer' (ver middleware/auth.ts).
 *
 * Esto es lo que impide que un comprador entre al panel: aunque las dos
 * familias de token se firmen con el mismo secreto, `jwt.verify` con
 * `audience` rechaza el que no corresponde. Sin este claim, un token de
 * comprador con un `userId` que coincidiera con un `staffId` pasaría el
 * verify y quedaría con permisos de administrador.
 */
export const STAFF_AUDIENCE = "bankstore:staff";
export const CUSTOMER_AUDIENCE = "bankstore:customer";

export function signStaffToken(payload: StaffPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: "8h",
    audience: STAFF_AUDIENCE,
  });
}

function readStaffToken(req: Request): StaffPayload {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new HttpError(401, "Token requerido");
  try {
    return jwt.verify(header.slice(7), config.jwtSecret, {
      audience: STAFF_AUDIENCE,
    }) as StaffPayload;
  } catch {
    throw new HttpError(401, "Token inválido o expirado");
  }
}

/** Exige un usuario de back-office, de cualquier rol. */
export function requireStaff(req: Request, _res: Response, next: NextFunction): void {
  try {
    req.staff = readStaffToken(req);
    next();
  } catch (err) {
    next(err);
  }
}

/** Exige que sea de la plataforma, no de un comercio. */
export function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction): void {
  try {
    const staff = readStaffToken(req);
    if (staff.role !== "platform_admin") {
      throw new HttpError(403, "Hace falta ser administrador de la plataforma");
    }
    req.staff = staff;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Exige que sea de un comercio y deja el merchantId listo para usar.
 *
 * Todos los endpoints de /api/merchant filtran por ESTE merchantId, nunca por
 * uno que venga en la URL o en el body. Es lo único que separa el catálogo de
 * Electro 1 del de Electro 2.
 */
export function requireMerchant(req: Request, _res: Response, next: NextFunction): void {
  try {
    const staff = readStaffToken(req);
    if (!staff.merchantId) {
      throw new HttpError(403, "Este endpoint es para usuarios de un comercio");
    }
    req.staff = staff;
    next();
  } catch (err) {
    next(err);
  }
}

/** Escrituras del panel: el staff común puede mirar, el admin del comercio toca. */
export function requireMerchantAdmin(req: Request, _res: Response, next: NextFunction): void {
  try {
    const staff = readStaffToken(req);
    if (!staff.merchantId || staff.role === "merchant_staff") {
      throw new HttpError(403, "Hace falta ser administrador del comercio");
    }
    req.staff = staff;
    next();
  } catch (err) {
    next(err);
  }
}
