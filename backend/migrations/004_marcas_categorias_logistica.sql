-- Bankstore · Marcas, árbol de categorías, logística e impuestos
--
-- Lo que faltaba para que un comercio real pueda cargar su catálogo:
-- marca, categoría de verdad (no una lista plana), dimensiones para cotizar
-- envío, y el IVA que hay que mostrarle al comprador.

-- ── Marcas ───────────────────────────────────────────────────────────────────
-- Catálogo global, compartido entre comercios: si cada uno cargara su lista,
-- "Liliana", "LILIANA" y "Liliana S.A." serían tres marcas distintas y filtrar
-- por marca no serviría para nada.
CREATE TABLE IF NOT EXISTS brands (
  id           BIGSERIAL PRIMARY KEY,
  -- Nombre normalizado (minúsculas, sin acentos, con guiones). Es la clave
  -- real: impide que entren dos veces la misma marca escrita distinto.
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT true,
  -- Marcado en la importación para las entradas que probablemente no sean
  -- marcas sino variantes de producto ("A.BANDERAS BLUE SEDUCTION W"). No se
  -- borran: algunas son legítimas y borrarlas a ciegas perdería datos buenos.
  needs_review BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_brands_nombre ON brands (name) WHERE active;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS brand_id BIGINT REFERENCES brands(id);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products (brand_id) WHERE active;

-- ── Categorías ───────────────────────────────────────────────────────────────
-- `parent_id` ya existía desde 002 pero nadie lo usaba en profundidad. Se
-- agrega el orden de presentación y una segunda categoría por producto: un
-- ventilador puede vivir en "Electro Hogar > Climatización" y además en
-- "Oportunidades Únicas".
ALTER TABLE product_categories
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS second_category_id TEXT REFERENCES product_categories(id);
CREATE INDEX IF NOT EXISTS idx_products_second_cat ON products (second_category_id)
  WHERE second_category_id IS NOT NULL AND active;

-- Filtrar por "Electro Hogar" tiene que traer también los ventiladores, que
-- cuelgan dos niveles más abajo. Sin esto, cada consulta tendría que armar el
-- recorrido a mano y alguna se olvidaría.
CREATE OR REPLACE FUNCTION categorias_descendientes(raiz TEXT)
RETURNS TABLE (id TEXT) AS $$
  WITH RECURSIVE arbol AS (
    SELECT c.id FROM product_categories c WHERE c.id = raiz
    UNION ALL
    SELECT h.id FROM product_categories h JOIN arbol a ON h.parent_id = a.id
  )
  SELECT arbol.id FROM arbol;
$$ LANGUAGE sql STABLE;

-- El camino completo hasta la raíz, para el "Electro Hogar › Climatización ›
-- Ventiladores" que se muestra en la ficha del producto.
CREATE OR REPLACE FUNCTION categoria_camino(hoja TEXT)
RETURNS TEXT[] AS $$
  WITH RECURSIVE subida AS (
    SELECT c.id, c.parent_id, 0 AS nivel
    FROM product_categories c WHERE c.id = hoja
    UNION ALL
    SELECT p.id, p.parent_id, s.nivel + 1
    FROM product_categories p JOIN subida s ON p.id = s.parent_id
  )
  SELECT ARRAY(SELECT id FROM subida ORDER BY nivel DESC);
$$ LANGUAGE sql STABLE;

-- ── Impuestos ────────────────────────────────────────────────────────────────
-- Se guarda el PRECIO FINAL (lo que paga el comprador) más la alícuota, y el
-- neto se deriva: neto = precio / (1 + alícuota).
--
-- La alternativa —guardar precio con y sin impuestos -- deja dos números que
-- pueden desincronizarse: alcanza con que alguien actualice uno solo.
-- Con precio final + tasa hay una sola fuente de verdad, y es además el número
-- que la ley obliga a mostrar.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS iva_rate NUMERIC(5,4) NOT NULL DEFAULT 0.21
    CHECK (iva_rate IN (0, 0.105, 0.21, 0.27));

COMMENT ON COLUMN products.price IS
  'Precio final al consumidor, IVA incluido. El neto se deriva con iva_rate.';

-- ── Logística ────────────────────────────────────────────────────────────────
-- Los bultos van en su propia tabla y no como columnas del producto: un juego
-- de comedor se despacha en tres cajas de medidas distintas, y el transportista
-- cotiza por bulto. Con alto/ancho/largo en el producto eso no se puede
-- representar.
--
-- Todo en unidad canónica —milímetros y gramos, enteros— aunque el comercio
-- cargue en pulgadas o libras. Guardar el valor junto a su unidad obliga a
-- convertir en cada consumidor (cotizador, packing list, reportes) y basta que
-- uno se olvide para despachar 10 libras creyendo que son 10 kilos. Enteros
-- porque no hay milímetros fraccionarios y así no se acumula error.
CREATE TABLE IF NOT EXISTS product_packages (
  id          BIGSERIAL PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- 1, 2, 3… El orden importa para el remito ("bulto 2 de 3").
  seq         INTEGER NOT NULL DEFAULT 1 CHECK (seq >= 1),

  height_mm   INTEGER NOT NULL CHECK (height_mm > 0),
  width_mm    INTEGER NOT NULL CHECK (width_mm  > 0),
  length_mm   INTEGER NOT NULL CHECK (length_mm > 0),
  weight_g    INTEGER NOT NULL CHECK (weight_g  > 0),

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_packages_product ON product_packages (product_id);

-- Peso volumétrico: el transportista cobra por el mayor entre el peso real y
-- el que ocupa. El divisor 5000 (cm³/kg) es el estándar de plaza; queda como
-- parámetro para poder cambiarlo si un operador usa otro.
CREATE OR REPLACE FUNCTION peso_volumetrico_g(
  alto_mm INTEGER, ancho_mm INTEGER, largo_mm INTEGER, divisor INTEGER DEFAULT 5000
) RETURNS INTEGER AS $$
  -- mm³ → cm³ es dividir por 1000; después el divisor da kg, y ×1000 da gramos.
  SELECT CEIL((alto_mm::numeric * ancho_mm * largo_mm) / 1000 / divisor * 1000)::integer;
$$ LANGUAGE sql IMMUTABLE;

-- Lo que necesita el cotizador de envío de un producto, ya sumado.
CREATE OR REPLACE VIEW product_logistics AS
SELECT p.id                                   AS product_id,
       p.merchant_id,
       COUNT(pk.id)::int                      AS bultos,
       COALESCE(SUM(pk.weight_g), 0)::int     AS peso_real_g,
       COALESCE(SUM(peso_volumetrico_g(pk.height_mm, pk.width_mm, pk.length_mm)), 0)::int
                                              AS peso_volumetrico_g,
       GREATEST(
         COALESCE(SUM(pk.weight_g), 0),
         COALESCE(SUM(peso_volumetrico_g(pk.height_mm, pk.width_mm, pk.length_mm)), 0)
       )::int                                 AS peso_facturable_g
FROM products p
LEFT JOIN product_packages pk ON pk.product_id = p.id
GROUP BY p.id;
