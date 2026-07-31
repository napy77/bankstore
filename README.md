# Bankstore

Marketplace bancario: catálogo con simulador de cuotas, beneficios por
banco/tarjeta, billetera y checkout.

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
cd backend && npm install && npm run migrate && npm run seed && npm run dev
```

Frontend (puerto 3200):

```bash
npm install && npm run dev
```

Usuario de prueba: `demo@bankstore.test` / `bankstore2026`

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

### `backend/src/lib/promos.ts`

Resuelve qué beneficio aplica: la oferta puntual del producto le gana a la
promo de categoría del banco. El **tope de reintegro es por cuenta y categoría**,
no por producto: dos televisores no reintegran dos veces el tope.

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
| `POST` | `/api/orders` | Checkout |
| `GET` | `/api/orders` · `/:id` | Historial y comprobante |

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

**Los comprobantes congelan los datos.** Nombre del banco, del producto y
últimos 4 quedan copiados en la orden: si mañana cambia el catálogo, el
comprobante viejo sigue diciendo lo que decía.

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
  migrations/001_initial.sql
  src/
    index.ts                Montaje de routers
    config.ts               Puerto, base, JWT, tasas financieras
    db.ts                   Pool y runner de migraciones
    seed.ts                 Carga los datos del prototipo en la base
    lib/
      installments.ts       Sistema francés, TNA/TEA/CFT
      promos.ts             Resolución de beneficios y topes
      money.ts              Redondeo a centavos
    middleware/             auth (JWT), error (HttpError + zod)
    modules/                auth, catalog, cards, orders
  test/                     Tests del motor financiero

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
