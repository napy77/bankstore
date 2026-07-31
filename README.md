# Bankstore

Marketplace bancario multi-comercio: catálogo de varios vendedores, simulador
de cuotas, beneficios por banco/comercio, billetera y checkout con sub-órdenes.

- **Frontend** — diseñado con Google Stitch / AI Studio, migrado a proyecto propio.
- **Backend** — Express + PostgreSQL, con toda la lógica de precios, cuotas y beneficios.

Producción: **https://bankstore.nexopos.app**

## Stack

| | |
| --- | --- |
| Frontend | React 19 · Vite 6 · Tailwind 4 · Motion · lucide-react |
| Backend | Node 20+ · Express · TypeScript · zod · `pg` (SQL crudo, sin ORM) |
| Base | PostgreSQL 16, migraciones `.sql` versionadas |

## Correr en local

Base de datos:

```bash
docker compose up -d
```

Backend (puerto 4020):

```bash
cd backend && npm install && npm run migrate && npm run seed && npm run seed:marketplace && npm run dev
```

Frontend (puerto 3200):

```bash
npm install && npm run dev
```

Cuentas de prueba que deja el seed:

| Ámbito | Usuario | Contraseña |
| --- | --- | --- |
| Comprador | `demo@bankstore.test` | `bankstore2026` |
| Plataforma | `admin@bankstore.test` | `bankstore-admin-2026` |
| Comercio | `admin@electro-1.test` (y uno por comercio) | `comercio-2026-demo` |

`seed:marketplace` imprime además una API key por comercio. Se muestran una
sola vez: guardalas o revocalas y generá otras desde el panel.

Los puertos evitan a los otros proyectos de la VM: NexoPOS usa 3000/4000 y
ClubPay 3100/4010.

## Dónde vive la lógica

Todo el cálculo de plata está en el servidor. El cliente manda **qué** quiere
comprar; el precio, el interés, la cuota y el reintegro salen de la base.

### `backend/src/lib/installments.ts`

Sistema francés real: cuota constante, interés sobre saldo, la última cuota
absorbe el arrastre del redondeo para que el crédito cierre en cero.

- **TEA** = `(1 + TNA/12)^12 - 1`
- **CFT** = TIR del flujo completo (cuotas + IVA sobre intereses), resuelta por
  bisección. Siempre da por encima de la TEA, que es justamente lo que hay que
  informar por Com. "A" 5460 del BCRA.

El prototipo calculaba `tea = tna * 1.25` y `cft = tea * 1.15`, que no son
fórmulas financieras sino factores elegidos a ojo.

### `backend/src/lib/agreements.ts`

Resuelve qué beneficio aplica cuando varias reglas del mismo banco calzan sobre
la misma compra. **Gana el acuerdo más específico, no el más generoso**:

```
comercio + categoría  >  comercio  >  categoría  >  global
```

Por encima de todo está la oferta puntual del producto. El **tope de reintegro
es por cuenta y por acuerdo**, no por producto ni por comercio: dos productos
amparados por el mismo acuerdo comparten un solo tope.

El reintegro **no es un descuento** — no baja lo que se financia ni lo que se
cobra hoy; se acredita después en el resumen.

## API

Todo cuelga de `/api`. Catálogo y simulador son públicos; billetera y órdenes
piden `Authorization: Bearer <token>`.

| Método | Ruta | Qué hace |
| --- | --- | --- |
| `POST` | `/api/auth/register` · `/login` | Alta y login, devuelven JWT |
| `GET` | `/api/auth/me` | Valida el token guardado |
| `GET` | `/api/catalog/products` | Listado con filtros, orden y paginado |
| `GET` | `/api/catalog/products/:id` | Detalle + beneficio resuelto por banco |
| `GET` | `/api/catalog/banks` · `/categories` | Bancos con promos vigentes, categorías |
| `POST` | `/api/catalog/simulate` | Simulador de cuotas (público) |
| `GET` | `/api/cards` | Billetera del usuario |
| `POST` | `/api/cards` | Vincular tarjeta (valida Luhn, deduce la marca) |
| `DELETE` | `/api/cards/:id` | Desvincular |
| `POST` | `/api/orders` | Checkout (parte la orden por comercio) |
| `GET` | `/api/orders` · `/:id` | Historial y comprobante |

Back-office — dos ámbitos separados, con tokens que no se cruzan:

| Método | Ruta | Quién |
| --- | --- | --- |
| `POST` | `/api/staff/login` | Plataforma y comercios |
| `*` | `/api/admin/merchants` · `/staff` · `/agreements` · `/settlements` | Sólo plataforma |
| `*` | `/api/merchant/products` · `/orders` · `/api-keys` | Sólo el comercio dueño |

Integración del sistema del comercio, con `X-API-Key`:

| Método | Ruta | Qué hace |
| --- | --- | --- |
| `GET` | `/api/v1/ping` | Verificar la clave y ver categorías permitidas |
| `PUT` | `/api/v1/products` | Sincronizar catálogo, idempotente por SKU |
| `PATCH` | `/api/v1/stock` | Sólo stock |
| `GET` | `/api/v1/orders` | Ventas del comercio |

### Decisiones que conviene conocer

**No se guardan números de tarjeta.** El alta acepta el PAN sólo para validarlo
con Luhn y quedarse con los últimos 4; el resto se descarta antes de tocar la
base. Guardar el PAN completo mete al proyecto en el alcance de PCI-DSS sin
necesidad. Para cobrar de verdad hay que integrar una pasarela y guardar *su*
token — para eso está la columna `gateway_token`.

**El checkout ignora todo monto que mande el cliente.** Recalcula precio,
interés, cuota y reintegro leyendo la base dentro de una transacción, con
`FOR UPDATE` sobre la tarjeta y los productos para que dos compras simultáneas
no gasten el mismo límite ni el mismo stock.

**Idempotencia.** El checkout acepta `idempotencyKey`; repetir la request
devuelve la orden que ya existe en vez de cobrar de nuevo.

**Los comprobantes congelan los datos.** Nombre del banco, del producto,
últimos 4 y el porcentaje de comisión quedan copiados en la orden: si mañana
cambia el catálogo o se renegocia la comisión, lo viejo sigue diciendo lo que
decía.

**Gana el acuerdo más específico, no el más generoso.** Un acuerdo del banco
con un comercio reemplaza al general, para bien o para mal. Está explicado en
[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Scripts

Frontend (raíz):

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Vite en :3200 |
| `npm run build` | Build a `dist/` |
| `npm run lint` | `tsc --noEmit` |

Backend (`backend/`):

| Script | Qué hace |
| --- | --- |
| `npm run dev` | API con recarga en :4020 |
| `npm run build` | Compila a `dist/` |
| `npm run migrate` | Aplica las migraciones pendientes |
| `npm run seed` | Carga bancos, productos y usuario demo |
| `npm run seed:marketplace` | Carga comercios, back-office y acuerdos |
| `npm test` | Tests del motor financiero |
| `npm run typecheck` | `tsc --noEmit` |

## Estructura

```
src/                        Frontend
  App.tsx                   Layout, filtros, estado (carrito, tarjetas, compras)
  types.ts                  Bank, CreditCard, Product, CartItem, Purchase
  data/                     Catálogo del prototipo (fuente del seed)
  components/               Wallet, ProductCard, simulador, carrito, checkout

backend/
  migrations/
    001_initial.sql         Catálogo, billetera, órdenes
    002_marketplace.sql     Comercios, back-office, acuerdos, sub-órdenes
  src/
    index.ts                Montaje de routers y guards
    config.ts               Puerto, base, JWT, tasas financieras
    db.ts                   Pool y runner de migraciones
    seed.ts                 Catálogo del prototipo
    seed-marketplace.ts     Comercios, usuarios de back-office y acuerdos
    lib/
      installments.ts       Sistema francés, TNA/TEA/CFT
      agreements.ts         Resolución de acuerdos por especificidad y topes
      products.ts           Alta/actualización compartida panel + API
      money.ts              Redondeo a centavos
    middleware/
      auth.ts               JWT de comprador
      staff.ts              JWT de back-office y guards por rol
      apikey.ts             Claves de integración (hash, scopes)
      error.ts              HttpError + zod
    modules/
      auth, catalog, cards, orders       compradores
      staff-auth, admin, merchant        back-office
      integration                        /api/v1 con API key
  test/                     Motor financiero y resolución de acuerdos

docs/ARQUITECTURA.md        Cómo encaja todo

deploy/                     Instalación y despliegue en la VM (ver deploy/README.md)
```

## Despliegue

Bankstore convive con NexoPOS y ClubPay en la misma VM sin pisarlos: carpeta,
usuario, base, puerto y server block propios.

| App | API | Front | Base |
| --- | --- | --- | --- |
| NexoPOS | 4000 | 3000 | `nexopos` |
| ClubPay | 4010 | 3110 | `clubpay` |
| **Bankstore** | **4020** | — (estático) | `bankstore` |

Un solo dominio sirve todo: `/` son los estáticos y `/api` va al backend por
proxy. Un certificado, sin CORS.

Los pasos están en **[deploy/README.md](deploy/README.md)**.
