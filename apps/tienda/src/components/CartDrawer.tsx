import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CartItem, CreditCard } from '../types';
import { X, Trash2, ShoppingBag, CreditCard as CardIcon, ChevronRight, Calculator, Info } from 'lucide-react';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cart: CartItem[];
  selectedCard: CreditCard | null;
  onRemoveItem: (productId: string) => void;
  onUpdateQuantity: (productId: string, qty: number) => void;
  onCheckout: () => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  cart,
  selectedCard,
  onRemoveItem,
  onUpdateQuantity,
  onCheckout,
}) => {
  const totalAmount = cart.reduce((acc, item) => acc + item.product.price * item.quantity, 0);

  // Maximum interest free installments among items in cart for the current selected card
  const getCartMaxCuotas = () => {
    if (!selectedCard) return 1;
    let minMaxCuotas = 24; // start high
    cart.forEach((item) => {
      const offer = item.product.bankOffers.find((o) => o.bankId === selectedCard.bankId);
      const maxItemCuotas = offer ? offer.maxCuotas : 1;
      if (maxItemCuotas < minMaxCuotas) {
        minMaxCuotas = maxItemCuotas;
      }
    });
    return minMaxCuotas === 24 ? 1 : minMaxCuotas;
  };

  const maxCuotas = getCartMaxCuotas();

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />

          {/* Drawer Panel */}
          <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.3 }}
              className="w-screen max-w-md bg-white border-l border-slate-100 flex flex-col justify-between shadow-2xl"
              id="cart-drawer-panel"
            >
              {/* Header */}
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white">
                <div className="flex items-center space-x-2.5">
                  <ShoppingBag className="text-blue-600" size={20} />
                  <h2 className="text-lg font-bold text-slate-800 tracking-wide">Mi Carrito ({cart.length})</h2>
                </div>
                <button
                  type="button"
                  id="close-cart-drawer"
                  onClick={onClose}
                  className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-full transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Items List */}
              <div className="flex-grow overflow-y-auto p-6 space-y-4 bg-white">
                {cart.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-4">
                    <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 mb-4 border border-slate-100">
                      <ShoppingBag size={28} />
                    </div>
                    <p className="text-slate-500 font-bold text-sm">Tu carrito está vacío</p>
                    <p className="text-xs text-slate-400 mt-1">¡Explorá nuestro catálogo y sumá tus beneficios exclusivos!</p>
                  </div>
                ) : (
                  cart.map((item) => {
                    return (
                      <div
                        key={item.product.id}
                        id={`cart-item-${item.product.id}`}
                        className="p-3 bg-slate-50 rounded-2xl border border-slate-100/60 flex items-start gap-3.5 relative"
                      >
                        {/* Visual icon or representation */}
                        <div className="w-16 h-16 rounded-xl bg-white border border-slate-100 flex items-center justify-center shrink-0">
                          <span className="text-[10px] text-blue-600 font-bold uppercase">{item.product.category.substring(0, 5)}</span>
                        </div>

                        {/* Title & Quantity */}
                        <div className="flex-grow space-y-1">
                          <h4 className="text-slate-800 font-bold text-xs tracking-wide line-clamp-1">
                            {item.product.name}
                          </h4>
                          <p className="text-xs text-slate-700 font-bold">
                            ${item.product.price.toLocaleString('es-AR')}
                          </p>

                          {/* Controls */}
                          <div className="flex justify-between items-center pt-2">
                            <div className="flex items-center space-x-1.5 bg-white px-2 py-1 rounded-full border border-slate-200/60 shadow-sm">
                              <button
                                type="button"
                                id={`cart-qty-dec-${item.product.id}`}
                                onClick={() => onUpdateQuantity(item.product.id, Math.max(1, item.quantity - 1))}
                                className="text-xs text-slate-500 hover:text-blue-600 font-extrabold px-1"
                              >
                                -
                              </button>
                              <span className="text-xs text-slate-800 font-bold min-w-4 text-center">
                                {item.quantity}
                              </span>
                              <button
                                type="button"
                                id={`cart-qty-inc-${item.product.id}`}
                                onClick={() => onUpdateQuantity(item.product.id, Math.min(item.product.stock, item.quantity + 1))}
                                className="text-xs text-slate-500 hover:text-blue-600 font-extrabold px-1"
                              >
                                +
                              </button>
                            </div>

                            <button
                              type="button"
                              id={`cart-remove-${item.product.id}`}
                              onClick={() => onRemoveItem(item.product.id)}
                              className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-full transition-colors"
                              title="Eliminar producto"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Pricing Summary Footer */}
              {cart.length > 0 && (
                <div className="p-6 bg-slate-50/50 border-t border-slate-100 space-y-4">
                  {/* Dynamic Interest-Free Promo Reminder */}
                  {selectedCard ? (
                    <div className="bg-emerald-50 border border-emerald-100/60 rounded-xl p-3.5 flex items-start gap-2.5">
                      <CardIcon size={16} className="text-emerald-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[11px] text-emerald-700 font-bold leading-tight">
                          ¡Comprá en {maxCuotas} cuotas sin interés con {selectedCard.bankName}!
                        </p>
                        <p className="text-[10px] text-slate-500 leading-tight">
                          Pago mensual aproximado: <strong>${Math.round(totalAmount / maxCuotas).toLocaleString('es-AR')}/mes</strong>.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-100 border border-slate-200/40 rounded-xl p-3.5 flex items-start gap-2.5">
                      <Info size={16} className="text-blue-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[11px] text-slate-600 font-bold leading-tight">
                          ¿Querés comprar en cuotas sin interés?
                        </p>
                        <p className="text-[10px] text-slate-500 leading-tight">
                          Seleccioná una tarjeta de tu billetera bancaria para activar los planes de financiación.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Summary Totals */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs text-slate-500">
                      <span>Subtotal de productos:</span>
                      <span className="font-semibold">${totalAmount.toLocaleString('es-AR')}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-slate-500">
                      <span>Envío a domicilio:</span>
                      <span className="text-emerald-600 font-bold uppercase text-[10px]">Gratis</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-slate-250/60 pt-3">
                      <span className="text-sm text-slate-800 font-bold">Total estimado:</span>
                      <span className="text-xl font-extrabold text-blue-900">${totalAmount.toLocaleString('es-AR')}</span>
                    </div>
                  </div>

                  {/* Action Trigger */}
                  <button
                    type="button"
                    id="trigger-checkout-btn"
                    onClick={onCheckout}
                    className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-full text-xs tracking-wider uppercase shadow-md shadow-blue-600/15 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    Proceder al Pago
                    <ChevronRight size={14} strokeWidth={2.5} />
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
};
