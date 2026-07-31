import React, { useCallback, useEffect, useState } from "react";
import {
  type ApiClient, type ApiKey,
  dateTime, ErrorBanner, Loading, Empty, Badge, Modal,
} from "@bankstore/shared";

const SCOPES = [
  { id: "catalog:write", label: "Publicar y actualizar productos" },
  { id: "stock:write", label: "Actualizar stock" },
  { id: "orders:read", label: "Leer órdenes" },
];

export function ApiKeys({ api }: { api: ApiClient }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [scopes, setScopes] = useState(SCOPES.map((s) => s.id));
  const [busy, setBusy] = useState(false);
  /** La clave recién creada. Es la única vez que se puede ver. */
  const [recien, setRecien] = useState<ApiKey | null>(null);

  const cargar = useCallback(() => {
    setLoading(true);
    api.get<ApiKey[]>("/api/merchant/api-keys", "staff")
      .then(setKeys).catch(setError).finally(() => setLoading(false));
  }, [api]);

  useEffect(cargar, [cargar]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const k = await api.post<ApiKey>("/api/merchant/api-keys", { name: nombre, scopes }, "staff");
      setRecien(k);
      setCreando(false);
      setNombre("");
      cargar();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function revocar(k: ApiKey) {
    if (!confirm(`¿Revocar "${k.name}"? Cualquier sistema que la esté usando va a dejar de funcionar al instante.`)) return;
    try {
      await api.del(`/api/merchant/api-keys/${k.id}`, "staff");
      cargar();
    } catch (err) {
      setError(err);
    }
  }

  const base = window.location.origin;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Integración</h1>
          <p>Conectá tu sistema para publicar catálogo y stock sin cargarlos a mano.</p>
        </div>
        <button className="btn-primary" onClick={() => setCreando(true)}>Nueva clave</button>
      </div>

      <ErrorBanner error={error} />

      <div className="card">
        <h2>Claves</h2>
        {loading ? <Loading /> : keys.length === 0 ? (
          <Empty>Todavía no generaste ninguna clave.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th><th>Clave</th><th>Permisos</th>
                  <th>Último uso</th><th>Estado</th><th />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td><strong>{k.name}</strong></td>
                    <td><code>{k.key_prefix}_••••••</code></td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {k.scopes.map((s) => <Badge key={s} tone="info">{s}</Badge>)}
                      </div>
                    </td>
                    <td className="hint">{k.last_used_at ? dateTime(k.last_used_at) : "nunca"}</td>
                    <td>
                      {k.revoked_at
                        ? <Badge tone="danger">Revocada</Badge>
                        : <Badge tone="success">Activa</Badge>}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {!k.revoked_at && (
                        <button className="btn-danger btn-sm" onClick={() => revocar(k)}>Revocar</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Cómo usarla</h2>
        <p className="hint" style={{ marginTop: -6 }}>
          Todas las llamadas van con el header <code>X-API-Key</code>. El comercio sale de la
          clave, así que nunca hay que mandarlo.
        </p>

        <h3 style={{ marginTop: 16 }}>Probar la clave</h3>
        <pre style={{ background: "var(--bg)", padding: 12, borderRadius: 6, overflowX: "auto", fontSize: 12 }}>
{`curl ${base}/api/v1/ping \\
  -H "X-API-Key: TU_CLAVE"`}
        </pre>
        <p className="hint">Devuelve tu comercio y qué categorías tenés habilitadas.</p>

        <h3 style={{ marginTop: 16 }}>Sincronizar catálogo</h3>
        <pre style={{ background: "var(--bg)", padding: 12, borderRadius: 6, overflowX: "auto", fontSize: 12 }}>
{`curl -X PUT ${base}/api/v1/products \\
  -H "X-API-Key: TU_CLAVE" \\
  -H "Content-Type: application/json" \\
  -d '{"products":[
    {"sku":"ABC-123","name":"Producto","price":150000,
     "categoryId":"tecnologia","stock":10}
  ]}'`}
        </pre>
        <p className="hint">
          Hasta 500 por llamada. Es idempotente por SKU: mandar lo mismo dos veces deja el
          mismo estado, no duplica. Si un producto falla, los demás entran igual y la
          respuesta te dice cuál falló y por qué.
        </p>

        <h3 style={{ marginTop: 16 }}>Actualizar sólo stock</h3>
        <pre style={{ background: "var(--bg)", padding: 12, borderRadius: 6, overflowX: "auto", fontSize: 12 }}>
{`curl -X PATCH ${base}/api/v1/stock \\
  -H "X-API-Key: TU_CLAVE" \\
  -H "Content-Type: application/json" \\
  -d '{"items":[{"sku":"ABC-123","stock":7}]}'`}
        </pre>
        <p className="hint">Más liviano que mandar el producto entero: es el que conviene correr seguido.</p>

        <h3 style={{ marginTop: 16 }}>Traer tus ventas</h3>
        <pre style={{ background: "var(--bg)", padding: 12, borderRadius: 6, overflowX: "auto", fontSize: 12 }}>
{`curl "${base}/api/v1/orders?status=pending" \\
  -H "X-API-Key: TU_CLAVE"`}
        </pre>
      </div>

      {creando && (
        <Modal title="Nueva clave de API" onClose={() => setCreando(false)}>
          <ErrorBanner error={error} />
          <form onSubmit={crear}>
            <label>
              <span>Nombre <span className="req">*</span></span>
              <input
                value={nombre} required autoFocus
                placeholder="ERP de depósito"
                onChange={(e) => setNombre(e.target.value)}
              />
              <div className="hint">Para saber cuál revocar si algún día hace falta.</div>
            </label>
            <label>
              <span>Permisos</span>
              {SCOPES.map((s) => (
                <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={scopes.includes(s.id)}
                    onChange={(e) =>
                      setScopes((prev) =>
                        e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id))
                    }
                  />
                  <span style={{ margin: 0, fontWeight: 400, color: "var(--text)" }}>{s.label}</span>
                </label>
              ))}
            </label>
            <div className="row" style={{ marginTop: 16 }}>
              <button type="submit" className="btn-primary" disabled={busy || scopes.length === 0}>
                {busy ? "Generando…" : "Generar clave"}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setCreando(false)}>
                Cancelar
              </button>
            </div>
          </form>
        </Modal>
      )}

      {recien?.key && (
        <Modal title="Guardá esta clave ahora" onClose={() => setRecien(null)}>
          <div className="alert warn">
            Es la única vez que se muestra. La guardamos hasheada, así que ni nosotros podemos
            recuperarla: si la perdés, revocala y generá otra.
          </div>
          <code style={{ display: "block", padding: 14, fontSize: 13 }}>{recien.key}</code>
          <div className="row" style={{ marginTop: 16 }}>
            <button
              className="btn-primary"
              onClick={() => navigator.clipboard?.writeText(recien.key!)}
            >
              Copiar
            </button>
            <button className="btn-ghost" onClick={() => setRecien(null)}>Ya la guardé</button>
          </div>
        </Modal>
      )}
    </>
  );
}
