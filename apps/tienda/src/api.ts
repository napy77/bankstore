/**
 * Puente entre la API y los tipos que ya usan los componentes.
 *
 * Los componentes de la tienda están diseñados alrededor de `Product` y `Bank`
 * (ver types.ts) y funcionan bien: no tiene sentido rediseñarlos para que
 * hablen el dialecto del backend. Lo que cambia es de dónde salen los datos,
 * no su forma, así que la traducción vive acá y en un solo lugar.
 *
 * La diferencia principal: el backend maneja los porcentajes como fracción
 * (0.15) porque es la unidad en la que hace las cuentas, y el frontend como
 * entero (15) porque es la que muestra. La conversión pasa acá.
 */
import type { Bank, Product } from './types';

// En producción Nginx sirve la tienda y proxea /api en el mismo origen, así
// que la base es relativa. En desarrollo el proxy de Vite hace lo mismo.
const BASE = ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL) ?? '';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal });
  const tipo = res.headers.get('content-type') ?? '';
  if (!tipo.includes('application/json')) {
    // Un 502 de Nginx o el backend caído devuelven HTML. Sin este guard el
    // error que ve el usuario es "Unexpected token < in JSON".
    throw new ApiError(res.status, `El servidor respondió ${res.status}`);
  }
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Error ${res.status}`);
  return data as T;
}

// ── Lo que devuelve el backend ───────────────────────────────────────────────

interface ApiBenefit {
  bankId: string;
  bankName: string;
  maxCuotas: number;
  /** Fracción: 0.15 = 15%. */
  reintegroPercent: number;
  capAmount: number | null;
  description: string;
  source: 'product' | 'agreement' | 'none';
}

interface ApiProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  originalPrice: number | null;
  category: string;
  kind: 'physical' | 'service';
  merchant: { id: string; name: string };
  rating: number;
  reviewsCount: number;
  image: string;
  stock: number;
  specs: string[];
  features: string[];
  benefits?: ApiBenefit[];
}

interface ApiBank {
  id: string;
  name: string;
  logoColor: string;
  accentColor: string;
  textColor: string;
  promos: {
    category: string | null;
    merchantId: string | null;
    maxCuotas: number;
    discountPercent: number;
    capAmount: number | null;
    description: string;
  }[];
}

// ── Traducción ───────────────────────────────────────────────────────────────

const pct = (fraccion: number) => Math.round(fraccion * 100);

function aProducto(p: ApiProduct): Product {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price,
    originalPrice: p.originalPrice ?? undefined,
    // El backend acepta categorías nuevas (ferretería, hotelería) que el tipo
    // del prototipo no enumera. Se respeta lo que venga.
    category: p.category as Product['category'],
    rating: Number(p.rating),
    reviewsCount: p.reviewsCount,
    image: p.image,
    stock: p.stock,
    specs: p.specs ?? [],
    features: p.features ?? [],
    // El servidor ya resolvió qué acuerdo gana para cada banco; acá sólo se
    // pasa a la forma que espera la card.
    bankOffers: (p.benefits ?? []).map((b) => ({
      bankId: b.bankId,
      maxCuotas: b.maxCuotas,
      discountPercent: pct(b.reintegroPercent),
    })),
  };
}

function aBanco(b: ApiBank): Bank {
  return {
    id: b.id,
    name: b.name,
    logoColor: b.logoColor,
    accentColor: b.accentColor,
    textColor: b.textColor,
    promos: b.promos
      // Las promos sin categoría (acuerdos globales o por comercio) no tienen
      // dónde mostrarse en la vidriera, que agrupa por categoría. El beneficio
      // igual se aplica: llega por `bankOffers` de cada producto.
      .filter((p) => p.category !== null)
      .map((p) => ({
        category: p.category!,
        maxCuotas: p.maxCuotas,
        discountPercent: pct(p.discountPercent),
        capAmount: p.capAmount ?? undefined,
        description: p.description,
      })),
  };
}

// ── Endpoints ────────────────────────────────────────────────────────────────

export interface CatalogQuery {
  category?: string;
  search?: string;
  sort?: 'relevance' | 'price_asc' | 'price_desc' | 'discount' | 'cuotas';
}

export async function fetchProducts(q: CatalogQuery, signal?: AbortSignal): Promise<Product[]> {
  const params = new URLSearchParams();
  if (q.category && q.category !== 'all') params.set('category', q.category);
  if (q.search) params.set('search', q.search);
  if (q.sort) params.set('sort', q.sort);
  params.set('limit', '100');
  const data = await get<{ items: ApiProduct[] }>(`/api/catalog/products?${params}`, signal);
  return data.items.map(aProducto);
}

export async function fetchBanks(signal?: AbortSignal): Promise<Bank[]> {
  return (await get<ApiBank[]>('/api/catalog/banks', signal)).map(aBanco);
}

export interface Category {
  id: string;
  name: string;
  product_count: number;
}

export async function fetchCategories(signal?: AbortSignal): Promise<Category[]> {
  const rows = await get<Category[]>('/api/catalog/categories', signal);
  // Sin productos publicados no hay nada que filtrar: la categoría sólo
  // ensuciaría la barra.
  return rows.filter((c) => c.product_count > 0);
}

// ── Simulador ────────────────────────────────────────────────────────────────

export interface Simulation {
  benefit: { maxCuotas: number; reintegroPercent: number; capAmount: number | null; description: string };
  options: number[];
  quote: {
    installments: number;
    interestFree: boolean;
    financedAmount: number;
    installmentAmount: number;
    totalAmount: number;
    interestAmount: number;
    vatAmount: number;
    tna: number;
    tea: number;
    cft: number;
  };
  reintegro: { amount: number; percent: number; capped: boolean; capAmount: number | null };
  netCost: number;
}

/**
 * Cuotas, CFT y reintegro calculados por el servidor.
 *
 * Es el mismo cálculo que después usa el checkout, así que el número que ve el
 * cliente es el que paga. Antes esto se hacía en el navegador con fórmulas
 * inventadas (`tea = tna * 1.25`), que no coincidían con nada.
 */
export async function simulate(
  productId: string,
  bankId: string,
  installments?: number,
  quantity = 1,
  signal?: AbortSignal
): Promise<Simulation> {
  const res = await fetch(`${BASE}/api/catalog/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, bankId, installments, quantity }),
    signal,
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'No pude simular las cuotas');
  return data as Simulation;
}

// ── Carrito ──────────────────────────────────────────────────────────────────

export interface CartSimulation {
  items: {
    productId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    unitPriceNet: number;
    ivaRate: number;
    lineTotal: number;
    lineNet: number;
    lineIva: number;
    merchant: { id: string; name: string };
  }[];
  maxInterestFree: number;
  options: number[];
  quote: Simulation['quote'];
  taxes: { net: number; iva: number; ivaInteres: number };
  reintegro: number;
}

/**
 * El carrito entero calculado por el servidor: cuotas, IVA discriminado y
 * reintegro. Es la misma cuenta que hace el checkout, así que lo que se le
 * muestra al comprador antes de pagar es exactamente lo que va a pagar.
 *
 * El desglose de impuestos no es un adorno: la transparencia fiscal al
 * consumidor obliga a informarlo en el momento de la venta, no sólo en el
 * comprobante posterior.
 */
export async function simulateCart(
  items: { productId: string; quantity: number }[],
  bankId: string,
  installments?: number,
  signal?: AbortSignal
): Promise<CartSimulation> {
  const res = await fetch(`${BASE}/api/catalog/simulate-cart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, bankId, installments }),
    signal,
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'No pude calcular el carrito');
  return data as CartSimulation;
}

// ── Sesión del comprador ─────────────────────────────────────────────────────

/**
 * El token va en localStorage con una clave propia del ámbito comprador. Los
 * paneles de back-office usan otra ('bankstore.token.staff'): son sesiones
 * distintas y no tienen que pisarse si alguien abre las dos en el mismo
 * navegador.
 */
const TOKEN_KEY = 'bankstore.token.customer';

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch { /* Safari en privado: la sesión dura lo que la pestaña */ }
}

export interface Customer {
  id: number;
  email: string;
  name: string;
}

async function authed<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    // Vencido o revocado: se limpia para que la app no quede reintentando.
    setToken(null);
    throw new ApiError(401, 'Tu sesión expiró. Volvé a entrar.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Error ${res.status}`);
  return data as T;
}

export async function login(email: string, password: string): Promise<Customer> {
  const r = await authed<{ token: string; user: Customer }>('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password }),
  });
  setToken(r.token);
  return r.user;
}

export async function register(name: string, email: string, password: string): Promise<Customer> {
  const r = await authed<{ token: string; user: Customer }>('/api/auth/register', {
    method: 'POST', body: JSON.stringify({ name, email, password }),
  });
  setToken(r.token);
  return r.user;
}

/** Revalida el token guardado. No alcanza con que exista: puede haber vencido. */
export async function me(): Promise<Customer> {
  return authed<Customer>('/api/auth/me');
}

export function logout(): void {
  setToken(null);
}

// ── Billetera ────────────────────────────────────────────────────────────────

export interface ApiCard {
  id: number;
  bankId: string;
  bankName: string;
  holderName: string;
  cardNumber: string;
  last4: string;
  brand: 'visa' | 'mastercard' | 'amex' | 'cabal';
  tier: 'black' | 'signature' | 'platinum' | 'gold' | 'classic';
  expiryDate: string;
  limit: number;
  availableLimit: number;
  colorTheme: string;
}

export async function fetchCards(): Promise<ApiCard[]> {
  return authed<ApiCard[]>('/api/cards');
}

export interface NuevaTarjeta {
  cardNumber: string;
  holderName: string;
  expiryMonth: number;
  expiryYear: number;
  bankId: string;
  displayName: string;
  tier: string;
  creditLimit: number;
  colorTheme: string;
}

/**
 * Vincula una tarjeta.
 *
 * El número completo se manda una sola vez: el servidor lo valida con Luhn,
 * deduce la marca, guarda los últimos 4 y descarta el resto. Nunca queda el
 * PAN completo en la base ni vuelve en ninguna respuesta.
 */
export async function addCard(t: NuevaTarjeta): Promise<ApiCard> {
  return authed<ApiCard>('/api/cards', { method: 'POST', body: JSON.stringify(t) });
}

export async function deleteCard(id: number): Promise<void> {
  await authed<void>(`/api/cards/${id}`, { method: 'DELETE' });
}

// ── Órdenes ──────────────────────────────────────────────────────────────────

export interface ApiOrder {
  id: number;
  orderNumber: number;
  date: string;
  status: string;
  merchants: {
    merchantId: string;
    merchantName: string;
    merchantOrderNumber: number;
    status: string;
    subtotal: number;
    netSubtotal: number;
    ivaSubtotal: number;
    items: { productId: string; productName: string; quantity: number; price: number;
             ivaRate: number; unitPriceNet: number; ivaAmount: number }[];
  }[];
  items: { productId: string; productName: string; quantity: number; price: number }[];
  cardUsed: { bankName: string; brand: string; cardNumber: string };
  installments: number;
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  interestAmount: number;
  installmentPrice: number;
  reintegroAmount: number;
  taxes: { net: number; iva: number; ivaInteres: number };
  tna: number;
  tea: number;
  cft: number;
  duplicated?: boolean;
}

/**
 * Confirma la compra.
 *
 * Sólo va QUÉ se compra: el servidor recalcula precio, IVA, interés, cuota y
 * reintegro contra la base. Nada de lo que mande el navegador afecta el monto.
 *
 * La clave de idempotencia evita la orden duplicada por doble click o por un
 * reintento de red: la segunda vez devuelve la orden que ya existe.
 */
export async function createOrder(
  items: { productId: string; quantity: number }[],
  cardId: number,
  installments: number,
  idempotencyKey: string
): Promise<ApiOrder> {
  return authed<ApiOrder>('/api/orders', {
    method: 'POST',
    body: JSON.stringify({ items, cardId, installments, idempotencyKey }),
  });
}

export async function fetchOrders(): Promise<OrderSummary[]> {
  return authed<OrderSummary[]>('/api/orders');
}

/** Una compra del historial, como la devuelve el listado. */
export interface OrderSummary {
  id: number;
  order_number: number;
  created_at: string;
  total_amount: number;
  installments: number;
  installment_amount: number;
  reintegro_amount: number;
  bank_name: string;
  card_brand: string;
  card_last4: string;
  merchant_count: number;
  item_count: number;
}

/**
 * El comprobante completo, con el desglose de impuestos y el corte por
 * comercio. El listado no los trae para no arrastrar todo el detalle de cada
 * compra en la pantalla de historial.
 */
export async function fetchOrder(id: number): Promise<ApiOrder> {
  return authed<ApiOrder>(`/api/orders/${id}`);
}
