import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  fetchProducts, fetchBanks, fetchCategories, fetchCards, addCard, me, logout,
  type Category, type Customer, type ApiCard, getToken,
} from './api';
import { AuthModal } from './components/AuthModal';
import type { Bank } from './types';

/**
 * La API devuelve la tarjeta con id numérico; los componentes del prototipo
 * esperan `CreditCard` con id string. Se traduce acá, en un solo lugar.
 */
function aTarjeta(c: ApiCard): CreditCard {
  return {
    id: String(c.id),
    holderName: c.holderName,
    cardNumber: c.cardNumber,
    expiryDate: c.expiryDate,
    brand: c.brand,
    tier: c.tier,
    bankId: c.bankId,
    bankName: c.bankName,
    limit: c.limit,
    availableLimit: c.availableLimit,
    colorTheme: c.colorTheme as CreditCard['colorTheme'],
  };
}
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

/** El select de la tienda usa otros valores que la API. */
const SORT_API: Record<string, 'relevance' | 'price_asc' | 'price_desc' | 'discount' | 'cuotas'> = {
  relevance: 'relevance',
  'price-asc': 'price_asc',
  'price-desc': 'price_desc',
  discount: 'discount',
  cuotas: 'cuotas',
};

export default function App() {
  // --- STATE ---
  // --- SESIÓN ---
  const [user, setUser] = useState<Customer | null>(null);
  const [checkingSession, setCheckingSession] = useState<boolean>(Boolean(getToken()));
  const [authOpen, setAuthOpen] = useState(false);
  const [authMotivo, setAuthMotivo] = useState<string | undefined>();

  const [cards, setCards] = useState<CreditCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<CreditCard | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  // --- CATÁLOGO (de la API) ---
  const [products, setProducts] = useState<Product[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState<boolean>(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
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

  /**
   * Vincula una tarjeta. El número completo viaja una sola vez al servidor,
   * que lo valida con Luhn y se queda con los últimos cuatro; nunca vuelve ni
   * queda guardado acá.
   */
  const handleAddCard = async (datos: Omit<Parameters<typeof addCard>[0], 'displayName'>) => {
    // El nombre comercial del producto bancario ("Galicia Eminent") se arma
    // con el banco y el rango: es lo que se muestra en la tarjeta.
    const banco = banks.find((b) => b.id === datos.bankId)?.name ?? 'Banco';
    const rango = datos.tier.charAt(0).toUpperCase() + datos.tier.slice(1);
    const creada = await addCard({ ...datos, displayName: `${banco} ${rango}` });
    const tarjeta = aTarjeta(creada);
    setCards((prev) => [tarjeta, ...prev]);
    setSelectedCard(tarjeta);
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


  // --- SESIÓN Y BILLETERA ---
  // Se revalida el token guardado contra el backend: que exista en
  // localStorage no significa que siga siendo válido.
  useEffect(() => {
    if (!getToken()) return;
    me()
      .then(setUser)
      .catch(() => { /* vencido: el cliente ya lo limpió */ })
      .finally(() => setCheckingSession(false));
  }, []);

  const recargarTarjetas = React.useCallback(() => {
    if (!user) { setCards([]); setSelectedCard(null); return; }
    fetchCards()
      .then((api) => {
        const mapeadas = api.map(aTarjeta);
        setCards(mapeadas);
        // Se conserva la elegida si sigue existiendo; si no, la primera.
        setSelectedCard((prev) => {
          const sigue = prev && mapeadas.find((c) => c.id === prev.id);
          return sigue ?? mapeadas[0] ?? null;
        });
      })
      .catch(() => { setCards([]); setSelectedCard(null); });
  }, [user]);

  useEffect(() => { recargarTarjetas(); }, [recargarTarjetas]);

  /** Abre el login explicando por qué hace falta. */
  const pedirLogin = (motivo?: string) => { setAuthMotivo(motivo); setAuthOpen(true); };

  const cerrarSesion = () => {
    logout();
    setUser(null);
    setCart([]);
    setPurchaseHistory([]);
  };

  // --- CARGA DEL CATÁLOGO ---
  // Los bancos y las categorías cambian poco: se piden una sola vez.
  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([fetchBanks(ctrl.signal), fetchCategories(ctrl.signal)])
      .then(([b, c]) => { setBanks(b); setCategories(c); })
      .catch((err) => { if (err.name !== 'AbortError') console.error(err); });
    return () => ctrl.abort();
  }, []);

  // El filtrado y el orden los hace el servidor, no el navegador. Es lo que
  // permite que un producto recién publicado aparezca y que el catálogo de un
  // comercio suspendido desaparezca sin que la tienda tenga que saber nada de
  // eso: la consulta ya excluye lo que no corresponde.
  useEffect(() => {
    const ctrl = new AbortController();
    // Espera antes de buscar: sin esto cada tecla dispara una request.
    const t = setTimeout(() => {
      setLoadingCatalog(true);
      setCatalogError(null);
      fetchProducts(
        {
          category: activeCategory,
          search: searchQuery.trim() || undefined,
          sort: SORT_API[sortBy] ?? 'relevance',
        },
        ctrl.signal
      )
        .then(setProducts)
        .catch((err) => {
          if (err.name === 'AbortError') return;
          setCatalogError(err.message ?? 'No pude cargar el catálogo');
        })
        .finally(() => { if (!ctrl.signal.aborted) setLoadingCatalog(false); });
    }, searchQuery ? 300 : 0);

    return () => { clearTimeout(t); ctrl.abort(); };
  }, [activeCategory, searchQuery, sortBy]);

  const filteredProducts = products;

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

          {/* Sesión */}
          {checkingSession ? (
            <div className="w-24 h-9 bg-slate-100 rounded-full animate-pulse" />
          ) : user ? (
            <div className="flex items-center gap-2">
              <div className="hidden md:block text-right leading-tight">
                <span className="block text-xs font-bold text-slate-800">{user.name}</span>
                <button
                  type="button" onClick={cerrarSesion}
                  className="text-[10px] text-slate-400 hover:text-rose-600 transition-colors"
                >
                  Cerrar sesión
                </button>
              </div>
              <div className="w-9 h-9 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold text-xs shrink-0">
                {user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => pedirLogin()}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2.5 rounded-full shadow-md shadow-blue-600/15 transition-all"
            >
              Ingresar
            </button>
          )}
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
          banks={banks}
          cards={cards}
          selectedCard={selectedCard}
          onSelectCard={handleSelectCard}
          onAddCard={handleAddCard}
          isLoggedIn={Boolean(user)}
          onRequestLogin={() => pedirLogin('Entrá para ver y vincular tus tarjetas.')}
        />

        {/* 4. Filters & Search Controls */}
        <div className="bg-white border border-slate-200/65 rounded-2xl p-4 flex flex-col lg:flex-row justify-between items-center gap-4 shadow-sm">
          
          {/* Categories Tab Selector */}
          <div className="flex gap-1.5 overflow-x-auto w-full lg:w-auto pb-2 lg:pb-0 select-none">
            {[
              { id: 'all', label: 'Todos' },
              // Las categorías salen de la API: si un comercio publica en una
              // nueva (ferretería, hotelería), aparece sola.
              ...categories.map((c) => ({ id: c.id, label: c.name }))
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
          {catalogError ? (
            <div className="bg-rose-50 border border-rose-100 rounded-3xl p-12 text-center">
              <Info size={32} className="text-rose-400 mx-auto mb-3" />
              <p className="text-rose-800 font-bold">No pudimos cargar el catálogo</p>
              <p className="text-xs text-rose-600 mt-1">{catalogError}</p>
            </div>
          ) : loadingCatalog && filteredProducts.length === 0 ? (
            /* Esqueletos en vez de spinner: la grilla no salta cuando llegan
               los productos. */
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="bg-white border border-slate-200/60 rounded-3xl h-96 animate-pulse" />
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
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
          // Comprar necesita cuenta: la orden se crea contra el usuario.
          if (!user) { pedirLogin('Entrá para completar tu compra.'); return; }
          if (cards.length === 0) {
            // Ya tiene sesión: lo que falta es la tarjeta, así que se lo lleva
            // a la billetera en vez de mostrarle un login que no resuelve nada.
            document.getElementById('card-wallet-section')
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
          }
          setIsCheckoutOpen(true);
        }}
      />

      {/* Checkout Payment Wizard Modal */}
      <CheckoutModal
          banks={banks}
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        cart={cart}
        availableCards={cards}
        selectedCard={selectedCard}
        onSelectCard={handleSelectCard}
        onCompletePurchase={handleCompletePurchase}
        onOrderPlaced={() => { recargarTarjetas(); setCart([]); }}
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

      <AuthModal
        isOpen={authOpen}
        motivo={authMotivo}
        onClose={() => setAuthOpen(false)}
        onAuth={(u) => { setUser(u); setAuthOpen(false); setAuthMotivo(undefined); }}
      />

    </div>
  );
}
