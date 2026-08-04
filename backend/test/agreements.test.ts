import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickAgreement, resolveBenefit, applyCaps, construirCaminos, type AgreementRow,
} from "../src/lib/agreements.js";

function ag(p: Partial<AgreementRow> & { id: number }): AgreementRow {
  return {
    bank_id: "galicia", merchant_id: null, category_id: null,
    max_cuotas: 6, discount_percent: 0.1, cap_amount: null,
    description: "", priority: 0, ...p,
  };
}

// ── Especificidad ────────────────────────────────────────────────────────────

test("el acuerdo del comercio le gana al general aunque dé menos cuotas", () => {
  const agreements = [
    ag({ id: 1, max_cuotas: 24, description: "24 en toda la app" }),
    ag({ id: 2, merchant_id: "electro-1", max_cuotas: 6, description: "6 en Electro 1" }),
  ];
  const picked = pickAgreement(agreements, "galicia", "electro-1", "tecnologia");
  assert.equal(picked?.id, 2, "gana el más específico, no el más generoso");
});

test("comercio + categoría le gana a comercio solo", () => {
  const agreements = [
    ag({ id: 1, merchant_id: "electro-1", max_cuotas: 6 }),
    ag({ id: 2, merchant_id: "electro-1", category_id: "tecnologia", max_cuotas: 18 }),
  ];
  assert.equal(pickAgreement(agreements, "galicia", "electro-1", "tecnologia")?.id, 2);
  // Pero en otra categoría del mismo comercio vuelve a valer el del comercio
  assert.equal(pickAgreement(agreements, "galicia", "electro-1", "moda")?.id, 1);
});

test("apuntar al comercio pesa más que apuntar a la categoría", () => {
  const agreements = [
    ag({ id: 1, category_id: "tecnologia", max_cuotas: 18 }),
    ag({ id: 2, merchant_id: "electro-1", max_cuotas: 3 }),
  ];
  assert.equal(pickAgreement(agreements, "galicia", "electro-1", "tecnologia")?.id, 2);
});

test("un acuerdo de otro comercio no aplica", () => {
  const agreements = [ag({ id: 1, merchant_id: "electro-2", max_cuotas: 24 })];
  assert.equal(pickAgreement(agreements, "galicia", "electro-1", "tecnologia"), undefined);
});

test("un acuerdo de otro banco no aplica", () => {
  const agreements = [ag({ id: 1, bank_id: "bna", max_cuotas: 24 })];
  assert.equal(pickAgreement(agreements, "galicia", "electro-1", "tecnologia"), undefined);
});

test("a igual alcance manda la prioridad", () => {
  const agreements = [
    ag({ id: 1, merchant_id: "electro-1", max_cuotas: 24, priority: 0 }),
    ag({ id: 2, merchant_id: "electro-1", max_cuotas: 3, priority: 10 }),
  ];
  assert.equal(pickAgreement(agreements, "galicia", "electro-1", "tecnologia")?.id, 2);
});

test("el orden de entrada no cambia el resultado", () => {
  const base = [
    ag({ id: 1, max_cuotas: 24 }),
    ag({ id: 2, merchant_id: "electro-1", max_cuotas: 6 }),
    ag({ id: 3, category_id: "tecnologia", max_cuotas: 12 }),
  ];
  const directo = pickAgreement(base, "galicia", "electro-1", "tecnologia")?.id;
  const alReves = pickAgreement([...base].reverse(), "galicia", "electro-1", "tecnologia")?.id;
  assert.equal(directo, alReves);
  assert.equal(directo, 2);
});

// ── Beneficio resuelto ───────────────────────────────────────────────────────

test("la oferta del producto le gana a cualquier acuerdo", () => {
  const agreements = [
    ag({ id: 1, merchant_id: "electro-1", category_id: "tecnologia", max_cuotas: 6, cap_amount: 50000 }),
  ];
  const b = resolveBenefit("galicia", "electro-1", "tecnologia", {
    product_id: "p1", bank_id: "galicia", max_cuotas: 18,
    discount_percent: 0.15, extra_reintegro_percent: 0.05,
  }, agreements);
  assert.equal(b.source, "product");
  assert.equal(b.maxCuotas, 18);
  assert.equal(b.reintegroPercent, 0.2, "el extra se suma al descuento");
  assert.equal(b.capAmount, 50000, "hereda el tope del acuerdo");
  assert.equal(b.agreementId, 1);
});

test("sin acuerdo ni oferta no hay beneficio", () => {
  const b = resolveBenefit("macro", "spa-1", "moda", undefined, []);
  assert.equal(b.source, "none");
  assert.equal(b.maxCuotas, 1);
  assert.equal(b.reintegroPercent, 0);
});

test("el reintegro nunca pasa del 100%", () => {
  const b = resolveBenefit("galicia", "electro-1", "tecnologia", {
    product_id: "p1", bank_id: "galicia", max_cuotas: 6,
    discount_percent: 0.8, extra_reintegro_percent: 0.5,
  }, []);
  assert.equal(b.reintegroPercent, 1);
});

// ── Topes ────────────────────────────────────────────────────────────────────

test("productos bajo el mismo acuerdo comparten un solo tope", () => {
  const total = applyCaps([
    { capKey: "ag:7", amount: 50000, capAmount: 40000 },
    { capKey: "ag:7", amount: 50000, capAmount: 40000 },
  ]);
  assert.equal(total, 40000);
});

test("el tope se comparte incluso entre comercios distintos", () => {
  // Dos comercios amparados por el mismo acuerdo global del banco: el tope es
  // por cuenta del cliente, no por comercio.
  const total = applyCaps([
    { capKey: "ag:3", amount: 30000, capAmount: 40000 },
    { capKey: "ag:3", amount: 30000, capAmount: 40000 },
  ]);
  assert.equal(total, 40000, "no son $60.000");
});

test("acuerdos distintos topean por separado", () => {
  const total = applyCaps([
    { capKey: "ag:1", amount: 50000, capAmount: 40000 },
    { capKey: "ag:2", amount: 30000, capAmount: 25000 },
  ]);
  assert.equal(total, 65000);
});

test("sin tope se reintegra todo", () => {
  assert.equal(applyCaps([{ capKey: "ag:9", amount: 12345.67, capAmount: null }]), 12345.67);
});

// ── Herencia por rama ────────────────────────────────────────────────────────
// El árbol de categorías rompió esto en silencio: un acuerdo sobre
// "electrohogar" dejaba de aplicar a un producto en "ventiladores".

const CAMINO_VENTILADOR = ["electrohogar", "climatizacion", "ventiladores"];

test("un acuerdo sobre la raíz cubre toda su rama", () => {
  const agreements = [ag({ id: 1, category_id: "electrohogar", max_cuotas: 12 })];
  const picked = pickAgreement(agreements, "galicia", "electro-1", CAMINO_VENTILADOR);
  assert.equal(picked?.id, 1, "electrohogar tiene que cubrir a ventiladores");
});

test("un acuerdo de otra rama sigue sin aplicar", () => {
  const agreements = [ag({ id: 1, category_id: "ferreteria", max_cuotas: 12 })];
  assert.equal(pickAgreement(agreements, "galicia", "electro-1", CAMINO_VENTILADOR), undefined);
});

test("a igual alcance gana el acuerdo más cercano a la hoja", () => {
  const agreements = [
    ag({ id: 1, category_id: "electrohogar", max_cuotas: 24 }),
    ag({ id: 2, category_id: "climatizacion", max_cuotas: 6 }),
  ];
  const picked = pickAgreement(agreements, "galicia", "electro-1", CAMINO_VENTILADOR);
  assert.equal(picked?.id, 2, "climatizacion está más abajo que electrohogar");
});

test("la hoja exacta le gana a cualquier ancestro", () => {
  const agreements = [
    ag({ id: 1, category_id: "electrohogar", max_cuotas: 24 }),
    ag({ id: 2, category_id: "climatizacion", max_cuotas: 18 }),
    ag({ id: 3, category_id: "ventiladores", max_cuotas: 3 }),
  ];
  assert.equal(pickAgreement(agreements, "galicia", "electro-1", CAMINO_VENTILADOR)?.id, 3);
});

test("comercio sin categoría sigue ganándole a una categoría de la rama", () => {
  const agreements = [
    ag({ id: 1, category_id: "ventiladores", max_cuotas: 24 }),
    ag({ id: 2, merchant_id: "electro-1", max_cuotas: 6 }),
  ];
  assert.equal(pickAgreement(agreements, "galicia", "electro-1", CAMINO_VENTILADOR)?.id, 2);
});

test("el orden de entrada no cambia cuál gana en la rama", () => {
  const base = [
    ag({ id: 1, category_id: "electrohogar", max_cuotas: 24 }),
    ag({ id: 2, category_id: "climatizacion", max_cuotas: 6 }),
    ag({ id: 3, max_cuotas: 3 }),
  ];
  const directo = pickAgreement(base, "galicia", "electro-1", CAMINO_VENTILADOR)?.id;
  const alReves = pickAgreement([...base].reverse(), "galicia", "electro-1", CAMINO_VENTILADOR)?.id;
  assert.equal(directo, alReves);
  assert.equal(directo, 2);
});

test("construirCaminos arma el recorrido hasta la raíz", () => {
  const caminos = construirCaminos([
    { id: "electrohogar", parent_id: null },
    { id: "climatizacion", parent_id: "electrohogar" },
    { id: "ventiladores", parent_id: "climatizacion" },
    { id: "tecnologia", parent_id: null },
  ]);
  assert.deepEqual(caminos.get("ventiladores"), CAMINO_VENTILADOR);
  assert.deepEqual(caminos.get("tecnologia"), ["tecnologia"]);
});

test("un ciclo en los datos no cuelga la resolución", () => {
  // No debería pasar (hay FK), pero si pasa es mejor un camino raro que un
  // proceso colgado.
  const caminos = construirCaminos([
    { id: "a", parent_id: "b" },
    { id: "b", parent_id: "a" },
  ]);
  assert.ok(caminos.get("a")!.length <= 20);
});
