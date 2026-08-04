import type pg from "pg";
import { cotizar, type RateRow, type ShippingQuote } from "./shipping.js";
import { round2 } from "./money.js";

/**
 * Puente entre la base y el motor de cotización.
 *
 * El motor (lib/shipping.ts) es puro y testeable; acá se le traen las zonas,
 * las tarifas y el peso de cada comercio. Lo usan el simulador del carrito y
 * el checkout, que tienen que dar exactamente el mismo número.
 */

/** IVA del servicio de envío. En Argentina es la alícuota general. */
export const IVA_ENVIO = 0.21;

export interface ContextoEnvio {
  zonasPorProvincia: Map<string, string>;
  rates: RateRow[];
}

export async function cargarContexto(client: pg.PoolClient | pg.Pool): Promise<ContextoEnvio> {
  const [{ rows: zonas }, { rows: rates }] = await Promise.all([
    client.query<{ province: string; zone_id: string }>(
      `SELECT p.province, p.zone_id FROM shipping_zone_provinces p
       JOIN shipping_zones z ON z.id = p.zone_id WHERE z.active`
    ),
    client.query<RateRow>(
      "SELECT zone_id, up_to_grams, price, price_per_extra_kg FROM shipping_rates WHERE active"
    ),
  ]);
  return {
    zonasPorProvincia: new Map(zonas.map((z) => [z.province, z.zone_id])),
    rates,
  };
}

/**
 * Peso facturable de lo que despacha cada comercio en este carrito.
 *
 * El transportista cobra por el mayor entre el peso real y el volumétrico, así
 * que se calculan los dos y gana el más alto. Un producto sin bultos cargados
 * pesa 0: no se puede inventar, y el comercio ya tiene el aviso en su panel.
 */
export async function pesoPorComercio(
  client: pg.PoolClient | pg.Pool,
  items: { productId: string; quantity: number }[]
): Promise<Map<string, number>> {
  if (items.length === 0) return new Map();

  const { rows } = await client.query<{
    merchant_id: string; product_id: string;
    peso_real_g: number; peso_volumetrico_g: number;
  }>(
    `SELECT p.merchant_id, p.id AS product_id,
            COALESCE(SUM(pk.weight_g), 0)::int AS peso_real_g,
            COALESCE(SUM(peso_volumetrico_g(pk.height_mm, pk.width_mm, pk.length_mm)), 0)::int
              AS peso_volumetrico_g
     FROM products p
     LEFT JOIN product_packages pk ON pk.product_id = p.id
     WHERE p.id = ANY($1)
     GROUP BY p.merchant_id, p.id`,
    [items.map((i) => i.productId)]
  );

  const cantidades = new Map(items.map((i) => [i.productId, i.quantity]));
  const porComercio = new Map<string, number>();
  for (const r of rows) {
    const cant = cantidades.get(r.product_id) ?? 1;
    // El peso facturable se decide por producto y después se suma: comparar
    // los totales del comercio daría distinto si uno pesa y otro abulta.
    const facturable = Math.max(r.peso_real_g, r.peso_volumetrico_g) * cant;
    porComercio.set(r.merchant_id, (porComercio.get(r.merchant_id) ?? 0) + facturable);
  }
  return porComercio;
}

export interface EnvioDeComercio extends ShippingQuote {
  merchantId: string;
}

/** Cotiza el envío de cada comercio del carrito. */
export function cotizarComercios(
  ctx: ContextoEnvio,
  province: string,
  comercios: {
    merchantId: string; subtotal: number; weightG: number;
    ships: boolean; freeShippingOver: number | null;
  }[]
): EnvioDeComercio[] {
  return comercios.map((c) => ({
    merchantId: c.merchantId,
    ...cotizar({
      province,
      weightG: c.weightG,
      merchantSubtotal: c.subtotal,
      ships: c.ships,
      freeShippingOver: c.freeShippingOver,
      zonasPorProvincia: ctx.zonasPorProvincia,
      rates: ctx.rates,
    }),
  }));
}

/** El total de envío del carrito y su desglose de IVA. */
export function totalizarEnvio(envios: EnvioDeComercio[]) {
  const total = round2(envios.reduce((a, e) => a + e.cost, 0));
  const neto = round2(total / (1 + IVA_ENVIO));
  return {
    total,
    net: neto,
    // Por diferencia, para que neto + IVA dé el total exacto.
    iva: round2(total - neto),
  };
}
