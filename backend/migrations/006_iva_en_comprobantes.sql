-- Bankstore · IVA discriminado en el comprobante
--
-- La transparencia fiscal al consumidor obliga a mostrarle al comprador cuánto
-- del precio es impuesto. Hasta acá la orden guardaba sólo el total.
--
-- Todo se CONGELA al momento de la venta. La alícuota de un producto puede
-- cambiar mañana —cambia la ley, o el comercio corrige una carga mal hecha— y
-- el comprobante emitido tiene que seguir diciendo lo que decía. Por eso la
-- tasa se copia en cada línea en vez de leerse de `products` al reimprimir.

-- ── Por línea ────────────────────────────────────────────────────────────────
ALTER TABLE order_items
  -- Alícuota vigente cuando se vendió, como fracción.
  ADD COLUMN IF NOT EXISTS iva_rate NUMERIC(5,4) NOT NULL DEFAULT 0.21,
  -- Precio unitario sin impuesto. Se deriva del final al vender y se guarda
  -- para no tener que recalcularlo —y arriesgar un centavo de diferencia—
  -- cada vez que se reimprime el comprobante.
  ADD COLUMN IF NOT EXISTS unit_price_net NUMERIC(14,2),
  -- IVA de la línea entera (unitario × cantidad).
  ADD COLUMN IF NOT EXISTS iva_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN order_items.unit_price IS
  'Precio unitario FINAL, con IVA incluido. Es lo que paga el comprador.';

-- Las líneas que ya existían no tienen el desglose. Se completa con la tasa
-- por defecto para que el comprobante no quede en blanco; son órdenes de
-- prueba, no facturas reales.
UPDATE order_items
SET unit_price_net = ROUND(unit_price / 1.21, 2),
    iva_amount     = ROUND(unit_price * quantity - (ROUND(unit_price / 1.21, 2) * quantity), 2)
WHERE unit_price_net IS NULL;

ALTER TABLE order_items ALTER COLUMN unit_price_net SET NOT NULL;

-- ── Totales de la orden ──────────────────────────────────────────────────────
ALTER TABLE orders
  -- Suma de los netos de las líneas.
  ADD COLUMN IF NOT EXISTS net_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- IVA de la mercadería.
  ADD COLUMN IF NOT EXISTS iva_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- IVA sobre los intereses de financiación. Va aparte porque es otro hecho
  -- imponible: no es el IVA del producto, es el del crédito. Ya se calculaba
  -- para el CFT; ahora también se guarda.
  ADD COLUMN IF NOT EXISTS iva_interes_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

UPDATE orders o
SET net_amount = sub.neto,
    iva_amount = sub.iva
FROM (
  SELECT order_id, SUM(unit_price_net * quantity) AS neto, SUM(iva_amount) AS iva
  FROM order_items GROUP BY order_id
) sub
WHERE o.id = sub.order_id AND o.net_amount = 0;

-- ── Liquidación al comercio ──────────────────────────────────────────────────
-- Al comercio se le liquida sobre el neto: el IVA no es suyo, lo cobra por
-- cuenta del fisco. Sin este desglose la liquidación estaría inflada un 21%.
ALTER TABLE merchant_orders
  ADD COLUMN IF NOT EXISTS net_subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iva_subtotal NUMERIC(14,2) NOT NULL DEFAULT 0;

UPDATE merchant_orders mo
SET net_subtotal = sub.neto,
    iva_subtotal = sub.iva
FROM (
  SELECT merchant_order_id, SUM(unit_price_net * quantity) AS neto, SUM(iva_amount) AS iva
  FROM order_items WHERE merchant_order_id IS NOT NULL GROUP BY merchant_order_id
) sub
WHERE mo.id = sub.merchant_order_id AND mo.net_subtotal = 0;
