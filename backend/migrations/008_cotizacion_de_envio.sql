-- Bankstore · Cotización de envío
--
-- Hasta acá el checkout decía "Envío GRATIS" sin calcular nada, y el costo lo
-- terminaba comiendo alguien sin que figurara en ningún lado.
--
-- Se implementa con tarifario propio (zona × peso) y no con integración a un
-- transportista: eso necesita cuenta, contrato y credenciales que todavía no
-- existen. La estructura queda preparada para que un transportista entre
-- después como otro proveedor: por eso `shipping_rates` cuelga de un
-- `carrier`, aunque hoy haya uno solo.
--
-- El envío se cotiza POR COMERCIO, no por carrito: dos vendedores son dos
-- despachos desde dos orígenes, y cada uno cobra el suyo.

-- ── Zonas ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shipping_zones (
  id          TEXT PRIMARY KEY,           -- 'amba', 'patagonia'
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true
);

-- Qué provincia cae en qué zona. Se resuelve por provincia y no por código
-- postal porque el CPA argentino no es contiguo por zona tarifaria: dos
-- localidades con prefijos parecidos pueden estar a mil kilómetros. La
-- provincia es el corte que efectivamente usan los transportistas.
CREATE TABLE IF NOT EXISTS shipping_zone_provinces (
  province  TEXT PRIMARY KEY,             -- normalizada: minúsculas sin acentos
  zone_id   TEXT NOT NULL REFERENCES shipping_zones(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_zone_provinces ON shipping_zone_provinces (zone_id);

-- ── Tarifario ────────────────────────────────────────────────────────────────
-- Un tramo por peso: "hasta 5 kg en Patagonia, $X". Se busca el primer tramo
-- cuyo tope alcance el peso facturable.
CREATE TABLE IF NOT EXISTS shipping_rates (
  id           BIGSERIAL PRIMARY KEY,
  carrier      TEXT NOT NULL DEFAULT 'estandar',
  zone_id      TEXT NOT NULL REFERENCES shipping_zones(id) ON DELETE CASCADE,
  -- Tope del tramo, en gramos. NULL = sin tope (el último tramo).
  up_to_grams  INTEGER CHECK (up_to_grams IS NULL OR up_to_grams > 0),
  -- Precio FINAL con IVA, igual que los productos: el neto se deriva.
  price        NUMERIC(14,2) NOT NULL CHECK (price >= 0),
  -- Para el tramo sin tope: cuánto se suma por kilo que pase del anterior.
  price_per_extra_kg NUMERIC(14,2) NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (carrier, zone_id, up_to_grams)
);
CREATE INDEX IF NOT EXISTS idx_rates_lookup ON shipping_rates (carrier, zone_id) WHERE active;

-- ── Condiciones de envío del comercio ────────────────────────────────────────
ALTER TABLE merchants
  -- Desde qué provincia despacha. Hoy es informativo; cuando entre un
  -- transportista real, es el origen de la cotización.
  ADD COLUMN IF NOT EXISTS ships_from_province TEXT,
  -- Compras por encima de este monto viajan sin cargo, y el costo lo absorbe
  -- el comercio. NULL = nunca gratis.
  ADD COLUMN IF NOT EXISTS free_shipping_over NUMERIC(14,2)
    CHECK (free_shipping_over IS NULL OR free_shipping_over >= 0),
  -- Si es false, el comercio no despacha: sólo retiro o servicios.
  ADD COLUMN IF NOT EXISTS ships BOOLEAN NOT NULL DEFAULT true;

-- ── Costo congelado en la orden ──────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_net  NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_iva  NUMERIC(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN orders.shipping_cost IS
  'Costo de envío final con IVA, sumado al total financiado. Congelado al vender: el tarifario cambia y el comprobante no.';

ALTER TABLE merchant_orders
  -- Lo que costó despachar lo de ESTE comercio.
  ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- true cuando entró por el umbral de envío gratis: el comercio lo absorbe y
  -- no se le cobra al comprador, pero queda registrado para la liquidación.
  ADD COLUMN IF NOT EXISTS shipping_absorbed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shipping_zone TEXT,
  ADD COLUMN IF NOT EXISTS shipping_weight_g INTEGER NOT NULL DEFAULT 0;

-- ── Zonas y tarifas iniciales ────────────────────────────────────────────────
-- Un corte estándar de plaza para Argentina. Los precios son de arranque: se
-- ajustan desde el panel de administración.
INSERT INTO shipping_zones (id, name, sort_order) VALUES
  ('amba',      'CABA y Gran Buenos Aires', 10),
  ('bs-as',     'Buenos Aires interior',    20),
  ('centro',    'Centro',                   30),
  ('litoral',   'Litoral',                  40),
  ('cuyo',      'Cuyo',                     50),
  ('noa',       'Noroeste',                 60),
  ('nea',       'Nordeste',                 70),
  ('patagonia', 'Patagonia',                80)
ON CONFLICT (id) DO NOTHING;

INSERT INTO shipping_zone_provinces (province, zone_id) VALUES
  ('caba', 'amba'),
  ('ciudad autonoma de buenos aires', 'amba'),
  ('buenos aires', 'bs-as'),
  ('cordoba', 'centro'),
  ('santa fe', 'centro'),
  ('la pampa', 'centro'),
  ('entre rios', 'litoral'),
  ('corrientes', 'litoral'),
  ('mendoza', 'cuyo'),
  ('san juan', 'cuyo'),
  ('san luis', 'cuyo'),
  ('la rioja', 'cuyo'),
  ('tucuman', 'noa'),
  ('salta', 'noa'),
  ('jujuy', 'noa'),
  ('catamarca', 'noa'),
  ('santiago del estero', 'noa'),
  ('chaco', 'nea'),
  ('formosa', 'nea'),
  ('misiones', 'nea'),
  ('neuquen', 'patagonia'),
  ('rio negro', 'patagonia'),
  ('chubut', 'patagonia'),
  ('santa cruz', 'patagonia'),
  ('tierra del fuego', 'patagonia')
ON CONFLICT (province) DO NOTHING;

-- Tramos: hasta 1 kg, 5 kg, 15 kg, 30 kg y sin tope.
INSERT INTO shipping_rates (carrier, zone_id, up_to_grams, price, price_per_extra_kg)
SELECT 'estandar', z.id, t.tope,
       ROUND(t.base * z.factor, 2),
       ROUND(t.extra * z.factor, 2)
FROM (VALUES
  (1000,    3500.00,   0.00),
  (5000,    5200.00,   0.00),
  (15000,   8900.00,   0.00),
  (30000,  14500.00,   0.00),
  (NULL,   14500.00, 420.00)
) AS t(tope, base, extra)
CROSS JOIN (VALUES
  ('amba', 1.00), ('bs-as', 1.25), ('centro', 1.45), ('litoral', 1.60),
  ('cuyo', 1.70), ('noa', 1.85), ('nea', 1.85), ('patagonia', 2.30)
) AS z(id, factor)
ON CONFLICT (carrier, zone_id, up_to_grams) DO NOTHING;

-- Los comercios de ejemplo despachan desde donde tiene sentido y bonifican el
-- envío por encima de cierto monto, que es la práctica habitual.
UPDATE merchants SET ships_from_province = 'buenos aires', free_shipping_over = 500000
WHERE id IN ('electro-1', 'electro-2', 'ferreteria-1', 'ferreteria-2')
  AND ships_from_province IS NULL;

-- Turismo, hotelería y spa no despachan nada.
UPDATE merchants SET ships = false
WHERE id IN ('viajes-1', 'viajes-2', 'spa-1', 'hotel-1', 'hotel-2', 'hotel-3');
