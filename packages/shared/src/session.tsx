import React, { useCallback, useEffect, useState } from "react";
import { Landmark, LogOut } from "lucide-react";
import { createApiClient, getToken, setToken, type ApiClient } from "./client.js";
import type { StaffUser } from "./types.js";
import { ErrorBanner } from "./ui.js";

/**
 * La marca, igual que en la tienda: ícono en cuadrado azul, BANK en bold sobre
 * STORE en light, y el bajada en versalitas. Se repite acá a propósito — que el
 * comercio entre a su panel desde la misma marca que ve el comprador es parte
 * de que los tres sitios se sientan un solo producto.
 */
export function Brand({ subtitle, center }: { subtitle: string; center?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${center ? "justify-center" : ""}`}>
      <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
        <Landmark className="text-white" size={20} strokeWidth={2.5} />
      </div>
      <div className="leading-none min-w-0">
        <span className="text-xl font-bold tracking-tight text-blue-900">BANK</span>
        <span className="text-xl font-light text-blue-600">STORE</span>
        <span className="text-[9px] block text-slate-400 font-bold uppercase tracking-widest mt-0.5 truncate">
          {subtitle}
        </span>
      </div>
    </div>
  );
}

/**
 * Sesión de back-office, compartida por los dos paneles.
 *
 * Los dos entran por el mismo endpoint (`/api/staff/login`) y se diferencian
 * por el rol que trae el usuario. Cada panel decide a quién deja pasar con
 * `allow`: el de administración exige `platform_admin`, el de comercios exige
 * que el usuario tenga comercio.
 */

export interface Session {
  user: StaffUser;
  api: ApiClient;
  logout: () => void;
}

export function useStaffSession(allow: (user: StaffUser) => string | null) {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const logout = useCallback(() => {
    setToken("staff", null);
    setUser(null);
  }, []);

  const api = React.useMemo(
    () => createApiClient({ onUnauthorized: () => setUser(null) }),
    []
  );

  // Al abrir la app se revalida el token guardado contra el backend. No
  // alcanza con que exista en localStorage: puede estar vencido, o la cuenta
  // puede haber sido deshabilitada desde que se emitió.
  useEffect(() => {
    if (!getToken("staff")) { setChecking(false); return; }
    api
      .get<StaffUser>("/api/staff/me", "staff")
      .then((u) => {
        const rechazo = allow(u);
        if (rechazo) { setToken("staff", null); setError(new Error(rechazo)); }
        else setUser(u);
      })
      .catch(() => setToken("staff", null))
      .finally(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { user, setUser, checking, api, logout, error, setError };
}

export function LoginScreen({
  title, subtitle, onLogin, allow, api,
}: {
  title: string;
  subtitle: string;
  onLogin: (user: StaffUser) => void;
  allow: (user: StaffUser) => string | null;
  api: ApiClient;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ token: string; user: StaffUser }>(
        "/api/staff/login", { email, password }
      );
      const rechazo = allow(res.user);
      if (rechazo) {
        // El backend autenticó bien, pero este panel no es para esta persona.
        // No se guarda el token: que tenga que volver a entrar donde le toca.
        setError(new Error(rechazo));
        return;
      }
      setToken("staff", res.token);
      onLogin(res.user);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-box">
        <div className="mb-6">
          <Brand subtitle={subtitle} center />
        </div>
        <div className="card">
          <ErrorBanner error={error} />
          <form onSubmit={submit}>
            <label>
              <span>Email</span>
              <input
                type="email" value={email} required autoFocus
                autoComplete="username"
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              <span>Contraseña</span>
              <input
                type="password" value={password} required
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button type="submit" className="btn-primary w-full py-2.5" disabled={busy}>
              {busy ? "Entrando…" : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function Shell({
  subtitle, user, sections, current, onNavigate, onLogout, children,
}: {
  /** Sólo para compatibilidad de llamada; la marca es siempre BANKSTORE. */
  title?: string;
  subtitle: string;
  user: StaffUser;
  sections: { id: string; label: string }[];
  current: string;
  onNavigate: (id: string) => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="px-2 pb-5 hidden lg:block">
          <Brand subtitle={subtitle} />
        </div>

        {/* En mobile la marca va compacta arriba de la barra de secciones */}
        <div className="flex items-center justify-between gap-3 pb-3 lg:hidden">
          <Brand subtitle={subtitle} />
          <button className="btn-ghost btn-sm shrink-0" onClick={onLogout} title="Cerrar sesión">
            <LogOut size={14} />
          </button>
        </div>

        <nav className="nav">
          {sections.map((s) => (
            <button
              key={s.id}
              aria-current={current === s.id}
              onClick={() => onNavigate(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="session">
          <div className="who">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
          <button
            className="btn-ghost btn-sm w-full flex items-center justify-center gap-1.5"
            onClick={onLogout}
          >
            <LogOut size={13} />
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
