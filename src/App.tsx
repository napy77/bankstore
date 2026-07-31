import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PRODUCTS } from './data/products';
import { INITIAL_CARDS, BANKS } from './data/banks';
import { CardWalletSection } from './components/CardWalletSection';
import { ProductCard } from './components/ProductCard';
import { ProductDetailsModal } from './components/ProductDetailsModal';
import { CartDrawer } from './components/CartDrawer';
import { CheckoutModal } from './components/CheckoutModal';
import { CreditCard, Product, CartItem, Purchase } from './types';
import {
  Search,
  Filter,
  ShoppingBag,
  Percent,
  Landmark,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  DollarSign,
  Wallet,
  CheckCircle2,
  List,
  CreditCard as CardIcon,
  HelpCircle,
  Clock,
  ExternalLink,
  ChevronRight,
  Info,
  X
} from 'lucide-react';

export default function App() {
  // --- STATE ---
  const [cards, setCards] = useState<CreditCard[]>(INITIAL_CARDS);
  const [selectedCard, setSelectedCard] = useState<CreditCard | null>(INITIAL_CARDS[0]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('relevance');
  
  // Modals & Drawers
  const [selectedProductDetails, setSelectedProductDetails] = useState<Product | null>(null);
  const [isCartOpen, setIsCartOpen] = useState<boolean>(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState<boolean>(false);
  
  // Purchases logs
  const [purchaseHistory, setPurchaseHistory] = useState<Purchase[]>([]);
  const [showInvoice, setShowInvoice] = useState<Purchase | null>(null);

  // --- ACTIONS ---
  const handleSelectCard = (card: CreditCard) => {
    setSelectedCard(card);
  };

  const handleAddCard = (newCard: CreditCard) => {
    setCards((prev) => [newCard, ...prev]);
    // Automatically select the newly added card
    setSelectedCard(newCard);
  };

  const handleAddToCart = (product: Product, quantity: number = 1) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      }
      return [...prev, { product, quantity }];
    });
  };

  const handleQuickAdd = (product: Product, e: React.MouseEvent) => {
    e.stopPropagation();
    handleAddToCart(product, 1);
    
    // Quick success pulse state
    const target = e.currentTarget;
    target.classList.add('bg-emerald-500', 'text-white');
    setTimeout(() => {
      target.classList.remove('bg-emerald-500', 'text-white');
    }, 800);
  };

  const handleRemoveItem = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const handleUpdateQuantity = (productId: string, quantity: number) => {
    setCart((prev) =>
      prev.map((item) => (item.product.id === productId ? { ...item, quantity } : item))
    );
  };

  const handleCompletePurchase = (purchase: Purchase) => {
    setPurchaseHistory((prev) => [purchase, ...prev]);
    setCart([]); // Clear cart
  };

  const handleUpdateCardLimit = (cardId: string, purchaseAmount: number) => {
    setCards((prev) =>
      prev.map((card) =>
        card.id === cardId
          ? { ...card, availableLimit: card.availableLimit - purchaseAmount }
          : card
      )
    );
    // Sync current active card
    setSelectedCard((prev) =>
      prev && prev.id === cardId
        ? { ...prev, availableLimit: prev.availableLimit - purchaseAmount }
        : prev
    );
  };

  // --- FILTERED PRODUCTS ---
  const filteredProducts = useMemo(() => {
    return PRODUCTS.filter((p) => {
      const matchCat = activeCategory === 'all' || p.category === activeCategory;
      const matchSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    }).sort((a, b) => {
      if (sortBy === 'price-asc') return a.price - b.price;
      if (sortBy === 'price-desc') return b.price - a.price;
      if (sortBy === 'discount') {
        const discA = a.originalPrice ? (a.originalPrice - a.price) / a.originalPrice : 0;
        const discB = b.originalPrice ? (b.originalPrice - b.price) / b.originalPrice : 0;
        return discB - discA;
      }
      if (sortBy === 'cuotas') {
        const maxCuotasA = selectedCard
          ? a.bankOffers.find((o) => o.bankId === selectedCard.bankId)?.maxCuotas || 1
          : Math.max(...a.bankOffers.map((o) => o.maxCuotas));
        const maxCuotasB = selectedCard
          ? b.bankOffers.find((o) => o.bankId === selectedCard.bankId)?.maxCuotas || 1
          : Math.max(...b.bankOffers.map((o) => o.maxCuotas));
        return maxCuotasB - maxCuotasA;
      }
      return 0; // relevance
    });
  }, [activeCategory, searchQuery, sortBy, selectedCard]);

  // Derived dashboard details
  const savingsAmount = useMemo(() => {
    return purchaseHistory.reduce((acc, curr) => acc + curr.reintegroAmount, 0);
  }, [purchaseHistory]);

  const outstandingFinancing = useMemo(() => {
    return purchaseHistory.reduce((acc, curr) => acc + curr.totalAmount, 0);
  }, [purchaseHistory]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900">
      {/* 1. Header Navigation Bar */}
      <nav className="border-b border-slate-200 bg-white sticky top-0 z-40 px-4 lg:px-8 py-3.5 flex justify-between items-center shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
            <Landmark className="text-white" size={20} strokeWidth={2.5} />
          </div>
          <div className="leading-none">
            <span className="text-xl font-bold tracking-tight text-blue-900">BANK</span>
            <span className="text-xl font-light text-blue-600">STORE</span>
            <span className="text-[9px] block text-slate-400 font-bold uppercase tracking-widest mt-0.5">Beneficios Exclusivos</span>
          </div>
        </div>

        {/* Global Stats */}
        <div className="hidden md:flex items-center space-x-6 text-xs border-l border-r border-slate-200 px-6 py-1">
          <div className="flex items-center gap-2">
            <Sparkles className="text-blue-600" size={14} />
            <div>
              <span className="text-slate-400 block text-[9px] font-bold uppercase">Ahorros simulados</span>
              <span className="font-mono font-bold text-emerald-600">${savingsAmount.toLocaleString('es-AR')}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp className="text-indigo-600" size={14} />
            <div>
              <span className="text-slate-400 block text-[9px] font-bold uppercase">Financiación total</span>
              <span className="font-mono font-bold text-slate-800">${outstandingFinancing.toLocaleString('es-AR')}</span>
            </div>
          </div>
        </div>

        {/* Cart Trigger */}
        <div className="flex items-center space-x-3">
          <button
            type="button"
            id="open-cart-trigger"
            onClick={() => setIsCartOpen(true)}
            className="p-2.5 px-5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full transition-all flex items-center gap-2 relative border-none"
          >
            <ShoppingBag size={18} />
            <span className="text-xs font-bold hidden sm:inline">Mi Carrito</span>
            {cart.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-blue-600 text-white font-black text-[10px] w-5 h-5 rounded-full flex items-center justify-center animate-pulse shadow-md">
                {cart.reduce((sum, item) => sum + item.quantity, 0)}
              </span>
            )}
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 lg:px-8 py-8 space-y-8">
        
        {/* 2. Innovative Promo Banner */}
        <section className="relative h-auto md:h-72 bg-gradient-to-r from-blue-900 to-indigo-800 rounded-[32px] overflow-hidden flex flex-col md:flex-row items-center px-6 md:px-12 py-8 md:py-0 shadow-lg justify-between gap-6">
          <div className="z-10 w-full md:w-1/2 text-left space-y-4">
            <span className="bg-white/20 backdrop-blur-md text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest inline-block">
              Beneficio Exclusivo
            </span>
            <h1 className="text-3xl md:text-5xl font-extrabold text-white leading-tight tracking-tighter">
              12 Cuotas sin Interés <br/>
              <span className="text-blue-300 italic font-serif">en toda la tienda</span>
            </h1>
            <p className="text-blue-100 text-sm md:text-base max-w-md">
              Aprovechá hoy con tus tarjetas Visa Signature y Mastercard Black de nuestro banco.
            </p>
          </div>
          <div className="w-full md:w-1/3 shrink-0 bg-white/10 border border-white/20 rounded-2xl p-5 backdrop-blur-md text-white">
            <p className="text-[10px] text-blue-200 uppercase font-bold tracking-widest mb-1.5">Ventaja de la semana</p>
            <p className="text-sm font-extrabold text-white">Reintegro automático del 15%</p>
            <p className="text-[11px] text-blue-100 mt-1">Con tarjetas premium seleccionadas en todos los productos de electro y tecnología.</p>
          </div>
        </section>

        {/* 3. Card Wallet Controller */}
        <CardWalletSection
          cards={cards}
          selectedCard={selectedCard}
          onSelectCard={handleSelectCard}
          onAddCard={handleAddCard}
        />

        {/* 4. Filters & Search Controls */}
        <div className="bg-white border border-slate-200/65 rounded-2xl p-4 flex flex-col lg:flex-row justify-between items-center gap-4 shadow-sm">
          
          {/* Categories Tab Selector */}
          <div className="flex gap-1.5 overflow-x-auto w-full lg:w-auto pb-2 lg:pb-0 select-none">
            {[
              { id: 'all', label: 'Todos' },
              { id: 'tecnologia', label: 'Tecnología' },
              { id: 'electrohogar', label: 'Electrohogar' },
              { id: 'turismo', label: 'Turismo / Viajes' },
              { id: 'deportes', label: 'Deportes' },
              { id: 'moda', label: 'Moda' }
            ].map((cat) => (
              <button
                type="button"
                id={`cat-tab-${cat.id}`}
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-5 py-2.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                  activeCategory === cat.id
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/15'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Search, Sort & Configs */}
          <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto shrink-0">
            {/* Search Input */}
            <div className="relative flex-grow">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <input
                type="text"
                id="search-input"
                placeholder="Busca tecnología, hogar y más..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full lg:w-64 bg-slate-100 text-slate-800 border-none rounded-full pl-10 pr-4 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-400 transition-all"
              />
            </div>

            {/* Sort Select */}
            <div className="flex items-center space-x-2 shrink-0">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider hidden sm:inline">Ordenar:</span>
              <select
                id="sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-slate-100 text-slate-700 border-none rounded-full px-4 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              >
                <option value="relevance">Relevancia</option>
                <option value="price-asc">Menor Precio</option>
                <option value="price-desc">Mayor Precio</option>
                <option value="discount">Mayor Descuento</option>
                <option value="cuotas">Más Cuotas sin Interés</option>
              </select>
            </div>
          </div>

        </div>

        {/* 5. Products Grid Showcase */}
        <div>
          {filteredProducts.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center shadow-sm">
              <Info size={32} className="text-slate-400 mx-auto mb-3" />
              <p className="text-slate-800 font-bold">No se encontraron productos</p>
              <p className="text-xs text-slate-500 mt-1">Intentá cambiar los filtros o el término de búsqueda.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredProducts.map((prod) => (
                <ProductCard
                  key={prod.id}
                  product={prod}
                  selectedCard={selectedCard}
                  onOpenDetails={(p) => setSelectedProductDetails(p)}
                  onAddToCart={handleQuickAdd}
                />
              ))}
            </div>
          )}
        </div>

        {/* 6. Purchase Invoices / Tickets Log */}
        {purchaseHistory.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-3xl p-6 space-y-4 shadow-sm">
            <div className="flex items-center space-x-2">
              <Clock size={16} className="text-blue-600" />
              <h3 className="font-bold text-slate-800 text-base tracking-wide">Comprobantes & Historial</h3>
            </div>
            
            <div className="overflow-x-auto border border-slate-200 rounded-2xl bg-slate-50/50">
              <table className="w-full text-xs text-left text-slate-600">
                <thead className="text-[10px] uppercase font-bold text-slate-500 bg-slate-100/80 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">ID Ticket</th>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Banco Tarjeta</th>
                    <th className="px-4 py-3">Cuotas</th>
                    <th className="px-4 py-3">Monto Total</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {purchaseHistory.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-100/50 transition-colors">
                      <td className="px-4 py-3.5 font-mono font-bold text-slate-800">{p.id}</td>
                      <td className="px-4 py-3.5">{p.date}</td>
                      <td className="px-4 py-3.5 font-medium">{p.cardUsed.bankName}</td>
                      <td className="px-4 py-3.5 font-bold">{p.installments} cuotas de ${p.installmentPrice.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</td>
                      <td className="px-4 py-3.5 font-bold text-slate-800">${p.totalAmount.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</td>
                      <td className="px-4 py-3.5 text-right">
                        <button
                          type="button"
                          id={`show-invoice-btn-${p.id}`}
                          onClick={() => setShowInvoice(p)}
                          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full font-bold transition-all flex items-center gap-1.5 ml-auto text-[11px]"
                        >
                          Ver Ticket
                          <ExternalLink size={11} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>

      {/* FOOTER */}
      <footer className="bg-white border-t border-slate-200 px-8 py-6 text-center md:flex md:items-center md:justify-between text-xs text-slate-400 mt-16 space-y-2 md:space-y-0">
        <div className="flex flex-wrap justify-center gap-6">
          <span>Atención al Cliente: 0800-BANK-STORE</span>
          <span>Seguimiento de Envío</span>
          <span>Términos y Condiciones</span>
        </div>
        <div className="flex items-center justify-center gap-2">
          <span className="text-slate-600 uppercase font-bold">Tu Banco. Tu Marketplace.</span>
          <div className="w-1.5 h-1.5 bg-blue-600 rounded-full"></div>
          <span>© 2026</span>
        </div>
      </footer>

      {/* --- FLOATING & POPUP DIALOGS --- */}

      {/* Product Technical Details Modal */}
      <ProductDetailsModal
        product={selectedProductDetails}
        selectedCard={selectedCard}
        onClose={() => setSelectedProductDetails(null)}
        onAddToCart={handleAddToCart}
      />

      {/* Shopping Cart Sidebar Drawer */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cart={cart}
        selectedCard={selectedCard}
        onRemoveItem={handleRemoveItem}
        onUpdateQuantity={handleUpdateQuantity}
        onCheckout={() => {
          setIsCartOpen(false);
          setIsCheckoutOpen(true);
        }}
      />

      {/* Checkout Payment Wizard Modal */}
      <CheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        cart={cart}
        availableCards={cards}
        selectedCard={selectedCard}
        onSelectCard={handleSelectCard}
        onCompletePurchase={handleCompletePurchase}
        onUpdateCardLimit={handleUpdateCardLimit}
      />

      {/* Isolated Invoice ticket popup */}
      <AnimatePresence>
        {showInvoice && (
          <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowInvoice(null)}
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-slate-200 rounded-[32px] w-full max-w-md p-6 relative z-10 space-y-4 shadow-2xl text-slate-800"
            >
              <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                <h4 className="font-bold text-slate-800 text-sm uppercase tracking-wider flex items-center gap-1.5">
                  <CheckCircle2 size={16} className="text-emerald-500" />
                  Comprobante Oficial de Pago
                </h4>
                <button
                  type="button"
                  id="close-invoice-modal"
                  onClick={() => setShowInvoice(null)}
                  className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-full transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-3.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>ID Transacción:</span>
                  <strong className="text-slate-800 font-mono">{showInvoice.id}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Fecha de Emisión:</span>
                  <span className="text-slate-800">{showInvoice.date}</span>
                </div>
                <div className="flex justify-between">
                  <span>Medio de Pago:</span>
                  <span className="text-slate-800 uppercase">{showInvoice.cardUsed.brand} {showInvoice.cardUsed.cardNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span>Banco Emisor:</span>
                  <span className="text-slate-800">{showInvoice.cardUsed.bankName}</span>
                </div>
                <div className="flex justify-between">
                  <span>Plan de Pago:</span>
                  <span className="text-slate-800">{showInvoice.installments} cuotas fijas</span>
                </div>

                <div className="border-t border-slate-100 pt-3 space-y-1.5">
                  {showInvoice.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between">
                      <span>{item.productName} (x{item.quantity})</span>
                      <span className="font-mono text-slate-700">${item.price.toLocaleString('es-AR')}</span>
                    </div>
                  ))}
                </div>

                <div className="border-t border-slate-100 pt-3 space-y-1">
                  <div className="flex justify-between font-bold text-slate-700">
                    <span>Monto por Cuota:</span>
                    <span className="font-mono">${showInvoice.installmentPrice.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                  </div>
                  {showInvoice.reintegroAmount > 0 && (
                    <div className="flex justify-between font-bold text-emerald-600">
                      <span>Reintegro del Banco:</span>
                      <span className="font-mono">-${showInvoice.reintegroAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-base font-bold text-blue-900 pt-2 border-t border-dashed border-slate-200">
                    <span>Monto Total:</span>
                    <span className="font-mono">${showInvoice.totalAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                id="close-invoice-modal-btn"
                onClick={() => setShowInvoice(null)}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-full transition-all shadow-md shadow-blue-600/10"
              >
                Cerrar Comprobante
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
