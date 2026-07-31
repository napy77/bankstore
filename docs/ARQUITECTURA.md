# Arquitectura de Bankstore

Marketplace bancario multi-comercio. Tres poblaciones de usuarios, tres formas
de autenticarse, un solo motor de precios.

## Los tres ámbitos

| Ámbito | Quién es | Cómo entra | Rutas |
| --- | --- | --- | --- |
| Comprador | El cliente del banco | JWT `aud: customer` | `/api/auth`, `/api/cards`, `/api/orders` |
| Plataforma | El operador del marketplace | JWT `aud: staff`, rol `platform_admin` | `/api/admin` |
| Comercio | Electro 1, Hotel 2, … | JWT `aud: staff`, con `merchantId` | `/api/merchant` |
| Sistema del comercio | Su ERP | `X-API-Key` | `/api/v1` |

La separación es deliberada y está en tres capas:

1. **Tablas distintas.** Los compradores viven en `users` y el back-office en
   `staff_users`. Son dos poblaciones con dos niveles de permiso: si
   compartieran tabla, un error en el alta de compradores podría terminar
   creando un administrador.

2. **Audiencia en el token.** Los dos JWT se firman con el mismo secreto, pero
   llevan `aud` distinto. Sin eso, un token de comprador cuyo `userId`
   coincidiera con un `staffId` pasaría el `verify` con permisos de admin.

3. **Guards montados en el router, no dentro.** En `index.ts`:

   ```
   app.use("/api/admin",    requirePlatformAdmin, adminRouter);
   app.use("/api/merchant", requireMerchant,      merchantRouter);
   ```

   Así no existe la posibilidad de agregar un endpoint nuevo y olvidarse de
   protegerlo.

El `merchantId` **siempre** sale de la credencial, nunca de la URL ni del body.
Es lo único que separa el catálogo de Electro 1 del de Electro 2.

## Beneficios bancarios: gana el más específico

Un banco puede tener varias reglas que calzan sobre la misma compra:

| Alcance | Ejemplo | Puntaje |
| --- | --- | --- |
| Comercio + categoría | "24 cuotas en tecnología de Electro Sur" | 3 |
| Comercio | "18 cuotas en Electro Sur" | 2 |
| Categoría | "12 cuotas en tecnología, en toda la app" | 1 |
| Global | "3 cuotas en todo" | 0 |

Gana el de mayor puntaje, **no el más generoso**. Es contraintuitivo pero es
como funcionan los acuerdos comerciales: si el banco negoció algo puntual con
un comercio, ese acuerdo reemplaza al general, para bien o para mal.

Empate de alcance → manda `priority`; si también empata, más cuotas.

Por encima de todo sigue estando `product_bank_offers`: la campaña de un
artículo concreto.

El código está en [`lib/agreements.ts`](../backend/src/lib/agreements.ts) y las
reglas están cubiertas por tests.

### Topes de reintegro

El tope es **por cuenta y por acuerdo**, no por producto ni por comercio. Dos
productos amparados por el mismo acuerdo comparten un solo tope, aunque sean de
comercios distintos. Por eso `applyCaps` agrupa por `capKey` (el id del
acuerdo) y no por categoría.

### El reintegro no es un descuento

No baja lo que se financia ni lo que se cobra hoy: se acredita después en el
resumen. El monto financiado es siempre el precio de venta.

## Una compra, varias sub-órdenes

El comprador arma un carrito con productos de varios comercios y paga **una
vez**: una tarjeta, un plan de cuotas, un resumen. Por debajo:

```
orders                     el pago (tarjeta, cuotas, CFT, reintegro)
  └── merchant_orders      una por comercio: despacho y liquidación
        └── order_items    los ítems de ese comercio
```

Cada comercio ve sólo su sub-orden, con su propia numeración correlativa.

### Cuotas del carrito mixto

El plan sin interés es el del producto **más restrictivo**. Si un ítem sólo
tiene 6 cuotas, no se pueden dar 24 por el carrito entero: el banco no lo
bancaría y alguien tendría que comerse la diferencia.

### Reparto del costo

```
comisión        = subtotal del comercio × commission_percent
costo de cuotas = costo financiero total × (subtotal del comercio / total)
a liquidar      = subtotal − comisión − costo de cuotas
```

El costo financiero se prorratea por participación: un comercio que aportó el
30% del carrito absorbe el 30% del costo, no la mitad por ser dos.

`absorbs_installment_cost = false` significa que ese costo lo pone el banco y
al comercio se le liquida sin esa quita.

Los porcentajes se **congelan** en la sub-orden al momento de la venta: si
mañana se renegocia la comisión, las liquidaciones viejas no cambian.

## Integración de los comercios

`/api/v1`, con `X-API-Key`. Versionada desde el arranque porque romper la
compatibilidad acá le rompe el cron a alguien.

| Endpoint | Para qué |
| --- | --- |
| `GET /api/v1/ping` | Verificar la clave y ver qué categorías tiene permitidas |
| `PUT /api/v1/products` | Sincronizar catálogo (hasta 500, idempotente por SKU) |
| `PATCH /api/v1/stock` | Sólo stock, para el cron que corre seguido |
| `GET /api/v1/products` | El catálogo tal como lo tenemos |
| `GET /api/v1/orders` | Las ventas, para armar el remito |

**Las claves se guardan hasheadas.** Se muestran una sola vez al crearlas; ni
nosotros podemos recuperarlas. Se usa SHA-256 y no bcrypt a propósito: son 24
bytes aleatorios, no algo adivinable por diccionario, y el hash se calcula en
cada request — bcrypt con costo 12 metería ~250 ms por llamada.

**Los lotes no fallan enteros.** Si un producto trae la categoría mal, se
rechaza ese y los otros 499 entran igual; la respuesta es `207 Multi-Status`
con el detalle por SKU. Un lote que falla completo por un renglón malo es una
pesadilla para el que integra.

## Reglas que fuerza la base

Hay cosas que no se dejan solamente en el código:

- **Un producto sólo se publica en una categoría habilitada para su comercio.**
  Es un trigger (`assert_categoria_habilitada`), porque mira otra tabla y no se
  puede expresar como CHECK. Es la clase de regla que si no la fuerza la base,
  tarde o temprano se cuela por algún endpoint.
- **Rol y comercio coherentes** en `staff_users`: un `platform_admin` nunca
  cuelga de un comercio, y un usuario de comercio siempre tiene el suyo.
- **Un solo acuerdo por alcance**, con `NULLS NOT DISTINCT` para que dos
  acuerdos globales del mismo banco y categoría no puedan coexistir.
- **SKU único por comercio**, no global: dos comercios pueden usar el mismo.

## Qué falta

- **Reservas con fecha.** Hotel, Spa y Viajes se venden hoy como ítem con cupo.
  La columna `products.kind` ya distingue `physical` de `service`, así que
  agregar disponibilidad por día, bloqueo temporal durante el pago y políticas
  de cancelación no obliga a reclasificar el catálogo.
- **Webhooks de órdenes.** Hoy el comercio consulta `/api/v1/orders`. Falta el
  push con reintentos y firma.
- **Cobro real.** No hay pasarela: el checkout descuenta límite pero no cobra.
  La columna `cards.gateway_token` está lista para guardar el token del
  proveedor cuando se integre.
- **El frontend sigue con datos mock.** No consume nada de esta API todavía.
