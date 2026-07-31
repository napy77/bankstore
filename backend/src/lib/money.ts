/** Redondeo a centavos, media arriba. */
export function round2(n: number): number {
  // El +Number.EPSILON corrige el caso clásico de 1.005 → 1.00 por la
  // representación binaria del float.
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Suma de montos redondeando una sola vez al final. */
export function sum(values: number[]): number {
  return round2(values.reduce((a, b) => a + b, 0));
}
