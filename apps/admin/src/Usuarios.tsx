import React, { useCallback, useEffect, useState } from "react";
import {
  type ApiClient, type Merchant, type StaffRole,
  dateTime, ROLE_LABEL, ErrorBanner, Loading, Empty, Badge, Modal,
} from "@bankstore/shared";

interface StaffRow {
  id: number;
  email: string;
  name: string;
  role: StaffRole;
  merchant_id: string | null;
  merchant_name: string | null;
  active: boolean;
  last_login_at: string | null;
}

interface FormState {
  email: string;
  name: string;
  password: string;
  role: StaffRole;
  merchantId: string;
}

const VACIO: FormState = {
  email: "", name: "", password: "", role: "merchant_admin", merchantId: "",
};

export function Usuarios({ api }: { api: ApiClient }) {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get<StaffRow[]>("/api/admin/staff", "staff"),
      api.get<Merchant[]>("/api/admin/merchants", "staff"),
    ])
      .then(([s, m]) => { setRows(s); setMerchants(m); })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(cargar, [cargar]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/admin/staff", {
        ...form,
        // Los de plataforma no cuelgan de ningún comercio; la base lo exige.
        merchantId: form.role === "platform_admin" ? null : form.merchantId,
      }, "staff");
      setForm(null);
      cargar();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function alternar(u: StaffRow) {
    try {
      await api.patch(`/api/admin/staff/${u.id}`, { active: !u.active }, "staff");
      cargar();
    } catch (err) {
      setError(err);
    }
  }

  const esPlataforma = form?.role === "platform_admin";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Usuarios</h1>
          <p>Quién entra a la administración y quién al panel de cada comercio.</p>
        </div>
        <button className="btn-primary" onClick={() => setForm(VACIO)}>Nuevo usuario</button>
      </div>

      <ErrorBanner error={error} />

      <div className="card">
        {loading ? <Loading /> : rows.length === 0 ? (
          <Empty>No hay usuarios.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Usuario</th><th>Rol</th><th>Comercio</th>
                  <th>Último acceso</th><th>Estado</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} style={{ opacity: u.active ? 1 : 0.55 }}>
                    <td>
                      <strong>{u.name}</strong>
                      <div className="hint">{u.email}</div>
                    </td>
                    <td>
                      <Badge tone={u.role === "platform_admin" ? "danger" : "info"}>
                        {ROLE_LABEL[u.role]}
                      </Badge>
                    </td>
                    <td>{u.merchant_name ?? <span className="hint">plataforma</span>}</td>
                    <td className="hint">
                      {u.last_login_at ? dateTime(u.last_login_at) : "nunca entró"}
                    </td>
                    <td>
                      <Badge tone={u.active ? "success" : "neutral"}>
                        {u.active ? "Activo" : "Deshabilitado"}
                      </Badge>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn-ghost btn-sm" onClick={() => alternar(u)}>
                        {u.active ? "Deshabilitar" : "Habilitar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form && (
        <Modal title="Nuevo usuario" onClose={() => setForm(null)}>
          <ErrorBanner error={error} />
          <form onSubmit={crear}>
            <label>
              <span>Nombre <span className="req">*</span></span>
              <input
                value={form.name} required autoFocus
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>

            <label>
              <span>Email <span className="req">*</span></span>
              <input
                type="email" value={form.email} required
                autoComplete="off"
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>

            <label>
              <span>Contraseña <span className="req">*</span></span>
              <input
                type="password" value={form.password} required minLength={10}
                autoComplete="new-password"
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <div className="hint">Mínimo 10 caracteres. Pedile que la cambie al entrar.</div>
            </label>

            <label>
              <span>Rol <span className="req">*</span></span>
              <select
                value={form.role} required
                onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}
              >
                <option value="merchant_admin">Administrador del comercio</option>
                <option value="merchant_staff">Operador del comercio (sólo lectura)</option>
                <option value="platform_admin">Administrador de plataforma</option>
              </select>
              {esPlataforma && (
                <div className="hint" style={{ color: "var(--danger)" }}>
                  Con este rol puede dar de alta cualquier comercio y cambiar cualquier condición
                  comercial. Dalo sólo si hace falta.
                </div>
              )}
            </label>

            {!esPlataforma && (
              <label>
                <span>Comercio <span className="req">*</span></span>
                <select
                  value={form.merchantId} required
                  onChange={(e) => setForm({ ...form, merchantId: e.target.value })}
                >
                  <option value="">Elegí un comercio</option>
                  {merchants.map((m) => <option key={m.id} value={m.id}>{m.tradeName}</option>)}
                </select>
              </label>
            )}

            <div className="row" style={{ marginTop: 16 }}>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Creando…" : "Crear usuario"}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setForm(null)}>
                Cancelar
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
