#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Bankstore — instalación en el servidor (se corre UNA vez, como root)
#
#   sudo bash deploy/setup-server.sh
#
# Qué hace:
#   1. Valida herramientas y que el puerto esté libre
#   2. Crea el usuario del sistema y la carpeta del proyecto
#   3. Clona el repo (o lo reutiliza si ya está)
#   4. Crea la base y el usuario de Postgres propios
#   5. Escribe el .env con secretos generados al azar
#   6. Instala el server block de Nginx y la unit de systemd
#   7. Deja todo listo para correr deploy.sh
#
# No toca nada de NexoPOS ni de ClubPay: carpeta, base, usuario, puerto y
# server block son propios. Es idempotente: se puede volver a correr.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CONFIG=${CONFIG:-/etc/bankstore-deploy.env}
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[0;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[0;33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[0;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Corré esto con sudo."

# ─── 1. Configuración y prerrequisitos ───────────────────────────────────────
say "Leyendo configuración"
if [[ ! -f "$CONFIG" ]]; then
  die "Falta $CONFIG.
     Copialo del repo y completalo:
       cp $HERE/bankstore.env.example $CONFIG
       chmod 600 $CONFIG
       nano $CONFIG"
fi
# shellcheck disable=SC1090
source "$CONFIG"

for var in DOMAIN APP_DIR REPO_URL BRANCH APP_USER API_PORT DB_NAME DB_USER; do
  [[ -n "${!var:-}" ]] || die "Falta $var en $CONFIG"
done
ok "Sitio: https://$DOMAIN  (/ estáticos · /api → 127.0.0.1:$API_PORT)"
ok "Carpeta: $APP_DIR · base: $DB_NAME"

say "Verificando herramientas"
for cmd in git node npm nginx psql; do
  command -v "$cmd" >/dev/null || die "Falta '$cmd'. Instalalo antes de seguir."
  ok "$cmd $(command -v "$cmd")"
done

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[[ "$NODE_MAJOR" -ge 20 ]] || die "Node $NODE_MAJOR es viejo: el backend usa ESM + Node 20+."
ok "Node $(node -v)"

# El puerto es el error más fácil de cometer al meter un tercer proyecto
say "Verificando que el puerto esté libre"
if ss -ltn 2>/dev/null | grep -q ":$API_PORT "; then
  die "El puerto $API_PORT ya está ocupado (¿NexoPOS en 4000? ¿ClubPay en 4010?).
     Cambiá API_PORT en $CONFIG y volvé a correr.
     Para ver qué hay tomado: sudo ss -ltnp"
fi
ok "puerto $API_PORT libre"

# ─── 2. Usuario y carpeta ────────────────────────────────────────────────────
say "Usuario del sistema y carpeta"
if id "$APP_USER" &>/dev/null; then
  ok "el usuario $APP_USER ya existe"
else
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
  ok "usuario $APP_USER creado"
fi

mkdir -p "$APP_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR"
ok "carpeta $APP_DIR lista"

# ─── 3. Repositorio ──────────────────────────────────────────────────────────
say "Repositorio"
if [[ -d "$APP_DIR/.git" ]]; then
  ok "ya está clonado; deploy.sh se encarga de actualizarlo"
else
  sudo -u "$APP_USER" git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR" ||
    die "No pude clonar $REPO_URL.
     Si el repo es privado, usá una URL con token de solo lectura:
       REPO_URL=https://<token>@github.com/napy77/bankstore.git"
  ok "clonado en la rama $BRANCH"
fi

# Lo más habitual es clonar como root para poder correr este script, y ahí los
# archivos quedan de root: después `sudo -u bankstore git fetch` falla por
# permisos y por el "dubious ownership" de git. Se normaliza siempre.
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
ok "todo el árbol pertenece a $APP_USER"

git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
ok "$APP_DIR habilitado para consultarlo con sudo"

# ─── 4. Base de datos ────────────────────────────────────────────────────────
say "Base de datos"
BACKEND_ENV="$APP_DIR/backend/.env"

if [[ -n "${DB_PASSWORD:-}" ]]; then
  ok "usando la contraseña de $CONFIG"
elif [[ -f "$BACKEND_ENV" ]] && grep -q '^DATABASE_URL=' "$BACKEND_ENV"; then
  # Al re-correr el setup no se puede generar una contraseña nueva a ciegas:
  # el ALTER ROLE de abajo la cambiaría en Postgres pero el .env se quedaría
  # con la vieja y el backend no podría conectarse. Se reutiliza la que hay.
  DB_PASSWORD=$(grep '^DATABASE_URL=' "$BACKEND_ENV" | head -1 |
                sed -E 's|^DATABASE_URL=postgres://[^:]+:([^@]+)@.*|\1|')
  if [[ -z "$DB_PASSWORD" || "$DB_PASSWORD" == DATABASE_URL=* ]]; then
    die "No pude leer la contraseña de $BACKEND_ENV.
     Poné DB_PASSWORD en $CONFIG con la que figura ahí y volvé a correr."
  fi
  ok "reutilizando la contraseña que ya está en el .env"
else
  DB_PASSWORD=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
  ok "contraseña de base generada"
fi

role_exists=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'")
if [[ "$role_exists" == "1" ]]; then
  sudo -u postgres psql -q -c "ALTER ROLE $DB_USER WITH PASSWORD '$DB_PASSWORD'"
  ok "usuario $DB_USER ya existía; contraseña actualizada"
else
  sudo -u postgres psql -q -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD'"
  ok "usuario $DB_USER creado"
fi

db_exists=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")
if [[ "$db_exists" == "1" ]]; then
  ok "la base $DB_NAME ya existía (no se toca)"
else
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
  ok "base $DB_NAME creada"
fi
sudo -u postgres psql -q -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO $DB_USER"

# ─── 5. Variables de entorno ─────────────────────────────────────────────────
say "Archivo .env del backend"

# Reescribe una variable dejando el resto intacto, para que re-correr el setup
# con otro dominio o puerto actualice lo que corresponde sin tocar JWT_SECRET,
# que no se puede regenerar sin desloguear a todo el mundo.
set_env_var() {
  local file=$1 key=$2 value=$3
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

if [[ -f "$BACKEND_ENV" ]]; then
  ok "$BACKEND_ENV ya existe: se conserva JWT_SECRET"
  set_env_var "$BACKEND_ENV" PORT "$API_PORT"
  set_env_var "$BACKEND_ENV" HOST "127.0.0.1"
  set_env_var "$BACKEND_ENV" DATABASE_URL \
    "postgres://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME"
  set_env_var "$BACKEND_ENV" PUBLIC_URL "https://$DOMAIN"
  set_env_var "$BACKEND_ENV" TNA_DEFAULT "${TNA_DEFAULT:-0.42}"
  set_env_var "$BACKEND_ENV" IVA_INTERESES "${IVA_INTERESES:-0.21}"
  ok "puerto, URL y tasas sincronizados con $CONFIG"
else
  # Si JWT_SECRET cambia, se caen todas las sesiones abiertas.
  JWT_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n=')
  cat > "$BACKEND_ENV" <<EOF
# Generado por deploy/setup-server.sh — $(date -Iseconds)
# NO borrar JWT_SECRET: si cambia, se caen todas las sesiones.
PORT=$API_PORT
# Solo por loopback: a la API se entra por Nginx, no directo desde internet
HOST=127.0.0.1
DATABASE_URL=postgres://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME
JWT_SECRET=$JWT_SECRET
PUBLIC_URL=https://$DOMAIN

# Parámetros financieros (ver deploy/README.md)
TNA_DEFAULT=${TNA_DEFAULT:-0.42}
IVA_INTERESES=${IVA_INTERESES:-0.21}
EOF
  ok "$BACKEND_ENV creado con secretos nuevos"
fi
chown "$APP_USER:$APP_USER" "$BACKEND_ENV"
chmod 600 "$BACKEND_ENV"

# ─── 6. Nginx y systemd ──────────────────────────────────────────────────────
say "Nginx"
render() {
  sed -e "s|__DOMAIN__|$DOMAIN|g" \
      -e "s|__API_PORT__|$API_PORT|g" \
      -e "s|__APP_DIR__|$APP_DIR|g" \
      -e "s|__APP_USER__|$APP_USER|g" \
      "$1"
}

NGINX_CONF=/etc/nginx/sites-available/bankstore

# Certbot ESCRIBE sobre este archivo: le agrega el bloque 443 con los
# certificados y el redirect. Regenerarlo desde la plantilla lo borraría y el
# sitio volvería a HTTP, con Nginx respondiendo el certificado de otro vhost
# ("no alternative certificate subject name matches").
if [[ -f "$NGINX_CONF" ]] && grep -q 'ssl_certificate' "$NGINX_CONF"; then
  warn "$NGINX_CONF ya tiene el HTTPS que agregó certbot: NO se toca."
  warn "Si de verdad necesitás regenerarlo (cambiaste el dominio o el puerto):"
  warn "    sudo rm $NGINX_CONF"
  warn "    sudo bash $HERE/setup-server.sh"
  warn "    sudo certbot --nginx -d $DOMAIN --redirect"
  nginx -t || die "La configuración de Nginx no valida."
else
  # En un servidor sin IPv6, `listen [::]:80` hace fallar TODO Nginx —incluido
  # NexoPOS y ClubPay— con "Address family not supported". Se saca si no hay.
  if [[ -f /proc/net/if_inet6 ]]; then
    ok "IPv6 disponible: se deja el listen [::]:80"
    render "$HERE/nginx/bankstore.conf.template" > "$NGINX_CONF"
  else
    warn "este servidor no tiene IPv6: se omite el listen [::]:80"
    render "$HERE/nginx/bankstore.conf.template" | grep -v 'listen \[::\]' > "$NGINX_CONF"
  fi
  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/bankstore

  # Nginx no arranca si el root no existe todavía (el primer deploy aún no
  # corrió). Se crea vacío con un placeholder para que `nginx -t` pase.
  if [[ ! -d "$APP_DIR/dist" ]]; then
    sudo -u "$APP_USER" mkdir -p "$APP_DIR/dist"
    echo '<!doctype html><title>Bankstore</title><p>Falta correr deploy.sh</p>' \
      > "$APP_DIR/dist/index.html"
    chown "$APP_USER:$APP_USER" "$APP_DIR/dist/index.html"
    ok "dist/ provisorio creado (deploy.sh lo reemplaza con el build real)"
  fi

  nginx -t || die "La configuración de Nginx no valida. No recargué nada: lo que está sirviendo hoy sigue intacto."
  systemctl reload nginx
  ok "server block instalado y Nginx recargado"
fi

# Nginx corre como www-data y tiene que poder leer dist/. Los directorios del
# camino necesitan +x para atravesarlos.
chmod o+x "$APP_DIR" 2>/dev/null || true

say "Servicio systemd"
render "$HERE/systemd/bankstore-api.service.template" > /etc/systemd/system/bankstore-api.service
systemctl daemon-reload
systemctl enable bankstore-api >/dev/null
ok "bankstore-api habilitado al arranque"

# ─── Cierre ──────────────────────────────────────────────────────────────────
cat <<EOF

┌────────────────────────────────────────────────────────────────────────────┐
│  Servidor preparado. Faltan 3 pasos:                                       │
└────────────────────────────────────────────────────────────────────────────┘

  1. DNS — que $DOMAIN apunte (registro A) a la IP de este
     servidor. Verificalo con:

       dig +short $DOMAIN

  2. Certificado HTTPS — recién cuando el DNS resuelva:

       sudo certbot --nginx -d $DOMAIN \\
         --agree-tos -m ${CERTBOT_EMAIL:-tu@email.com} --redirect

  3. Desplegar:

       sudo bash $APP_DIR/deploy/deploy.sh

EOF
