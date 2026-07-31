import React, { useState } from "react";
import { ApiError } from "./client.js";

/** Piezas de UI que usan los dos paneles internos. */

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof ApiError ? error.message :
    error instanceof Error ? error.message :
    "Algo salió mal";

  // zod devuelve el detalle por campo: mostrarlo evita el clásico
  // "Datos inválidos" sin decir cuál.
  const details =
    error instanceof ApiError && Array.isArray(error.details)
      ? (error.details as { path?: (string | number)[]; message?: string }[])
      : null;

  return (
    <div className="alert error">
      <strong>{message}</strong>
      {details && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          {details.map((d, i) => (
            <li key={i}>{d.path?.join(".")}: {d.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Loading({ what = "Cargando" }: { what?: string }) {
  return <div className="empty">{what}…</div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

const ORDER_TONE: Record<string, BadgeTone> = {
  pending: "warning", accepted: "info", shipped: "info",
  delivered: "success", cancelled: "danger",
};

export function StatusBadge({ status, labels }: { status: string; labels: Record<string, string> }) {
  return <Badge tone={ORDER_TONE[status] ?? "neutral"}>{labels[status] ?? status}</Badge>;
}

export function Modal({
  title, onClose, children,
}: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="modal-backdrop"
      // Cerrar al clickear afuera, pero no cuando el click nace adentro y
      // termina afuera (arrastrar para seleccionar texto).
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="modal">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export interface Field {
  name: string;
  label: string;
  type?: "text" | "number" | "email" | "password" | "textarea" | "checkbox" | "select" | "date";
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  step?: string;
  placeholder?: string;
}

/**
 * Formulario declarativo. Los dos paneles son en el fondo ABM sobre la misma
 * API, así que describir los campos rinde más que escribir el mismo JSX
 * quince veces.
 */
export function AutoForm<T extends Record<string, unknown>>({
  fields, initial, submitLabel, onSubmit, onCancel, busy,
}: {
  fields: Field[];
  initial: T;
  submitLabel: string;
  onSubmit: (values: T) => void;
  onCancel?: () => void;
  busy?: boolean;
}) {
  const [values, setValues] = useState<T>(initial);
  const set = (name: string, value: unknown) =>
    setValues((v) => ({ ...v, [name]: value }));

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(values); }}
    >
      {fields.map((f) => {
        const value = values[f.name];
        if (f.type === "checkbox") {
          return (
            <label key={f.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => set(f.name, e.target.checked)}
              />
              <span style={{ margin: 0 }}>{f.label}</span>
            </label>
          );
        }
        return (
          <label key={f.name}>
            <span>
              {f.label}
              {f.required && <span className="req"> *</span>}
            </span>
            {f.type === "textarea" ? (
              <textarea
                value={String(value ?? "")}
                required={f.required}
                placeholder={f.placeholder}
                onChange={(e) => set(f.name, e.target.value)}
              />
            ) : f.type === "select" ? (
              <select
                value={String(value ?? "")}
                required={f.required}
                onChange={(e) => set(f.name, e.target.value)}
              >
                <option value="">—</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <input
                type={f.type ?? "text"}
                step={f.step}
                value={value === null || value === undefined ? "" : String(value)}
                required={f.required}
                placeholder={f.placeholder}
                onChange={(e) =>
                  set(f.name, f.type === "number"
                    ? (e.target.value === "" ? null : Number(e.target.value))
                    : e.target.value)
                }
              />
            )}
            {f.hint && <div className="hint">{f.hint}</div>}
          </label>
        );
      })}
      <div className="row" style={{ marginTop: 16 }}>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Guardando…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

/** Multi-select de categorías, que los dos paneles necesitan. */
export function CategoryPicker({
  all, selected, onChange,
}: { all: { id: string; name: string }[]; selected: string[]; onChange: (v: string[]) => void }) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((c) => c !== id) : [...selected, id]);

  return (
    <div className="row" style={{ gap: 6 }}>
      {all.map((c) => (
        <button
          key={c.id}
          type="button"
          className={selected.includes(c.id) ? "btn-primary btn-sm" : "btn-ghost btn-sm"}
          onClick={() => toggle(c.id)}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}
