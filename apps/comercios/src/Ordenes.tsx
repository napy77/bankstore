import React, { useCallback, useEffect, useState } from "react";
import {
  type ApiClient, type MerchantOrder, type MerchantOrderStatus,
  money, dateTime, date, ORDER_STATUS_LABEL,
  ErrorBanner, Loading, Empty, StatusBadge, Modal,
} from "@bankstore/shared";

/**
 * Qué transición se le ofrece al comercio en cada estado. Es el mismo camino
 * que valida el backend; acá sólo se evita mostrar botones que van a fallar.
 */
const SIGUIENTE: Record<MerchantOrderStatus, { estado: MerchantOrderStatus; label: string }[]> = {
  pending: [
    { estado: "accepted", label: "Aceptar" },
    { estado: "cancelled", label: "Cancelar" },
  ],
  accepted: [
    { estado: "shipped", label: "Marcar despachada" },
    { estado: "cancelled", label: "Cancelar" },
  ],
  shipped: [{ estado: "delivered", label: "Marcar entregada" }],
  delivered: [],
  cancelled: [],
};

interface Detalle extends MerchantOrder {
  items: { product_id: string; product_name: string; quantity: number; unit_price: number }[];
  customer_email: string;
}

export function Ordenes({ api }: { api: ApiClient }) {
  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [filtro, setFiltro] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);

  const cargar = useCallback(
    (estado: string) => {
      setLoading(true);
      const qs = estado ? `?status=${estado}` : "";
      api
        .get<MerchantOrder[]>(`/api/merchant/orders${qs}`, "staff")
        .then(setOrders)
        .catch(setError)
        .finally(() => setLoading(false));
    },
    [api]
  );

  useEffect(() => { cargar(filtro); }, [cargar, filtro]);

  async function avanzar(o: MerchantOrder, estado: MerchantOrderStatus) {
    if (estado === "cancelled" &&
        !confirm("¿Cancelar esta orden? La mercadería vuelve al stock.")) return;
    try {
      await api.patch(`/api/merchant/orders/${o.id}`, { status: estado }, "staff");
      cargar(filtro);
      setDetalle(null);
    } catch (err) {
      setError(err);
    }
  }

  async function abrir(o: MerchantOrder) {
    try {
      setDetalle(await api.get<Detalle>(`/api/merchant/orders/${o.id}`, "staff"));
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Órdenes</h1>
          <p>
            El comprador paga una sola vez, aunque el carrito tenga productos de varios
            comercios. Acá ves sólo tu parte.
          </p>
        </div>
      </div>

      <ErrorBanner error={error} />

      <div className="card">
        <div className="row" style={{ marginBottom: 14 }}>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">Todos los estados</option>
            {Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {loading ? <Loading /> : orders.length === 0 ? (
          <Empty>No hay órdenes{filtro ? " en ese estado" : " todavía"}.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Pago</th>
                  <th className="num">Bruto</th>
                  <th className="num">Comisión</th>
                  <th className="num">Costo cuotas</th>
                  <th className="num">A cobrar</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td><strong>#{o.merchant_order_number}</strong></td>
                    <td className="hint">{dateTime(o.created_at)}</td>
                    <td>{o.customer_name}</td>
                    <td className="hint">
                      {o.bank_name}<br />
                      {o.installments}x ·••••{o.card_last4}
                    </td>
                    <td className="num">{money(o.subtotal)}</td>
                    <td className="num">−{money(o.commission_amount)}</td>
                    <td className="num">
                      {Number(o.installment_cost) > 0 ? `−${money(o.installment_cost)}` : "—"}
                    </td>
                    <td className="num"><strong>{money(o.payout_amount)}</strong></td>
                    <td>
                      <StatusBadge status={o.status} labels={ORDER_STATUS_LABEL} />
                      {o.settlement_date && o.status !== "cancelled" && (
                        <div className="hint">paga {date(o.settlement_date)}</div>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        <button className="btn-ghost btn-sm" onClick={() => abrir(o)}>Ver</button>
                        {SIGUIENTE[o.status].map((t) => (
                          <button
                            key={t.estado}
                            className={t.estado === "cancelled" ? "btn-danger btn-sm" : "btn-primary btn-sm"}
                            onClick={() => avanzar(o, t.estado)}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detalle && (
        <Modal title={`Orden #${detalle.merchant_order_number}`} onClose={() => setDetalle(null)}>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr><td>Compra en la plataforma</td><td>#{detalle.order_number}</td></tr>
                <tr><td>Cliente</td><td>{detalle.customer_name} · {detalle.customer_email}</td></tr>
                <tr><td>Pago</td><td>{detalle.bank_name} ••••{detalle.card_last4}, {detalle.installments} cuotas</td></tr>
                <tr><td>Estado</td><td><StatusBadge status={detalle.status} labels={ORDER_STATUS_LABEL} /></td></tr>
              </tbody>
            </table>
          </div>

          <h3 style={{ marginTop: 18 }}>Productos</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Producto</th><th className="num">Cant.</th><th className="num">Unitario</th><th className="num">Total</th></tr>
              </thead>
              <tbody>
                {detalle.items.map((i) => (
                  <tr key={i.product_id}>
                    <td>{i.product_name}</td>
                    <td className="num">{i.quantity}</td>
                    <td className="num">{money(i.unit_price)}</td>
                    <td className="num">{money(i.quantity * Number(i.unit_price))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ marginTop: 18 }}>Liquidación</h3>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr><td>Bruto</td><td className="num">{money(detalle.subtotal)}</td></tr>
                <tr><td>Comisión del marketplace</td><td className="num">−{money(detalle.commission_amount)}</td></tr>
                <tr>
                  <td>
                    Costo de las cuotas
                    <div className="hint">Prorrateado según tu parte de la orden</div>
                  </td>
                  <td className="num">−{money(detalle.installment_cost)}</td>
                </tr>
                <tr>
                  <td><strong>A cobrar</strong></td>
                  <td className="num"><strong>{money(detalle.payout_amount)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="row" style={{ marginTop: 18 }}>
            {SIGUIENTE[detalle.status].map((t) => (
              <button
                key={t.estado}
                className={t.estado === "cancelled" ? "btn-danger" : "btn-primary"}
                onClick={() => avanzar(detalle, t.estado)}
              >
                {t.label}
              </button>
            ))}
            <button className="btn-ghost" onClick={() => setDetalle(null)}>Cerrar</button>
          </div>
        </Modal>
      )}
    </>
  );
}
