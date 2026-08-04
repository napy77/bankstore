/**
 * Cotización de envío.
 *
 * Tarifario propio: zona de destino × peso facturable. No es una integración
 * con transportista —eso necesita cuenta y contrato— pero la forma es la
 * misma, así que cuando entre Andreani u OCA se suma como otro `carrier` sin
 * tocar a quien cotiza.
 *
 * Se cotiza POR COMERCIO. En un marketplace cada vendedor despacha desde su
 * propio depósito: un carrito con dos comercios son dos envíos y dos costos.
 */

import { round2 } from "./money.js";

export interface RateRow {
  zone_id: string;
  /** Tope del tramo en gramos. null = el último, sin tope. */
  up_to_grams: number | null;
  price: number;
  price_per_extra_kg: number;
}

export interface ShippingQuote {
  zoneId: string;
  /** Peso que se cobra: el mayor entre el real y el volumétrico. */
  weightG: number;
  /** Costo final con IVA. 0 si es gratis. */
  cost: number;
  /** Lo que habría costado, aunque termine gratis. Sirve para la liquidación. */
  listCost: number;
  /** true cuando entró por el umbral y lo absorbe el comercio. */
  absorbed: boolean;
  /** Por qué salió lo que salió, para poder explicárselo al comprador. */
  reason: "tarifa" | "gratis-por-monto" | "no-despacha" | "sin-tarifa";
}

/**
 * Normaliza el nombre de la provincia para poder buscarla.
 *
 * La gente escribe "Córdoba", "cordoba", "CORDOBA" y "Cordoba " indistintamente.
 * Sin normalizar, la mitad de las compras no encontraría zona y quedaría sin
 * cotizar.
 */
export function normalizarProvincia(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Busca el tramo que corresponde al peso.
 *
 * Los tramos se ordenan por tope y gana el primero que lo alcanza. El tramo
 * sin tope (up_to_grams null) va último y cobra un extra por kilo excedente.
 */
export function buscarTarifa(rates: RateRow[], zoneId: string, weightG: number): number | null {
  const delaZona = rates
    .filter((r) => r.zone_id === zoneId)
    // Los null van al final: son el tramo abierto.
    .sort((a, b) => (a.up_to_grams ?? Infinity) - (b.up_to_grams ?? Infinity));

  if (delaZona.length === 0) return null;

  for (const tramo of delaZona) {
    if (tramo.up_to_grams === null) {
      // Tramo abierto: la base más el excedente sobre el último tope cerrado.
      const ultimoCerrado = delaZona
        .filter((r) => r.up_to_grams !== null)
        .reduce((max, r) => Math.max(max, r.up_to_grams!), 0);
      const excedenteKg = Math.max(0, Math.ceil((weightG - ultimoCerrado) / 1000));
      return round2(Number(tramo.price) + excedenteKg * Number(tramo.price_per_extra_kg));
    }
    if (weightG <= tramo.up_to_grams) return round2(Number(tramo.price));
  }
  return null;
}

export interface CotizarParams {
  /** Provincia de destino, sin normalizar. */
  province: string;
  /** Peso facturable en gramos: el mayor entre real y volumétrico. */
  weightG: number;
  /** Lo que se compró a este comercio, para el umbral de envío gratis. */
  merchantSubtotal: number;
  /** Condiciones del comercio. */
  ships: boolean;
  freeShippingOver: number | null;
  /** Zonas y tarifas cargadas. */
  zonasPorProvincia: Map<string, string>;
  rates: RateRow[];
}

export function cotizar(p: CotizarParams): ShippingQuote {
  const vacio = { weightG: p.weightG, cost: 0, listCost: 0 };

  if (!p.ships) {
    return { ...vacio, zoneId: "", absorbed: false, reason: "no-despacha" };
  }

  const zoneId = p.zonasPorProvincia.get(normalizarProvincia(p.province));
  if (!zoneId) {
    // Provincia sin zona: no se inventa un precio. El checkout lo trata como
    // "no cotizable" y lo dice, en vez de cobrar algo arbitrario.
    return { ...vacio, zoneId: "", absorbed: false, reason: "sin-tarifa" };
  }

  const tarifa = buscarTarifa(p.rates, zoneId, p.weightG);
  if (tarifa === null) {
    return { ...vacio, zoneId, absorbed: false, reason: "sin-tarifa" };
  }

  // El umbral se compara contra lo comprado a ESTE comercio, no contra el
  // carrito entero: el que bonifica es él, con su propia venta.
  const gratis = p.freeShippingOver !== null && p.merchantSubtotal >= p.freeShippingOver;

  return {
    zoneId,
    weightG: p.weightG,
    cost: gratis ? 0 : tarifa,
    // El costo de lista se guarda igual: es lo que el comercio se está
    // comiendo al bonificar, y sin eso la liquidación no lo refleja.
    listCost: tarifa,
    absorbed: gratis,
    reason: gratis ? "gratis-por-monto" : "tarifa",
  };
}
