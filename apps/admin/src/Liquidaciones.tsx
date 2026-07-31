import React, { useCallback, useEffect, useState } from "react";
import {
  type ApiClient, type Settlement,
  money, ErrorBanner, Loading, Empty,
} from "@bankstore/shared";

/** Primer día del mes actual, que es el corte con el que se mira esto. */
function inicioDeMes(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export function Liquidaciones({ api }: { api: ApiClient }) {
  const [rows, setRows] = useState<Settlement[]>([]);
  const [from, setFrom] = useState(inicioDeMes());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const cargar = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    api
      .get<Settlement[]>(`/api/admin/settlements?${qs}`, "staff")
      .then(setRows)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [api, from, to]);

  useEffect(cargar, [cargar]);

  const total = rows.reduce(
    (a, r) => ({
      bruto: a.bruto + Number(r.bruto),
      comision: a.comision + Number(r.comision),
      costo: a.costo + Number(r.costo_cuotas),
      pagar: a.pagar + Number(r.a_pagar),
      ordenes: a.ordenes + r.ordenes,
    }),
    { bruto: 0, comision: 0, costo: 0, pagar: 0, ordenes: 0 }
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Liquidaciones</h1>
          <p>Cuánto se le paga a cada comercio y cuánto retuvo la plataforma. Excluye canceladas.</p>
        </div>
      </div>

      <ErrorBanner error={error} />

      <div className="grid cols-4">
        <div className="card stat">
          <div className="label">Ventas</div>
          <div className="value">{total.ordenes}</div>
        </div>
        <div className="card stat">
          <div className="label">Facturado</div>
          <div className="value">{money(total.bruto)}</div>
        </div>
        <div className="card stat">
          <div className="label">Comisión retenida</div>
          <div className="value">{money(total.comision)}</div>
          <div className="hint">ingreso de la plataforma</div>
        </div>
        <div className="card stat">
          <div className="label">A pagar a comercios</div>
          <div className="value">{money(total.pagar)}</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <label style={{ margin: 0 }}>
            <span>Desde</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label style={{ margin: 0 }}>
            <span>Hasta</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>

        {loading ? <Loading /> : rows.length === 0 ? (
          <Empty>No hubo ventas en ese período.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Comercio</th>
                  <th className="num">Ventas</th>
                  <th className="num">Bruto</th>
                  <th className="num">Comisión</th>
                  <th className="num">Costo de cuotas</th>
                  <th className="num">A pagar</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.merchant_id}>
                    <td>
                      <strong>{r.trade_name}</strong>
                      <div className="hint"><code>{r.merchant_id}</code></div>
                    </td>
                    <td className="num">{r.ordenes}</td>
                    <td className="num">{money(r.bruto)}</td>
                    <td className="num">−{money(r.comision)}</td>
                    <td className="num">
                      {Number(r.costo_cuotas) > 0 ? `−${money(r.costo_cuotas)}` : "—"}
                    </td>
                    <td className="num"><strong>{money(r.a_pagar)}</strong></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--border)" }}>
                  <td><strong>Total</strong></td>
                  <td className="num"><strong>{total.ordenes}</strong></td>
                  <td className="num"><strong>{money(total.bruto)}</strong></td>
                  <td className="num"><strong>−{money(total.comision)}</strong></td>
                  <td className="num"><strong>−{money(total.costo)}</strong></td>
                  <td className="num"><strong>{money(total.pagar)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="hint" style={{ marginTop: 12 }}>
          El costo de las cuotas se prorratea según cuánto puso cada comercio en cada orden, y
          sólo se le descuenta a los que lo absorben. Los porcentajes quedan congelados al
          momento de la venta.
        </p>
      </div>
    </>
  );
}
