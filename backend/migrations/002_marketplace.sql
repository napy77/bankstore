-- Bankstore · De tienda única a marketplace multi-comercio
--
-- Qué cambia respecto de 001:
--   * Los productos dejan de ser del marketplace y pasan a ser de un comercio.
--   * Aparecen los usuarios de back-office (plataforma y comercio), separados
--     de los compradores.
--   * Las promos bancarias dejan de ser sólo (banco, categoría) y pasan a ser
--     acuerdos que pueden apuntar a un comercio, a una categoría, a las dos o
--     a ninguna.
--   * Una orden puede tener productos de varios comercios: el pago es uno solo
--     y por debajo se parte en una sub-orden por comercio.
--
-- Los 9 productos de la maqueta se reasignan a un comercio semilla para no
-- perder el catálogo que ya está cargado.

-- ── Comercios ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS merchants (
  id            TEXT PRIMARY KEY,          -- slug: 'electro-1', 'ferreteria-2'
  legal_name    TEXT NOT NULL,             -- razón social
  trade_name    TEXT NOT NULL,             -- nombre de fantasía, el que ve el comprador
  tax_id        TEXT,                      -- CUIT
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','active','suspended')),
  contact_email TEXT,
  contact_phone TEXT,

  -- Comisión que retiene el marketplace sobre cada venta, como fracción.
  commission_percent NUMERIC(5,4) NOT NULL DEFAULT 0
                  CHECK (commission_percent BETWEEN 0 AND 1),

  -- Quién se come el costo de las cuotas sin interés. En los acuerdos reales
  -- suele bancarlo el comercio (por eso acepta la promo: le trae ventas). Si
  -- es false, el costo lo absorbe el banco y al comercio se le liquida el
  -- total sin descuento.
  absorbs_installment_cost BOOLEAN NOT NULL DEFAULT true,

  -- A cuántos días de la venta se le liquida al comercio.
  settlement_days INTEGER NOT NULL DEFAULT 30 CHECK (settlement_days >= 0),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_merchants_status ON merchants (status);

-- Categorías habilitadas para cada comercio. Es lo que define el admin al dar
-- de alta: una ferretería no publica en 'turismo'.
CREATE TABLE IF NOT EXISTS merchant_categories (
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES product_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (merchant_id, category_id)
);

-- Las categorías pasan a poder anidarse: 'ferreteria' → 'herramientas'.
ALTER TABLE product_categories
  ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES product_categories(id),
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

-- ── Usuarios de back-office ──────────────────────────────────────────────────
-- Deliberadamente separados de `users` (los compradores). Son dos poblaciones
-- distintas —decenas contra miles— y sobre todo dos niveles de permiso: si
-- comparten tabla, un error de lógica en el alta de compradores puede terminar
-- creando un administrador. Los tokens también son distintos (ver el claim
-- `aud` en middleware/staff.ts): un token de comprador no abre /api/admin.
CREATE TABLE IF NOT EXISTS staff_users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL
                  CHECK (role IN ('platform_admin','merchant_admin','merchant_staff')),
  -- NULL sólo para platform_admin: es gente de la plataforma, no de un comercio.
  merchant_id   TEXT REFERENCES merchants(id) ON DELETE CASCADE,
  active        BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- La regla que sostiene todo el aislamiento: el rol y el comercio tienen que
  -- ser coherentes. Un platform_admin nunca cuelga de un comercio, y un
  -- usuario de comercio siempre tiene el suyo.
  CONSTRAINT staff_role_merchant_coherente CHECK (
    (role = 'platform_admin' AND merchant_id IS NULL) OR
    (role <> 'platform_admin' AND merchant_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_staff_merchant ON staff_users (merchant_id);

-- ── Claves de API de los comercios ───────────────────────────────────────────
-- El comercio integra su sistema para publicar catálogo y stock sin cargar a
-- mano. La clave se muestra UNA sola vez al crearla: acá va sólo el hash, así
-- que ni nosotros podemos recuperarla. El prefijo se guarda en claro para
-- poder identificar la clave en la lista y en los logs sin exponerla.
CREATE TABLE IF NOT EXISTS merchant_api_keys (
  id           BIGSERIAL PRIMARY KEY,
  merchant_id  TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,              -- "ERP de depósito", para saber cuál revocar
  key_prefix   TEXT NOT NULL UNIQUE,       -- 'bsk_a1b2c3d4'
  key_hash     TEXT NOT NULL,
  scopes       TEXT[] NOT NULL DEFAULT ARRAY['catalog:write','stock:write','orders:read'],
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT REFERENCES staff_users(id)
);
CREATE INDEX IF NOT EXISTS idx_apikeys_merchant ON merchant_api_keys (merchant_id)
  WHERE revoked_at IS NULL;

-- ── Comercio semilla para el catálogo que ya existe ──────────────────────────
-- Los 9 productos de la maqueta no tienen dueño. Se les asigna este comercio
-- para poder poner merchant_id NOT NULL sin perderlos.
INSERT INTO merchants (id, legal_name, trade_name, status, commission_percent)
VALUES ('bankstore-demo', 'Bankstore Demo S.A.', 'Bankstore', 'active', 0.08)
ON CONFLICT (id) DO NOTHING;

INSERT INTO merchant_categories (merchant_id, category_id)
SELECT 'bankstore-demo', id FROM product_categories
ON CONFLICT DO NOTHING;

-- ── Los productos pasan a ser de un comercio ─────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS merchant_id TEXT REFERENCES merchants(id) ON DELETE CASCADE,
  -- 'physical' se despacha; 'service' (hotel, spa, viaje) se entrega con una
  -- reserva. Por ahora los dos se venden como ítem con cupo: la disponibilidad
  -- por fecha llega en una migración posterior. La columna existe desde ahora
  -- para no tener que reclasificar el catálogo después.
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'physical'
    CHECK (kind IN ('physical','service')),
  -- Código interno del comercio. Es la clave con la que sincroniza por API:
  -- manda su propio SKU y nosotros resolvemos si es alta o actualización.
  ADD COLUMN IF NOT EXISTS sku TEXT;

UPDATE products SET merchant_id = 'bankstore-demo' WHERE merchant_id IS NULL;
UPDATE products SET sku = id WHERE sku IS NULL;

ALTER TABLE products ALTER COLUMN merchant_id SET NOT NULL;

-- Dos comercios pueden usar el mismo SKU; lo que no puede repetirse es el SKU
-- dentro de un mismo comercio.
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_merchant_sku
  ON products (merchant_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_merchant ON products (merchant_id) WHERE active;

-- Un producto sólo puede publicarse en una categoría habilitada para su
-- comercio. No se puede expresar como CHECK (mira otra tabla), así que va como
-- trigger: es la clase de regla que si no la fuerza la base, tarde o temprano
-- se cuela por algún endpoint.
CREATE OR REPLACE FUNCTION assert_categoria_habilitada() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM merchant_categories
    WHERE merchant_id = NEW.merchant_id AND category_id = NEW.category_id
  ) THEN
    RAISE EXCEPTION 'El comercio % no tiene habilitada la categoría %',
      NEW.merchant_id, NEW.category_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_producto_categoria_habilitada ON products;
CREATE TRIGGER trg_producto_categoria_habilitada
  BEFORE INSERT OR UPDATE OF merchant_id, category_id ON products
  FOR EACH ROW EXECUTE FUNCTION assert_categoria_habilitada();

-- ── Acuerdos banco ↔ comercio ────────────────────────────────────────────────
-- Reemplaza a bank_promos. La diferencia es que ahora un acuerdo puede apuntar
-- a un comercio concreto, que es como se negocian de verdad ("12 cuotas en
-- Electro 1"), sin perder la promo general por categoría.
--
-- Cuál gana cuando hay varios: el más específico. Ver lib/agreements.ts.
CREATE TABLE IF NOT EXISTS bank_agreements (
  id               BIGSERIAL PRIMARY KEY,
  bank_id          TEXT NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  -- NULL = vale para todos los comercios
  merchant_id      TEXT REFERENCES merchants(id) ON DELETE CASCADE,
  -- NULL = vale para todas las categorías
  category_id      TEXT REFERENCES product_categories(id) ON DELETE CASCADE,

  max_cuotas       INTEGER NOT NULL CHECK (max_cuotas >= 1),
  discount_percent NUMERIC(5,4) NOT NULL DEFAULT 0
                     CHECK (discount_percent BETWEEN 0 AND 1),
  cap_amount       NUMERIC(14,2) CHECK (cap_amount IS NULL OR cap_amount >= 0),
  description      TEXT NOT NULL DEFAULT '',

  -- Desempate entre acuerdos de la misma especificidad. Mayor gana.
  priority         INTEGER NOT NULL DEFAULT 0,
  valid_from       DATE,
  valid_to         DATE,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT vigencia_coherente CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
-- No tiene sentido tener dos acuerdos idénticos en alcance. NULL no compara
-- igual en un UNIQUE normal, así que se usa NULLS NOT DISTINCT (PG 15+).
CREATE UNIQUE INDEX IF NOT EXISTS idx_agreement_alcance
  ON bank_agreements (bank_id, merchant_id, category_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_agreements_lookup
  ON bank_agreements (bank_id) WHERE active;

-- Las promos que ya existían pasan a ser acuerdos globales por categoría:
-- mismo alcance que tenían (todos los comercios, una categoría).
INSERT INTO bank_agreements (bank_id, merchant_id, category_id, max_cuotas,
                             discount_percent, cap_amount, description, valid_from, valid_to)
SELECT bank_id, NULL, category_id, max_cuotas, discount_percent, cap_amount,
       description, valid_from, valid_to
FROM bank_promos
ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS bank_promos;

-- ── Sub-órdenes por comercio ─────────────────────────────────────────────────
-- El comprador paga una vez, con una tarjeta y un plan de cuotas. Por debajo
-- la orden se parte: cada comercio ve, despacha y cobra lo suyo.
CREATE TABLE IF NOT EXISTS merchant_orders (
  id                BIGSERIAL PRIMARY KEY,
  order_id          BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  merchant_id       TEXT NOT NULL REFERENCES merchants(id),
  -- Numeración propia de cada comercio, que es la que usa para su gestión.
  merchant_order_number BIGINT NOT NULL,

  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','accepted','shipped','delivered','cancelled')),

  -- Lo que se vendió de este comercio, a precio de venta.
  subtotal          NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
  -- Comisión del marketplace, congelada al momento de la venta: si mañana se
  -- renegocia el porcentaje, las liquidaciones viejas no cambian.
  commission_percent NUMERIC(5,4) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Parte del costo financiero de las cuotas que le toca a este comercio,
  -- prorrateada por su participación en la orden. 0 si lo banca el banco.
  installment_cost  NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Lo que efectivamente se le paga: subtotal - comisión - costo financiero.
  payout_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
  settlement_date   DATE,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, merchant_id),
  UNIQUE (merchant_id, merchant_order_number)
);
CREATE INDEX IF NOT EXISTS idx_merchant_orders_merchant
  ON merchant_orders (merchant_id, created_at DESC);

-- Cada ítem pasa a colgar de la sub-orden de su comercio.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS merchant_order_id BIGINT REFERENCES merchant_orders(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_order_items_merchant_order
  ON order_items (merchant_order_id);

-- Guardar en la orden qué acuerdo se aplicó permite reconstruir después por
-- qué se cobró lo que se cobró, aunque el acuerdo haya cambiado o vencido.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS merchant_count INTEGER NOT NULL DEFAULT 1;

-- El log de auditoría también lo escriben usuarios de back-office.
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS staff_user_id BIGINT REFERENCES staff_users(id),
  ADD COLUMN IF NOT EXISTS merchant_id TEXT REFERENCES merchants(id);
