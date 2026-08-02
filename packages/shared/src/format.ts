/**
 * Formateo compartido. Las tres apps muestran los mismos montos y tasas, así
 * que conviene que lo hagan igual: si el panel del comercio redondea distinto
 * que la tienda, el comercio llama para preguntar por qué no coinciden.
 */

const PESOS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
});

const PESOS_ENTEROS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export function money(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return PESOS.format(Number(value));
}

/** Sin centavos, para listados y tarjetas donde el detalle estorba. */
export function moneyShort(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return PESOS_ENTEROS.format(Number(value));
}

/**
 * El backend manda las tasas como fracción (0.42) porque es la unidad en la
 * que hace las cuentas. Al usuario se le muestra en porcentaje.
 */
export function percent(fraction: number | string | null | undefined, decimals = 2): string {
  if (fraction === null || fraction === undefined) return "—";
  return `${(Number(fraction) * 100).toFixed(decimals)}%`;
}

/** Para valores que el backend ya manda en porcentaje (comisiones del panel). */
export function percentDirect(value: number | string | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(decimals)}%`;
}

export function date(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  accepted: "Aceptada",
  shipped: "Despachada",
  delivered: "Entregada",
  cancelled: "Cancelada",
};

export const MERCHANT_STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  active: "Activo",
  suspended: "Suspendido",
};

export const ROLE_LABEL: Record<string, string> = {
  platform_admin: "Administrador de plataforma",
  merchant_admin: "Administrador del comercio",
  merchant_staff: "Operador",
};

// ── Unidades ─────────────────────────────────────────────────────────────────
// La API guarda milímetros y gramos. Estas funciones son sólo para mostrar:
// la conversión al guardar la hace el servidor, que es donde tiene que estar.

export function mmToCm(mm: number): number {
  return Math.round((mm / 10) * 100) / 100;
}

export function gToKg(g: number): number {
  return Math.round((g / 1000) * 1000) / 1000;
}

/**
 * Peso volumétrico en kg, con el divisor estándar de plaza (5000 cm³/kg).
 * Se replica del backend para poder mostrarlo mientras el comercio escribe,
 * sin ir al servidor en cada tecla.
 */
export function volumetricKg(heightMm: number, widthMm: number, lengthMm: number): number {
  return Math.round(((heightMm * widthMm * lengthMm) / 1000 / 5000) * 1000) / 1000;
}
