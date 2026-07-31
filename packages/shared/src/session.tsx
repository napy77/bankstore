import React, { useCallback, useEffect, useState } from "react";
import { createApiClient, getToken, setToken, type ApiClient } from "./client.js";
import type { StaffUser } from "./types.js";
import { ErrorBanner } from "./ui.js";

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
        <div className="brand">
          <strong>{title}</strong>
          <span>{subtitle}</span>
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
            <button type="submit" className="btn-primary" disabled={busy} style={{ width: "100%" }}>
              {busy ? "Entrando…" : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function Shell({
  title, subtitle, user, sections, current, onNavigate, onLogout, children,
}: {
  title: string;
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
        <div className="brand">
          <strong>{title}</strong>
          <span>{subtitle}</span>
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
          <button className="btn-ghost btn-sm" style={{ width: "100%" }} onClick={onLogout}>
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
