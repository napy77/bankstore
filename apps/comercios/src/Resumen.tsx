import React, { useEffect, useState } from "react";
import {
  type ApiClient, type MerchantProfile, type MerchantOrder,
  money, percentDirect, ErrorBanner, Loading, Badge, Empty,
} from "@bankstore/shared";

interface AgreementView {
  id: number;
  bankName: string;
  categoryId: string | null;
  maxCuotas: number;
  discountPercent: number;
  capAmount: number | null;
  description: string;
  exclusivo: boolean;
}

export function Resumen({ api }: { api: ApiClient }) {
  const [profile, setProfile] = useState<MerchantProfile | null>(null);
  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [agreements, setAgreements] = useState<AgreementView[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<MerchantProfile>("/api/merchant/profile", "staff"),
      api.get<MerchantOrder[]>("/api/merchant/orders", "staff"),
      api.get<AgreementView[]>("/api/merchant/agreements", "staff"),
    ])
      .then(([p, o, a]) => { setProfile(p); setOrders(o); setAgreements(a); })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [api]);

  if (loading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;
  if (!profile) return null;

  const vivas = orders.filter((o) => o.status !== "cancelled");
  const pendientes = orders.filter((o) => o.status === "pending");
  const bruto = vivas.reduce((a, o) => a + Number(o.subtotal), 0);
  const aCobrar = vivas.reduce((a, o) => a + Number(o.payout_amount), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{profile.tradeName}</h1>
          <p>{profile.legalName}</p>
        </div>
        <Badge tone={profile.status === "active" ? "success" : "warning"}>
          {profile.status === "active" ? "Activo" : profile.status}
        </Badge>
      </div>

      <div className="grid cols-4">
        <div className="card stat">
          <div className="label">Ventas</div>
          <div className="value">{vivas.length}</div>
          <div className="hint">{pendientes.length} sin aceptar</div>
        </div>
        <div className="card stat">
          <div className="label">Facturado</div>
          <div className="value">{money(bruto)}</div>
          <div className="hint">a precio de venta</div>
        </div>
        <div className="card stat">
          <div className="label">A cobrar</div>
          <div className="value">{money(aCobrar)}</div>
          <div className="hint">neto de comisión y cuotas</div>
        </div>
        <div className="card stat">
          <div className="label">Comisión</div>
          <div className="value">{percentDirect(profile.commissionPercent)}</div>
          <div className="hint">se liquida a {profile.settlementDays} días</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Tus condiciones</h2>
        <p className="hint">
          Las fija la plataforma. Si algo no coincide con lo acordado, hablá con tu contacto comercial.
        </p>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <td>Categorías habilitadas</td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    {profile.categories.map((c) => <Badge key={c} tone="info">{c}</Badge>)}
                  </div>
                </td>
              </tr>
              <tr>
                <td>Comisión del marketplace</td>
                <td>{percentDirect(profile.commissionPercent)} sobre cada venta</td>
              </tr>
              <tr>
                <td>Costo de las cuotas sin interés</td>
                <td>
                  {profile.absorbsInstallmentCost
                    ? "Lo absorbe el comercio, prorrateado por su parte de cada orden"
                    : "Lo absorbe el banco: se te liquida sin esa quita"}
                </td>
              </tr>
              <tr>
                <td>Plazo de liquidación</td>
                <td>{profile.settlementDays} días desde la venta</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Beneficios bancarios que te aplican</h2>
        <p className="hint">
          Cuando hay más de uno para la misma compra, gana el más específico: un acuerdo
          exclusivo tuyo reemplaza al general del banco.
        </p>
        {agreements.length === 0 ? (
          <Empty>Todavía no hay acuerdos vigentes para tu comercio.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Banco</th>
                  <th>Categoría</th>
                  <th className="num">Cuotas</th>
                  <th className="num">Reintegro</th>
                  <th className="num">Tope</th>
                  <th>Alcance</th>
                </tr>
              </thead>
              <tbody>
                {agreements.map((a) => (
                  <tr key={a.id}>
                    <td><strong>{a.bankName}</strong></td>
                    <td>{a.categoryId ?? <span className="hint">todas</span>}</td>
                    <td className="num">{a.maxCuotas}</td>
                    <td className="num">{percentDirect(a.discountPercent, 0)}</td>
                    <td className="num">{a.capAmount ? money(a.capAmount) : "sin tope"}</td>
                    <td>
                      <Badge tone={a.exclusivo ? "success" : "neutral"}>
                        {a.exclusivo ? "Exclusivo tuyo" : "General"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
