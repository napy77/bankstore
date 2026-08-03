import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Landmark, ShieldCheck, Loader2 } from 'lucide-react';
import { login, register, type Customer } from '../api';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuth: (user: Customer) => void;
  /** Qué se estaba intentando hacer, para explicar por qué pide entrar. */
  motivo?: string;
}

/**
 * Entrada del comprador.
 *
 * Registro y login en el mismo modal: obligar a elegir antes de escribir el
 * mail es fricción sin sentido cuando la mitad de la gente no se acuerda si ya
 * tenía cuenta.
 */
export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onAuth, motivo }) => {
  const [modo, setModo] = useState<'login' | 'registro'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = modo === 'login'
        ? await login(email, password)
        : await register(name, email, password);
      onAuth(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos entrar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 10 }}
          className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden"
        >
          <div className="p-6 pb-0 flex justify-between items-start">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                <Landmark className="text-white" size={20} strokeWidth={2.5} />
              </div>
              <div className="leading-none">
                <span className="text-xl font-bold tracking-tight text-blue-900">BANK</span>
                <span className="text-xl font-light text-blue-600">STORE</span>
              </div>
            </div>
            <button
              type="button" onClick={onClose}
              className="text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="p-6">
            <h2 className="text-xl font-bold text-slate-800">
              {modo === 'login' ? 'Entrá a tu cuenta' : 'Creá tu cuenta'}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {motivo ?? 'Para usar tu billetera y comprar en cuotas.'}
            </p>

            {error && (
              <div className="bg-rose-50 border border-rose-100 rounded-2xl p-3 mt-4 text-xs text-rose-700">
                {error}
              </div>
            )}

            <form onSubmit={submit} className="mt-4 space-y-3.5">
              {modo === 'registro' && (
                <div>
                  <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">
                    Nombre
                  </label>
                  <input
                    type="text" value={name} required autoFocus
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>
              )}

              <div>
                <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">
                  Email
                </label>
                <input
                  type="email" value={email} required autoComplete="username"
                  autoFocus={modo === 'login'}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">
                  Contraseña
                </label>
                <input
                  type="password" value={password} required minLength={8}
                  autoComplete={modo === 'login' ? 'current-password' : 'new-password'}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
                {modo === 'registro' && (
                  <p className="text-[10px] text-slate-400 mt-1">Mínimo 8 caracteres.</p>
                )}
              </div>

              <button
                type="submit" disabled={busy}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl py-3 text-sm shadow-md shadow-blue-600/15 transition-all flex items-center justify-center gap-2"
              >
                {busy && <Loader2 size={15} className="animate-spin" />}
                {busy ? 'Un momento…' : modo === 'login' ? 'Entrar' : 'Crear cuenta'}
              </button>
            </form>

            <button
              type="button"
              onClick={() => { setModo(modo === 'login' ? 'registro' : 'login'); setError(null); }}
              className="w-full text-center text-xs text-slate-500 hover:text-blue-600 mt-4 transition-colors"
            >
              {modo === 'login'
                ? '¿No tenés cuenta? Creá una'
                : '¿Ya tenés cuenta? Entrá'}
            </button>

            <div className="flex items-start gap-2 mt-5 pt-4 border-t border-slate-100">
              <ShieldCheck size={15} className="text-emerald-600 mt-0.5 shrink-0" />
              <p className="text-[10px] text-slate-400 leading-tight">
                No guardamos el número completo de tus tarjetas: sólo los últimos cuatro
                dígitos, que es lo que se muestra.
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
