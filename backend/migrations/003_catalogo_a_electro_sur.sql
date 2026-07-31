-- Bankstore · El catálogo de la maqueta pasa a ser de Electro Sur
--
-- La migración 002 dejó los 9 productos del prototipo en un comercio semilla
-- ('bankstore-demo') que existía sólo para poder poner merchant_id NOT NULL
-- sin perderlos. Ese comercio no tiene usuarios ni dueño real: aparece en la
-- vidriera pero nadie puede administrarlo.
--
-- Pasan a Electro Sur, que sí tiene login y panel. Así se puede probar el
-- circuito completo —publicar, despublicar, suspender el comercio— sobre el
-- catálogo que ya está cargado.

-- El catálogo del prototipo cruza cinco categorías, no sólo las dos de un
-- electro. Hay que habilitárselas antes de mover nada: el trigger
-- assert_categoria_habilitada rechaza publicar en una categoría que el
-- comercio no tenga.
INSERT INTO merchant_categories (merchant_id, category_id)
SELECT 'electro-1', category_id
FROM (VALUES ('tecnologia'), ('electrohogar'), ('turismo'), ('deportes'), ('moda')) AS c(category_id)
WHERE EXISTS (SELECT 1 FROM merchants WHERE id = 'electro-1')
  AND EXISTS (SELECT 1 FROM product_categories pc WHERE pc.id = c.category_id)
ON CONFLICT DO NOTHING;

-- El traspaso. Sólo corre si Electro Sur existe: en una instalación donde
-- todavía no se sembraron los comercios, esta migración no hace nada y el
-- seed se encarga (ver seed.ts, que ya los crea directamente ahí).
UPDATE products
SET merchant_id = 'electro-1', updated_at = now()
WHERE merchant_id = 'bankstore-demo'
  AND EXISTS (SELECT 1 FROM merchants WHERE id = 'electro-1');

-- El comercio semilla queda sin catálogo. No se borra —podría estar
-- referenciado por órdenes viejas, y el histórico no se toca— pero se saca de
-- la vidriera: sin productos no aportaba nada y sólo confundía en el panel.
UPDATE merchants
SET status = 'suspended', updated_at = now()
WHERE id = 'bankstore-demo'
  AND NOT EXISTS (SELECT 1 FROM products WHERE merchant_id = 'bankstore-demo');
