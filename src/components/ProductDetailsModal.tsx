import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Product, CreditCard } from '../types';
import { InstallmentSimulator } from './InstallmentSimulator';
import { ProductVisual } from './ProductCard';
import { X, ShieldCheck, Truck, RotateCcw, ShoppingBag, Plus, Minus, Tag } from 'lucide-react';

interface ProductDetailsModalProps {
  product: Product | null;
  selectedCard: CreditCard | null;
  onClose: () => void;
  onAddToCart: (product: Product, quantity: number) => void;
}

export const ProductDetailsModal: React.FC<ProductDetailsModalProps> = ({
  product,
  selectedCard,
  onClose,
  onAddToCart,
}) => {
  const [quantity, setQuantity] = React.useState<number>(1);

  if (!product) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4">
        {/* Backdrop overlay */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
        />

        {/* Modal Content */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.3 }}
          className="bg-white border border-slate-200 rounded-[32px] w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl relative z-10 flex flex-col md:flex-row text-slate-800"
        >
          {/* Close button */}
          <button
            type="button"
            id="close-details-modal"
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 rounded-full transition-colors z-20 border-none"
          >
            <X size={18} />
          </button>

          {/* Left Column: Visuals & Specifications */}
          <div className="w-full md:w-1/2 p-6 md:p-8 border-b md:border-b-0 md:border-r border-slate-100 flex flex-col justify-between">
            <div>
              {/* Category & Badge */}
              <div className="flex justify-between items-center mb-3">
                <span className="text-[10px] text-blue-600 uppercase font-bold tracking-wider bg-blue-50 px-3 py-1 rounded-full">
                  {product.category}
                </span>
                <span className={`text-xs font-bold ${product.stock > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {product.stock > 0 ? `Stock Disponible (${product.stock})` : 'Sin Stock'}
                </span>
              </div>

              {/* Title & Reviews */}
              <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight leading-tight mb-2">
                {product.name}
              </h2>
              
              {/* Product Visual Container */}
              <div className="w-full aspect-[4/3] bg-slate-50 rounded-2xl overflow-hidden my-4 border border-slate-100 flex items-center justify-center p-2">
                <ProductVisual productId={product.id} className="w-full h-full" />
              </div>

              {/* Description */}
              <p className="text-slate-600 text-sm leading-relaxed mb-6">
                {product.description}
              </p>

              {/* Specs checklist */}
              <div className="space-y-2 mb-6">
                <h4 className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-2">Ficha Técnica</h4>
                <div className="grid grid-cols-1 gap-2">
                  {product.specs.map((spec, idx) => (
                    <div key={idx} className="flex items-start gap-2.5 bg-slate-50 p-2.5 rounded-xl border border-slate-100/50">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-1.5 shrink-0" />
                      <span className="text-slate-600 text-xs leading-tight">{spec}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Guarantees and highlights */}
            <div className="grid grid-cols-3 gap-3 pt-4 border-t border-slate-100 text-center">
              <div className="flex flex-col items-center p-2.5 bg-slate-50 rounded-xl border border-slate-100/30">
                <Truck size={18} className="text-blue-600 mb-1" />
                <span className="text-[10px] text-slate-600 font-semibold leading-tight">Envío Gratis</span>
              </div>
              <div className="flex flex-col items-center p-2.5 bg-slate-50 rounded-xl border border-slate-100/30">
                <ShieldCheck size={18} className="text-blue-600 mb-1" />
                <span className="text-[10px] text-slate-600 font-semibold leading-tight">Garantía Oficial</span>
              </div>
              <div className="flex flex-col items-center p-2.5 bg-slate-50 rounded-xl border border-slate-100/30">
                <RotateCcw size={18} className="text-blue-600 mb-1" />
                <span className="text-[10px] text-slate-600 font-semibold leading-tight">Devolución 30 Días</span>
              </div>
            </div>
          </div>

          {/* Right Column: Pricing, Simulator & Add-to-cart */}
          <div className="w-full md:w-1/2 p-6 md:p-8 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              {/* Main Price Tag */}
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex justify-between items-center">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Precio Exclusivo</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-3xl font-extrabold text-blue-900">
                      ${product.price.toLocaleString('es-AR')}
                    </span>
                    {product.originalPrice && (
                      <span className="text-sm text-slate-400 line-through">
                        ${product.originalPrice.toLocaleString('es-AR')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-full text-right">
                  <span className="text-[10px] font-bold text-emerald-700">
                    {product.originalPrice ? `${Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)}% OFF` : '15% OFF'}
                  </span>
                </div>
              </div>

              {/* Installment Simulator Panel */}
              <InstallmentSimulator product={product} selectedCard={selectedCard} />
            </div>

            {/* Bottom Add-To-Cart actions */}
            <div className="space-y-4 pt-4 border-t border-slate-100">
              {/* Quantity Selector */}
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Cantidad</span>
                <div className="flex items-center space-x-1 bg-slate-100 rounded-full p-1">
                  <button
                    type="button"
                    id="decrease-quantity-btn"
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="p-1.5 hover:bg-slate-200 text-slate-500 hover:text-slate-800 rounded-full transition-colors"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-8 text-center text-slate-850 font-bold text-sm">{quantity}</span>
                  <button
                    type="button"
                    id="increase-quantity-btn"
                    onClick={() => setQuantity(Math.min(product.stock, quantity + 1))}
                    className="p-1.5 hover:bg-slate-200 text-slate-500 hover:text-slate-800 rounded-full transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              {/* Purchase action button */}
              <button
                type="button"
                id="add-to-cart-confirm-btn"
                onClick={() => {
                  onAddToCart(product, quantity);
                  onClose();
                }}
                disabled={product.stock <= 0}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none text-white font-bold rounded-full text-sm tracking-wider uppercase shadow-md shadow-blue-600/10 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <ShoppingBag size={18} strokeWidth={2.5} />
                Agregar {quantity} al Carrito • ${(product.price * quantity).toLocaleString('es-AR')}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
