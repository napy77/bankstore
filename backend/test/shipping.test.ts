import { test } from "node:test";
import assert from "node:assert/strict";
import { cotizar, buscarTarifa, normalizarProvincia, type RateRow } from "../src/lib/shipping.js";

const TARIFAS: RateRow[] = [
  { zone_id: "amba", up_to_grams: 1000, price: 3500, price_per_extra_kg: 0 },
  { zone_id: "amba", up_to_grams: 5000, price: 5200, price_per_extra_kg: 0 },
  { zone_id: "amba", up_to_grams: 30000, price: 14500, price_per_extra_kg: 0 },
  { zone_id: "amba", up_to_grams: null, price: 14500, price_per_extra_kg: 420 },
  { zone_id: "patagonia", up_to_grams: 1000, price: 8050, price_per_extra_kg: 0 },
];

const ZONAS = new Map([
  ["caba", "amba"],
  ["buenos aires", "bs-as"],
  ["tierra del fuego", "patagonia"],
]);

const BASE = {
  ships: true,
  freeShippingOver: null as number | null,
  zonasPorProvincia: ZONAS,
  rates: TARIFAS,
  merchantSubtotal: 100000,
};

// ── Normalización ────────────────────────────────────────────────────────────

test("la provincia se encuentra escrita de cualquier forma", () => {
  for (const escrita of ["Córdoba", "cordoba", "CÓRDOBA", "  Cordoba  ", "Còrdoba"]) {
    assert.equal(normalizarProvincia(escrita), "cordoba", `falló con "${escrita}"`);
  }
});

// ── Tramos ───────────────────────────────────────────────────────────────────

test("cae en el primer tramo cuyo tope alcanza", () => {
  assert.equal(buscarTarifa(TARIFAS, "amba", 500), 3500);
  assert.equal(buscarTarifa(TARIFAS, "amba", 1000), 3500, "el tope es inclusivo");
  assert.equal(buscarTarifa(TARIFAS, "amba", 1001), 5200);
  assert.equal(buscarTarifa(TARIFAS, "amba", 5000), 5200);
  assert.equal(buscarTarifa(TARIFAS, "amba", 5001), 14500);
});

test("pasado el último tope cerrado se cobra por kilo excedente", () => {
  // 30 kg es el último tope cerrado. 33,5 kg → 4 kg de excedente (se redondea
  // hacia arriba: nadie cobra medio kilo).
  assert.equal(buscarTarifa(TARIFAS, "amba", 33500), 14500 + 4 * 420);
  assert.equal(buscarTarifa(TARIFAS, "amba", 31000), 14500 + 1 * 420);
  // Justo en el tope no hay excedente
  assert.equal(buscarTarifa(TARIFAS, "amba", 30000), 14500);
});

test("el orden en que vienen las tarifas no cambia el resultado", () => {
  const alReves = [...TARIFAS].reverse();
  assert.equal(buscarTarifa(alReves, "amba", 3000), buscarTarifa(TARIFAS, "amba", 3000));
  assert.equal(buscarTarifa(alReves, "amba", 40000), buscarTarifa(TARIFAS, "amba", 40000));
});

test("una zona sin tarifas no cotiza", () => {
  assert.equal(buscarTarifa(TARIFAS, "noa", 1000), null);
});

// ── Cotización ───────────────────────────────────────────────────────────────

test("cotiza por zona: la misma caja sale más lejos", () => {
  const caba = cotizar({ ...BASE, province: "CABA", weightG: 800 });
  const tdf = cotizar({ ...BASE, province: "Tierra del Fuego", weightG: 800 });
  assert.equal(caba.cost, 3500);
  assert.equal(tdf.cost, 8050);
  assert.ok(tdf.cost > caba.cost);
});

test("supera el umbral y viaja gratis, pero el costo queda registrado", () => {
  const q = cotizar({
    ...BASE, province: "CABA", weightG: 800,
    freeShippingOver: 50000, merchantSubtotal: 60000,
  });
  assert.equal(q.cost, 0, "el comprador no paga");
  assert.equal(q.listCost, 3500, "pero se registra lo que costó");
  assert.equal(q.absorbed, true);
  assert.equal(q.reason, "gratis-por-monto");
});

test("justo debajo del umbral se cobra", () => {
  const q = cotizar({
    ...BASE, province: "CABA", weightG: 800,
    freeShippingOver: 50000, merchantSubtotal: 49999,
  });
  assert.equal(q.cost, 3500);
  assert.equal(q.absorbed, false);
});

test("el umbral mira lo comprado a ESE comercio, no el carrito entero", () => {
  // El comprador gastó mucho en total, pero poco en este comercio: no aplica.
  const q = cotizar({
    ...BASE, province: "CABA", weightG: 800,
    freeShippingOver: 50000, merchantSubtotal: 10000,
  });
  assert.equal(q.cost, 3500);
  assert.equal(q.absorbed, false);
});

test("un comercio que no despacha no cotiza", () => {
  const q = cotizar({ ...BASE, province: "CABA", weightG: 800, ships: false });
  assert.equal(q.cost, 0);
  assert.equal(q.reason, "no-despacha");
});

test("provincia sin zona: no se inventa un precio", () => {
  const q = cotizar({ ...BASE, province: "Montevideo", weightG: 800 });
  assert.equal(q.cost, 0);
  assert.equal(q.reason, "sin-tarifa");
  assert.equal(q.zoneId, "");
});

test("zona conocida pero sin tarifas cargadas tampoco inventa", () => {
  const q = cotizar({ ...BASE, province: "Buenos Aires", weightG: 800 });
  assert.equal(q.reason, "sin-tarifa");
  assert.equal(q.zoneId, "bs-as", "igual identifica la zona, para poder diagnosticar");
});
