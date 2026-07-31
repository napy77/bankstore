import React, { useState, useEffect } from 'react';
import { CreditCard, Product } from '../types';
import { simulate, type Simulation } from '../api';
import { Info, CheckCircle2, TrendingDown, Calculator, AlertTriangle } from 'lucide-react';

interface InstallmentSimulatorProps {
  product: Product;
  selectedCard: CreditCard | null;
}

/**
 * Simulador de cuotas.
 *
 * Todos los números los calcula el servidor. Antes se calculaban acá con
 * fórmulas que no eran fórmulas —`tea = tna * 1.25`, `cft = tea * 1.15`— y que
 * daban resultados que no coincidían con nada. El CFT tiene valor legal (hay
 * que informarlo por Com. "A" 5460 del BCRA), así que no puede salir de una
 * cuenta aproximada en el navegador.
 *
 * Además es el MISMO cálculo que después usa el checkout: el número que ve el
 * cliente acá es el que termina pagando.
 */
export const InstallmentSimulator: React.FC<InstallmentSimulatorProps> = ({ product, selectedCard }) => {
  const [installments, setInstallments] = useState<number | null>(null);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Al cambiar de tarjeta se vuelve al plan por defecto: el más largo sin
  // interés, que lo decide el servidor según el acuerdo que aplique.
  useEffect(() => { setInstallments(null); }, [selectedCard?.id]);

  useEffect(() => {
    if (!selectedCard) { setSim(null); return; }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    simulate(product.id, selectedCard.bankId, installments ?? undefined, 1, ctrl.signal)
      .then((r) => {
        setSim(r);
        // La primera respuesta trae el plan sugerido; se adopta para que los
        // botones queden en sintonía con lo que se está mostrando.
        if (installments === null) setInstallments(r.quote.installments);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err.message ?? 'No pude calcular las cuotas');
      })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [product.id, selectedCard?.bankId, installments]);

  const money = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2 });
  const pct = (f: number) => (f * 100).toFixed(2);

  return (
    <div className="bg-slate-50/50 border border-slate-200/60 rounded-2xl p-5" id={`simulator-${product.id}`}>
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
          <Calculator size={18} className="text-blue-600" />
          Simulador de Cuotas & Beneficios
        </h4>
        {sim && (
          <span className="text-xs text-slate-500 font-medium bg-slate-200/80 px-2 py-0.5 rounded-full">
            CFT: {pct(sim.quote.cft)}%
          </span>
        )}
      </div>

      {!selectedCard ? (
        <div className="bg-slate-100/50 border border-slate-200/60 rounded-2xl p-4 text-center">
          <Info size={20} className="mx-auto text-blue-600 mb-2" />
          <p className="text-xs text-slate-600">
            Seleccioná una tarjeta de crédito de tu billetera para activar los planes de{' '}
            <strong className="text-blue-600">cuotas sin interés</strong> y reintegros exclusivos de tu banco.
          </p>
        </div>
      ) : error ? (
        <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 text-center">
          <AlertTriangle size={20} className="mx-auto text-rose-600 mb-2" />
          <p className="text-xs text-rose-700">{error}</p>
        </div>
      ) : !sim ? (
        <div className="py-8 text-center text-xs text-slate-400">Calculando…</div>
      ) : (
        <div className={`space-y-4 transition-opacity ${loading ? 'opacity-50' : ''}`}>
          {/* Beneficio activo */}
          <div className="bg-blue-50 border-l-4 border-blue-600 p-3.5 rounded-r-2xl">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">
                  Beneficio Activo con tu Tarjeta
                </p>
                <p className="text-sm font-bold text-slate-800">
                  {sim.benefit.maxCuotas} Cuotas sin Interés
                  {sim.benefit.reintegroPercent > 0 &&
                    ` + ${Math.round(sim.benefit.reintegroPercent * 100)}% Reintegro`}
                </p>
                {sim.benefit.capAmount !== null && (
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Tope de reintegro por cuenta: ${sim.benefit.capAmount.toLocaleString('es-AR')}
                  </p>
                )}
              </div>
              <TrendingDown size={24} className="text-blue-600 animate-pulse" />
            </div>
          </div>

          {/* Selector de cuotas */}
          <div>
            <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">
              Cantidad de Cuotas
            </label>
            <div className="grid grid-cols-4 gap-2">
              {sim.options.map((opt) => {
                const sinInteres = opt <= sim.benefit.maxCuotas;
                const active = sim.quote.installments === opt;
                return (
                  <button
                    type="button"
                    key={opt}
                    id={`opt-installments-${opt}`}
                    disabled={loading}
                    onClick={() => setInstallments(opt)}
                    className={`p-2.5 rounded-xl text-center transition-all disabled:cursor-wait ${
                      active
                        ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/15'
                        : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200/80'
                    }`}
                  >
                    <div className="text-sm font-bold">{opt} cuota{opt > 1 ? 's' : ''}</div>
                    <div
                      className={`text-[9px] mt-0.5 uppercase tracking-tighter ${
                        active ? 'text-blue-100 font-semibold'
                        : sinInteres ? 'text-emerald-600 font-bold'
                        : 'text-slate-400'
                      }`}
                    >
                      {sinInteres ? 'Sin Interés' : 'Fijas'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Desglose */}
          <div className="bg-white rounded-2xl p-4 border border-slate-100 space-y-3.5 shadow-sm">
            {product.originalPrice && (
              <div className="flex justify-between items-center border-b border-slate-100 pb-2.5">
                <span className="text-xs text-slate-500">Precio de Lista:</span>
                <span className="text-xs text-slate-400 line-through">
                  ${money(product.originalPrice)}
                </span>
              </div>
            )}

            <div className="flex justify-between items-center border-b border-slate-100 pb-2.5">
              <span className="text-xs text-slate-500">Precio de Venta:</span>
              <span className="text-sm font-bold text-slate-800">${money(product.price)}</span>
            </div>

            {sim.quote.interestAmount > 0 && (
              <div className="flex justify-between items-center text-rose-600 text-xs border-b border-slate-100 pb-2.5">
                <span>Interés de financiación:</span>
                <span className="font-bold">+ ${money(sim.quote.interestAmount)}</span>
              </div>
            )}

            <div className="bg-slate-50 p-3 rounded-xl flex justify-between items-center border border-slate-100/50">
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider block">
                  Cuota Mensual ({sim.quote.installments}x)
                </span>
                <span className="text-lg font-extrabold text-blue-900">
                  ${money(sim.quote.installmentAmount)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider block">
                  Total Financiado
                </span>
                <span className="text-sm font-bold text-slate-700">${money(sim.quote.totalAmount)}</span>
              </div>
            </div>

            {sim.reintegro.amount > 0 && (
              <div className="bg-emerald-50 border border-emerald-100/60 p-3.5 rounded-xl flex items-start gap-2">
                <CheckCircle2 size={16} className="text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-emerald-700 font-bold">
                    ¡Ahorrás ${sim.reintegro.amount.toLocaleString('es-AR')} con tu Tarjeta!
                  </p>
                  <p className="text-[10px] text-slate-600 leading-tight">
                    {sim.reintegro.capped
                      ? `Alcanzaste el tope de $${sim.reintegro.capAmount?.toLocaleString('es-AR')} de esta promoción. `
                      : `Reintegro del ${Math.round(sim.reintegro.percent * 100)}% se reflejará en tu próximo resumen. `}
                    Costo real: <strong className="text-slate-800">${sim.netCost.toLocaleString('es-AR')}</strong>
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Costo financiero, con valor legal */}
          <div className="bg-slate-100/50 rounded-xl p-3 text-[10px] text-slate-400 leading-tight space-y-0.5">
            <p><strong>C.F.T. (Costo Financiero Total): {pct(sim.quote.cft)}% (Con IVA)</strong></p>
            <p>
              T.N.A. (Tasa Nominal Anual): {pct(sim.quote.tna)}% | T.E.A. (Tasa Efectiva Anual): {pct(sim.quote.tea)}%
            </p>
            <p>Operación sujeta a aprobación crediticia de {selectedCard.bankName}.</p>
          </div>
        </div>
      )}
    </div>
  );
};
