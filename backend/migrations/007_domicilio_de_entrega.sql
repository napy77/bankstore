-- Bankstore · Domicilio de entrega
--
-- El checkout pedía calle y altura pero no los guardaba en ningún lado: la
-- compra se creaba y el comercio no tenía adónde despachar.
--
-- Dos piezas: la libreta de direcciones del comprador (reutilizable) y una
-- COPIA congelada dentro de la orden. La copia no es redundancia: si el
-- comprador después edita su dirección o la borra, el remito de una compra ya
-- despachada tiene que seguir diciendo adónde fue.

-- ── Libreta del comprador ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_addresses (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  label       TEXT,                       -- "Casa", "Trabajo"
  recipient   TEXT NOT NULL,              -- quién recibe, puede no ser el titular
  phone       TEXT,                       -- el correo lo pide para coordinar
  street      TEXT NOT NULL,
  number      TEXT NOT NULL,
  floor_apt   TEXT,                       -- piso y depto
  zip         TEXT NOT NULL,
  city        TEXT NOT NULL,
  province    TEXT NOT NULL,
  notes       TEXT,                       -- "portón negro", "timbre 3B"

  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_addresses_user ON user_addresses (user_id);

-- Una sola predeterminada por comprador. Con un UNIQUE parcial lo garantiza la
-- base: si se resolviera en el código, dos pestañas guardando a la vez podrían
-- dejar dos.
CREATE UNIQUE INDEX IF NOT EXISTS idx_addresses_una_default
  ON user_addresses (user_id) WHERE is_default;

-- ── Copia congelada en la orden ──────────────────────────────────────────────
-- Se copian los campos en vez de guardar sólo el id. El id igual se guarda,
-- para poder agrupar envíos del mismo domicilio, pero lo que manda para el
-- remito son estas columnas.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_address_id BIGINT REFERENCES user_addresses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ship_recipient TEXT,
  ADD COLUMN IF NOT EXISTS ship_phone     TEXT,
  ADD COLUMN IF NOT EXISTS ship_street    TEXT,
  ADD COLUMN IF NOT EXISTS ship_number    TEXT,
  ADD COLUMN IF NOT EXISTS ship_floor_apt TEXT,
  ADD COLUMN IF NOT EXISTS ship_zip       TEXT,
  ADD COLUMN IF NOT EXISTS ship_city      TEXT,
  ADD COLUMN IF NOT EXISTS ship_province  TEXT,
  ADD COLUMN IF NOT EXISTS ship_notes     TEXT;

COMMENT ON COLUMN orders.shipping_address_id IS
  'Referencia a la libreta, sólo informativa. El remito usa las columnas ship_*, que son la copia congelada al momento de la venta.';

-- ── Lo que el comercio necesita para despachar ───────────────────────────────
-- Junta el domicilio con el peso de los bultos de ESE comercio: es lo que hace
-- falta para cotizar el envío con el transportista, y hasta ahora había que
-- armarlo a mano cruzando tres tablas.
CREATE OR REPLACE VIEW merchant_shipments AS
SELECT mo.id                                   AS merchant_order_id,
       mo.merchant_id,
       mo.merchant_order_number,
       mo.status,
       o.order_number,
       o.ship_recipient, o.ship_phone, o.ship_street, o.ship_number,
       o.ship_floor_apt, o.ship_zip, o.ship_city, o.ship_province, o.ship_notes,
       -- Sólo los bultos de los productos de esta sub-orden: cada comercio
       -- despacha lo suyo por separado.
       COALESCE(SUM(pk.weight_g), 0)::int      AS peso_real_g,
       COALESCE(SUM(peso_volumetrico_g(pk.height_mm, pk.width_mm, pk.length_mm)), 0)::int
                                               AS peso_volumetrico_g,
       COUNT(pk.id)::int                       AS bultos,
       -- Un producto sin dimensiones cargadas no se puede cotizar. Se marca
       -- para que el comercio lo vea antes de que el transportista lo rebote.
       BOOL_OR(pk.id IS NULL)                  AS faltan_dimensiones
FROM merchant_orders mo
JOIN orders o ON o.id = mo.order_id
JOIN order_items i ON i.merchant_order_id = mo.id
LEFT JOIN product_packages pk ON pk.product_id = i.product_id
GROUP BY mo.id, o.order_number, o.ship_recipient, o.ship_phone, o.ship_street,
         o.ship_number, o.ship_floor_apt, o.ship_zip, o.ship_city,
         o.ship_province, o.ship_notes;
