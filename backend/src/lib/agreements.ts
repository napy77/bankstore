/**
 * Qué beneficio bancario aplica a un producto de un comercio.
 *
 * Ahora que hay muchos comercios, un mismo banco puede tener varias reglas que
 * calzan a la vez sobre la misma compra:
 *
 *   "18 cuotas en Electro 1"                   (comercio, sin categoría)
 *   "12 cuotas en tecnología, en toda la app"  (categoría, sin comercio)
 *   "24 cuotas en tecnología de Electro 1"     (comercio + categoría)
 *   "6 cuotas en todo"                         (global)
 *
 * Gana el MÁS ESPECÍFICO, no el más generoso. Es lo contrario de lo que uno
 * esperaría a primera vista, pero es como funcionan los acuerdos comerciales:
 * si el banco negoció algo puntual para un comercio, ese acuerdo reemplaza al
 * general —para bien o para mal—, no se suman ni se elige el mejor.
 *
 * Por encima de todo sigue estando la oferta puntual del producto
 * (product_bank_offers), que es la campaña de un artículo concreto.
 *
 * La categoría se compara contra el CAMINO completo del producto, no contra su
 * hoja: un acuerdo sobre "Electrohogar" tiene que cubrir también los
 * ventiladores, que cuelgan dos niveles más abajo. Comparar sólo la hoja hacía
 * que cualquier producto publicado en una subcategoría perdiera sus beneficios
 * sin que nadie se enterara.
 */

import { round2 } from "./money.js";

export interface AgreementRow {
  id: number;
  bank_id: string;
  merchant_id: string | null;
  category_id: string | null;
  max_cuotas: number;
  discount_percent: number;
  cap_amount: number | null;
  description: string;
  priority: number;
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
  capAmount: number | null;
  /**
   * Con qué se está topeando el reintegro. Dos productos que compartan esta
   * clave comparten un solo tope; los de claves distintas topean por separado.
   */
  capKey: string;
  source: "product" | "agreement" | "none";
  /** Acuerdo que se aplicó, para poder auditar después por qué se cobró así. */
  agreementId: number | null;
  description: string;
}

export function noBenefit(bankId: string): Benefit {
  return {
    bankId,
    maxCuotas: 1,
    reintegroPercent: 0,
    capAmount: null,
    capKey: "none",
    source: "none",
    agreementId: null,
    description: "Sin beneficios para esta tarjeta",
  };
}

/**
 * Puntaje de especificidad. Apuntar a un comercio pesa más que apuntar a una
 * categoría: el acuerdo con el comercio es el que se firmó y el que se paga.
 */
function specificity(a: AgreementRow): number {
  return (a.merchant_id ? 2 : 0) + (a.category_id ? 1 : 0);
}

/**
 * Cuán cerca de la hoja apunta el acuerdo.
 *
 * Con el camino ["electrohogar", "climatizacion", "ventiladores"], un acuerdo
 * sobre "climatizacion" es más específico que uno sobre "electrohogar". Sin
 * este desempate, cuál gana dependería del orden que devuelva Postgres.
 */
function profundidad(a: AgreementRow, camino: string[]): number {
  if (!a.category_id) return -1;
  return camino.indexOf(a.category_id);
}

/**
 * Camino de cada categoría hasta su raíz, para poder resolver los acuerdos sin
 * una consulta por producto. La tabla es chica: se carga entera y se arma en
 * memoria.
 */
export function construirCaminos(
  categorias: { id: string; parent_id: string | null }[]
): Map<string, string[]> {
  const padres = new Map(categorias.map((c) => [c.id, c.parent_id]));
  const caminos = new Map<string, string[]>();
  for (const c of categorias) {
    const camino: string[] = [];
    let actual: string | null = c.id;
    // El tope evita un ciclo infinito si alguna vez quedan datos inconsistentes.
    let vueltas = 0;
    while (actual && vueltas++ < 20) {
      camino.unshift(actual);
      actual = padres.get(actual) ?? null;
    }
    caminos.set(c.id, camino);
  }
  return caminos;
}

/** El acuerdo que corresponde, o undefined si ninguno alcanza. */
export function pickAgreement(
  agreements: AgreementRow[],
  bankId: string,
  merchantId: string,
  /** Camino de la categoría, de la raíz a la hoja. */
  categoryPath: string[]
): AgreementRow | undefined {
  const candidates = agreements.filter(
    (a) =>
      a.bank_id === bankId &&
      (a.merchant_id === null || a.merchant_id === merchantId) &&
      // El acuerdo aplica si apunta a la categoría del producto o a cualquiera
      // de sus ancestros.
      (a.category_id === null || categoryPath.includes(a.category_id))
  );
  if (candidates.length === 0) return undefined;

  return candidates.sort((x, y) => {
    const bySpec = specificity(y) - specificity(x);
    if (bySpec !== 0) return bySpec;
    // A igual alcance, el que apunta más cerca de la hoja.
    const byDepth = profundidad(y, categoryPath) - profundidad(x, categoryPath);
    if (byDepth !== 0) return byDepth;
    // Después la prioridad que puso el admin, y por último más cuotas: es sólo
    // para que el resultado sea determinista y no dependa del orden de Postgres.
    const byPriority = y.priority - x.priority;
    if (byPriority !== 0) return byPriority;
    return y.max_cuotas - x.max_cuotas;
  })[0];
}

export function resolveBenefit(
  bankId: string,
  merchantId: string,
  /** Camino de la categoría (raíz→hoja), o la hoja sola si no hay árbol. */
  categoryPath: string[] | string,
  offer: ProductOfferRow | undefined,
  agreements: AgreementRow[]
): Benefit {
  const camino = Array.isArray(categoryPath) ? categoryPath : [categoryPath];
  const categoryId = camino[camino.length - 1] ?? "";
  const agreement = pickAgreement(agreements, bankId, merchantId, camino);

  if (offer) {
    const reintegro = Math.min(offer.discount_percent + offer.extra_reintegro_percent, 1);
    return {
      bankId,
      maxCuotas: offer.max_cuotas,
      reintegroPercent: reintegro,
      // La oferta de producto hereda el tope del acuerdo: los topes los pone el
      // banco por cuenta, no por artículo. Sin acuerdo detrás no hay tope.
      capAmount: agreement?.cap_amount ?? null,
      capKey: agreement ? `ag:${agreement.id}` : `offer:${bankId}:${categoryId}`,
      source: "product",
      agreementId: agreement?.id ?? null,
      description:
        agreement?.description ||
        `${offer.max_cuotas} cuotas sin interés y ${Math.round(reintegro * 100)}% de reintegro`,
    };
  }

  if (!agreement) return noBenefit(bankId);

  return {
    bankId,
    maxCuotas: agreement.max_cuotas,
    reintegroPercent: agreement.discount_percent,
    capAmount: agreement.cap_amount,
    capKey: `ag:${agreement.id}`,
    source: "agreement",
    agreementId: agreement.id,
    description: agreement.description,
  };
}

export interface ReintegroLine {
  /** Acuerdo (o pseudo-acuerdo) bajo el que topea esta línea. */
  capKey: string;
  amount: number;
  capAmount: number | null;
}

/**
 * Aplica los topes agrupando por acuerdo.
 *
 * El tope es por cuenta y por promoción ("hasta $40.000 de reintegro en
 * Electrohogar"), así que dos productos amparados por el mismo acuerdo
 * comparten un único tope aunque sean de comercios distintos. Antes esto
 * agrupaba por categoría, que daba el mismo resultado cuando había un solo
 * comercio pero se rompe en cuanto hay varios.
 */
export function applyCaps(lines: ReintegroLine[]): number {
  const byKey = new Map<string, { total: number; cap: number | null }>();
  for (const line of lines) {
    const acc = byKey.get(line.capKey) ?? { total: 0, cap: line.capAmount };
    acc.total += line.amount;
    if (line.capAmount !== null) {
      acc.cap = acc.cap === null ? line.capAmount : Math.min(acc.cap, line.capAmount);
    }
    byKey.set(line.capKey, acc);
  }
  let total = 0;
  for (const { total: amount, cap } of byKey.values()) {
    total += cap === null ? amount : Math.min(amount, cap);
  }
  return round2(total);
}
