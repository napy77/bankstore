import React, { useCallback, useEffect, useState } from "react";
import {
  type ApiClient, type Agreement, type Merchant, type Category, type Bank,
  money, percentDirect, date,
  ErrorBanner, Loading, Empty, Badge, Modal,
} from "@bankstore/shared";

/**
 * Acuerdos banco ↔ comercio.
 *
 * La pantalla ordena por especificidad porque es lo que define cuál gana, y es
 * la pregunta que uno se hace al mirar la lista: "si compran esto con esta
 * tarjeta, ¿cuál aplica?".
 */

const ALCANCE_TONE: Record<string, "success" | "info" | "warning" | "neutral"> = {
  "comercio + categoría": "success",
  "comercio": "info",
  "categoría": "warning",
  "global": "neutral",
};

interface FormState {
  bankId: string;
  merchantId: string;
  categoryId: string;
  maxCuotas: number;
  discountPercent: number;
  capAmount: number | null;
  description: string;
  priority: number;
  validFrom: string;
  validTo: string;
}

const VACIO: FormState = {
  bankId: "", merchantId: "", categoryId: "", maxCuotas: 6, discountPercent: 0,
  capAmount: null, description: "", priority: 0, validFrom: "", validTo: "",
};

export function Acuerdos({ api }: { api: ApiClient }) {
  const [items, setItems] = useState<Agreement[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [filtro, setFiltro] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(
    (merchantId: string) => {
      setLoading(true);
      const qs = merchantId ? `?merchantId=${merchantId}` : "";
      Promise.all([
        api.get<Agreement[]>(`/api/admin/agreements${qs}`, "staff"),
        api.get<Bank[]>("/api/catalog/banks"),
        api.get<Merchant[]>("/api/admin/merchants", "staff"),
        api.get<Category[]>("/api/catalog/categories"),
      ])
        .then(([a, b, m, c]) => { setItems(a); setBanks(b); setMerchants(m); setCats(c); })
        .catch(setError)
        .finally(() => setLoading(false));
    },
    [api]
  );

  useEffect(() => { cargar(filtro); }, [cargar, filtro]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/admin/agreements", {
        ...form,
        // El backend distingue "todos" de "uno concreto" con null, no con "".
        merchantId: form.merchantId || null,
        categoryId: form.categoryId || null,
        validFrom: form.validFrom || null,
        validTo: form.validTo || null,
      }, "staff");
      setForm(null);
      cargar(filtro);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function borrar(a: Agreement) {
    if (!confirm(`¿Borrar el acuerdo de ${a.bankName}? Las compras nuevas dejan de tener ese beneficio.`)) return;
    try {
      await api.del(`/api/admin/agreements/${a.id}`, "staff");
      cargar(filtro);
    } catch (err) {
      setError(err);
    }
  }

  async function alternar(a: Agreement) {
    try {
      await api.patch(`/api/admin/agreements/${a.id}`, { active: !a.active }, "staff");
      cargar(filtro);
    } catch (err) {
      setError(err);
    }
  }

  // Al elegir comercio y categoría a la vez, sólo tienen sentido las
  // categorías que ese comercio tiene habilitadas: el backend rechaza el resto.
  const categoriasDisponibles = form?.merchantId
    ? cats.filter((c) => merchants.find((m) => m.id === form.merchantId)?.categories.includes(c.id))
    : cats;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Acuerdos bancarios</h1>
          <p>
            Cuando varios calzan sobre la misma compra, <strong>gana el más específico</strong>,
            no el más generoso.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setForm(VACIO)}>Nuevo acuerdo</button>
      </div>

      <ErrorBanner error={error} />

      <div className="card">
        <div className="row" style={{ marginBottom: 14 }}>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ maxWidth: 280 }}>
            <option value="">Todos los comercios</option>
            {merchants.map((m) => <option key={m.id} value={m.id}>{m.tradeName}</option>)}
          </select>
        </div>

        {loading ? <Loading /> : items.length === 0 ? (
          <Empty>No hay acuerdos cargados.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Banco</th>
                  <th>Alcance</th>
                  <th className="num">Cuotas</th>
                  <th className="num">Reintegro</th>
                  <th className="num">Tope</th>
                  <th className="num">Prior.</th>
                  <th>Vigencia</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} style={{ opacity: a.active ? 1 : 0.55 }}>
                    <td><strong>{a.bankName}</strong></td>
                    <td>
                      <Badge tone={ALCANCE_TONE[a.alcance] ?? "neutral"}>{a.alcance}</Badge>
                      <div className="hint">
                        {a.merchantName ?? "todos los comercios"}
                        {" · "}
                        {a.categoryId ?? "todas las categorías"}
                      </div>
                    </td>
                    <td className="num">{a.maxCuotas}</td>
                    <td className="num">{percentDirect(a.discountPercent, 0)}</td>
                    <td className="num">{a.capAmount ? money(a.capAmount) : "sin tope"}</td>
                    <td className="num">{a.priority}</td>
                    <td className="hint">
                      {a.validFrom || a.validTo
                        ? `${date(a.validFrom)} → ${a.validTo ? date(a.validTo) : "sin fin"}`
                        : "permanente"}
                    </td>
                    <td>
                      <Badge tone={a.active ? "success" : "neutral"}>
                        {a.active ? "Vigente" : "Pausado"}
                      </Badge>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        <button className="btn-ghost btn-sm" onClick={() => alternar(a)}>
                          {a.active ? "Pausar" : "Reactivar"}
                        </button>
                        <button className="btn-danger btn-sm" onClick={() => borrar(a)}>Borrar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Cómo se resuelve</h2>
        <p className="hint" style={{ marginTop: -6 }}>
          De más específico a más general. El primero que exista, gana:
        </p>
        <ol style={{ margin: "10px 0 0", paddingLeft: 20, lineHeight: 2 }}>
          <li><Badge tone="success">comercio + categoría</Badge> — "24 cuotas en tecnología de Electro Sur"</li>
          <li><Badge tone="info">comercio</Badge> — "18 cuotas en Electro Sur"</li>
          <li><Badge tone="warning">categoría</Badge> — "12 cuotas en tecnología, en toda la app"</li>
          <li><Badge tone="neutral">global</Badge> — "3 cuotas en todo"</li>
        </ol>
        <p className="hint" style={{ marginTop: 12 }}>
          Por encima de todos está la oferta puntual de un producto, que se carga por producto y
          no acá. A igual alcance desempata la prioridad, y después la cantidad de cuotas.
        </p>
      </div>

      {form && (
        <Modal title="Nuevo acuerdo" onClose={() => setForm(null)}>
          <ErrorBanner error={error} />
          <form onSubmit={crear}>
            <label>
              <span>Banco <span className="req">*</span></span>
              <select
                value={form.bankId} required
                onChange={(e) => setForm({ ...form, bankId: e.target.value })}
              >
                <option value="">Elegí un banco</option>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>

            <label>
              <span>Comercio</span>
              <select
                value={form.merchantId}
                onChange={(e) => setForm({ ...form, merchantId: e.target.value, categoryId: "" })}
              >
                <option value="">Todos los comercios</option>
                {merchants.map((m) => <option key={m.id} value={m.id}>{m.tradeName}</option>)}
              </select>
              <div className="hint">Dejalo en "todos" para una promo general del banco.</div>
            </label>

            <label>
              <span>Categoría</span>
              <select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              >
                <option value="">Todas las categorías</option>
                {categoriasDisponibles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {form.merchantId && (
                <div className="hint">
                  Sólo aparecen las que ese comercio tiene habilitadas: con otra, el acuerdo nunca
                  se aplicaría.
                </div>
              )}
            </label>

            <label>
              <span>Cuotas sin interés <span className="req">*</span></span>
              <input
                type="number" min={1} max={24} required value={form.maxCuotas}
                onChange={(e) => setForm({ ...form, maxCuotas: Number(e.target.value) })}
              />
            </label>

            <label>
              <span>Reintegro (%)</span>
              <input
                type="number" min={0} max={100} step="0.01" value={form.discountPercent}
                onChange={(e) => setForm({ ...form, discountPercent: Number(e.target.value) })}
              />
              <div className="hint">
                Se acredita en el resumen del cliente. No baja lo que se financia ni lo que
                cobra el comercio.
              </div>
            </label>

            <label>
              <span>Tope de reintegro</span>
              <input
                type="number" min={0} step="0.01"
                value={form.capAmount ?? ""}
                placeholder="Sin tope"
                onChange={(e) => setForm({
                  ...form, capAmount: e.target.value === "" ? null : Number(e.target.value),
                })}
              />
              <div className="hint">
                Por cuenta y por acuerdo: dos productos amparados por este acuerdo comparten un
                solo tope, aunque sean de comercios distintos.
              </div>
            </label>

            <label>
              <span>Descripción</span>
              <input
                value={form.description}
                placeholder="Exclusivo Electro Sur: 18 cuotas y 20% de reintegro"
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
              <div className="hint">Es lo que se le muestra al comprador.</div>
            </label>

            <div className="grid cols-2">
              <label>
                <span>Vigente desde</span>
                <input
                  type="date" value={form.validFrom}
                  onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
                />
              </label>
              <label>
                <span>Vigente hasta</span>
                <input
                  type="date" value={form.validTo}
                  onChange={(e) => setForm({ ...form, validTo: e.target.value })}
                />
              </label>
            </div>

            <label>
              <span>Prioridad</span>
              <input
                type="number" value={form.priority}
                onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
              />
              <div className="hint">Sólo desempata entre acuerdos del mismo alcance. Mayor gana.</div>
            </label>

            <div className="row" style={{ marginTop: 16 }}>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Guardando…" : "Crear acuerdo"}
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
