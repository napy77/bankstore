import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  type ApiClient, type MerchantProduct, type MerchantProfile,
  type ProductBrand, type CategoryNode,
  LENGTH_UNITS, MASS_UNITS, IVA_RATES,
  money, mmToCm, gToKg, volumetricKg,
  ErrorBanner, Badge,
} from "@bankstore/shared";

/**
 * Alta y edición de un producto.
 *
 * Está separado de la grilla porque creció bastante: además del alta básica
 * ahora lleva marca contra un catálogo de miles, categoría en cascada por el
 * árbol, IVA y los bultos de despacho.
 */

interface PaqueteForm {
  height: string;
  width: string;
  length: string;
  lengthUnit: string;
  weight: string;
  massUnit: string;
}

const PAQUETE_VACIO: PaqueteForm = {
  height: "", width: "", length: "", lengthUnit: "cm", weight: "", massUnit: "kg",
};

interface FormState {
  sku: string;
  name: string;
  description: string;
  price: string;
  originalPrice: string;
  ivaRate: number;
  categoryId: string;
  secondCategoryId: string;
  brandId: number | null;
  brandName: string;
  kind: "physical" | "service";
  stock: string;
  active: boolean;
  packages: PaqueteForm[];
}

/** Aplana el árbol a "Electrohogar › Climatización › Ventiladores". */
function aplanar(
  nodos: CategoryNode[],
  permitidas: Set<string>,
  prefijo = ""
): { id: string; label: string }[] {
  const salida: { id: string; label: string }[] = [];
  for (const n of nodos) {
    const label = prefijo ? `${prefijo} › ${n.name}` : n.name;
    // Sólo las que el comercio tiene habilitadas. Se sigue bajando igual
    // porque un padre no habilitado puede tener hijos que sí lo estén.
    if (permitidas.has(n.id)) salida.push({ id: n.id, label });
    salida.push(...aplanar(n.children, permitidas, label));
  }
  return salida;
}

export function ProductoForm({
  api, profile, editando, onGuardado, onCancelar,
}: {
  api: ApiClient;
  profile: MerchantProfile;
  editando: MerchantProduct | null;
  onGuardado: () => void;
  onCancelar: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => ({
    sku: editando?.sku ?? "",
    name: editando?.name ?? "",
    description: editando?.description ?? "",
    price: editando ? String(editando.price) : "",
    originalPrice: editando?.originalPrice ? String(editando.originalPrice) : "",
    ivaRate: editando?.ivaRate ?? 0.21,
    categoryId: editando?.category ?? "",
    secondCategoryId: editando?.secondCategory ?? "",
    brandId: editando?.brandId ?? null,
    brandName: editando?.brandName ?? "",
    kind: editando?.kind ?? "physical",
    stock: editando ? String(editando.stock) : "0",
    active: editando?.active ?? true,
    // Los bultos vienen en mm/g y se muestran en cm/kg, que es como los piensa
    // quien los carga.
    packages: (editando?.packages ?? []).map((p) => ({
      height: String(mmToCm(p.heightMm)),
      width: String(mmToCm(p.widthMm)),
      length: String(mmToCm(p.lengthMm)),
      lengthUnit: "cm",
      weight: String(gToKg(p.weightG)),
      massUnit: "kg",
    })),
  }));

  const [arbol, setArbol] = useState<CategoryNode[]>([]);
  const [busquedaMarca, setBusquedaMarca] = useState(editando?.brandName ?? "");
  const [marcas, setMarcas] = useState<ProductBrand[]>([]);
  const [listaAbierta, setListaAbierta] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    api.get<CategoryNode[]>("/api/catalog/categories/tree").then(setArbol).catch(setError);
  }, [api]);

  // El catálogo tiene miles de marcas: no entra en un select, se busca.
  const buscarMarcas = useCallback((texto: string) => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      if (texto.trim().length < 2) { setMarcas([]); return; }
      api
        .get<ProductBrand[]>(`/api/catalog/brands?search=${encodeURIComponent(texto)}&limit=8`)
        .then(setMarcas)
        .catch(() => setMarcas([]));
    }, 250);
  }, [api]);

  const permitidas = new Set(profile.allowedCategories ?? profile.categories);
  const opciones = aplanar(arbol, permitidas);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const setPaquete = (i: number, campo: keyof PaqueteForm, valor: string) =>
    setForm((f) => ({
      ...f,
      packages: f.packages.map((p, j) => (j === i ? { ...p, [campo]: valor } : p)),
    }));

  const precio = Number(form.price) || 0;
  const neto = precio / (1 + form.ivaRate);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/merchant/products", {
        sku: form.sku,
        name: form.name,
        description: form.description,
        price: Number(form.price),
        originalPrice: form.originalPrice ? Number(form.originalPrice) : null,
        ivaRate: form.ivaRate,
        categoryId: form.categoryId,
        secondCategoryId: form.secondCategoryId || null,
        // Si eligió del listado va el id; si tipeó una marca nueva, el nombre.
        brandId: form.brandId,
        brandName: form.brandId ? null : (busquedaMarca.trim() || null),
        kind: form.kind,
        stock: Number(form.stock),
        active: form.active,
        specs: [],
        features: [],
        image: editando?.image ?? "",
        packages: form.packages
          .filter((p) => p.height && p.width && p.length && p.weight)
          .map((p) => ({
            height: Number(p.height), width: Number(p.width), length: Number(p.length),
            lengthUnit: p.lengthUnit, weight: Number(p.weight), massUnit: p.massUnit,
          })),
      }, "staff");
      onGuardado();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={guardar}>
      <ErrorBanner error={error} />

      <label>
        <span>SKU <span className="req">*</span></span>
        <input
          value={form.sku} required autoFocus={!editando}
          onChange={(e) => set("sku", e.target.value)}
        />
        <div className="hint">
          Tu código interno. Es la clave de sincronización: repetir un SKU actualiza ese
          producto en vez de crear otro.
        </div>
      </label>

      <label>
        <span>Nombre <span className="req">*</span></span>
        <input value={form.name} required onChange={(e) => set("name", e.target.value)} />
      </label>

      <label>
        <span>Descripción</span>
        <textarea value={form.description} onChange={(e) => set("description", e.target.value)} />
      </label>

      {/* ── Marca ─────────────────────────────────────────────────────────── */}
      <label style={{ position: "relative" }}>
        <span>Marca</span>
        <input
          value={busquedaMarca}
          placeholder="Empezá a escribir: Liliana, Samsung…"
          onChange={(e) => {
            setBusquedaMarca(e.target.value);
            // Al editar el texto se suelta la marca elegida: si no, quedaría
            // guardado un id que ya no corresponde a lo que se ve.
            set("brandId", null);
            setListaAbierta(true);
            buscarMarcas(e.target.value);
          }}
          onFocus={() => setListaAbierta(true)}
          onBlur={() => setTimeout(() => setListaAbierta(false), 150)}
        />
        {form.brandId && (
          <div className="hint">
            <Badge tone="success">del catálogo</Badge>
          </div>
        )}
        {!form.brandId && busquedaMarca.trim() && (
          <div className="hint">
            No está en el catálogo: se va a crear y quedará marcada para revisión.
          </div>
        )}
        {listaAbierta && marcas.length > 0 && (
          <div
            className="bg-white border border-slate-200 rounded-xl shadow-lg absolute z-10 w-full max-h-52 overflow-y-auto"
            style={{ top: "100%" }}
          >
            {marcas.map((m) => (
              <button
                key={m.id}
                type="button"
                className="!rounded-none w-full text-left !font-normal hover:bg-slate-50 !py-2"
                onMouseDown={() => {
                  set("brandId", m.id);
                  setBusquedaMarca(m.name);
                  setListaAbierta(false);
                }}
              >
                {m.name}
                {m.needsReview && <> <Badge tone="warning">a revisar</Badge></>}
              </button>
            ))}
          </div>
        )}
      </label>

      {/* ── Categorías ────────────────────────────────────────────────────── */}
      <label>
        <span>Categoría <span className="req">*</span></span>
        <select
          value={form.categoryId} required
          onChange={(e) => set("categoryId", e.target.value)}
        >
          <option value="">Elegí una categoría</option>
          {opciones.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <div className="hint">
          Sólo aparecen las ramas que la plataforma te habilitó.
        </div>
      </label>

      <label>
        <span>Segunda categoría</span>
        <select
          value={form.secondCategoryId}
          onChange={(e) => set("secondCategoryId", e.target.value)}
        >
          <option value="">Ninguna</option>
          {opciones.filter((o) => o.id !== form.categoryId).map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <div className="hint">Opcional: el producto también se lista acá.</div>
      </label>

      {/* ── Precio ────────────────────────────────────────────────────────── */}
      <div className="grid cols-2">
        <label>
          <span>Precio final <span className="req">*</span></span>
          <input
            type="number" step="0.01" min="0" value={form.price} required
            onChange={(e) => set("price", e.target.value)}
          />
          <div className="hint">Con IVA incluido: es lo que paga el comprador.</div>
        </label>

        <label>
          <span>IVA</span>
          <select
            value={form.ivaRate}
            onChange={(e) => set("ivaRate", Number(e.target.value))}
          >
            {IVA_RATES.map((r) => (
              <option key={r} value={r}>{(r * 100).toFixed(1).replace(".0", "")}%</option>
            ))}
          </select>
        </label>
      </div>

      {precio > 0 && (
        <div className="alert ok" style={{ marginTop: -4 }}>
          Neto <strong>{money(neto)}</strong> + IVA <strong>{money(precio - neto)}</strong> ={" "}
          <strong>{money(precio)}</strong>
        </div>
      )}

      <div className="grid cols-2">
        <label>
          <span>Precio de lista (tachado)</span>
          <input
            type="number" step="0.01" min="0" value={form.originalPrice}
            onChange={(e) => set("originalPrice", e.target.value)}
          />
          <div className="hint">Opcional. Mayor o igual al precio final.</div>
        </label>

        <label>
          <span>Stock</span>
          <input
            type="number" min="0" value={form.stock}
            onChange={(e) => set("stock", e.target.value)}
          />
        </label>
      </div>

      <label>
        <span>Tipo</span>
        <select value={form.kind} onChange={(e) => set("kind", e.target.value as "physical" | "service")}>
          <option value="physical">Producto físico (se despacha)</option>
          <option value="service">Servicio (hotel, spa, viaje)</option>
        </select>
      </label>

      {/* ── Logística ─────────────────────────────────────────────────────── */}
      {form.kind === "physical" && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Bultos de despacho</h3>
          <p className="hint">
            Un bulto por caja. Si el producto se despacha en varias, cargá cada una: el
            transportista cotiza por bulto.
          </p>

          {form.packages.length === 0 && (
            <div className="empty">Sin dimensiones cargadas.</div>
          )}

          {form.packages.map((p, i) => {
            const vol =
              p.height && p.width && p.length && p.lengthUnit === "cm"
                ? volumetricKg(Number(p.height) * 10, Number(p.width) * 10, Number(p.length) * 10)
                : null;
            return (
              <div key={i} className="card" style={{ marginTop: 10, background: "#fafbfc" }}>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                  <strong className="text-sm">Bulto {i + 1}</strong>
                  <button
                    type="button" className="btn-danger btn-sm"
                    onClick={() => set("packages", form.packages.filter((_, j) => j !== i))}
                  >
                    Quitar
                  </button>
                </div>
                <div className="grid cols-4">
                  <label><span>Alto</span>
                    <input type="number" step="0.1" min="0" value={p.height}
                      onChange={(e) => setPaquete(i, "height", e.target.value)} /></label>
                  <label><span>Ancho</span>
                    <input type="number" step="0.1" min="0" value={p.width}
                      onChange={(e) => setPaquete(i, "width", e.target.value)} /></label>
                  <label><span>Largo</span>
                    <input type="number" step="0.1" min="0" value={p.length}
                      onChange={(e) => setPaquete(i, "length", e.target.value)} /></label>
                  <label><span>Unidad</span>
                    <select value={p.lengthUnit}
                      onChange={(e) => setPaquete(i, "lengthUnit", e.target.value)}>
                      {LENGTH_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select></label>
                </div>
                <div className="grid cols-2">
                  <label><span>Peso</span>
                    <input type="number" step="0.01" min="0" value={p.weight}
                      onChange={(e) => setPaquete(i, "weight", e.target.value)} /></label>
                  <label><span>Unidad</span>
                    <select value={p.massUnit}
                      onChange={(e) => setPaquete(i, "massUnit", e.target.value)}>
                      {MASS_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select></label>
                </div>
                {vol !== null && Number(p.weight) > 0 && (
                  <div className="hint">
                    Peso volumétrico {vol} kg · real {p.weight} kg →{" "}
                    <strong>se factura {Math.max(vol, Number(p.weight))} kg</strong>
                    {vol > Number(p.weight) && " (ocupa más de lo que pesa)"}
                  </div>
                )}
              </div>
            );
          })}

          <button
            type="button" className="btn-ghost btn-sm" style={{ marginTop: 10 }}
            onClick={() => set("packages", [...form.packages, { ...PAQUETE_VACIO }])}
          >
            Agregar bulto
          </button>
        </div>
      )}

      <label className="flex items-center gap-2" style={{ marginTop: 16 }}>
        <input type="checkbox" checked={form.active}
          onChange={(e) => set("active", e.target.checked)} />
        <span className="!m-0 !normal-case !tracking-normal !text-sm !font-normal !text-slate-700">
          Publicado en la tienda
        </span>
      </label>

      <div className="row" style={{ marginTop: 16 }}>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancelar} disabled={busy}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
