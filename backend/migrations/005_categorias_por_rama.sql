-- Bankstore · Habilitar categorías por rama, no por hoja
--
-- Hasta acá el trigger exigía que la categoría EXACTA estuviera en
-- merchant_categories. Con una lista plana funcionaba; con el árbol de 004 se
-- vuelve impracticable: habilitar Electrohogar a un comercio obligaría al admin
-- a cargar también climatización, ventiladores, aires acondicionados,
-- refrigeración, lavado… y a volver a hacerlo cada vez que se agrega una hoja.
--
-- Ahora habilitar un nodo habilita su rama completa. Sigue siendo explícito
-- —nadie publica donde no lo habilitaron— pero se declara al nivel que tiene
-- sentido comercial.

CREATE OR REPLACE FUNCTION assert_categoria_habilitada() RETURNS TRIGGER AS $$
DECLARE
  permitida BOOLEAN;
BEGIN
  -- La categoría del producto tiene que ser, o descender de, alguna de las
  -- habilitadas para el comercio.
  SELECT EXISTS (
    SELECT 1
    FROM merchant_categories mc
    WHERE mc.merchant_id = NEW.merchant_id
      AND NEW.category_id IN (SELECT id FROM categorias_descendientes(mc.category_id))
  ) INTO permitida;

  IF NOT permitida THEN
    RAISE EXCEPTION 'El comercio % no tiene habilitada la categoría %',
      NEW.merchant_id, NEW.category_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- La segunda categoría, si viene, se valida igual: si no, sería la puerta de
  -- atrás para publicar en cualquier rubro.
  IF NEW.second_category_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM merchant_categories mc
      WHERE mc.merchant_id = NEW.merchant_id
        AND NEW.second_category_id IN (SELECT id FROM categorias_descendientes(mc.category_id))
    ) INTO permitida;

    IF NOT permitida THEN
      RAISE EXCEPTION 'El comercio % no tiene habilitada la categoría secundaria %',
        NEW.merchant_id, NEW.second_category_id
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.second_category_id = NEW.category_id THEN
      RAISE EXCEPTION 'La segunda categoría no puede ser igual a la principal'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_producto_categoria_habilitada ON products;
CREATE TRIGGER trg_producto_categoria_habilitada
  BEFORE INSERT OR UPDATE OF merchant_id, category_id, second_category_id ON products
  FOR EACH ROW EXECUTE FUNCTION assert_categoria_habilitada();

-- Los comercios sembrados tienen habilitadas las hojas sueltas que existían
-- antes del árbol. Ahora que se hereda por rama, alcanza con la raíz: se
-- limpian las hojas que ya quedan cubiertas por un ancestro habilitado.
DELETE FROM merchant_categories mc
WHERE EXISTS (
  SELECT 1 FROM merchant_categories padre
  WHERE padre.merchant_id = mc.merchant_id
    AND padre.category_id <> mc.category_id
    AND mc.category_id IN (SELECT id FROM categorias_descendientes(padre.category_id))
);
