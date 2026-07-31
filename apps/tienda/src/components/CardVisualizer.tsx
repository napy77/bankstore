import React, { useState } from 'react';
import { motion } from 'motion/react';
import { CreditCard } from '../types';
import { CreditCard as CardIcon, Shield, Layers, HelpCircle, Eye, EyeOff } from 'lucide-react';

interface CardVisualizerProps {
  card: CreditCard;
  isActive?: boolean;
  onSelect?: () => void;
}

export const CardVisualizer: React.FC<CardVisualizerProps> = ({ card, isActive = false, onSelect }) => {
  const [showNumber, setShowNumber] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);

  // Elegant gradients based on theme
  const getThemeClasses = () => {
    switch (card.colorTheme) {
      case 'black':
        return 'bg-gradient-to-br from-neutral-900 via-neutral-800 to-stone-950 text-white shadow-neutral-900/50 border border-neutral-700/50';
      case 'navy':
        return 'bg-gradient-to-br from-slate-900 via-blue-950 to-neutral-950 text-white shadow-blue-950/45 border border-blue-900/50';
      case 'platinum':
        return 'bg-gradient-to-br from-slate-300 via-neutral-100 to-zinc-400 text-slate-800 shadow-slate-300/40 border border-neutral-300';
      case 'gold':
        return 'bg-gradient-to-br from-amber-600 via-yellow-500 to-amber-950 text-white shadow-amber-600/35 border border-amber-500/50';
      case 'red':
        return 'bg-gradient-to-br from-red-800 via-rose-950 to-stone-900 text-white shadow-red-950/40 border border-rose-800/40';
      case 'teal':
        return 'bg-gradient-to-br from-teal-900 via-slate-900 to-emerald-950 text-white shadow-teal-900/30 border border-teal-800/40';
      default:
        return 'bg-gradient-to-br from-slate-800 to-slate-950 text-white shadow-slate-950/40 border border-slate-700';
    }
  };

  const getBrandLogo = () => {
    switch (card.brand) {
      case 'visa':
        return (
          <svg className="h-6 w-auto" viewBox="0 0 100 30" fill="currentColor">
            <path d="M15 2 L3 28 L11 28 L17 2 Z" fill="#FFC72C" className="opacity-80" />
            <text x="18" y="22" className="font-extrabold italic text-lg tracking-wider" fill="currentColor">VISA</text>
          </svg>
        );
      case 'mastercard':
        return (
          <div className="flex -space-x-2 items-center">
            <div className="w-5 h-5 rounded-full bg-red-500 opacity-90" />
            <div className="w-5 h-5 rounded-full bg-yellow-500 opacity-90" />
          </div>
        );
      case 'amex':
        return (
          <div className="px-1.5 py-0.5 border border-sky-400 bg-sky-600 rounded text-[9px] font-black uppercase tracking-wider text-white">
            AMEX
          </div>
        );
      case 'cabal':
        return (
          <div className="flex space-x-1 items-center">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
            <span className="text-[10px] font-bold tracking-tight">cabal</span>
          </div>
        );
    }
  };

  return (
    <div className="relative group perspective" style={{ perspective: '1000px' }}>
      <motion.div
        whileHover={{ scale: 1.03, rotateY: isFlipped ? 180 : 2, rotateX: 2 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => {
          if (onSelect) onSelect();
        }}
        animate={{ rotateY: isFlipped ? 180 : 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className={`w-full max-w-[340px] aspect-[1.586/1] rounded-2xl p-5 flex flex-col justify-between relative cursor-pointer select-none transition-all duration-300 shadow-xl overflow-hidden ${getThemeClasses()} ${
          isActive ? 'ring-2 ring-amber-500 ring-offset-2 ring-offset-slate-900 scale-103' : 'opacity-85 hover:opacity-100'
        }`}
      >
        {/* Holographic sparkle effect */}
        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-transparent pointer-events-none transform -skew-x-12 group-hover:translate-x-full transition-transform duration-1000" />

        {!isFlipped ? (
          /* FRONT SIDE */
          <div className="h-full flex flex-col justify-between" id={`card-front-${card.id}`}>
            {/* Header: Bank & Card Brand */}
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] uppercase font-semibold tracking-widest opacity-60">Tarjeta Premium</p>
                <h4 className="font-bold text-sm tracking-wide">{card.bankName}</h4>
              </div>
              <div className="h-6 flex items-center">{getBrandLogo()}</div>
            </div>

            {/* Middle: EMV Chip & Tier */}
            <div className="flex justify-between items-center my-1">
              {/* EMV Chip */}
              <div className="w-8 h-6 bg-gradient-to-r from-amber-200 to-yellow-400/80 rounded-md flex flex-col justify-around p-1 relative overflow-hidden border border-amber-300">
                <div className="w-full h-0.5 bg-neutral-800/20" />
                <div className="w-full h-0.5 bg-neutral-800/20" />
                <div className="absolute top-0 bottom-0 left-3 w-0.5 bg-neutral-800/20" />
                <div className="absolute top-0 bottom-0 left-5 w-0.5 bg-neutral-800/20" />
              </div>

              {/* Card Tier Badge */}
              <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 bg-white/10 rounded backdrop-blur-sm">
                {card.tier}
              </span>
            </div>

            {/* Footer: Card Number & Details */}
            <div className="mt-2">
              <div className="flex justify-between items-center">
                <p className="font-mono text-base tracking-widest">
                  {showNumber ? card.cardNumber.replace(/•/g, '•') : card.cardNumber}
                </p>
                <button
                  type="button"
                  id={`toggle-number-${card.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowNumber(!showNumber);
                  }}
                  className="p-1 hover:bg-white/10 rounded transition-colors"
                >
                  {showNumber ? <EyeOff size={14} className="opacity-70" /> : <Eye size={14} className="opacity-70" />}
                </button>
              </div>

              <div className="flex justify-between items-end mt-2">
                <div>
                  <p className="text-[7px] uppercase font-semibold tracking-widest opacity-50">Titular</p>
                  <p className="text-xs font-medium tracking-wide uppercase">{card.holderName}</p>
                </div>
                <div className="text-right">
                  <p className="text-[7px] uppercase font-semibold tracking-widest opacity-50">Vence</p>
                  <p className="text-xs font-mono font-bold tracking-wider">{card.expiryDate}</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* BACK SIDE */
          <div className="h-full flex flex-col justify-between transform rotateY-180" id={`card-back-${card.id}`}>
            {/* Magnetic Stripe */}
            <div className="w-full h-9 bg-neutral-900 absolute left-0 right-0 top-4" />
            
            <div className="mt-14 flex justify-between items-center px-2">
              <div className="w-2/3 h-6 bg-white/20 rounded flex items-center justify-end px-2">
                <span className="text-xs italic tracking-wider text-black font-semibold">Firma Autorizada</span>
              </div>
              <div className="bg-white text-black font-mono font-bold px-2 py-0.5 text-xs rounded shadow">
                123
              </div>
            </div>

            <div className="text-[8px] opacity-40 px-2 leading-tight">
              Esta tarjeta es de uso personal e intransferible. Propiedad de {card.bankName}. Su uso se rige por los contratos vigentes de la entidad financiera.
            </div>
          </div>
        )}
      </motion.div>

      {/* Quick indicators/actions below card */}
      <div className="flex justify-between items-center px-1.5 mt-2 max-w-[340px]">
        <div className="flex items-center space-x-1.5">
          <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-amber-500 animate-pulse' : 'bg-slate-500'}`} />
          <span className="text-[10px] text-slate-400 font-medium">
            {isActive ? 'Tarjeta Activa para Compras' : 'Inactiva'}
          </span>
        </div>
        <button
          type="button"
          id={`flip-btn-${card.id}`}
          onClick={(e) => {
            e.stopPropagation();
            setIsFlipped(!isFlipped);
          }}
          className="text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold transition-colors flex items-center gap-1"
        >
          <Layers size={10} /> {isFlipped ? 'Ver Frente' : 'Ver Reverso'}
        </button>
      </div>
    </div>
  );
};
