import { test } from "node:test";
import assert from "node:assert/strict";
import { quote } from "../src/lib/installments.js";

const VAT = 0.21;

test("cuotas sin interés: la suma de las cuotas es exactamente el precio", () => {
  const q = quote({ amount: 1899999, installments: 12, maxInterestFree: 24, tna: 0.42, vatRate: VAT });
  assert.equal(q.interestFree, true);
  assert.equal(q.totalAmount, 1899999);
  assert.equal(q.interestAmount, 0);
  assert.equal(q.vatAmount, 0);
  assert.equal(q.tna, 0);
  assert.equal(q.tea, 0);
  assert.equal(q.cft, 0);
});

test("un solo pago sin interés es el precio entero", () => {
  const q = quote({ amount: 100000, installments: 1, maxInterestFree: 1, tna: 0.42, vatRate: VAT });
  assert.equal(q.installmentAmount, 100000);
  assert.equal(q.totalAmount, 100000);
});

test("el cuadro de marcha siempre cierra en saldo cero", () => {
  for (const n of [3, 6, 9, 12, 18, 24]) {
    for (const amount of [1000, 99999.99, 1899999, 3450000]) {
      const q = quote({ amount, installments: n, maxInterestFree: 0, tna: 0.42, vatRate: VAT });
      const last = q.schedule.at(-1)!;
      assert.equal(last.balance, 0, `saldo final de ${n} cuotas sobre ${amount}`);
      // El capital amortizado tiene que ser el capital prestado
      const principal = q.schedule.reduce((a, r) => a + r.principal, 0);
      assert.ok(Math.abs(principal - amount) < 0.01, `capital de ${n}x${amount}`);
    }
  }
});

test("sistema francés: la cuota es constante salvo la última", () => {
  const q = quote({ amount: 1200000, installments: 12, maxInterestFree: 0, tna: 0.42, vatRate: VAT });
  const cuotas = q.schedule.slice(0, -1).map((r) => r.payment);
  assert.equal(new Set(cuotas).size, 1, "todas las cuotas menos la última son iguales");
  // Y el interés decrece a medida que baja el saldo
  for (let i = 1; i < q.schedule.length; i++) {
    assert.ok(q.schedule[i]!.interest < q.schedule[i - 1]!.interest);
  }
});

test("cuota francesa contra valor calculado a mano", () => {
  // $1.000.000 a 12 cuotas con TNA 42% → i = 0.035 mensual
  //   1.035^12          = 1.5110686573
  //   1 - 1.035^-12     = 0.3382167017
  //   cuota = 1.000.000 * 0.035 / 0.3382167017 = 103.483,9492...
  const q = quote({ amount: 1000000, installments: 12, maxInterestFree: 0, tna: 0.42, vatRate: VAT });
  assert.equal(q.installmentAmount, 103483.95);
});

test("TEA es la TNA capitalizada, no la TNA por un factor inventado", () => {
  const q = quote({ amount: 500000, installments: 6, maxInterestFree: 0, tna: 0.42, vatRate: VAT });
  // (1 + 0.42/12)^12 - 1 = 0.51107...
  assert.ok(Math.abs(q.tea - 0.51107) < 0.0001, `TEA obtenida ${q.tea}`);
});

test("el CFT queda por encima de la TEA porque incluye el IVA", () => {
  const q = quote({ amount: 500000, installments: 12, maxInterestFree: 0, tna: 0.42, vatRate: VAT });
  assert.ok(q.cft > q.tea, `CFT ${q.cft} debería superar a TEA ${q.tea}`);
  // Y sin IVA tiene que dar prácticamente igual a la TEA
  const sinIva = quote({ amount: 500000, installments: 12, maxInterestFree: 0, tna: 0.42, vatRate: 0 });
  assert.ok(Math.abs(sinIva.cft - sinIva.tea) < 0.001, `CFT sin IVA ${sinIva.cft} vs TEA ${sinIva.tea}`);
});

test("más cuotas con interés encarecen el total", () => {
  const seis = quote({ amount: 1000000, installments: 6, maxInterestFree: 0, tna: 0.42, vatRate: VAT });
  const doce = quote({ amount: 1000000, installments: 12, maxInterestFree: 0, tna: 0.42, vatRate: VAT });
  assert.ok(doce.totalAmount > seis.totalAmount);
  assert.ok(doce.installmentAmount < seis.installmentAmount, "pero la cuota mensual baja");
});

test("pasarse del máximo sin interés activa el costo financiero", () => {
  const dentro = quote({ amount: 800000, installments: 9, maxInterestFree: 9, tna: 0.42, vatRate: VAT });
  const fuera = quote({ amount: 800000, installments: 12, maxInterestFree: 9, tna: 0.42, vatRate: VAT });
  assert.equal(dentro.interestAmount, 0);
  assert.ok(fuera.interestAmount > 0);
});

test("rechaza entradas imposibles", () => {
  assert.throws(() => quote({ amount: 0, installments: 6, maxInterestFree: 0, tna: 0.42, vatRate: VAT }));
  assert.throws(() => quote({ amount: 100, installments: 0, maxInterestFree: 0, tna: 0.42, vatRate: VAT }));
  assert.throws(() => quote({ amount: 100, installments: 1.5, maxInterestFree: 0, tna: 0.42, vatRate: VAT }));
});
