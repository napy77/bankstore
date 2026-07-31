/**
 * Marcas y árbol de categorías.
 *
 *   npm run seed:catalogo
 *
 * Las marcas salen de backend/seed-data/marcas.json, relevado del back-office
 * de Avenida (una cuenta propia del proyecto). Son nombres de fabricantes:
 * datos de hecho, no curaduría. Las entradas que parecen variantes de producto
 * ("A.BANDERAS BLUE SEDUCTION W") entran igual pero marcadas con needs_review,
 * porque descartarlas a ciegas también perdería marcas legítimas
 * ("BAGELS & BAGELS" lo es).
 *
 * De las categorías sólo se pudo relevar el primer nivel y la rama del producto
 * que estaba abierto: el resto del árbol se carga por AJAX nodo por nodo y
 * recorrerlo entero habría sido cientos de requests. Lo que falta se completa
 * desde el panel de administración.
 *
 * Idempotente. No toca las categorías que ya tienen productos.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool, runMigrations } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface MarcaSeed {
  slug: string;
  name: string;
  needsReview: boolean;
}

/**
 * Nivel 1. Se conservan las que ya existían (tienen productos colgando) y se
 * suman las que faltaban.
 */
const RAICES: [string, string, number][] = [
  ["tecnologia", "Tecnología", 10],
  ["electrohogar", "Electrohogar", 20],
  ["ferreteria", "Ferretería", 30],
  ["hogar-y-deco", "Hogar y Deco", 40],
  ["moda", "Moda y Accesorios", 50],
  ["deportes", "Deportes y Recreación", 60],
  ["turismo", "Turismo", 70],
  ["bienestar", "Bienestar y Salud", 80],
  ["almacen-y-bebidas", "Almacén y Bebidas", 90],
  ["infantiles", "Infantiles", 100],
  ["mascotas", "Mascotas", 110],
  ["autos-y-motos", "Accesorios de Autos y Motos", 120],
  ["instrumentos-musicales", "Instrumentos Musicales", 130],
  ["servicio-tecnico", "Servicio Técnico", 140],
];

/** Niveles 2 y 3: [id, nombre, padre, orden]. */
const RAMAS: [string, string, string, number][] = [
  // Electrohogar — la rama que se pudo relevar completa
  ["climatizacion", "Climatización", "electrohogar", 10],
  ["aires-acondicionados", "Aires Acondicionados", "climatizacion", 10],
  ["ventiladores", "Ventiladores", "climatizacion", 20],
  ["climatizadores", "Climatizadores", "climatizacion", 30],
  ["refrigeracion", "Refrigeración", "electrohogar", 20],
  ["lavado", "Lavado", "electrohogar", 30],
  ["hornos-y-cocinas", "Hornos y Cocinas", "electrohogar", 40],
  ["pequenos-electros", "Pequeños Electros", "electrohogar", 50],
  ["termotanques", "Termotanques y Calefones", "electrohogar", 60],

  // Ferretería — las que ya usan los comercios sembrados
  ["herramientas", "Herramientas", "ferreteria", 10],
  ["construccion", "Construcción", "ferreteria", 20],

  // Turismo
  ["hoteleria", "Hotelería", "turismo", 10],
  ["paquetes", "Paquetes y Excursiones", "turismo", 20],
];

async function seed() {
  await runMigrations();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── Categorías ───────────────────────────────────────────────────────────
    for (const [id, name, orden] of RAICES) {
      await client.query(
        `INSERT INTO product_categories (id, name, parent_id, sort_order)
         VALUES ($1,$2,NULL,$3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order`,
        [id, name, orden]
      );
    }
    // Las ramas van después de las raíces por la FK a parent_id.
    for (const [id, name, padre, orden] of RAMAS) {
      await client.query(
        `INSERT INTO product_categories (id, name, parent_id, sort_order)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, parent_id = EXCLUDED.parent_id, sort_order = EXCLUDED.sort_order`,
        [id, name, padre, orden]
      );
    }
    console.log(`[seed] ${RAICES.length} categorías raíz y ${RAMAS.length} subcategorías`);

    // ── Marcas ───────────────────────────────────────────────────────────────
    const archivo = path.resolve(__dirname, "..", "seed-data", "marcas.json");
    const marcas: MarcaSeed[] = JSON.parse(readFileSync(archivo, "utf8"));

    // De a lotes: 6.263 inserts sueltos son 6.263 viajes de ida y vuelta.
    // Con UNNEST entra todo en unas pocas consultas.
    const LOTE = 500;
    for (let i = 0; i < marcas.length; i += LOTE) {
      const lote = marcas.slice(i, i + LOTE);
      await client.query(
        `INSERT INTO brands (slug, name, needs_review)
         SELECT * FROM UNNEST($1::text[], $2::text[], $3::boolean[])
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name`,
        [lote.map((m) => m.slug), lote.map((m) => m.name), lote.map((m) => m.needsReview)]
      );
    }
    const revisar = marcas.filter((m) => m.needsReview).length;
    console.log(`[seed] ${marcas.length} marcas (${revisar} para revisar)`);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
