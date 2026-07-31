# Despliegue de Bankstore

Bankstore convive en la misma VM que NexoPOS y ClubPay. Carpeta, usuario del
sistema, base de datos, puerto y server block de Nginx son propios: ningún
script toca nada de los otros dos.

| App | API | Front | Base | Carpeta |
| --- | --- | --- | --- | --- |
| NexoPOS | 4000 | 3000 | `nexopos` | `/opt/nexopos` |
| ClubPay | 4010 | 3110 | `clubpay` | `/opt/clubpay` |
| **Bankstore** | **4020** | — (estático) | `bankstore` | `/opt/bankstore` |

El frontend de Bankstore no necesita proceso: compila a estáticos y los sirve
Nginx desde `/opt/bankstore/dist`. Por eso ocupa un solo puerto.

Todo se sirve desde un único dominio:

```
bankstore.nexopos.app/       → estáticos (dist/)
bankstore.nexopos.app/api/   → backend Express en 127.0.0.1:4020
```

Un solo certificado y sin CORS, porque el navegador nunca cruza de origen.

## Instalación desde cero

```bash
sudo git clone -b main https://github.com/napy77/bankstore.git /opt/bankstore
```

```bash
sudo cp /opt/bankstore/deploy/bankstore.env.example /etc/bankstore-deploy.env
sudo chmod 600 /etc/bankstore-deploy.env
sudo nano /etc/bankstore-deploy.env
```

Antes de seguir, que el DNS resuelva:

```bash
dig +short bankstore.nexopos.app
```

```bash
sudo bash /opt/bankstore/deploy/setup-server.sh
```

```bash
sudo certbot --nginx -d bankstore.nexopos.app --agree-tos -m germanyovan@gmail.com --redirect
```

```bash
sudo bash /opt/bankstore/deploy/deploy.sh
```

## Actualizar

```bash
sudo bash /opt/bankstore/deploy/deploy.sh
```

Trae la rama, reinstala dependencias, compila backend y frontend, corre las
migraciones, reinicia la API y verifica que responda. Si algo falla después
del build, el commit anterior queda guardado:

```bash
sudo bash /opt/bankstore/deploy/deploy.sh --rollback
```

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
vez con un `JWT_SECRET` al azar. Si volvés a correr el setup, actualiza puerto,
URL y tasas, pero conserva el secreto: si cambiara, se caerían todas las
sesiones abiertas.

**Certbot escribe sobre el server block.** Después de pedir el certificado,
`/etc/nginx/sites-available/bankstore` tiene el bloque 443 que agregó certbot.
`setup-server.sh` lo detecta y no lo pisa. Si necesitás regenerarlo (cambio de
dominio o de puerto), borralo, corré el setup y volvé a pedir el certificado.

**Las tasas se cambian sin deploy.** `TNA_DEFAULT` e `IVA_INTERESES` viven en
`/etc/bankstore-deploy.env` y se copian al `.env` del backend. Para cambiarlas:
editá el `.env` del backend y `sudo systemctl restart bankstore-api`.

**`SEED_DEMO_DATA=true` recarga el catálogo en cada deploy.** Es lo que querés
en un entorno de prueba. Para producción real, ponelo en `false`: el seed no
borra órdenes ni usuarios, pero pisa precios y promos con los del prototipo.

**Repo privado.** Si `napy77/bankstore` es privado, el clone con HTTPS pide
credenciales y el script falla. Generá un token de solo lectura y poné:

```
REPO_URL=https://<token>@github.com/napy77/bankstore.git
```
