/**
 * Tipos del dominio, compartidos por las tres apps.
 *
 * Espejan lo que devuelve el backend. Cuando cambie un endpoint, esto es lo
 * primero que hay que tocar: el typecheck de las tres apps marca dónde
 * impacta.
 */

export type CardBrand = "visa" | "mastercard" | "amex" | "cabal";
export type CardTier = "black" | "signature" | "platinum" | "gold" | "classic";
export type MerchantStatus = "draft" | "active" | "suspended";
export type StaffRole = "platform_admin" | "merchant_admin" | "merchant_staff";
export type ProductKind = "physical" | "service";
export type MerchantOrderStatus =
  | "pending" | "accepted" | "shipped" | "delivered" | "cancelled";

// ── Sesiones ─────────────────────────────────────────────────────────────────

export interface CustomerSession {
  token: string;
  user: { id: number; email: string; name: string };
}

export interface StaffUser {
  id: number;
  email: string;
  name: string;
  role: StaffRole;
  merchantId: string | null;
  merchantName: string | null;
}

export interface StaffSession {
  token: string;
  user: StaffUser;
}

// ── Catálogo ─────────────────────────────────────────────────────────────────

export interface MerchantRef {
  id: string;
  name: string;
}

export interface CatalogProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  originalPrice: number | null;
  category: string;
  kind: ProductKind;
  merchant: MerchantRef;
  rating: number;
  reviewsCount: number;
  image: string;
  stock: number;
  specs: string[];
  features: string[];
  bestOffer: {
    bankId: string;
    bankName: string;
    maxCuotas: number;
    reintegroPercent: number;
  } | null;
}

export interface Benefit {
  bankId: string;
  bankName?: string;
  maxCuotas: number;
  reintegroPercent: number;
  capAmount: number | null;
  capKey: string;
  source: "product" | "agreement" | "none";
  agreementId: number | null;
  description: string;
}

export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  product_count: number;
}

// ── Simulador ────────────────────────────────────────────────────────────────

export interface Quote {
  installments: number;
  interestFree: boolean;
  financedAmount: number;
  installmentAmount: number;
  totalAmount: number;
  interestAmount: number;
  vatAmount: number;
  /** Fracción: 0.42 = 42%. */
  tna: number;
  tea: number;
  cft: number;
}

export interface SimulationResult {
  product: { id: string; name: string; price: number; merchant: MerchantRef };
  quantity: number;
  benefit: Benefit;
  options: number[];
  quote: Quote;
  reintegro: {
    amount: number;
    percent: number;
    capped: boolean;
    capAmount: number | null;
  };
  netCost: number;
}

// ── Billetera ────────────────────────────────────────────────────────────────

export interface Card {
  id: number;
  bankId: string;
  bankName: string;
  holderName: string;
  cardNumber: string;
  last4: string;
  brand: CardBrand;
  tier: CardTier;
  expiryDate: string;
  limit: number;
  availableLimit: number;
  colorTheme: string;
}

// ── Órdenes ──────────────────────────────────────────────────────────────────

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
}

export interface OrderMerchantGroup {
  merchantId: string;
  merchantName: string;
  merchantOrderNumber: number;
  status: MerchantOrderStatus;
  subtotal: number;
  items: OrderItem[];
}

export interface Order {
  id: number;
  orderNumber: number;
  date: string;
  status: string;
  merchants: OrderMerchantGroup[];
  items: OrderItem[];
  cardUsed: { bankName: string; brand: CardBrand; cardNumber: string };
  installments: number;
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  interestAmount: number;
  installmentPrice: number;
  reintegroAmount: number;
  tna: number;
  tea: number;
  cft: number;
  duplicated?: boolean;
}

// ── Panel del comercio ───────────────────────────────────────────────────────

export interface MerchantProfile {
  id: string;
  tradeName: string;
  legalName: string;
  taxId: string | null;
  status: MerchantStatus;
  /** Ya viene en porcentaje (8 = 8%), no en fracción. */
  commissionPercent: number;
  absorbsInstallmentCost: boolean;
  settlementDays: number;
  categories: string[];
}

export interface MerchantProduct {
  id: string;
  sku: string;
  name: string;
  description: string;
  price: number;
  originalPrice: number | null;
  category: string;
  kind: ProductKind;
  stock: number;
  image: string;
  specs: string[];
  features: string[];
  active: boolean;
  merchantId: string;
  updatedAt: string;
}

export interface MerchantOrder {
  id: number;
  merchant_order_number: number;
  status: MerchantOrderStatus;
  subtotal: number;
  commission_amount: number;
  installment_cost: number;
  payout_amount: number;
  settlement_date: string | null;
  created_at: string;
  order_number: number;
  installments: number;
  bank_name: string;
  card_last4: string;
  customer_name: string;
}

export interface ApiKey {
  id: number;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  /** Sólo viene al crearla: no se puede recuperar después. */
  key?: string;
  aviso?: string;
}

// ── Panel de plataforma ──────────────────────────────────────────────────────

export interface Merchant {
  id: string;
  legalName: string;
  tradeName: string;
  taxId: string | null;
  status: MerchantStatus;
  contactEmail: string | null;
  contactPhone: string | null;
  commissionPercent: number;
  absorbsInstallmentCost: boolean;
  settlementDays: number;
  categories: string[];
  productCount?: number;
  createdAt: string;
}

export interface Agreement {
  id: number;
  bankId: string;
  bankName: string;
  merchantId: string | null;
  merchantName: string | null;
  categoryId: string | null;
  maxCuotas: number;
  discountPercent: number;
  capAmount: number | null;
  description: string;
  priority: number;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
  /** "global" | "categoría" | "comercio" | "comercio + categoría" */
  alcance: string;
}

export interface Settlement {
  merchant_id: string;
  trade_name: string;
  ordenes: number;
  bruto: number;
  comision: number;
  costo_cuotas: number;
  a_pagar: number;
}

export interface Bank {
  id: string;
  name: string;
  logoColor: string;
  accentColor: string;
  textColor: string;
}
