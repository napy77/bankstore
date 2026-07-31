import React, { useCallback, useEffect, useState } from "react";
import {
  type ApiClient, type MerchantProduct, type MerchantProfile,
  money, dateTime, ErrorBanner, Loading, Empty, Badge, Modal, AutoForm, type Field,
} from "@bankstore/shared";

export function Productos({ api }: { api: ApiClient }) {
  const [items, setItems] = useState<MerchantProduct[]>([]);
  const [profile, setProfile] = useState<MerchantProfile | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<MerchantProduct | "nuevo" | null>(null);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(
    (q: string) => {
      setLoading(true);
      const qs = q ? `?search=${encodeURIComponent(q)}` : "";
      api
        .get<{ total: number; items: MerchantProduct[] }>(`/api/merchant/products${qs}`, "staff")
        .then((r) => setItems(r.items))
        .catch(setError)
        .finally(() => setLoading(false));
    },
    [api]
  );

  useEffect(() => { cargar(""); }, [cargar]);
  useEffect(() => {
    api.get<MerchantProfile>("/api/merchant/profile", "staff").then(setProfile).catch(() => {});
  }, [api]);

  // El backend limita la categoría a las habilitadas para el comercio; el
  // select refleja lo mismo para no ofrecer opciones que van a ser rechazadas.
  const campos: Field[] = [
    { name: "sku", label: "SKU (tu código interno)", required: true,
      hint: "Es la clave de sincronización: si repetís un SKU, se actualiza ese producto en vez de crear otro." },
    { name: "name", label: "Nombre", required: true },
    { name: "description", label: "Descripción", type: "textarea" },
    { name: "price", label: "Precio de venta", type: "number", step: "0.01", required: true },
    { name: "originalPrice", label: "Precio de lista (tachado)", type: "number", step: "0.01",
      hint: "Opcional. Tiene que ser mayor o igual al de venta." },
    { name: "categoryId", label: "Categoría", type: "select", required: true,
      options: (profile?.categories ?? []).map((c) => ({ value: c, label: c })) },
    { name: "kind", label: "Tipo", type: "select",
      options: [
        { value: "physical", label: "Producto físico (se despacha)" },
        { value: "service", label: "Servicio (hotel, spa, viaje)" },
      ] },
    { name: "stock", label: "Stock", type: "number", required: true },
    { name: "active", label: "Publicado en la tienda", type: "checkbox" },
  ];

  async function guardar(values: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/merchant/products", {
        ...values,
        specs: [],
        features: [],
        image: (values.image as string) ?? "",
      }, "staff");
      setEditing(null);
      cargar(search);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function cambiarStock(p: MerchantProduct, stock: number) {
    try {
      await api.patch(`/api/merchant/products/${p.id}`, { stock }, "staff");
      setItems((prev) => prev.map((i) => (i.id === p.id ? { ...i, stock } : i)));
    } catch (err) {
      setError(err);
    }
  }

  async function despublicar(p: MerchantProduct) {
    if (!confirm(`¿Despublicar "${p.name}"? Deja de verse en la tienda, pero no se borra: sigue en las órdenes viejas.`)) return;
    try {
      await api.del(`/api/merchant/products/${p.id}`, "staff");
      cargar(search);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Productos</h1>
          <p>Lo que publicás en la tienda. También podés sincronizarlos por API.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing("nuevo")}>
          Nuevo producto
        </button>
      </div>

      <ErrorBanner error={error} />

      <div className="card">
        <form
          className="row"
          style={{ marginBottom: 14 }}
          onSubmit={(e) => { e.preventDefault(); cargar(search); }}
        >
          <input
            placeholder="Buscar por nombre o SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 300 }}
          />
          <button type="submit" className="btn-ghost">Buscar</button>
          {search && (
            <button type="button" className="btn-ghost"
              onClick={() => { setSearch(""); cargar(""); }}>
              Limpiar
            </button>
          )}
        </form>

        {loading ? <Loading /> : items.length === 0 ? (
          <Empty>
            {search ? "Ningún producto coincide con la búsqueda." : "Todavía no cargaste productos."}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th className="num">Precio</th>
                  <th className="num">Stock</th>
                  <th>Estado</th>
                  <th>Actualizado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td><code>{p.sku}</code></td>
                    <td>
                      <strong>{p.name}</strong>
                      {p.kind === "service" && <> <Badge tone="info">servicio</Badge></>}
                    </td>
                    <td>{p.category}</td>
                    <td className="num">
                      {money(p.price)}
                      {p.originalPrice && (
                        <div className="hint" style={{ textDecoration: "line-through" }}>
                          {money(p.originalPrice)}
                        </div>
                      )}
                    </td>
                    <td className="num">
                      <input
                        type="number" min={0} defaultValue={p.stock}
                        style={{ width: 80, textAlign: "right" }}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v !== p.stock) cambiarStock(p, v);
                        }}
                      />
                    </td>
                    <td>
                      <Badge tone={p.active ? "success" : "neutral"}>
                        {p.active ? "Publicado" : "Oculto"}
                      </Badge>
                    </td>
                    <td className="hint">{dateTime(p.updatedAt)}</td>
                    <td>
                      <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        <button className="btn-ghost btn-sm" onClick={() => setEditing(p)}>
                          Editar
                        </button>
                        {p.active && (
                          <button className="btn-danger btn-sm" onClick={() => despublicar(p)}>
                            Despublicar
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

      {editing && (
        <Modal
          title={editing === "nuevo" ? "Nuevo producto" : `Editar ${editing.name}`}
          onClose={() => setEditing(null)}
        >
          <ErrorBanner error={error} />
          <AutoForm
            fields={campos}
            initial={
              editing === "nuevo"
                ? { sku: "", name: "", description: "", price: null, originalPrice: null,
                    categoryId: profile?.categories[0] ?? "", kind: "physical", stock: 0, active: true }
                : { sku: editing.sku, name: editing.name, description: editing.description,
                    price: editing.price, originalPrice: editing.originalPrice,
                    categoryId: editing.category, kind: editing.kind,
                    stock: editing.stock, active: editing.active }
            }
            submitLabel="Guardar"
            busy={busy}
            onSubmit={guardar}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
    </>
  );
}
