import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CreditCard, CardBrand, CardTier, Bank } from '../types';
import { CardVisualizer } from './CardVisualizer';
import { Plus, X, Landmark, CreditCard as CardIcon, DollarSign, Wallet, ShieldCheck, CheckCircle2 } from 'lucide-react';

interface CardWalletSectionProps {
  cards: CreditCard[];
  /** Bancos disponibles, de la API. Antes venían de un archivo estático. */
  banks: Bank[];
  selectedCard: CreditCard | null;
  onSelectCard: (card: CreditCard) => void;
  /** Vincula la tarjeta contra la API. El padre hace el POST. */
  onAddCard: (datos: {
    cardNumber: string; holderName: string; expiryMonth: number; expiryYear: number;
    bankId: string; tier: string; creditLimit: number; colorTheme: string;
  }) => Promise<void>;
  /** Sin sesión no hay billetera: las tarjetas son del usuario. */
  isLoggedIn: boolean;
  onRequestLogin: () => void;
}

/**
 * Marca a partir del número, sólo para la vista previa. La que vale es la que
 * deduce el servidor sobre el número completo; acá se replica para que la
 * tarjeta de muestra no quede en Visa mientras se tipea una Amex.
 */
function detectarMarca(numero: string): CardBrand {
  const d = numero.replace(/\D/g, '');
  if (/^4/.test(d)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'mastercard';
  if (/^3[47]/.test(d)) return 'amex';
  if (/^(58|60|6042|6043|6044)/.test(d)) return 'cabal';
  return 'visa';
}

export const CardWalletSection: React.FC<CardWalletSectionProps> = ({
  cards,
  banks,
  selectedCard,
  onSelectCard,
  onAddCard,
  isLoggedIn,
  onRequestLogin,
}) => {
  const [isOpenAddModal, setIsOpenAddModal] = useState(false);
  const [newCard, setNewCard] = useState({
    cardNumber: '',
    expiry: '',
    holderName: '',
    tier: 'signature' as CardTier,
    bankId: '',
    limit: 1500000,
    colorTheme: 'navy' as any
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * El número completo se manda una sola vez. El servidor lo valida con Luhn,
   * deduce la marca y se queda con los últimos cuatro dígitos; el resto se
   * descarta antes de tocar la base. Por eso acá no se guarda en ningún estado
   * que sobreviva al submit.
   */
  const handleCreateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const [mm, aa] = newCard.expiry.split('/');
    if (!mm || !aa || mm.length !== 2 || aa.length !== 2) {
      setError('El vencimiento va como MM/AA');
      setBusy(false);
      return;
    }

    try {
      await onAddCard({
        cardNumber: newCard.cardNumber,
        holderName: newCard.holderName,
        expiryMonth: Number(mm),
        expiryYear: 2000 + Number(aa),
        bankId: newCard.bankId,
        tier: newCard.tier,
        creditLimit: Number(newCard.limit),
        colorTheme: newCard.colorTheme,
      });
      setIsOpenAddModal(false);
      setNewCard({ ...newCard, cardNumber: '', expiry: '', holderName: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos vincular la tarjeta');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 shadow-sm rounded-3xl p-6" id="card-wallet-section">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div className="flex items-center space-x-2.5">
          <Wallet size={20} className="text-blue-600" />
          <div>
            <h3 className="text-base font-bold text-slate-800 tracking-wide">Billetera de Beneficios</h3>
            <p className="text-[10px] text-slate-500 font-medium">Seleccioná una tarjeta para activar sus cuotas sin interés en el catálogo</p>
          </div>
        </div>
        <button
          type="button"
          id="add-card-btn-trigger"
          onClick={() => setIsOpenAddModal(true)}
          className="py-2.5 px-5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-full flex items-center gap-1.5 transition-all border-none shadow-md shadow-blue-600/10"
        >
          <Plus size={14} />
          Vincular Tarjeta
        </button>
      </div>

      {/* Sin sesión no hay billetera que mostrar: las tarjetas son del usuario */}
      {!isLoggedIn ? (
        <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-8 text-center">
          <Wallet size={28} className="text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-700">Entrá para ver tu billetera</p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Vinculá tus tarjetas para activar las cuotas sin interés y los reintegros de
            tu banco en todo el catálogo.
          </p>
          <button
            type="button"
            onClick={onRequestLogin}
            className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-5 py-2.5 rounded-full shadow-md shadow-blue-600/15 transition-all"
          >
            Ingresar
          </button>
        </div>
      ) : cards.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-8 text-center">
          <Wallet size={28} className="text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-700">Todavía no tenés tarjetas</p>
          <p className="text-xs text-slate-500 mt-1">
            Vinculá una para ver tus cuotas y reintegros en cada producto.
          </p>
        </div>
      ) : (
      /* Credit cards carousel */
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
        {cards.map((card) => {
          const isActive = selectedCard?.id === card.id;
          return (
            <div
              key={card.id}
              className={`flex flex-col items-center p-3 rounded-2xl transition-all ${
                isActive ? 'bg-blue-50/50 border border-blue-200/60 shadow-sm' : 'border border-transparent'
              }`}
            >
              <CardVisualizer
                card={card}
                isActive={isActive}
                onSelect={() => onSelectCard(card)}
              />
              <div className="w-full max-w-[340px] px-3 mt-3.5 flex justify-between items-center text-[11px]">
                <span className="text-slate-400 font-medium">Monto Límite:</span>
                <span className="text-slate-700 font-bold font-mono">
                  ${card.availableLimit.toLocaleString('es-AR')} / ${card.limit.toLocaleString('es-AR')}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Add Card Modal */}
      <AnimatePresence>
        {isOpenAddModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpenAddModal(false)}
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
            />

            {/* Modal Body */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-slate-200 rounded-[32px] w-full max-w-md p-6 overflow-hidden shadow-2xl relative z-10 space-y-5 text-slate-800"
            >
              <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                <h3 className="font-bold text-slate-800 text-base tracking-wide flex items-center gap-2">
                  <CardIcon size={18} className="text-blue-600" />
                  Vincular Nueva Tarjeta Bancaria
                </h3>
                <button
                  type="button"
                  id="close-add-card-modal"
                  onClick={() => setIsOpenAddModal(false)}
                  className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-full transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Card visual showcase on add */}
              <div className="flex justify-center p-3 bg-slate-50 rounded-2xl border border-slate-100/50">
                <CardVisualizer
                  card={{
                    id: 'preview',
                    holderName: newCard.holderName || 'GERMAN YOVAN',
                    // La vista previa refleja lo que se va escribiendo.
                    cardNumber: newCard.cardNumber
                      ? `•••• •••• •••• ${newCard.cardNumber.replace(/\D/g, '').slice(-4).padStart(4, '•')}`
                      : '•••• •••• •••• ••••',
                    expiryDate: newCard.expiry || 'MM/AA',
                    // La marca sale del propio número: Visa empieza con 4,
                    // Mastercard con 51-55 o 22-27, Amex con 34 o 37. Es la
                    // misma deducción que hace el servidor.
                    brand: detectarMarca(newCard.cardNumber),
                    tier: newCard.tier,
                    bankId: newCard.bankId,
                    bankName: banks.find((b) => b.id === newCard.bankId)?.name || 'Banco',
                    limit: newCard.limit,
                    availableLimit: newCard.limit,
                    colorTheme: newCard.colorTheme
                  }}
                />
              </div>

              <form onSubmit={handleCreateCard} className="space-y-4">
                {error && (
                  <div className="bg-rose-50 border border-rose-100 rounded-xl p-3 text-xs text-rose-700">
                    {error}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">
                      Número de Tarjeta
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      id="new-card-number"
                      required
                      placeholder="0000 0000 0000 0000"
                      value={newCard.cardNumber}
                      onChange={(e) => {
                        // Se agrupa de a cuatro mientras se escribe: así se
                        // relee contra la tarjeta física sin perder la cuenta.
                        const limpio = e.target.value.replace(/\D/g, '').slice(0, 19);
                        const agrupado = limpio.replace(/(.{4})/g, '$1 ').trim();
                        setNewCard({ ...newCard, cardNumber: agrupado });
                      }}
                      className="w-full bg-slate-50 text-slate-800 border border-slate-200 rounded-xl p-2.5 text-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-400 transition-all"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      Guardamos sólo los últimos cuatro dígitos.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">
                      Vence
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      id="new-card-expiry"
                      required
                      placeholder="MM/AA"
                      value={newCard.expiry}
                      onChange={(e) => {
                        const d = e.target.value.replace(/\D/g, '').slice(0, 4);
                        setNewCard({
                          ...newCard,
                          expiry: d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d,
                        });
                      }}
                      className="w-full bg-slate-50 text-slate-800 border border-slate-200 rounded-xl p-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-400 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">Nombre del Titular</label>
                  <input
                    type="text"
                    id="new-card-holder"
                    required
                    value={newCard.holderName}
                    onChange={(e) => setNewCard({ ...newCard, holderName: e.target.value })}
                    className="w-full bg-slate-50 text-slate-800 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-400 transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">Banco Emisor</label>
                    <select
                      id="new-card-bank"
                      value={newCard.bankId}
                      onChange={(e) => {
                        const val = e.target.value;
                        // set prebuilt themes per bank
                        let theme: any = 'navy';
                        if (val === 'bna') theme = 'black';
                        if (val === 'ciudad') theme = 'gold';
                        if (val === 'macro') theme = 'teal';
                        if (val === 'galicia') theme = 'red';
                        setNewCard({ ...newCard, bankId: val, colorTheme: theme });
                      }}
                      className="w-full bg-slate-50 text-slate-800 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    >
                      {banks.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">Categoría / Rango</label>
                    <select
                      id="new-card-tier"
                      value={newCard.tier}
                      onChange={(e) => setNewCard({ ...newCard, tier: e.target.value as CardTier })}
                      className="w-full bg-slate-50 text-slate-800 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    >
                      <option value="signature">Signature</option>
                      <option value="black">Black</option>
                      <option value="platinum">Platinum</option>
                      <option value="gold">Gold</option>
                      <option value="classic">Classic</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">Límite Compra (ARS)</label>
                    <input
                      type="number"
                      id="new-card-limit"
                      required
                      min={100000}
                      step={50000}
                      value={newCard.limit}
                      onChange={(e) => setNewCard({ ...newCard, limit: Number(e.target.value) })}
                      className="w-full bg-slate-50 text-slate-800 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  id="add-card-submit-btn"
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-full text-xs tracking-wider uppercase transition-all shadow-md shadow-blue-600/10 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ShieldCheck size={16} strokeWidth={2.5} />
                  Vincular Tarjeta con Éxito
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
