import React from 'react';
import { motion } from 'motion/react';
import { Product, CreditCard } from '../types';
import { Star, CreditCard as CardIcon, ShoppingBag, Percent, Eye } from 'lucide-react';

interface ProductCardProps {
  product: Product;
  selectedCard: CreditCard | null;
  onOpenDetails: (product: Product) => void;
  onAddToCart: (product: Product, e: React.MouseEvent) => void;
}

// Custom vector-drawn product representation using Tailwind and pure shapes
export const ProductVisual: React.FC<{ productId: string; className?: string }> = ({ productId, className = "" }) => {
  switch (productId) {
    case 'prod-1': // Smart TV
      return (
        <div className={`w-full h-full flex flex-col items-center justify-center relative p-4 ${className}`}>
          <div className="w-[85%] aspect-[16/9] bg-slate-950 border-4 border-slate-700 rounded shadow-2xl flex items-center justify-center relative">
            <div className="absolute inset-2 bg-gradient-to-tr from-indigo-900/40 via-violet-950/20 to-transparent animate-pulse" />
            <div className="text-center z-10">
              <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest">NEO QLED 8K</p>
              <div className="w-12 h-1 bg-gradient-to-r from-cyan-500 to-indigo-500 mx-auto mt-1 rounded-full" />
            </div>
          </div>
          {/* Stand */}
          <div className="w-20 h-2 bg-slate-700 mt-0.5 rounded-sm" />
          <div className="w-28 h-1.5 bg-slate-800 rounded-sm" />
        </div>
      );
    case 'prod-2': // iPhone 15 Pro Max
      return (
        <div className={`w-full h-full flex items-center justify-center relative p-4 ${className}`}>
          <div className="w-28 h-52 bg-stone-900 border-[3px] border-neutral-700 rounded-[28px] shadow-2xl flex flex-col justify-between p-2 relative overflow-hidden">
            {/* Dynamic Island */}
            <div className="w-10 h-3 bg-black mx-auto rounded-full z-20 mt-1 flex items-center justify-around px-1">
              <div className="w-1 h-1 rounded-full bg-blue-900/50" />
              <div className="w-1.5 h-1.5 rounded-full bg-slate-900" />
            </div>
            {/* Camera Module on back (visible in simulated translucent overlay) */}
            <div className="absolute top-10 right-2 w-14 h-14 bg-stone-850 rounded-2xl border border-white/5 p-1 grid grid-cols-2 gap-1 opacity-20">
              <div className="w-5 h-5 rounded-full bg-black" />
              <div className="w-5 h-5 rounded-full bg-black" />
              <div className="w-5 h-5 rounded-full bg-black" />
            </div>
            {/* Screen glowing effect */}
            <div className="absolute inset-0 bg-gradient-to-b from-stone-800/10 via-neutral-900/50 to-stone-950/90 pointer-events-none" />
            <div className="mt-auto mb-2 text-center z-10">
              <p className="text-[9px] text-neutral-400 font-bold uppercase tracking-wider">A17 Pro Titanium</p>
            </div>
          </div>
        </div>
      );
    case 'prod-3': // ASUS ROG Laptop
      return (
        <div className={`w-full h-full flex flex-col items-center justify-center relative p-4 ${className}`}>
          {/* Laptop Screen */}
          <div className="w-[80%] aspect-[16/10] bg-zinc-950 border-2 border-zinc-700 rounded-t-lg flex items-center justify-center relative shadow-2xl">
            <div className="absolute inset-1.5 bg-gradient-to-br from-slate-900/40 via-red-950/20 to-zinc-950 rounded" />
            <div className="text-center z-10">
              <div className="w-8 h-8 rounded-full border border-red-500/30 flex items-center justify-center mx-auto mb-1 animate-pulse">
                <div className="w-4 h-4 bg-red-600 rounded-sm transform rotate-45" />
              </div>
              <p className="text-[8px] text-red-500 font-black tracking-widest">ZEPHYRUS OLED</p>
            </div>
          </div>
          {/* Laptop Base */}
          <div className="w-[92%] h-2.5 bg-zinc-800 rounded-b-md relative flex justify-center">
            <div className="w-12 h-1 bg-zinc-900 rounded-b-sm" />
            {/* Keyboard glowing bar */}
            <div className="absolute top-0 left-4 right-4 h-[1px] bg-red-500/80 blur-[1px]" />
          </div>
          {/* Base bottom lip */}
          <div className="w-[88%] h-1 bg-zinc-900 rounded-b" />
        </div>
      );
    case 'prod-4': // Philips Coffee Maker
      return (
        <div className={`w-full h-full flex items-center justify-center relative p-4 ${className}`}>
          <div className="w-24 h-40 bg-zinc-900 border border-amber-900/20 rounded-xl shadow-2xl flex flex-col justify-between p-2 relative overflow-hidden">
            {/* Control Panel */}
            <div className="w-full h-6 bg-black rounded-lg border border-zinc-800 p-1 flex items-center justify-around">
              <div className="w-1 h-1 rounded-full bg-red-500" />
              <div className="w-1.5 h-1 bg-green-500" />
              <div className="w-1 h-1 rounded-full bg-blue-500" />
            </div>
            {/* Spout and drip tray */}
            <div className="w-full h-24 border-t border-b border-zinc-800/80 my-2 relative flex flex-col items-center justify-end">
              {/* Spout */}
              <div className="w-6 h-4 bg-zinc-800 absolute top-0 rounded-b flex justify-around px-0.5">
                <div className="w-1 h-1 bg-black rounded-full" />
                <div className="w-1 h-1 bg-black rounded-full" />
              </div>
              {/* Coffee Mug */}
              <div className="w-10 h-10 bg-amber-950 border border-amber-600/30 rounded-b-md rounded-t-sm flex items-center justify-center relative">
                <div className="w-2.5 h-5 border border-amber-600/30 rounded-r-lg absolute -right-2" />
                <div className="w-1.5 h-0.5 bg-amber-500 rounded-full animate-bounce" />
              </div>
            </div>
            {/* Bottom Drip Tray */}
            <div className="w-full h-3 bg-zinc-950 rounded-md border-t border-zinc-800" />
          </div>
        </div>
      );
    case 'prod-5': // BGH Silent Air
      return (
        <div className={`w-full h-full flex flex-col items-center justify-center relative p-4 ${className}`}>
          <div className="w-[85%] h-14 bg-zinc-100 border border-zinc-300 rounded-lg shadow-xl flex flex-col justify-between p-1.5 relative">
            <div className="flex justify-between items-center px-1">
              <span className="text-[7px] text-zinc-500 font-bold tracking-widest">BGH SILENT AIR</span>
              <span className="text-[9px] font-mono font-bold text-sky-500 bg-zinc-900 px-1 rounded">24°c</span>
            </div>
            <div className="w-full h-1 bg-zinc-200 rounded-full" />
            <div className="w-full h-2 bg-zinc-300/50 rounded-b border-t border-zinc-200" />
          </div>
          {/* Air flow waves */}
          <div className="flex space-x-2 mt-4 animate-pulse">
            <div className="w-1.5 h-4 bg-sky-400/20 rounded-full transform rotate-12 blur-[1px]" />
            <div className="w-1.5 h-5 bg-sky-400/30 rounded-full transform rotate-12 blur-[1px]" />
            <div className="w-1.5 h-4 bg-sky-400/20 rounded-full transform rotate-12 blur-[1px]" />
          </div>
        </div>
      );
    case 'prod-6': // Bariloche package
      return (
        <div className={`w-full h-full flex items-center justify-center relative p-4 ${className}`}>
          <div className="w-36 h-36 bg-emerald-950 rounded-2xl shadow-2xl relative overflow-hidden flex flex-col justify-between p-3 border border-emerald-500/20">
            {/* Mountains */}
            <div className="absolute bottom-0 left-0 right-0 h-16 flex items-end">
              <div className="w-20 h-20 bg-emerald-900 transform rotate-45 translate-y-10 -translate-x-4 border border-emerald-500/20" />
              <div className="w-24 h-24 bg-teal-900/80 transform rotate-45 translate-y-8 translate-x-1 border border-teal-500/20" />
            </div>
            {/* Snowy peak overlays */}
            <div className="absolute bottom-5 left-10 w-4 h-4 bg-white rounded-full blur-[2px] opacity-40" />
            {/* Sun or Moon */}
            <div className="w-8 h-8 rounded-full bg-amber-400/80 shadow-lg absolute top-4 right-4" />
            {/* Flight illustration */}
            <div className="z-10 bg-emerald-900/60 backdrop-blur-sm border border-emerald-500/10 px-2 py-1 rounded text-[9px] font-bold text-emerald-300 w-fit">
              Hospedaje 5★ + Aéreos
            </div>
            <div className="z-10 mt-auto text-white text-[10px] font-black tracking-wide">
              Bariloche Imperial
            </div>
          </div>
        </div>
      );
    case 'prod-7': // Mountain Bike
      return (
        <div className={`w-full h-full flex items-center justify-center relative p-4 ${className}`}>
          <div className="relative w-40 h-28 flex items-center justify-center">
            {/* Wheels */}
            <div className="w-16 h-16 rounded-full border-4 border-dashed border-cyan-500/30 flex items-center justify-center absolute left-2 bottom-2">
              <div className="w-10 h-10 rounded-full border border-cyan-500/20" />
            </div>
            <div className="w-16 h-16 rounded-full border-4 border-dashed border-cyan-500/30 flex items-center justify-center absolute right-2 bottom-2">
              <div className="w-10 h-10 rounded-full border border-cyan-500/20" />
            </div>
            {/* Carbon Frame Structure */}
            <svg className="w-32 h-20 absolute z-10" viewBox="0 0 100 60">
              <path d="M20 45 L45 15 L75 45 L48 45 Z" fill="none" stroke="currentColor" strokeWidth="4" className="text-cyan-400" />
              <line x1="45" y1="15" x2="48" y2="45" stroke="currentColor" strokeWidth="4" className="text-cyan-400" />
              <line x1="45" y1="15" x2="35" y2="10" stroke="currentColor" strokeWidth="3" className="text-cyan-500" />
              <line x1="75" y1="45" x2="80" y2="25" stroke="currentColor" strokeWidth="3" className="text-slate-500" />
            </svg>
          </div>
        </div>
      );
    case 'prod-8': // Garmin Smartwatch
      return (
        <div className={`w-full h-full flex items-center justify-center relative p-4 ${className}`}>
          <div className="w-32 h-32 relative flex items-center justify-center">
            {/* Watch Straps */}
            <div className="w-10 h-36 bg-zinc-800 rounded-xl absolute" />
            {/* Bezel */}
            <div className="w-28 h-28 rounded-full bg-zinc-900 border-4 border-amber-600/40 shadow-2xl z-10 flex items-center justify-center p-1">
              {/* Dial Screen */}
              <div className="w-full h-full rounded-full bg-black border border-zinc-800 flex flex-col justify-between items-center p-2 text-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-tr from-amber-500/10 to-transparent pointer-events-none" />
                <span className="text-[8px] text-amber-500 font-bold tracking-widest">SOLAR</span>
                <span className="text-xs font-mono font-black text-white my-1">10:45 AM</span>
                <div className="flex space-x-1 items-center">
                  <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-ping" />
                  <span className="text-[7px] text-slate-400 font-semibold uppercase">GPS ON</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    case 'prod-9': // Sastrero coat
      return (
        <div className={`w-full h-full flex items-center justify-center relative p-4 ${className}`}>
          <div className="w-32 h-44 bg-amber-950/20 border border-amber-800/20 rounded-2xl shadow-2xl relative overflow-hidden flex flex-col justify-between p-3">
            {/* Hanger */}
            <div className="w-16 h-8 border-t-2 border-l-2 border-r-2 border-amber-600 rounded-t-full mx-auto opacity-40 mt-1" />
            {/* Suit Lapel vector */}
            <div className="w-24 h-32 bg-neutral-900 border border-amber-800/30 rounded-xl mx-auto relative flex justify-between p-1">
              {/* Left lapel */}
              <div className="w-[45%] h-full bg-neutral-800 rounded-l-lg border-r border-amber-800/20 transform skew-y-12 origin-top-left" />
              {/* Golden buttons */}
              <div className="absolute left-1/2 top-16 -translate-x-1/2 flex flex-col space-y-3 z-10">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 border border-amber-600 shadow" />
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 border border-amber-600 shadow" />
              </div>
              {/* Right lapel */}
              <div className="w-[45%] h-full bg-neutral-800 rounded-r-lg border-l border-amber-800/20 transform -skew-y-12 origin-top-right" />
            </div>
            <p className="text-[9px] text-center text-amber-500 font-bold tracking-wide">100% LANA PURA</p>
          </div>
        </div>
      );
    default:
      return (
        <div className={`w-full h-full flex items-center justify-center relative p-4 ${className}`}>
          <div className="w-24 h-24 rounded-lg bg-slate-800 flex items-center justify-center">
            <ShoppingBag size={32} className="text-slate-600" />
          </div>
        </div>
      );
  }
};

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  selectedCard,
  onOpenDetails,
  onAddToCart,
}) => {
  // Find promotion or card specific details
  const bankOffer = selectedCard
    ? product.bankOffers.find((offer) => offer.bankId === selectedCard.bankId)
    : null;

  // Find standard promo if any
  const maxCuotas = bankOffer ? bankOffer.maxCuotas : Math.max(...product.bankOffers.map((o) => o.maxCuotas));
  const discountPercent = bankOffer ? bankOffer.discountPercent : 0;

  return (
    <motion.div
      whileHover={{ y: -6, transition: { duration: 0.2 } }}
      className="bg-white border border-slate-200/60 rounded-[24px] overflow-hidden shadow-sm flex flex-col justify-between relative group"
      id={`product-card-${product.id}`}
    >
      {/* Top Banner Offer Badge */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5">
        <span className="bg-blue-600 text-white font-extrabold text-[9px] uppercase tracking-wider px-2.5 py-1 rounded-full shadow-md flex items-center gap-1 w-fit">
          <Percent size={10} strokeWidth={3} />
          {maxCuotas} Cuotas Sin Interés
        </span>
        {discountPercent > 0 && (
          <span className="bg-emerald-600 text-white font-extrabold text-[9px] uppercase tracking-wider px-2.5 py-1 rounded-full shadow-md w-fit">
            {discountPercent}% OFF con {selectedCard?.bankName.split(' ')[0]}
          </span>
        )}
      </div>

      {/* Product Image Area */}
      <div className="w-full aspect-[4/3] relative overflow-hidden bg-slate-50 p-2 border-b border-slate-100">
        <ProductVisual productId={product.id} className="w-full h-full group-hover:scale-102 transition-transform duration-300" />
        
        {/* Hover quick view overlay */}
        <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2">
          <button
            type="button"
            id={`quick-view-${product.id}`}
            onClick={() => onOpenDetails(product)}
            className="p-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-bold transition-transform transform scale-90 group-hover:scale-100 flex items-center gap-1.5 text-xs shadow-lg"
          >
            <Eye size={15} />
            Ver Detalles
          </button>
        </div>
      </div>

      {/* Product Details Area */}
      <div className="p-5 flex-grow flex flex-col justify-between space-y-3.5">
        <div>
          <span className="text-[10px] text-blue-600 uppercase font-bold tracking-wider">{product.category}</span>
          <h3 className="text-slate-800 font-bold text-sm tracking-wide mt-1 line-clamp-1 hover:line-clamp-none transition-all duration-300">
            {product.name}
          </h3>

          {/* Rating */}
          <div className="flex items-center space-x-1.5 mt-1.5">
            <div className="flex text-amber-400">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  size={12}
                  className={i < Math.floor(product.rating) ? "fill-amber-400 text-amber-400" : "text-slate-200"}
                />
              ))}
            </div>
            <span className="text-[11px] text-slate-400 font-medium">({product.reviewsCount})</span>
          </div>
        </div>

        {/* Pricing Panel */}
        <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex justify-between items-end">
          <div>
            {product.originalPrice && (
              <span className="text-[10px] text-slate-400 line-through block leading-none mb-1">
                ${product.originalPrice.toLocaleString('es-AR')}
              </span>
            )}
            <span className="text-lg font-extrabold text-blue-900 leading-none">
              ${product.price.toLocaleString('es-AR')}
            </span>
          </div>

          <div className="text-right">
            <span className="text-[8px] text-emerald-600 uppercase font-bold tracking-wider block">Desde</span>
            <span className="text-xs font-extrabold text-emerald-600 leading-none">
              ${Math.round(product.price / maxCuotas).toLocaleString('es-AR')}/mes
            </span>
          </div>
        </div>

        {/* Action Panel */}
        <div className="grid grid-cols-5 gap-2 pt-1">
          <button
            type="button"
            id={`open-detail-btn-${product.id}`}
            onClick={() => onOpenDetails(product)}
            className="col-span-1 p-2 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl flex items-center justify-center transition-colors"
            title="Ver ficha técnica"
          >
            <Eye size={16} />
          </button>
          <button
            type="button"
            id={`add-to-cart-btn-${product.id}`}
            onClick={(e) => onAddToCart(product, e)}
            className="col-span-4 py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs tracking-wide shadow-md shadow-blue-600/10 flex items-center justify-center gap-1.5 transition-all"
          >
            <ShoppingBag size={14} />
            Agregar al Carrito
          </button>
        </div>
      </div>
    </motion.div>
  );
};
