# Despliegue de Bankstore

Tres subdominios, un solo backend, una sola base.

| Subdominio | Sirve | Acceso | Rutas de API que expone |
| --- | --- | --- | --- |
| `bankstore.nexopos.app` | `apps/tienda/dist` | Público | `/api/auth`, `/api/catalog`, `/api/cards`, `/api/orders` |
| `comercios.bankstore.nexopos.app` | `apps/comercios/dist` | Público (con login) | `/api/staff`, `/api/merchant`, `/api/v1` |
| `admin.bankstore.nexopos.app` | `apps/admin/dist` | Según `ADMIN_ALLOWED_CIDRS` | `/api/staff`, `/api/admin`, `/api/catalog` |

Cada uno proxea `/api` al mismo proceso en `127.0.0.1:4020`, pero **sólo las
rutas de su columna**. Todo lo demás bajo `/api` devuelve 404.

## Por qué el corte está en Nginx y no sólo en el token

El backend ya rechaza a quien no tiene el rol. Pero si los tres subdominios
proxearan `/api` entero, `/api/admin` quedaría alcanzable desde la tienda
pública, y la restricción de intranet no serviría de nada: alcanzaría con robar
un token de administrador para operar desde cualquier lado.

Cortando en Nginx, un token filtrado tampoco alcanza — hay que estar en la red.
Son tres capas para lo mismo, a propósito: red, token y rol.

Para comprobar que el ruteo hace lo que dice:

```bash
python3 deploy/verificar-ruteo.py
```

Simula el algoritmo de resolución de `location` de Nginx contra la plantilla y
verifica ruta por ruta qué subdominio llega al backend y cuál no. Conviene
correrlo después de tocar la plantilla: `nginx -t` valida la sintaxis, esto
valida la intención.

## Convivencia en la VM

Bankstore comparte servidor con NexoPOS y ClubPay sin pisarlos: carpeta,
usuario del sistema, base, puerto y server blocks propios.

| App | API | Front | Base | Carpeta |
| --- | --- | --- | --- | --- |
| NexoPOS | 4000 | 3000 | `nexopos` | `/opt/nexopos` |
| ClubPay | 4010 | 3110 | `clubpay` | `/opt/clubpay` |
| **Bankstore** | **4020** | — (3 estáticos) | `bankstore` | `/opt/bankstore` |

Los tres frontends de Bankstore compilan a estáticos: no necesitan proceso, los
sirve Nginx. Por eso ocupa un solo puerto pese a tener tres sitios.

Lo único compartido entre las tres apps es Node (el del sistema, 20+), Nginx y
PostgreSQL.

## Migrar la instalación que ya está corriendo

La VM hoy tiene Bankstore en un solo dominio, con el server block apuntando a
`/opt/bankstore/dist`. Después de pasar a monorepo esa carpeta ya no existe:
cada app compila a `apps/<app>/dist`. Hay que regenerar el server block.

`setup-server.sh` **detecta este caso y frena** en vez de dejar la tienda en
404. Los pasos:

```bash
sudo cp /opt/bankstore/deploy/bankstore.env.example /etc/bankstore-deploy.env
```

Revisá `ADMIN_ALLOWED_CIDRS` y `ADMIN_PASSWORD` antes de seguir:

```bash
sudo vi /etc/bankstore-deploy.env
```

```bash
sudo rm /etc/nginx/sites-available/bankstore
```

```bash
sudo bash /opt/bankstore/deploy/setup-server.sh
```

```bash
sudo certbot --nginx -d bankstore.nexopos.app -d comercios.bankstore.nexopos.app -d admin.bankstore.nexopos.app --agree-tos -m germanyovan@gmail.com --redirect
```

Certbot **amplía el certificado que ya existe** para cubrir los tres nombres;
no emite uno desde cero ni pierde el actual.

```bash
sudo bash /opt/bankstore/deploy/deploy.sh
```

## Instalación desde cero

**1. DNS.** Los tres subdominios apuntando (registro A) a la IP del servidor.
El de admin también: Let's Encrypt valida por HTTP desde internet aunque
después el sitio quede restringido.

```bash
dig +short tienda.bankstore.nexopos.app comercios.bankstore.nexopos.app admin.bankstore.nexopos.app
```

**2. Clonar.**

```bash
sudo git clone -b main https://github.com/napy77/bankstore.git /opt/bankstore
```

**3. Configurar.**

```bash
sudo cp /opt/bankstore/deploy/bankstore.env.example /etc/bankstore-deploy.env
sudo chmod 600 /etc/bankstore-deploy.env
sudo vi /etc/bankstore-deploy.env
```

Lo que hay que revisar sí o sí: los tres dominios, `ADMIN_ALLOWED_CIDRS` y
`ADMIN_PASSWORD`.

**4. Preparar el servidor.**

```bash
sudo bash /opt/bankstore/deploy/setup-server.sh
```

Crea usuario, base, `.env` con secretos al azar, snippets de Nginx, los tres
server blocks y la unit de systemd. Es idempotente.

**5. Certificados.** Los tres en una sola corrida, así comparten renovación:

```bash
sudo certbot --nginx -d tienda.bankstore.nexopos.app -d comercios.bankstore.nexopos.app -d admin.bankstore.nexopos.app --agree-tos -m germanyovan@gmail.com --redirect
```

**6. Desplegar.**

```bash
sudo bash /opt/bankstore/deploy/deploy.sh
```

## Actualizar

```bash
sudo bash /opt/bankstore/deploy/deploy.sh
```

Trae la rama, instala dependencias de todos los workspaces, compila backend y
las tres apps, migra, reinicia la API y verifica. Si algo falla después del
build:

```bash
sudo bash /opt/bankstore/deploy/deploy.sh --rollback
```

## Cambiar de dominio

Cuando el proyecto tenga dominio propio (por ejemplo `bancolapampa.com.ar`):

1. Apuntar el DNS de los tres subdominios nuevos.
2. Cambiar `STORE_DOMAIN`, `MERCHANT_DOMAIN` y `ADMIN_DOMAIN` en
   `/etc/bankstore-deploy.env`. Poner el dominio viejo en `LEGACY_DOMAIN` para
   que redirija.
3. Borrar el server block y regenerarlo (certbot lo tiene congelado):

```bash
sudo rm /etc/nginx/sites-available/bankstore && sudo bash /opt/bankstore/deploy/setup-server.sh
```

4. Pedir los certificados nuevos y desplegar.

## Cambiar quién entra al admin

`ADMIN_ALLOWED_CIDRS` controla desde qué redes se llega a `admin.<dominio>`.

**Vacío = sin restricción de red.** Es como está hoy, mientras se prueba con
datos mock: pelear con la VPN en cada cambio no aporta nada cuando no hay nada
real que proteger. El panel sigue pidiendo usuario y contraseña; lo que no hay
es filtro de red.

**Antes de cargar datos reales** hay que cerrarlo:

1. Completar `ADMIN_ALLOWED_CIDRS` con las redes que correspondan.
2. Cambiar `ADMIN_PASSWORD` — con esa cuenta se toca cualquier comercio y
   cualquier condición comercial.
3. Re-correr el setup.

La lógica de restricción queda instalada en los dos casos: la plantilla de
Nginx siempre incluye el snippet, y el setup lo regenera con `allow all;` o con
la lista de redes según la variable. Volver a cerrarlo no toca la configuración
de Nginx ni obliga a rehacer los certificados.

Es lo que más se toca (cambió la VPN, se sumó una oficina, hay que probar desde
afuera), así que:

```bash
sudo vi /etc/bankstore-deploy.env && sudo bash /opt/bankstore/deploy/setup-server.sh
```

El setup regenera la lista de redes **aunque el server block esté congelado por
certbot**, justamente para que este cambio no obligue a rehacer certificados.

## Operación

```bash
sudo systemctl status bankstore-api
```

```bash
sudo journalctl -u bankstore-api -f
```

```bash
sudo ss -ltnp | grep -E '3000|3110|4000|4010|4020'
```

## Cosas que conviene saber

**El `.env` del backend no se regenera.** `setup-server.sh` lo crea la primera
vez con un `JWT_SECRET` al azar. Al re-correrlo actualiza puerto, URL y tasas,
pero conserva el secreto: si cambiara, se caerían todas las sesiones.

**Certbot escribe sobre el server block.** Después de pedir los certificados,
`setup-server.sh` lo detecta y no lo pisa. Los snippets sí se actualizan
siempre.

**Las tasas se cambian sin deploy.** `TNA_DEFAULT` e `IVA_INTERESES` viven en
el `.env` del backend. Editarlas y `sudo systemctl restart bankstore-api`.

**`SEED_DEMO_DATA=true` recarga catálogo y comercios de ejemplo en cada
deploy.** Para producción real, ponerlo en `false`: no borra órdenes ni
usuarios, pero pisa precios, promos y comercios de demo.

**Las API keys sólo se generan la primera vez.** El secreto no se puede
recuperar, así que el seed no las regenera: rompería integraciones ya
configuradas.
