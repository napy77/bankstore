import { randomBytes } from "node:crypto";
import { z } from "zod";
import type pg from "pg";
import { HttpError } from "../middleware/error.js";

/**
 * Alta y actualización de productos, compartida por el panel del comercio y la
 * API de integración. Las dos hacen exactamente lo mismo; lo único que cambia
 * es de dónde sale el merchantId (del token o de la API key). Tenerlo una sola
 * vez evita que las reglas se separen entre un camino y el otro.
 */

export const productInputSchema = z.object({
  /** Código del comercio. Es la clave de sincronización: mismo SKU = mismo producto. */
  sku: z.string().min(1).max(60).trim(),
  name: z.string().min(2).max(160).trim(),
  description: z.string().max(2000).default(""),
  price: z.coerce.number().positive("El precio tiene que ser mayor a cero"),
  originalPrice: z.coerce.number().positive().nullable().default(null),
  categoryId: z.string(),
  kind: z.enum(["physical", "service"]).default("physical"),
  stock: z.coerce.number().int().min(0).default(0),
  image: z.string().max(300).default(""),
  specs: z.array(z.string().max(200)).max(30).default([]),
  features: z.array(z.string().max(120)).max(15).default([]),
  active: z.boolean().default(true),
});

export type ProductInput = z.infer<typeof productInputSchema>;

/** Id público. Se genera al alta y no cambia nunca, aunque cambie el SKU. */
export function newProductId(): string {
  return `p_${randomBytes(9).toString("base64url")}`;
}

export function serializeProduct(p: Record<string, any>) {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    price: p.price,
    originalPrice: p.original_price,
    category: p.category_id,
    kind: p.kind,
    stock: p.stock,
    image: p.image,
    specs: p.specs,
    features: p.features,
    active: p.active,
    merchantId: p.merchant_id,
    rating: p.rating,
    reviewsCount: p.reviews_count,
    updatedAt: p.updated_at,
  };
}

/**
 * Inserta o actualiza por (merchant_id, sku).
 *
 * El merchantId lo pone quien llama a partir de la credencial; nunca viene del
 * body. Es lo que impide que un comercio publique en el catálogo de otro.
 */
export async function upsertProduct(
  client: pg.PoolClient,
  merchantId: string,
  input: ProductInput
): Promise<{ row: Record<string, any>; created: boolean }> {
  if (input.originalPrice !== null && input.originalPrice < input.price) {
    throw new HttpError(400, `"${input.sku}": el precio de lista no puede ser menor al de venta`);
  }

  const { rows: existing } = await client.query(
    "SELECT id FROM products WHERE merchant_id = $1 AND sku = $2",
    [merchantId, input.sku]
  );

  const id = existing[0]?.id ?? newProductId();
  const { rows } = await client.query(
    `INSERT INTO products (id, merchant_id, sku, name, description, price, original_price,
                           category_id, kind, stock, image, specs, features, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, description = EXCLUDED.description, price = EXCLUDED.price,
       original_price = EXCLUDED.original_price, category_id = EXCLUDED.category_id,
       kind = EXCLUDED.kind, stock = EXCLUDED.stock, image = EXCLUDED.image,
       specs = EXCLUDED.specs, features = EXCLUDED.features, active = EXCLUDED.active,
       updated_at = now()
     RETURNING *`,
    [id, merchantId, input.sku, input.name, input.description, input.price, input.originalPrice,
     input.categoryId, input.kind, input.stock, input.image,
     JSON.stringify(input.specs), JSON.stringify(input.features), input.active]
  );
  return { row: rows[0], created: !existing[0] };
}

/**
 * Traduce el error del trigger de categoría a un 400 con mensaje útil.
 * Sin esto, publicar en una categoría no habilitada devuelve un 500 opaco.
 */
export function traducirErrorDeCategoria(err: unknown): unknown {
  const e = err as { code?: string; message?: string };
  if (e?.code === "23514" && e.message?.includes("no tiene habilitada la categoría")) {
    return new HttpError(400, e.message.replace(/^.*?ERROR:\s*/, ""));
  }
  return err;
}
