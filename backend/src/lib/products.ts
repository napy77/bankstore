import { randomBytes } from "node:crypto";
import { z } from "zod";
import type pg from "pg";
import { HttpError } from "../middleware/error.js";
import {
  LENGTH_UNITS, MASS_UNITS, IVA_RATES, toMillimeters, toGrams,
  type LengthUnit, type MassUnit,
} from "./units.js";

/**
 * Alta y actualización de productos, compartida por el panel del comercio y la
 * API de integración. Las dos hacen exactamente lo mismo; lo único que cambia
 * es de dónde sale el merchantId (del token o de la API key). Tenerlo una sola
 * vez evita que las reglas se separen entre un camino y el otro.
 */

/**
 * Un bulto. El comercio carga en la unidad que le resulta natural y acá se
 * convierte a milímetros y gramos, que es lo único que guarda la base.
 */
const packageSchema = z.object({
  height: z.coerce.number().positive(),
  width: z.coerce.number().positive(),
  length: z.coerce.number().positive(),
  lengthUnit: z.enum(LENGTH_UNITS).default("cm"),
  weight: z.coerce.number().positive(),
  massUnit: z.enum(MASS_UNITS).default("kg"),
});

export const productInputSchema = z.object({
  /** Código del comercio. Es la clave de sincronización: mismo SKU = mismo producto. */
  sku: z.string().min(1).max(60).trim(),
  name: z.string().min(2).max(160).trim(),
  description: z.string().max(2000).default(""),
  /** Precio FINAL al consumidor, con IVA incluido. El neto se deriva. */
  price: z.coerce.number().positive("El precio tiene que ser mayor a cero"),
  originalPrice: z.coerce.number().positive().nullable().default(null),
  // Se acepta la alícuota como fracción (0.21). El CHECK de la base repite la
  // validación; acá se hace igual para devolver un 400 explicando cuáles valen
  // en vez de un error de constraint.
  ivaRate: z.coerce
    .number()
    .refine((r) => (IVA_RATES as readonly number[]).includes(r),
      `La alícuota de IVA tiene que ser una de: ${IVA_RATES.join(", ")}`)
    .default(0.21),
  categoryId: z.string(),
  /** Segunda rama donde también se publica. Opcional. */
  secondCategoryId: z.string().nullable().default(null),
  /** Marca del catálogo global. Se manda el id, o el nombre y se resuelve. */
  brandId: z.coerce.number().int().nullable().default(null),
  brandName: z.string().max(80).trim().nullable().default(null),
  kind: z.enum(["physical", "service"]).default("physical"),
  stock: z.coerce.number().int().min(0).default(0),
  image: z.string().max(300).default(""),
  specs: z.array(z.string().max(200)).max(30).default([]),
  features: z.array(z.string().max(120)).max(15).default([]),
  active: z.boolean().default(true),
  /**
   * Bultos de despacho. Si no viene, no se toca lo que ya está cargado: el cron
   * de stock manda el producto sin dimensiones y no debería borrarlas.
   */
  packages: z.array(packageSchema).max(20).optional(),
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
    ivaRate: p.iva_rate === undefined ? undefined : Number(p.iva_rate),
    category: p.category_id,
    secondCategory: p.second_category_id ?? null,
    brandId: p.brand_id ?? null,
    brandName: p.brand_name ?? null,
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
    packages: p.packages ?? undefined,
  };
}

/**
 * Resuelve la marca. Acepta el id del catálogo o el nombre.
 *
 * Si el nombre no existe se da de alta marcada para revisión, en vez de
 * rechazar el producto: un comercio que sincroniza mil artículos por API no
 * puede quedar bloqueado porque falta una marca, y frenar el lote entero por
 * eso sería peor que sumar una entrada que después el admin depura.
 */
async function resolveBrand(
  client: pg.PoolClient,
  input: ProductInput
): Promise<number | null> {
  if (input.brandId !== null) {
    const { rows } = await client.query("SELECT id FROM brands WHERE id = $1", [input.brandId]);
    if (!rows[0]) throw new HttpError(400, `La marca ${input.brandId} no existe`);
    return input.brandId;
  }
  if (!input.brandName) return null;

  const slug = input.brandName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return null;

  const { rows } = await client.query(
    `INSERT INTO brands (slug, name, needs_review) VALUES ($1,$2,true)
     ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
     RETURNING id`,
    [slug, input.brandName]
  );
  return rows[0].id;
}

/** Reemplaza los bultos del producto. */
async function replacePackages(
  client: pg.PoolClient,
  productId: string,
  packages: ProductInput["packages"]
): Promise<void> {
  if (packages === undefined) return; // no vino: no se toca lo que hay
  await client.query("DELETE FROM product_packages WHERE product_id = $1", [productId]);
  let seq = 1;
  for (const pkg of packages) {
    await client.query(
      `INSERT INTO product_packages (product_id, seq, height_mm, width_mm, length_mm, weight_g)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        productId, seq++,
        toMillimeters(pkg.height, pkg.lengthUnit as LengthUnit),
        toMillimeters(pkg.width, pkg.lengthUnit as LengthUnit),
        toMillimeters(pkg.length, pkg.lengthUnit as LengthUnit),
        toGrams(pkg.weight, pkg.massUnit as MassUnit),
      ]
    );
  }
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

  const brandId = await resolveBrand(client, input);

  const { rows: existing } = await client.query(
    "SELECT id FROM products WHERE merchant_id = $1 AND sku = $2",
    [merchantId, input.sku]
  );

  const id = existing[0]?.id ?? newProductId();
  const { rows } = await client.query(
    `INSERT INTO products (id, merchant_id, sku, name, description, price, original_price,
                           iva_rate, category_id, second_category_id, brand_id, kind, stock,
                           image, specs, features, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, description = EXCLUDED.description, price = EXCLUDED.price,
       original_price = EXCLUDED.original_price, iva_rate = EXCLUDED.iva_rate,
       category_id = EXCLUDED.category_id, second_category_id = EXCLUDED.second_category_id,
       brand_id = EXCLUDED.brand_id, kind = EXCLUDED.kind, stock = EXCLUDED.stock,
       image = EXCLUDED.image, specs = EXCLUDED.specs, features = EXCLUDED.features,
       active = EXCLUDED.active, updated_at = now()
     RETURNING *`,
    [id, merchantId, input.sku, input.name, input.description, input.price, input.originalPrice,
     input.ivaRate, input.categoryId, input.secondCategoryId, brandId, input.kind, input.stock,
     input.image, JSON.stringify(input.specs), JSON.stringify(input.features), input.active]
  );

  await replacePackages(client, id, input.packages);

  // Se relee con el nombre de la marca resuelto: quien guarda desde el panel
  // espera ver "Liliana", no el id que le tocó.
  const { rows: completo } = await client.query(
    `SELECT p.*, b.name AS brand_name FROM products p
     LEFT JOIN brands b ON b.id = p.brand_id WHERE p.id = $1`,
    [id]
  );

  return { row: completo[0] ?? rows[0], created: !existing[0] };
}

/**
 * Traduce los errores que levanta la base a un 400 con mensaje útil.
 * Sin esto, publicar en una categoría no habilitada devuelve un 500 opaco.
 */
export function traducirErrorDeCategoria(err: unknown): unknown {
  const e = err as { code?: string; message?: string };
  if (e?.code === "23514" && /no tiene habilitada la categoría|segunda categoría/.test(e.message ?? "")) {
    return new HttpError(400, e.message!.replace(/^.*?ERROR:\s*/, ""));
  }
  return err;
}
