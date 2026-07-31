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
