-- Bankstore · Schema inicial
--
-- Convenciones:
--  * Los ids públicos son TEXT con prefijo ('galicia', 'prod-1') porque el
--    frontend del prototipo ya los usa así y son estables entre entornos.
--    Las tablas transaccionales sí usan BIGSERIAL.
--  * Toda la plata es NUMERIC(14,2). Nunca float: 0.1 + 0.2 en binario no da
--    0.3 y un centavo de diferencia en una cuota se ve en el resumen.
--  * Los porcentajes se guardan como fracción (0.15 = 15%), no como 15. Es la
--    unidad en la que se hacen las cuentas, así evitamos dividir por 100 en
--    quince lugares distintos y olvidarnos en uno.

-- ── Bancos y beneficios ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS banks (
  id           TEXT PRIMARY KEY,           -- 'galicia', 'bna', ...
  name         TEXT NOT NULL,
  -- Clases de Tailwind del prototipo. Viven acá para poder dar de alta un
  -- banco sin recompilar el frontend.
  logo_color   TEXT NOT NULL DEFAULT '',
  accent_color TEXT NOT NULL DEFAULT '',
  text_color   TEXT NOT NULL DEFAULT '',
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_categories (
  id    TEXT PRIMARY KEY,                  -- 'tecnologia', 'electrohogar', ...
  name  TEXT NOT NULL
);

-- Promo general del banco para una categoría. Es el piso de beneficio: si el
-- producto no tiene una oferta propia, se aplica esta.
CREATE TABLE IF NOT EXISTS bank_promos (
  id                BIGSERIAL PRIMARY KEY,
  bank_id           TEXT NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  category_id       TEXT NOT NULL REFERENCES product_categories(id),
  max_cuotas        INTEGER NOT NULL CHECK (max_cuotas >= 1),
  discount_percent  NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 1),
  -- Tope de reintegro por cuenta y por período. NULL = sin tope.
  cap_amount        NUMERIC(14,2) CHECK (cap_amount IS NULL OR cap_amount >= 0),
  description       TEXT NOT NULL DEFAULT '',
  -- Vigencia: una promo vencida no se aplica ni se muestra.
  valid_from        DATE,
  valid_to          DATE,
  UNIQUE (bank_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_bank_promos_lookup ON bank_promos (bank_id, category_id);

-- ── Catálogo ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id             TEXT PRIMARY KEY,         -- 'prod-1'
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  price          NUMERIC(14,2) NOT NULL CHECK (price > 0),
  original_price NUMERIC(14,2) CHECK (original_price IS NULL OR original_price >= price),
  category_id    TEXT NOT NULL REFERENCES product_categories(id),
  rating         NUMERIC(2,1) NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  reviews_count  INTEGER NOT NULL DEFAULT 0,
  -- Clases de Tailwind que dibujan el "hero" del producto en la card.
  image          TEXT NOT NULL DEFAULT '',
  stock          INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  specs          JSONB NOT NULL DEFAULT '[]'::jsonb,
  features       JSONB NOT NULL DEFAULT '[]'::jsonb,
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_products_search
  ON products USING gin (to_tsvector('spanish', name || ' ' || description));

-- Oferta puntual de un banco para un producto. Pisa a la promo de categoría.
CREATE TABLE IF NOT EXISTS product_bank_offers (
  id                       BIGSERIAL PRIMARY KEY,
  product_id               TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  bank_id                  TEXT NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  max_cuotas               INTEGER NOT NULL CHECK (max_cuotas >= 1),
  discount_percent         NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 1),
  extra_reintegro_percent  NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (extra_reintegro_percent BETWEEN 0 AND 1),
  UNIQUE (product_id, bank_id)
);
CREATE INDEX IF NOT EXISTS idx_offers_product ON product_bank_offers (product_id);

-- ── Usuarios y billetera ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tarjetas de la billetera.
--
-- IMPORTANTE: acá NO se guarda el número completo de la tarjeta (PAN), ni el
-- CVV, ni la banda. Solo los últimos 4 dígitos, que es lo que se muestra.
-- Guardar el PAN metería a este proyecto en el alcance de PCI-DSS (cifrado en
-- reposo, rotación de claves, auditoría anual) sin ninguna necesidad: para
-- cobrar de verdad hay que integrar una pasarela y guardar SU token, que es
-- para lo que está la columna gateway_token.
CREATE TABLE IF NOT EXISTS cards (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_id       TEXT NOT NULL REFERENCES banks(id),
  -- Nombre comercial del producto bancario: "Galicia Eminent", "Nación Black".
  display_name  TEXT NOT NULL,
  holder_name   TEXT NOT NULL,
  last4         TEXT NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  brand         TEXT NOT NULL CHECK (brand IN ('visa','mastercard','amex','cabal')),
  tier          TEXT NOT NULL CHECK (tier IN ('black','signature','platinum','gold','classic')),
  expiry_month  INTEGER NOT NULL CHECK (expiry_month BETWEEN 1 AND 12),
  expiry_year   INTEGER NOT NULL CHECK (expiry_year BETWEEN 2000 AND 2100),
  credit_limit  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  -- Lo que queda disponible hoy. Se descuenta al confirmar una compra.
  available_limit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (available_limit >= 0),
  color_theme   TEXT NOT NULL DEFAULT 'navy',
  -- Token de la pasarela de pago. Vacío mientras no haya cobro real.
  gateway_token TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, bank_id, last4, brand)
);
CREATE INDEX IF NOT EXISTS idx_cards_user ON cards (user_id);

-- ── Órdenes ──────────────────────────────────────────────────────────────────
-- Todos los montos los calcula el servidor en el checkout. Nunca se confía en
-- lo que manda el cliente: el precio, el descuento y la cuota se recalculan
-- contra la base antes de escribir nada.
CREATE TABLE IF NOT EXISTS orders (
  id               BIGSERIAL PRIMARY KEY,
  order_number     BIGINT NOT NULL UNIQUE,
  user_id          BIGINT NOT NULL REFERENCES users(id),
  card_id          BIGINT NOT NULL REFERENCES cards(id),
  status           TEXT NOT NULL DEFAULT 'confirmed'
                     CHECK (status IN ('confirmed','cancelled')),

  -- Foto del banco al momento de la compra: si mañana cambia el nombre del
  -- banco o se da de baja la tarjeta, el comprobante viejo tiene que seguir
  -- diciendo lo que decía.
  bank_id          TEXT NOT NULL REFERENCES banks(id),
  bank_name        TEXT NOT NULL,
  card_brand       TEXT NOT NULL,
  card_last4       TEXT NOT NULL,

  installments     INTEGER NOT NULL CHECK (installments >= 1),
  subtotal         NUMERIC(14,2) NOT NULL,  -- suma de precios de lista x cantidad
  discount_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Lo que se le cobra a la tarjeta hoy (sin restar el reintegro, que llega
  -- después en el resumen).
  total_amount     NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  -- Interés de financiación, 0 si entró en cuotas sin interés.
  interest_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  installment_amount NUMERIC(14,2) NOT NULL,
  reintegro_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  tna              NUMERIC(6,4) NOT NULL DEFAULT 0,
  tea              NUMERIC(8,4) NOT NULL DEFAULT 0,
  cft              NUMERIC(8,4) NOT NULL DEFAULT 0,

  -- Evita la orden duplicada por doble click o por reintento de la red: el
  -- cliente manda una clave por intento de compra y la segunda vez le
  -- devolvemos la orden que ya existe en lugar de cobrar de nuevo.
  idempotency_key  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id           BIGSERIAL PRIMARY KEY,
  order_id     BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   TEXT NOT NULL REFERENCES products(id),
  -- Nombre congelado: el catálogo cambia, el comprobante no.
  product_name TEXT NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  unit_price   NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);

-- ── Auditoría ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT REFERENCES users(id),
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);
