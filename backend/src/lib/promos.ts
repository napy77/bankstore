/**
 * Resolución de beneficios bancarios.
 *
 * Hay dos niveles y uno pisa al otro:
 *
 *   1. bank_promos       — el acuerdo general del banco para una categoría.
 *   2. product_bank_offers — la oferta puntual de ese banco para ese producto.
 *
 * Si el producto tiene oferta propia, manda esa. Si no, se cae a la promo de
 * categoría. Si no hay ninguna, es 1 cuota y sin reintegro.
 *
 * Ojo con el reintegro: NO es un descuento. No baja lo que se financia ni lo
 * que se le cobra hoy a la tarjeta; se acredita después en el resumen. Por eso
 * el monto financiado siempre es el precio de lista de venta.
 */

import { round2 } from "./money.js";

export interface BankPromoRow {
  bank_id: string;
  category_id: string;
  max_cuotas: number;
  discount_percent: number;
  cap_amount: number | null;
  description: string;
}

export interface ProductOfferRow {
  product_id: string;
  bank_id: string;
  max_cuotas: number;
  discount_percent: number;
  extra_reintegro_percent: number;
}

export interface Benefit {
  bankId: string;
  maxCuotas: number;
  /** Fracción: 0.15 = 15% de reintegro. */
  reintegroPercent: number;
  /** Tope del reintegro por cuenta y período. null = sin tope. */
  capAmount: number | null;
  source: "product" | "category" | "none";
  description: string;
}

export const NO_BENEFIT: Benefit = {
  bankId: "",
  maxCuotas: 1,
  reintegroPercent: 0,
  capAmount: null,
  source: "none",
  description: "Sin beneficios para esta tarjeta",
};

export function resolveBenefit(
  bankId: string,
  categoryId: string,
  offer: ProductOfferRow | undefined,
  promo: BankPromoRow | undefined
): Benefit {
  if (offer) {
    // El extra se suma al descuento de la oferta: es la mecánica de "15% del
    // banco + 5% adicional por ser producto de campaña".
    const reintegro = offer.discount_percent + offer.extra_reintegro_percent;
    return {
      bankId,
      maxCuotas: offer.max_cuotas,
      reintegroPercent: Math.min(reintegro, 1),
      // La oferta de producto hereda el tope de la promo de categoría: los
      // topes los pone el banco por cuenta, no por producto.
      capAmount: promo?.cap_amount ?? null,
      source: "product",
      description:
        promo?.description ||
        `${offer.max_cuotas} cuotas sin interés y ${Math.round(reintegro * 100)}% de reintegro`,
    };
  }
  if (promo && promo.category_id === categoryId) {
    return {
      bankId,
      maxCuotas: promo.max_cuotas,
      reintegroPercent: promo.discount_percent,
      capAmount: promo.cap_amount,
      source: "category",
      description: promo.description,
    };
  }
  return { ...NO_BENEFIT, bankId };
}

/**
 * Reintegro de una línea, sin aplicar el tope todavía.
 * El tope se aplica a nivel orden porque es por cuenta, no por producto:
 * si comprás tres televisores no te reintegran tres veces el tope.
 */
export function grossReintegro(lineTotal: number, benefit: Benefit): number {
  return round2(lineTotal * benefit.reintegroPercent);
}

export interface ReintegroLine {
  categoryId: string;
  amount: number;
  capAmount: number | null;
}

/**
 * Aplica los topes agrupando por categoría, que es como los publica el banco
 * ("hasta $40.000 de tope en Electrohogar"). Dos productos de la misma
 * categoría comparten un tope; uno de Tecno y uno de Electro tienen el suyo.
 */
export function applyCaps(lines: ReintegroLine[]): number {
  const byCategory = new Map<string, { total: number; cap: number | null }>();
  for (const line of lines) {
    const acc = byCategory.get(line.categoryId) ?? { total: 0, cap: line.capAmount };
    acc.total += line.amount;
    // Si dos líneas de la misma categoría traen topes distintos (no debería,
    // pero el schema lo permite), se respeta el más chico.
    if (line.capAmount !== null) {
      acc.cap = acc.cap === null ? line.capAmount : Math.min(acc.cap, line.capAmount);
    }
    byCategory.set(line.categoryId, acc);
  }
  let total = 0;
  for (const { total: amount, cap } of byCategory.values()) {
    total += cap === null ? amount : Math.min(amount, cap);
  }
  return round2(total);
}
