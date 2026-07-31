/**
 * Conversión a unidad canónica.
 *
 * La base guarda milímetros y gramos, siempre, como enteros. El comercio carga
 * en lo que le resulte natural —centímetros, pulgadas, kilos, libras— y la
 * conversión pasa acá, una sola vez, al entrar.
 *
 * El motivo es que guardar el valor junto a su unidad obliga a convertir en
 * cada consumidor: el cotizador de envío, el packing list, los reportes. Basta
 * que uno se olvide para despachar 10 libras creyendo que son 10 kilos.
 */

export const LENGTH_UNITS = ["mm", "cm", "m", "in"] as const;
export const MASS_UNITS = ["g", "kg", "lb", "oz"] as const;

export type LengthUnit = (typeof LENGTH_UNITS)[number];
export type MassUnit = (typeof MASS_UNITS)[number];

const A_MM: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
};

const A_G: Record<MassUnit, number> = {
  g: 1,
  kg: 1000,
  lb: 453.59237,
  oz: 28.349523125,
};

/**
 * Se redondea hacia arriba a propósito. Una caja de 10,4 mm no entra en un
 * hueco de 10; declarar de menos hace que el paquete no cierre o que el
 * transportista recotice en el depósito, que sale más caro que el milímetro
 * de más.
 */
export function toMillimeters(value: number, unit: LengthUnit): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("La medida tiene que ser un número mayor a cero");
  }
  return Math.ceil(value * A_MM[unit]);
}

export function toGrams(value: number, unit: MassUnit): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("El peso tiene que ser un número mayor a cero");
  }
  return Math.ceil(value * A_G[unit]);
}

/** Para mostrar: de la unidad canónica a la que prefiera quien mira. */
export function fromMillimeters(mm: number, unit: LengthUnit): number {
  return Math.round((mm / A_MM[unit]) * 100) / 100;
}

export function fromGrams(g: number, unit: MassUnit): number {
  return Math.round((g / A_G[unit]) * 1000) / 1000;
}

/**
 * Peso volumétrico en gramos: lo que el transportista cobra cuando el bulto
 * ocupa más de lo que pesa. El divisor 5000 (cm³/kg) es el estándar de plaza.
 *
 * Está también en la base (peso_volumetrico_g) para poder calcularlo en las
 * consultas; acá se repite para no tener que ir a la base sólo por esto.
 */
export function volumetricGrams(
  heightMm: number,
  widthMm: number,
  lengthMm: number,
  divisor = 5000
): number {
  return Math.ceil(((heightMm * widthMm * lengthMm) / 1000 / divisor) * 1000);
}

// ── Impuestos ────────────────────────────────────────────────────────────────

/** Alícuotas vigentes de IVA en Argentina. */
export const IVA_RATES = [0, 0.105, 0.21, 0.27] as const;
export type IvaRate = (typeof IVA_RATES)[number];

export interface PriceBreakdown {
  /** Lo que paga el comprador. Es lo que se guarda en products.price. */
  final: number;
  /** Precio sin impuestos. */
  net: number;
  /** El IVA contenido en el precio final. */
  tax: number;
  rate: number;
}

/**
 * Desglose del precio final.
 *
 * Se guarda el precio final y la alícuota, y el neto se deriva. Guardar los dos
 * precios deja dos números que pueden desincronizarse —alcanza con que alguien
 * actualice uno solo— y además el final es el que la ley obliga a mostrar.
 */
export function breakdown(finalPrice: number, rate: number): PriceBreakdown {
  const net = Math.round((finalPrice / (1 + rate)) * 100) / 100;
  return {
    final: Math.round(finalPrice * 100) / 100,
    net,
    // Por diferencia y no recalculando: así net + tax da exactamente final,
    // sin un centavo de descuadre por redondeo.
    tax: Math.round((finalPrice - net) * 100) / 100,
    rate,
  };
}
