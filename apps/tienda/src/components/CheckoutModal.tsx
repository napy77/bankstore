import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CartItem, CreditCard, Purchase, Bank } from '../types';
import { CardVisualizer } from './CardVisualizer';
import { simulateCart, createOrder, fetchAddresses, type CartSimulation, type ApiOrder, type Address } from '../api';
import { X, ArrowRight, ArrowLeft, Check, CheckCircle2, ShieldCheck, Truck, DollarSign, Calendar, Landmark, MapPin, ReceiptText, ChevronRight, Loader2 } from 'lucide-react';

interface CheckoutModalProps {
  isOpen: boolean;
  /** Bancos disponibles, de la API. */
  banks: Bank[];
  onClose: () => void;
  cart: CartItem[];
  availableCards: CreditCard[];
  selectedCard: CreditCard | null;
  onSelectCard: (card: CreditCard) => void;
  onCompletePurchase: (purchase: Purchase) => void;
  /**
   * Se llama cuando la orden se creó. El límite lo descontó el servidor, así
   * que el padre relee la billetera en vez de restar a mano un número que
   * puede no coincidir con el real.
   */
  onOrderPlaced: () => void;
}

type Step = 'review' | 'financing' | 'shipping' | 'success';

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  banks,
  onClose,
  cart,
  availableCards,
  selectedCard,
  onSelectCard,
  onCompletePurchase,
  onOrderPlaced,
}) => {
  const [step, setStep] = useState<Step>('review');
  const [installments, setInstallments] = useState<number>(3);
  
  // Shipping details state
  const [shipping, setShipping] = useState({
    // Quién recibe puede no ser el titular de la tarjeta, y el correo pide un
    // teléfono para coordinar la entrega.
    recipient: '',
    phone: '',
    street: '',
    number: '',
    apartment: '',
    zip: '',
    city: 'CABA',
    province: 'Buenos Aires'
  });
  /** Direcciones ya guardadas. Quien compró una vez suele repetir domicilio. */
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressId, setAddressId] = useState<number | null>(null);

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Generated purchase success receipt
  const [receipt, setReceipt] = useState<Purchase | null>(null);

  // Lo que devuelve el servidor para este carrito.
  const [sim, setSim] = useState<CartSimulation | null>(null);
  const [orden, setOrden] = useState<ApiOrder | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  /** Se genera una vez por intento de compra y se reusa al reintentar. */
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  // Cuotas, interés, CFT, IVA discriminado y reintegro los calcula el servidor.
  // Antes se hacían acá con fórmulas inventadas (`tna = 40 + diferencia * 2.5`,
  // `cft = tna * 1.35`) que no coincidían con lo que después se iba a cobrar.
  // Es además la misma cuenta que hace el checkout, así que lo que se muestra
  // es exactamente lo que se paga.
  useEffect(() => {
    // El guard incluye isOpen porque este efecto vive ARRIBA del early
    // return: los hooks tienen que ejecutarse siempre, en el mismo orden.
    if (!isOpen || !selectedCard || cart.length === 0) { setSim(null); return; }
    const ctrl = new AbortController();
    setSimLoading(true);
    setSimError(null);
    // La provincia define la zona tarifaria. Mientras no se sepa, el envío
    // queda "a calcular" en vez de mostrar un cero engañoso.
    const provinciaDestino = addressId !== null
      ? addresses.find((d) => d.id === addressId)?.province
      : shipping.province;

    simulateCart(
      cart.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
      selectedCard.bankId,
      installments,
      provinciaDestino,
      ctrl.signal
    )
      .then(setSim)
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setSimError(err.message ?? 'No pude calcular el total');
      })
      .finally(() => { if (!ctrl.signal.aborted) setSimLoading(false); });
    return () => ctrl.abort();
  }, [isOpen, cart, selectedCard?.bankId, installments, addressId, addresses, shipping.province]);

  // La libreta se pide al abrir el checkout, no al montar: si el comprador
  // nunca llega a pagar, no hace falta haberla traído.
  useEffect(() => {
    if (!isOpen) return;
    fetchAddresses()
      .then((dirs) => {
        setAddresses(dirs);
        const pref = dirs.find((d) => d.isDefault) ?? dirs[0];
        if (pref) setAddressId(pref.id);
      })
      .catch(() => setAddresses([]));
  }, [isOpen]);

  if (!isOpen) return null;

  const totalAmount = cart.reduce((acc, item) => acc + item.product.price * item.quantity, 0);
  const currentBank = selectedCard ? banks.find((b) => b.id === selectedCard.bankId) : null;

  const maxCuotas = sim?.maxInterestFree ?? 1;
  const isInterestFree = sim ? sim.quote.interestFree : true;
  const cft = (sim?.quote.cft ?? 0) * 100;
  const surchargePercent = sim && totalAmount > 0
    ? ((sim.quote.totalAmount - totalAmount) / totalAmount) * 100
    : 0;
  const totalFinancedAmount = sim?.quote.totalAmount ?? totalAmount;
  const monthlyInstallment = sim?.quote.installmentAmount ?? totalAmount / installments;

  const reintegroAmount = sim?.reintegro ?? 0;

  // Validate address form
  const validateShippingForm = () => {
    const errors: Record<string, string> = {};
    // Con una dirección guardada elegida no hay nada que validar.
    if (addressId !== null) { setFormErrors({}); return true; }
    if (!shipping.recipient.trim()) errors.recipient = 'Decinos quién recibe';
    if (!shipping.street.trim()) errors.street = 'La calle es obligatoria';
    if (!shipping.number.trim()) errors.number = 'La altura es obligatoria';
    if (!shipping.zip.trim()) errors.zip = 'El código postal es obligatorio';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  /**
   * Confirma la compra contra el servidor.
   *
   * Sólo se manda QUÉ se compra: producto, cantidad, tarjeta y cuotas. El
   * precio, el IVA, el interés y el reintegro los recalcula el backend contra
   * la base, así que nada de lo que esté en este navegador afecta el monto.
   *
   * La clave de idempotencia se genera UNA vez por intento y se reusa si hay
   * que reintentar: es lo que evita la orden duplicada por doble click o por
   * un corte de red justo después de que el servidor ya la creó.
   */
  const handleFinalPayment = async () => {
    if (!selectedCard || paying) return;

    setPaying(true);
    setPayError(null);

    const clave = idempotencyKey ?? `chk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    if (!idempotencyKey) setIdempotencyKey(clave);

    try {
      const orden = await createOrder(
        cart.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
        Number(selectedCard.id),
        installments,
        clave,
        addressId !== null
          ? { addressId }
          : {
              shipping: {
                recipient: shipping.recipient,
                phone: shipping.phone || null,
                street: shipping.street,
                number: shipping.number,
                floorApt: shipping.apartment || null,
                zip: shipping.zip,
                city: shipping.city,
                province: shipping.province,
                notes: null,
              },
            }
      );

      const purchase: Purchase = {
        id: `#${orden.orderNumber}`,
        date: new Date(orden.date).toLocaleDateString('es-AR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        }),
        items: orden.items.map((i) => ({
          productId: i.productId,
          productName: i.productName,
          price: i.price,
          quantity: i.quantity,
        })),
        totalAmount: orden.totalAmount,
        cardUsed: {
          bankName: orden.cardUsed.bankName,
          brand: orden.cardUsed.brand as Purchase['cardUsed']['brand'],
          cardNumber: orden.cardUsed.cardNumber,
        },
        installments: orden.installments,
        installmentPrice: orden.installmentPrice,
        cft: orden.cft * 100,
        reintegroAmount: orden.reintegroAmount,
      };

      setOrden(orden);
      setReceipt(purchase);
      onCompletePurchase(purchase);
      // El límite lo descontó el servidor: se relee para no mostrar un número
      // calculado a mano que puede diferir del real.
      onOrderPlaced();
      setStep('success');
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'No pudimos procesar la compra');
    } finally {
      setPaying(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4">
        {/* Backdrop overlay */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={step === 'success' ? undefined : onClose}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
        />

        {/* Modal Wizard Panel */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white border border-slate-200 rounded-[32px] w-full max-w-2xl overflow-hidden shadow-2xl relative z-10 flex flex-col text-slate-800"
        >
          {/* Header */}
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white">
            <div>
              <p className="text-[10px] text-blue-600 font-bold uppercase tracking-widest">Pago Seguro de Compra</p>
              <h3 className="text-base font-bold text-slate-800 tracking-wide mt-0.5">
                {step === 'review' && 'Paso 1: Tarjeta & Resumen'}
                {step === 'financing' && 'Paso 2: Financiación'}
                {step === 'shipping' && 'Paso 3: Datos de Envío'}
                {step === 'success' && '¡Compra Completada!'}
              </h3>
            </div>
            {step !== 'success' && (
              <button
                type="button"
                id="close-checkout"
                onClick={onClose}
                className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-full transition-colors"
              >
                <X size={18} />
              </button>
            )}
          </div>

          {/* Stepper Indicator */}
          {step !== 'success' && (
            <div className="bg-slate-50 border-b border-slate-100 p-3.5 flex justify-around">
              {[
                { label: 'Tarjeta', key: 'review' },
                { label: 'Financiación', key: 'financing' },
                { label: 'Envío', key: 'shipping' },
              ].map((s, idx) => {
                const active = step === s.key;
                const completed =
                  (step === 'financing' && s.key === 'review') ||
                  (step === 'shipping' && (s.key === 'review' || s.key === 'financing'));
                return (
                  <div key={s.key} className="flex items-center space-x-2">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        active
                          ? 'bg-blue-600 text-white shadow-md shadow-blue-600/15'
                          : completed
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white text-slate-400 border border-slate-200'
                      }`}
                    >
                      {completed ? <Check size={10} strokeWidth={3} /> : idx + 1}
                    </div>
                    <span
                      className={`text-[11px] font-bold tracking-wider uppercase ${
                        active ? 'text-slate-800' : completed ? 'text-emerald-600' : 'text-slate-400'
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Step Contents */}
          <div className="p-6 flex-grow overflow-y-auto max-h-[65vh]">
            <AnimatePresence mode="wait">
              {step === 'review' && (
                <motion.div
                  key="review-step"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="space-y-5"
                >
                  {/* Select Card Wallet */}
                  <div>
                    <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2.5">
                      Seleccioná tu Tarjeta de Crédito de Pago
                    </label>

                    {/* horizontal sliding list */}
                    <div className="flex gap-4 overflow-x-auto pb-4 snap-x select-none">
                      {availableCards.map((card) => (
                        <div key={card.id} className="snap-start shrink-0">
                          <CardVisualizer
                            card={card}
                            isActive={selectedCard?.id === card.id}
                            onSelect={() => onSelectCard(card)}
                          />
                        </div>
                      ))}
                    </div>

                    {formErrors.card && (
                      <p className="text-xs text-rose-600 font-bold mt-1 bg-rose-50 p-2.5 rounded-xl border border-rose-100">
                        {formErrors.card}
                      </p>
                    )}
                  </div>

                  {/* Limit status indicator */}
                  {selectedCard && (
                    <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 flex justify-between items-center text-xs">
                      <div>
                        <span className="text-slate-500 font-semibold">Límite Disponible:</span>
                        <span className="text-slate-800 font-bold ml-1.5">
                          ${selectedCard.availableLimit.toLocaleString('es-AR')}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 font-semibold">Monto a abonar:</span>
                        <span className={`font-bold ml-1.5 ${selectedCard.availableLimit < totalAmount ? 'text-rose-500' : 'text-emerald-600'}`}>
                          ${totalAmount.toLocaleString('es-AR')}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Order Products List Summary */}
                  <div>
                    <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">
                      Productos a abonar
                    </label>
                    <div className="bg-slate-50 border border-slate-100 rounded-2xl divide-y divide-slate-100/60 max-h-36 overflow-y-auto shadow-sm">
                      {cart.map((item) => (
                        <div key={item.product.id} className="p-3.5 flex justify-between items-center text-xs">
                          <div className="space-y-0.5">
                            <p className="text-slate-800 font-bold">{item.product.name}</p>
                            <p className="text-slate-400 font-medium">Cantidad: {item.quantity}</p>
                          </div>
                          <span className="text-blue-900 font-bold">
                            ${(item.product.price * item.quantity).toLocaleString('es-AR')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              {step === 'financing' && (
                <motion.div
                  key="financing-step"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="space-y-5"
                >
                  <div className="bg-blue-50 border-l-4 border-blue-600 p-4 rounded-r-2xl">
                    <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest leading-tight">
                      Beneficio {selectedCard?.bankName} Seleccionado
                    </p>
                    <p className="text-sm font-bold text-slate-800 mt-0.5">
                      Disponés de hasta {maxCuotas} cuotas sin interés en tu compra completa.
                    </p>
                  </div>

                  {/* Cuotas Radio List with Exact Calculations */}
                  <div className="space-y-2.5">
                    <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                      Planes de Cuotas Disponibles
                    </label>

                    {[1, 3, 6, 9, 12, 18, 24]
                      .filter((o) => o <= (maxCuotas > 12 ? maxCuotas : 12))
                      .map((opt) => {
                        const optIsInterestFree = opt <= maxCuotas;
                        const active = installments === opt;

                        // Calculate rates specifically for this option
                        const difference = opt > maxCuotas ? opt - maxCuotas : 0;
                        const optSurcharge = difference > 0 ? (35 + difference * 3) / 12 * opt * 0.45 : 0;
                        const optTotalFinanced = totalAmount * (1 + optSurcharge / 100);
                        const optMonthly = optTotalFinanced / opt;

                        return (
                          <button
                            type="button"
                            id={`checkout-installment-opt-${opt}`}
                            key={opt}
                            onClick={() => setInstallments(opt)}
                            className={`w-full p-4 rounded-2xl text-left border flex justify-between items-center transition-all ${
                              active
                                ? 'bg-blue-50/70 border-blue-500 text-blue-900 shadow-sm'
                                : 'bg-white border-slate-200/80 hover:bg-slate-50 text-slate-600'
                            }`}
                          >
                            <div>
                              <div className="flex items-center space-x-2">
                                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${active ? 'border-blue-600' : 'border-slate-300'}`}>
                                  {active && <div className="w-2 h-2 rounded-full bg-blue-600" />}
                                </div>
                                <span className="text-sm font-bold text-slate-800">
                                  {opt} cuota{opt > 1 ? 's' : ''} de ${optMonthly.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-400 ml-6 mt-0.5">
                                {optIsInterestFree
                                  ? 'Financiación TNA: 0,00% | Costo Financiero Total: 0,00%'
                                  : `TNA de mercado financiada. Costo Financiero Total: ${(40 + difference * 3).toFixed(1)}%`}
                              </p>
                            </div>

                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                              optIsInterestFree ? 'bg-emerald-50 border border-emerald-100 text-emerald-600' : 'bg-slate-100 border border-slate-200/60 text-slate-500'
                            }`}>
                              {optIsInterestFree ? 'Sin Interés' : 'Tasa Fija'}
                            </span>
                          </button>
                        );
                      })}
                  </div>

                  {/* Summary Box with Net Costs */}
                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-2 shadow-sm">
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>Total de la compra:</span>
                      <span className="font-semibold text-slate-700">${totalAmount.toLocaleString('es-AR')}</span>
                    </div>
                    {!isInterestFree && (
                      <div className="flex justify-between text-xs text-rose-600">
                        <span>Interés por cuota fija ({surchargePercent.toFixed(1)}%):</span>
                        <span className="font-bold">+ ${(totalFinancedAmount - totalAmount).toLocaleString('es-AR')}</span>
                      </div>
                    )}
                    {reintegroAmount > 0 && (
                      <div className="flex justify-between text-xs text-emerald-600">
                        <span>Reintegro estimado por Banco:</span>
                        <span className="font-bold">- ${reintegroAmount.toLocaleString('es-AR')}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-bold border-t border-slate-200/60 pt-2.5 text-slate-800">
                      <span>Monto Total a Resumen:</span>
                      <span className="text-blue-900 font-extrabold">${totalFinancedAmount.toLocaleString('es-AR')}</span>
                    </div>
                  </div>

                  {/* Envío. Se cotiza por comercio: dos vendedores, dos despachos. */}
                  {sim && (
                    <div className="bg-white border border-slate-200/60 rounded-2xl p-4 mt-3">
                      <div className="flex justify-between items-start text-xs">
                        <div>
                          <span className="text-slate-500 font-medium">Envío</span>
                          {!sim.shipping.cotizado && (
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              Se calcula al cargar el domicilio.
                            </p>
                          )}
                          {sim.shipping.cotizado && sim.shipping.porComercio.length > 1 && (
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {sim.shipping.porComercio.length} despachos: cada comercio envía lo suyo.
                            </p>
                          )}
                          {sim.shipping.porComercio.some((e) => e.absorbed) && (
                            <p className="text-[10px] text-emerald-600 font-bold mt-0.5">
                              Bonificado por el comercio
                            </p>
                          )}
                          {sim.shipping.porComercio.some((e) => e.reason === 'sin-tarifa') && (
                            <p className="text-[10px] text-amber-600 mt-0.5">
                              No tenemos tarifa para ese destino: te contactamos para coordinarlo.
                            </p>
                          )}
                        </div>
                        <span className={`font-bold shrink-0 ${sim.shipping.total === 0 && sim.shipping.cotizado ? 'text-emerald-600' : 'text-slate-800'}`}>
                          {!sim.shipping.cotizado
                            ? 'a calcular'
                            : sim.shipping.total === 0
                            ? 'GRATIS'
                            : `$${sim.shipping.total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`}
                        </span>
                      </div>
                    </div>
                  )}

                  {/*
                    Desglose fiscal. La transparencia fiscal al consumidor
                    obliga a informar cuánto del precio es impuesto EN EL
                    MOMENTO DE LA VENTA, no sólo en el comprobante posterior.
                    Los montos vienen del servidor, congelados igual en la
                    orden cuando se confirma.
                  */}
                  {sim && (
                    <div className="bg-white border border-slate-200/60 rounded-2xl p-4 mt-3">
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2.5">
                        Discriminación de impuestos
                      </p>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between text-slate-500">
                          <span>Neto gravado</span>
                          <span className="tabular-nums">${sim.taxes.net.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between text-slate-500">
                          <span>IVA sobre la mercadería</span>
                          <span className="tabular-nums">${sim.taxes.iva.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                        </div>
                        {sim.taxes.ivaInteres > 0 && (
                          <div className="flex justify-between text-slate-500">
                            <span>
                              IVA sobre la financiación
                              <span className="block text-[10px] text-slate-400">Hecho imponible distinto al de la mercadería</span>
                            </span>
                            <span className="tabular-nums">${sim.taxes.ivaInteres.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                          </div>
                        )}
                        {/* Con varias alícuotas en el carrito conviene aclarar cuáles */}
                        {new Set(sim.items.map((i) => i.ivaRate)).size > 1 && (
                          <p className="text-[10px] text-slate-400 pt-1 leading-tight">
                            Tu compra tiene productos con distinta alícuota:{' '}
                            {[...new Set(sim.items.map((i) => i.ivaRate))]
                              .sort((a, b) => a - b)
                              .map((r) => `${(r * 100).toFixed(1).replace('.0', '')}%`)
                              .join(' y ')}.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {simError && (
                    <div className="bg-rose-50 border border-rose-100 rounded-2xl p-3 mt-3 text-xs text-rose-700">
                      {simError}
                    </div>
                  )}
                </motion.div>
              )}

              {step === 'shipping' && (
                <motion.div
                  key="shipping-step"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="space-y-4"
                >
                  {payError && (
                    <div className="bg-rose-50 border border-rose-100 rounded-2xl p-3.5 text-xs text-rose-700">
                      <strong className="block font-bold mb-0.5">No pudimos procesar la compra</strong>
                      {payError}
                    </div>
                  )}

                  {/* Direcciones guardadas: lo más común es repetir domicilio */}
                  {addresses.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                        Enviar a
                      </p>
                      {addresses.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => setAddressId(d.id)}
                          className={`w-full text-left p-3.5 rounded-2xl border transition-all ${
                            addressId === d.id
                              ? 'border-blue-600 bg-blue-50/50 ring-1 ring-blue-600'
                              : 'border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <MapPin size={15} className={addressId === d.id ? 'text-blue-600 mt-0.5' : 'text-slate-400 mt-0.5'} />
                            <div className="text-xs">
                              <span className="font-bold text-slate-800">
                                {d.recipient}
                                {d.label && <span className="text-slate-400 font-normal"> · {d.label}</span>}
                              </span>
                              <span className="block text-slate-500">
                                {d.street} {d.number}
                                {d.floorApt && `, ${d.floorApt}`} · {d.city}, {d.province} ({d.zip})
                              </span>
                            </div>
                          </div>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setAddressId(null)}
                        className={`w-full text-left p-3 rounded-2xl border border-dashed transition-all text-xs font-bold ${
                          addressId === null
                            ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                            : 'border-slate-300 text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                        + Usar otro domicilio
                      </button>
                    </div>
                  )}

                  <div className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-4 flex gap-3 text-xs text-slate-600">
                    <Truck size={20} className="text-emerald-600 mt-0.5 shrink-0" />
                    <p className="leading-relaxed">
                      {sim && sim.shipping.cotizado && sim.shipping.total === 0
                        ? <>El envío de esta compra va <strong className="text-emerald-700 font-bold">sin cargo</strong>. Recibís tu pedido en el domicilio que cargues.</>
                        : <>Coordinamos la entrega en el domicilio que cargues. El costo se calcula según destino y peso.</>}
                    </p>
                  </div>

                  {/* Formulario, sólo si no eligió una guardada */}
                  {addressId === null && (
                  <div className="grid grid-cols-6 gap-3.5 pt-1">
                    <div className="col-span-4">
                      <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">Quién recibe</label>
                      <input
                        type="text"
                        id="shipping-recipient"
                        placeholder="Nombre y apellido"
                        value={shipping.recipient}
                        onChange={(e) => setShipping({ ...shipping, recipient: e.target.value })}
                        className="w-full bg-slate-50 text-slate-800 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-400 transition-all"
                      />
                      {formErrors.recipient && <p className="text-[10px] text-rose-600 font-semibold mt-0.5">{formErrors.recipient}</p>}
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">Teléfono</label>
                      <input
                        type="tel"
                        id="shipping-phone"
                        placeholder="11 5555-5555"
                        value={shipping.phone}
                        onChange={(e) => setShipping({ ...shipping, phone: e.target.value })}
                        className="w-full bg-slate-50 text-slate-800 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-400 transition-all"
                      />
                      <p className="text-[10px] text-slate-400 mt-0.5">Para coordinar la entrega.</p>
                    </div>
                    <div className="col-span-4">
                      <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">Calle</label>
                      <input
                        type="text"
                        id="shipping-street"
                        placeholder="Ej. Av. Corrientes"
                        value={shipping.street}
                        onChange={(e) => setShipping({ ...shipping, street: e.target.value })}
                        className="w-full bg-slate-50 text-slate-800 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-400 transition-all"
                      />
                      {formErrors.street && <p className="text-[10px] text-rose-600 font-semibold mt-0.5">{formErrors.street}</p>}
                    </div>

                    <div className="col-span-2">
                      <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">Altura</label>
                      <input
                        type="text"
                        id="shipping-number"
                        placeholder="Ej. 1234"
                        value={shipping.number}
                        onChange={(e) => setShipping({ ...shipping, number: e.target.value })}
                        className="w-full bg-slate-50 text-slate-800 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-400 transition-all"
                      />
                      {formErrors.number && <p className="text-[10px] text-rose-600 font-semibold mt-0.5">{formErrors.number}</p>}
                    </div>

                    <div className="col-span-3">
                      <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">Piso / Depto</label>
                      <input
                        type="text"
                        id="shipping-apt"
                        placeholder="Ej. 4 B"
                        value={shipping.apartment}
                        onChange={(e) => setShipping({ ...shipping, apartment: e.target.value })}
                        className="w-full bg-slate-50 text-slate-800 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-400 transition-all"
                      />
                    </div>

                    <div className="col-span-3">
                      <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">Código Postal</label>
                      <input
                        type="text"
                        id="shipping-zip"
                        placeholder="Ej. C1043"
                        value={shipping.zip}
                        onChange={(e) => setShipping({ ...shipping, zip: e.target.value })}
                        className="w-full bg-slate-50 text-slate-800 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-400 transition-all"
                      />
                      {formErrors.zip && <p className="text-[10px] text-rose-600 font-semibold mt-0.5">{formErrors.zip}</p>}
                    </div>

                    <div className="col-span-3">
                      <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">Localidad</label>
                      <input
                        type="text"
                        id="shipping-city"
                        value={shipping.city}
                        onChange={(e) => setShipping({ ...shipping, city: e.target.value })}
                        className="w-full bg-slate-50 text-slate-800 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      />
                    </div>

                    <div className="col-span-3">
                      <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">Provincia</label>
                      <input
                        type="text"
                        id="shipping-province"
                        value={shipping.province}
                        onChange={(e) => setShipping({ ...shipping, province: e.target.value })}
                        className="w-full bg-slate-50 text-slate-800 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      />
                    </div>
                  </div>
                  )}
                </motion.div>
              )}

              {step === 'success' && receipt && (
                <motion.div
                  key="success-step"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-6 text-center py-4"
                >
                  {/* Glowing Animated Success Badge */}
                  <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto shadow-sm animate-bounce">
                    <CheckCircle2 size={36} className="text-emerald-600" />
                  </div>

                  <div>
                    <h4 className="text-xl font-bold text-slate-800 tracking-tight">¡Tu Compra fue Aprobada!</h4>
                    <p className="text-xs text-slate-500 mt-1">El comprobante se envió a tu correo registrado y el límite disponible se actualizó.</p>
                  </div>

                  {/* High Fidelity Visual Receipt */}
                  <div className="bg-slate-50 border border-slate-200/60 rounded-3xl p-5 text-left space-y-4 max-w-md mx-auto shadow-sm relative">
                    {/* Top ticket strip dots */}
                    <div className="absolute top-0 inset-x-4 h-1.5 flex justify-between -translate-y-1">
                      {Array.from({ length: 12 }).map((_, i) => (
                        <div key={i} className="w-2.5 h-2.5 rounded-full bg-white border-b border-slate-200/40" />
                      ))}
                    </div>

                    <div className="border-b border-slate-200/60 pb-3 flex justify-between items-center text-xs">
                      <span className="flex items-center gap-1.5 text-slate-500">
                        <ReceiptText size={14} className="text-blue-600" />
                        Código Comprobante:
                      </span>
                      <strong className="font-mono text-slate-800 text-sm">{receipt.id}</strong>
                    </div>

                    <div className="grid grid-cols-2 gap-y-3.5 gap-x-2 text-xs border-b border-slate-200/60 pb-4">
                      <div>
                        <span className="text-slate-400 block mb-0.5">Fecha:</span>
                        <span className="text-slate-700 font-bold">{receipt.date}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block mb-0.5">Medio de Pago:</span>
                        <span className="text-slate-700 font-bold uppercase">{receipt.cardUsed.brand} {receipt.cardUsed.cardNumber}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block mb-0.5">Banco Emisor:</span>
                        <span className="text-slate-700 font-bold">{receipt.cardUsed.bankName}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block mb-0.5">Financiación:</span>
                        <span className="text-slate-700 font-bold">{receipt.installments} cuotas fijas</span>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center text-xs text-slate-500">
                        <span>Pago por Mes:</span>
                        <strong className="text-slate-800 font-bold">${receipt.installmentPrice.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong>
                      </div>
                      {receipt.reintegroAmount > 0 && (
                        <div className="flex justify-between items-center text-xs text-emerald-600">
                          <span>Ahorro Reintegro de Banco:</span>
                          <strong className="font-bold">-${receipt.reintegroAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong>
                        </div>
                      )}
                      <div className="flex justify-between items-center pt-2.5 border-t border-slate-200/60 text-sm">
                        <span className="text-slate-700 font-bold">Total Facturado:</span>
                        <strong className="text-blue-900 text-base font-extrabold">${receipt.totalAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer Navigation controls */}
          {step !== 'success' && (
            <div className="p-5 border-t border-slate-100 flex justify-between bg-white">
              {/* Back Button */}
              {step !== 'review' ? (
                <button
                  type="button"
                  id="checkout-back-btn"
                  onClick={() => {
                    if (step === 'financing') setStep('review');
                    if (step === 'shipping') setStep('financing');
                  }}
                  className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs uppercase tracking-wider rounded-full flex items-center gap-1.5 border-none transition-all"
                >
                  <ArrowLeft size={14} />
                  Atrás
                </button>
              ) : (
                <div />
              )}

              {/* Forward / Pay Button */}
              {step === 'review' && (
                <button
                  type="button"
                  id="checkout-next-review-btn"
                  disabled={!selectedCard}
                  onClick={() => setStep('financing')}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400 text-white font-bold text-xs uppercase tracking-wider rounded-full flex items-center gap-1.5 shadow-md shadow-blue-600/10 cursor-pointer transition-all"
                >
                  Continuar Financiación
                  <ArrowRight size={14} strokeWidth={2.5} />
                </button>
              )}

              {step === 'financing' && (
                <button
                  type="button"
                  id="checkout-next-financing-btn"
                  onClick={() => setStep('shipping')}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-full flex items-center gap-1.5 shadow-md shadow-blue-600/10 cursor-pointer transition-all"
                >
                  Confirmar Cuotas
                  <ArrowRight size={14} strokeWidth={2.5} />
                </button>
              )}

              {step === 'shipping' && (
                <button
                  type="button"
                  id="checkout-pay-btn"
                  disabled={paying}
                  onClick={() => {
                    if (validateShippingForm()) {
                      handleFinalPayment();
                    }
                  }}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-wait text-white font-bold text-xs uppercase tracking-wider rounded-full flex items-center gap-1.5 shadow-md shadow-blue-600/10 cursor-pointer transition-all"
                >
                  {paying
                    ? <><Loader2 size={16} className="animate-spin" /> Procesando…</>
                    : <><ShieldCheck size={16} strokeWidth={2.5} /> Pagar Ahora • ${totalFinancedAmount.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</>}
                </button>
              )}
            </div>
          )}

          {step === 'success' && (
            <div className="p-5 border-t border-slate-100 flex justify-center bg-white">
              <button
                type="button"
                id="success-done-btn"
                onClick={onClose}
                className="w-full max-w-xs py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider rounded-full border-none cursor-pointer transition-all"
              >
                Volver a la Tienda
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
