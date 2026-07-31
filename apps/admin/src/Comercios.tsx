import React, { useCallback, useEffect, useState } from "react";
import {
  type ApiClient, type Merchant, type Category,
  percentDirect, date, MERCHANT_STATUS_LABEL,
  ErrorBanner, Loading, Empty, Badge, Modal, CategoryPicker,
} from "@bankstore/shared";

const ESTADO_TONE = { active: "success", draft: "neutral", suspended: "danger" } as const;

/** Sugiere un id a partir del nombre, que es lo que se hace a mano igual. */
function slugify(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // saca acentos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

interface FormState {
  id: string;
  legalName: string;
  tradeName: string;
  taxId: string;
  contactEmail: string;
  commissionPercent: number;
  absorbsInstallmentCost: boolean;
  settlementDays: number;
  categories: string[];
}

const VACIO: FormState = {
  id: "", legalName: "", tradeName: "", taxId: "", contactEmail: "",
  commissionPercent: 8, absorbsInstallmentCost: true, settlementDays: 30, categories: [],
};

export function Comercios({ api }: { api: ApiClient }) {
  const [items, setItems] = useState<Merchant[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** El id no se puede cambiar después: lo referencian productos y acuerdos. */
  const esAlta = editandoId === null;

  const cargar = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get<Merchant[]>("/api/admin/merchants", "staff"),
      api.get<Category[]>("/api/catalog/categories"),
    ])
      .then(([m, c]) => { setItems(m); setCats(c); })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(cargar, [cargar]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      if (esAlta) {
        await api.post("/api/admin/merchants", form, "staff");
      } else {
        const { id: _id, ...resto } = form;
        await api.patch(`/api/admin/merchants/${editandoId}`, resto, "staff");
      }
      setForm(null);
      setEditandoId(null);
      cargar();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function cambiarEstado(m: Merchant, status: string) {
    const aviso = status === "suspended"
      ? `¿Suspender ${m.tradeName}? Su catálogo sale de la tienda al instante y no puede vender ni entrar al panel.`
      : status === "active"
      ? `¿Activar ${m.tradeName}? Sus productos pasan a verse en la tienda.`
      : null;
    if (aviso && !confirm(aviso)) return;
    try {
      await api.patch(`/api/admin/merchants/${m.id}`, { status }, "staff");
      cargar();
    } catch (err) {
      setError(err);
    }
  }

  function abrirEdicion(m: Merchant) {
    setEditandoId(m.id);
    setForm({
      id: m.id,
      legalName: m.legalName,
      tradeName: m.tradeName,
      taxId: m.taxId ?? "",
      contactEmail: m.contactEmail ?? "",
      commissionPercent: m.commissionPercent,
      absorbsInstallmentCost: m.absorbsInstallmentCost,
      settlementDays: m.settlementDays,
      categories: m.categories,
    });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Comercios</h1>
          <p>Alta, condiciones comerciales y categorías habilitadas.</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditandoId(null); setForm(VACIO); }}>
          Nuevo comercio
        </button>
      </div>

      <ErrorBanner error={error} />

      <div className="card">
        {loading ? <Loading /> : items.length === 0 ? (
          <Empty>Todavía no hay comercios.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Comercio</th>
                  <th>Categorías</th>
                  <th className="num">Productos</th>
                  <th className="num">Comisión</th>
                  <th>Cuotas</th>
                  <th className="num">Liquida</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.tradeName}</strong>
                      <div className="hint">{m.legalName}</div>
                      <code>{m.id}</code>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {m.categories.length === 0
                          ? <span className="hint">ninguna</span>
                          : m.categories.map((c) => <Badge key={c} tone="info">{c}</Badge>)}
                      </div>
                    </td>
                    <td className="num">{m.productCount ?? 0}</td>
                    <td className="num">{percentDirect(m.commissionPercent)}</td>
                    <td className="hint">
                      {m.absorbsInstallmentCost ? "las paga el comercio" : "las paga el banco"}
                    </td>
                    <td className="num">{m.settlementDays} d</td>
                    <td>
                      <Badge tone={ESTADO_TONE[m.status]}>{MERCHANT_STATUS_LABEL[m.status]}</Badge>
                      <div className="hint">{date(m.createdAt)}</div>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        <button className="btn-ghost btn-sm" onClick={() => abrirEdicion(m)}>Editar</button>
                        {m.status !== "active" ? (
                          <button className="btn-primary btn-sm" onClick={() => cambiarEstado(m, "active")}>
                            Activar
                          </button>
                        ) : (
                          <button className="btn-danger btn-sm" onClick={() => cambiarEstado(m, "suspended")}>
                            Suspender
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form && (
        <Modal
          title={esAlta ? "Nuevo comercio" : `Editar ${form.tradeName}`}
          onClose={() => { setForm(null); setEditandoId(null); }}
        >
          <ErrorBanner error={error} />
          <form onSubmit={guardar}>
            <label>
              <span>Nombre de fantasía <span className="req">*</span></span>
              <input
                value={form.tradeName} required autoFocus
                placeholder="Electro Sur"
                onChange={(e) => setForm({
                  ...form,
                  tradeName: e.target.value,
                  // El id se sugiere mientras es alta; una vez creado no se toca.
                  id: esAlta ? slugify(e.target.value) : form.id,
                })}
              />
              <div className="hint">Es el que ve el comprador en la tienda.</div>
            </label>

            <label>
              <span>Identificador <span className="req">*</span></span>
              <input
                value={form.id} required disabled={!esAlta}
                pattern="[a-z0-9][a-z0-9-]*"
                onChange={(e) => setForm({ ...form, id: e.target.value })}
              />
              <div className="hint">
                {esAlta
                  ? "Sólo minúsculas, números y guiones. No se puede cambiar después."
                  : "No se puede cambiar: lo referencian productos, acuerdos y órdenes."}
              </div>
            </label>

            <label>
              <span>Razón social <span className="req">*</span></span>
              <input
                value={form.legalName} required
                onChange={(e) => setForm({ ...form, legalName: e.target.value })}
              />
            </label>

            <label>
              <span>CUIT</span>
              <input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} />
            </label>

            <label>
              <span>Email de contacto</span>
              <input
                type="email" value={form.contactEmail}
                onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
              />
            </label>

            <label>
              <span>Categorías habilitadas</span>
              <CategoryPicker
                all={cats}
                selected={form.categories}
                onChange={(categories) => setForm({ ...form, categories })}
              />
              <div className="hint">
                El comercio sólo puede publicar en estas. Quitar una que ya tenga productos
                activos se rechaza: primero hay que despublicarlos.
              </div>
            </label>

            <label>
              <span>Comisión del marketplace (%)</span>
              <input
                type="number" step="0.01" min={0} max={100}
                value={form.commissionPercent}
                onChange={(e) => setForm({ ...form, commissionPercent: Number(e.target.value) })}
              />
              <div className="hint">
                Se retiene sobre cada venta. Queda congelada en cada orden: cambiarla no altera
                las liquidaciones ya emitidas.
              </div>
            </label>

            <label>
              <span>Días de liquidación</span>
              <input
                type="number" min={0} max={180}
                value={form.settlementDays}
                onChange={(e) => setForm({ ...form, settlementDays: Number(e.target.value) })}
              />
            </label>

            <label style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
              <input
                type="checkbox" checked={form.absorbsInstallmentCost}
                onChange={(e) => setForm({ ...form, absorbsInstallmentCost: e.target.checked })}
                style={{ marginTop: 3 }}
              />
              <span style={{ margin: 0, fontWeight: 400, color: "var(--text)" }}>
                El comercio absorbe el costo de las cuotas sin interés
                <div className="hint">
                  Si se destilda, ese costo lo pone el banco y al comercio se le liquida el bruto
                  sin esa quita.
                </div>
              </span>
            </label>

            <div className="row" style={{ marginTop: 16 }}>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Guardando…" : esAlta ? "Crear comercio" : "Guardar"}
              </button>
              <button
                type="button" className="btn-ghost"
                onClick={() => { setForm(null); setEditandoId(null); }}
              >
                Cancelar
              </button>
            </div>
            {esAlta && (
              <p className="hint" style={{ marginTop: 10 }}>
                Nace en borrador: no vende hasta que lo actives a propósito.
              </p>
            )}
          </form>
        </Modal>
      )}
    </>
  );
}
