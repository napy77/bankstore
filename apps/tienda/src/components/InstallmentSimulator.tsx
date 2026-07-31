import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { CreditCard, Product } from '../types';
import { BANKS } from '../data/banks';
import { Info, CheckCircle2, TrendingDown, DollarSign, Calculator, Percent } from 'lucide-react';

interface InstallmentSimulatorProps {
  product: Product;
  selectedCard: CreditCard | null;
}

export const InstallmentSimulator: React.FC<InstallmentSimulatorProps> = ({ product, selectedCard }) => {
  const [installments, setInstallments] = useState<number>(3);
  
  // Find promotion or custom bank parameters
  const bankOffer = selectedCard
    ? product.bankOffers.find((offer) => offer.bankId === selectedCard.bankId)
    : null;

  const bankPromo = selectedCard
    ? BANKS.find((b) => b.id === selectedCard.bankId)?.promos.find(
        (p) => p.category === product.category
      )
    : null;

  // Maximum interest free installments
  const maxCuotasSinInteres = bankOffer?.maxCuotas || bankPromo?.maxCuotas || 1;
  const discountPercent = bankOffer?.discountPercent || bankPromo?.discountPercent || 0;
  const capAmount = bankPromo?.capAmount || 0;

  // Calculate prices
  const basePrice = product.price;
  
  // Bank cashback discount (reintegro)
  const estimatedReintegro = Math.min((basePrice * discountPercent) / 100, capAmount || Infinity);
  const netCost = basePrice - estimatedReintegro;

  // Installment calculations:
  // If chosen installments <= maxCuotasSinInteres, then it is 0% interest.
  // If chosen installments > maxCuotasSinInteres, we apply a realistic financial surcharge (Costo Financiero).
  const isInterestFree = installments <= maxCuotasSinInteres;

  // Financial rates (TNA: Tasa Nominal Anual, TEA: Tasa Efectiva Anual, CFT: Costo Financiero Total)
  const getFinancialRates = (cuotas: number) => {
    if (cuotas <= maxCuotasSinInteres) {
      return { tna: 0, tea: 0, cft: 0, surchargePercent: 0 };
    }
    // Surcharges for going beyond free installments
    const difference = cuotas - maxCuotasSinInteres;
    const tna = 42 + difference * 2; // e.g. 42% TNA
    const tea = tna * 1.25; // e.g. 52.5% TEA
    const cft = tea * 1.15; // e.g. 60.3% CFT
    const surchargePercent = (tna / 12) * cuotas * 0.45; // Simulated surcharge factor
    return { tna, tea, cft, surchargePercent };
  };

  const { tna, tea, cft, surchargePercent } = getFinancialRates(installments);
  const totalFinancedAmount = basePrice * (1 + surchargePercent / 100);
  const monthlyInstallmentAmount = totalFinancedAmount / installments;

  // Set initial installments to max available interest free on card change
  useEffect(() => {
    if (maxCuotasSinInteres > 1) {
      setInstallments(maxCuotasSinInteres);
    } else {
      setInstallments(1);
    }
  }, [selectedCard, maxCuotasSinInteres]);

  const installmentOptions = [1, 3, 6, 9, 12, 18, 24].filter(
    // Show only realistic or available installment configurations
    (opt) => opt <= (maxCuotasSinInteres > 12 ? maxCuotasSinInteres : 12) || opt === 18 || opt === 24
  );

  return (
    <div className="bg-slate-50/50 border border-slate-200/60 rounded-2xl p-5" id={`simulator-${product.id}`}>
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
          <Calculator size={18} className="text-blue-600" />
          Simulador de Cuotas & Beneficios
        </h4>
        <span className="text-xs text-slate-500 font-medium bg-slate-200/80 px-2 py-0.5 rounded-full">
          CFT: {cft.toFixed(2)}%
        </span>
      </div>

      {!selectedCard ? (
        <div className="bg-slate-100/50 border border-slate-200/60 rounded-2xl p-4 text-center">
          <Info size={20} className="mx-auto text-blue-600 mb-2" />
          <p className="text-xs text-slate-600">
            Seleccioná una tarjeta de crédito de tu billetera para activar los planes de{' '}
            <strong className="text-blue-600">cuotas sin interés</strong> y reintegros exclusivos de tu banco.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Card Benefit Summary */}
          <div className="bg-blue-50 border-l-4 border-blue-600 p-3.5 rounded-r-2xl">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">
                  Beneficio Activo con tu Tarjeta
                </p>
                <p className="text-sm font-bold text-slate-800">
                  {maxCuotasSinInteres} Cuotas sin Interés + {discountPercent}% Reintegro
                </p>
                {capAmount > 0 && (
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Tope de reintegro por cuenta: ${capAmount.toLocaleString('es-AR')}
                  </p>
                )}
              </div>
              <TrendingDown size={24} className="text-blue-600 animate-pulse" />
            </div>
          </div>

          {/* Installment Selector Pill Grid */}
          <div>
            <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">
              Cantidad de Cuotas
            </label>
            <div className="grid grid-cols-4 gap-2">
              {installmentOptions.map((opt) => {
                const optIsInterestFree = opt <= maxCuotasSinInteres;
                const active = installments === opt;
                return (
                  <button
                    type="button"
                    key={opt}
                    id={`opt-installments-${opt}`}
                    onClick={() => setInstallments(opt)}
                    className={`p-2.5 rounded-xl text-center transition-all ${
                      active
                        ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/15'
                        : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200/80'
                    }`}
                  >
                    <div className="text-sm font-bold">{opt} cuota{opt > 1 ? 's' : ''}</div>
                    <div
                      className={`text-[9px] mt-0.5 uppercase tracking-tighter ${
                        active
                          ? 'text-blue-100 font-semibold'
                          : optIsInterestFree
                          ? 'text-emerald-600 font-bold'
                          : 'text-slate-400'
                      }`}
                    >
                      {optIsInterestFree ? 'Sin Interés' : 'Fijas'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Pricing Breakdown Card */}
          <div className="bg-white rounded-2xl p-4 border border-slate-100 space-y-3.5 shadow-sm">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2.5">
              <span className="text-xs text-slate-500">Precio de Lista:</span>
              <span className="text-xs text-slate-400 line-through">
                ${(product.originalPrice || product.price * 1.15).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
              </span>
            </div>

            <div className="flex justify-between items-center border-b border-slate-100 pb-2.5">
              <span className="text-xs text-slate-500">Precio de Venta:</span>
              <span className="text-sm font-bold text-slate-800">
                ${basePrice.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
              </span>
            </div>

            {/* Surcharge indicator if any */}
            {!isInterestFree && surchargePercent > 0 && (
              <div className="flex justify-between items-center text-rose-600 text-xs border-b border-slate-100 pb-2.5">
                <span className="flex items-center gap-1">
                  Interés de financiación ({surchargePercent.toFixed(1)}%):
                </span>
                <span className="font-bold">+ ${(totalFinancedAmount - basePrice).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
              </div>
            )}

            {/* Monthly Installment Price */}
            <div className="bg-slate-50 p-3 rounded-xl flex justify-between items-center border border-slate-100/50">
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider block">
                  Cuota Mensual ({installments}x)
                </span>
                <span className="text-lg font-extrabold text-blue-900">
                  ${monthlyInstallmentAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider block">
                  Total Financiado
                </span>
                <span className="text-sm font-bold text-slate-700">
                  ${totalFinancedAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {/* Reintegro details */}
            {estimatedReintegro > 0 && (
              <div className="bg-emerald-50 border border-emerald-100/60 p-3.5 rounded-xl flex items-start gap-2">
                <CheckCircle2 size={16} className="text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-emerald-700 font-bold">
                    ¡Ahorrás ${estimatedReintegro.toLocaleString('es-AR')} con tu Tarjeta!
                  </p>
                  <p className="text-[10px] text-slate-600 leading-tight">
                    Reintegro del {discountPercent}% se reflejará en tu próximo resumen. Costo real del producto:{' '}
                    <strong className="text-slate-800">${netCost.toLocaleString('es-AR')}</strong>
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Financial cost legal info */}
          <div className="bg-slate-100/50 rounded-xl p-3 text-[10px] text-slate-400 leading-tight space-y-0.5">
            <p><strong>C.F.T. (Costo Financiero Total): {cft.toFixed(2)}% (Con IVA)</strong></p>
            <p>T.N.A. (Tasa Nominal Anual): {tna.toFixed(2)}% | T.E.A. (Tasa Efectiva Anual): {tea.toFixed(2)}%</p>
            <p>Operación sujeta a aprobación crediticia de {selectedCard.bankName}.</p>
          </div>
        </div>
      )}
    </div>
  );
};
