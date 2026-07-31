/**
 * Motor de financiación en cuotas.
 *
 * El prototipo del frontend calculaba las tasas así:
 *
 *     tna = 42 + diferencia * 2
 *     tea = tna * 1.25
 *     cft = tea * 1.15
 *     recargo = (tna / 12) * cuotas * 0.45
 *
 * Eso no es ninguna fórmula financiera: son factores elegidos para que el
 * número "se vea bien". Acá está la cuenta de verdad, que es la que hay que
 * informar por Com. "A" 5460 del BCRA.
 *
 *  - Sistema francés: cuota constante, el interés se calcula sobre el saldo
 *    que queda, no sobre el total.
 *  - TEA: la TNA capitalizada mensualmente, (1 + TNA/12)^12 - 1.
 *  - CFT: la tasa que iguala el valor presente de TODO lo que paga el cliente
 *    (cuotas + IVA sobre los intereses) al monto financiado. Se resuelve
 *    numéricamente porque no tiene forma cerrada.
 */

import { round2 } from "./money.js";

export interface ScheduleRow {
  /** Número de cuota, desde 1. */
  n: number;
  /** Cuota pura del sistema francés (constante). */
  payment: number;
  /** Parte que amortiza capital. */
  principal: number;
  /** Parte que es interés. */
  interest: number;
  /** IVA sobre el interés de esa cuota. Se cobra aparte en el resumen. */
  vat: number;
  /** Capital que queda por pagar después de esta cuota. */
  balance: number;
}

export interface Quote {
  installments: number;
  /** true si el banco banca el costo: sin interés y sin IVA. */
  interestFree: boolean;
  /** Monto que se financia (el precio de venta; el reintegro no lo reduce). */
  financedAmount: number;
  /** Cuota mensual que se le informa al cliente. */
  installmentAmount: number;
  /** Suma de las cuotas: lo que termina pagando en el plan. */
  totalAmount: number;
  /** Interés total. 0 en cuotas sin interés. */
  interestAmount: number;
  /** IVA sobre los intereses. Entra en el CFT, no en la cuota informada. */
  vatAmount: number;
  /** Tasa Nominal Anual, como fracción (0.42 = 42%). */
  tna: number;
  /** Tasa Efectiva Anual, como fracción. */
  tea: number;
  /** Costo Financiero Total anual con IVA, como fracción. */
  cft: number;
  schedule: ScheduleRow[];
}

export interface QuoteParams {
  /** Monto a financiar. */
  amount: number;
  /** Cuotas elegidas por el cliente. */
  installments: number;
  /** Hasta cuántas cuotas el banco no cobra interés. */
  maxInterestFree: number;
  /** TNA que se aplica al pasarse de las cuotas sin interés. */
  tna: number;
  /** Alícuota de IVA sobre intereses (0.21). */
  vatRate: number;
}

/**
 * Tasa interna de retorno mensual de un flujo de fondos, por bisección.
 *
 * Newton-Raphson converge más rápido pero se va al diablo si la derivada
 * queda cerca de cero, y acá el resultado va en un cartel con valor legal.
 * La bisección es lenta y aburrida, que es exactamente lo que se quiere:
 * 200 iteraciones sobre [0, 100% mensual] dan precisión muy por debajo del
 * último decimal que se informa.
 */
function monthlyIrr(principal: number, payments: number[]): number {
  const npv = (rate: number): number =>
    payments.reduce((acc, p, idx) => acc + p / Math.pow(1 + rate, idx + 1), 0) - principal;

  let lo = 0;
  let hi = 1; // 100% mensual: techo absurdo a propósito, para que nunca falte
  if (npv(lo) <= 0) return 0; // no hay costo: el flujo no supera al capital

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function quote(params: QuoteParams): Quote {
  const { amount, installments, maxInterestFree, vatRate } = params;

  if (!Number.isInteger(installments) || installments < 1) {
    throw new Error("Las cuotas tienen que ser un entero mayor o igual a 1");
  }
  if (amount <= 0) throw new Error("El monto a financiar tiene que ser positivo");

  const interestFree = installments <= maxInterestFree;
  const tna = interestFree ? 0 : params.tna;
  const i = tna / 12; // tasa mensual nominal

  // Cuota del sistema francés. Con i = 0 la fórmula se indetermina (0/0), así
  // que el caso sin interés es simplemente el capital dividido en partes.
  const rawPayment = i === 0 ? amount / installments : (amount * i) / (1 - Math.pow(1 + i, -installments));
  const installmentAmount = round2(rawPayment);

  // Cuadro de marcha. Se arma con el valor redondeado, que es el que se cobra
  // de verdad; usar el exacto haría que el saldo final no cierre en cero.
  const schedule: ScheduleRow[] = [];
  let balance = amount;
  for (let n = 1; n <= installments; n++) {
    const interest = round2(balance * i);
    // La última cuota se lleva el arrastre del redondeo: cancela el saldo que
    // quede, aunque difiera unos centavos de las anteriores. Si no, el crédito
    // termina con un saldo de $0.03 que nadie sabe de dónde salió.
    const isLast = n === installments;
    const principalPart = isLast ? balance : round2(installmentAmount - interest);
    const payment = isLast ? round2(principalPart + interest) : installmentAmount;
    balance = round2(balance - principalPart);
    schedule.push({
      n,
      payment,
      principal: principalPart,
      interest,
      vat: round2(interest * vatRate),
      balance,
    });
  }

  const totalAmount = round2(schedule.reduce((a, r) => a + r.payment, 0));
  const interestAmount = round2(schedule.reduce((a, r) => a + r.interest, 0));
  const vatAmount = round2(schedule.reduce((a, r) => a + r.vat, 0));

  const tea = i === 0 ? 0 : Math.pow(1 + i, 12) - 1;

  // El CFT sale del flujo que realmente sale del bolsillo del cliente: cuota
  // más el IVA de esa cuota. Por eso siempre da por encima de la TEA.
  const cft =
    interestFree || interestAmount === 0
      ? 0
      : Math.pow(1 + monthlyIrr(amount, schedule.map((r) => round2(r.payment + r.vat))), 12) - 1;

  return {
    installments,
    interestFree,
    financedAmount: round2(amount),
    installmentAmount,
    totalAmount,
    interestAmount,
    vatAmount,
    tna,
    tea,
    cft,
    schedule,
  };
}

/**
 * Opciones que se le ofrecen al cliente. Se muestran siempre los planes sin
 * interés (que son el gancho) más los tramos habituales de plaza; no tiene
 * sentido ofrecer 24 cuotas con interés sobre un producto de $20.000.
 */
export const INSTALLMENT_OPTIONS = [1, 3, 6, 9, 12, 18, 24] as const;

export function availableInstallments(maxInterestFree: number): number[] {
  return INSTALLMENT_OPTIONS.filter((n) => n <= Math.max(maxInterestFree, 12));
}
