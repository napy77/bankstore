#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Bankstore — despliegue (se corre cada vez que querés subir cambios)
#
#   sudo bash /opt/bankstore/deploy/deploy.sh
#   sudo bash /opt/bankstore/deploy/deploy.sh --rollback   # volver al anterior
#
# Flujo: git pull → dependencias → build (front y back) → migraciones →
#        reiniciar la API → publicar los estáticos → verificar.
#
# El desarrollo sigue siendo local + git. Este script sólo trae lo que ya está
# probado y en la rama.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CONFIG=${CONFIG:-/etc/bankstore-deploy.env}
ROLLBACK=false
[[ "${1:-}" == "--rollback" ]] && ROLLBACK=true

say()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[0;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[0;33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[0;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Corré esto con sudo."

setup_primero() {
  die "$1

     Todavía no corriste la instalación. El orden es:

       1. DNS de los TRES subdominios apuntando a este servidor
       2. sudo git clone -b main https://github.com/napy77/bankstore.git /opt/bankstore
       3. sudo cp /opt/bankstore/deploy/bankstore.env.example /etc/bankstore-deploy.env
          sudo vi /etc/bankstore-deploy.env
       4. sudo bash /opt/bankstore/deploy/setup-server.sh
       5. sudo certbot --nginx -d tienda... -d comercios... -d admin... --redirect
       6. sudo bash /opt/bankstore/deploy/deploy.sh   ← recién acá

     Está todo detallado en deploy/README.md"
}

[[ -f "$CONFIG" ]] || setup_primero "Falta $CONFIG."
# Un valor con espacios y sin comillas hace que `source` intente EJECUTAR lo
# que viene después del primer espacio. El error de bash ("No such file or
# directory: 172.16.0.0/12") no dice en qué línea ni por qué, así que conviene
# detectarlo acá y explicarlo. Pasa con ADMIN_ALLOWED_CIDRS, que es el único
# valor multi-palabra del archivo.
mala_linea=$(grep -nE "^[A-Z_]+=[^\"'#]*[[:space:]]" "$CONFIG" || true)
if [[ -n "$mala_linea" ]]; then
  die "Hay un valor con espacios sin comillas en $CONFIG:

       $mala_linea

     Bash toma sólo lo que va hasta el primer espacio y trata de ejecutar el
     resto como un comando. Ponelo entre comillas:

       ADMIN_ALLOWED_CIDRS=\"10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 127.0.0.1\""
fi

# shellcheck disable=SC1090
source "$CONFIG"

[[ -d "$APP_DIR/.git" ]] || setup_primero "No hay un repositorio en $APP_DIR."
[[ -f "$APP_DIR/backend/.env" ]] || setup_primero "Falta $APP_DIR/backend/.env."
[[ -f /etc/systemd/system/bankstore-api.service ]] || setup_primero "No está instalado el servicio bankstore-api."

cd "$APP_DIR" || die "No existe $APP_DIR"
run() { sudo -u "$APP_USER" "$@"; }

STATE_DIR=/var/lib/bankstore
mkdir -p "$STATE_DIR"
PREV_FILE="$STATE_DIR/previous-commit"

# ─── 1. Traer el código ──────────────────────────────────────────────────────
if $ROLLBACK; then
  [[ -f "$PREV_FILE" ]] || die "No hay commit anterior registrado: nada a lo que volver."
  TARGET=$(cat "$PREV_FILE")
  say "Volviendo al commit anterior: $TARGET"
  run git checkout -q "$TARGET" || die "No pude hacer checkout de $TARGET"
else
  say "Trayendo los cambios de $BRANCH"
  CURRENT=$(run git rev-parse HEAD)
  echo "$CURRENT" > "$PREV_FILE"

  # Un archivo tocado a mano en el servidor aborta el merge en silencio y te
  # deja creyendo que desplegaste. Mejor avisar y frenar.
  if ! run git diff --quiet || ! run git diff --cached --quiet; then
    warn "Hay cambios locales sin commitear en el servidor:"
    run git status --short
    die "Resolvelos (git checkout -- <archivo>) y volvé a correr."
  fi

  for intento in 1 2 3 4; do
    if run git fetch origin "$BRANCH"; then break; fi
    warn "Falló el fetch (intento $intento). Reintento en $((2 ** intento))s…"
    sleep $((2 ** intento))
    [[ $intento -eq 4 ]] && die "No pude traer el repositorio."
  done
  run git checkout -q "$BRANCH" 2>/dev/null || run git checkout -q -B "$BRANCH" "origin/$BRANCH"
  run git reset --hard "origin/$BRANCH"
  ok "en $(run git rev-parse --short HEAD) — $(run git log -1 --pretty=%s)"

  if [[ "$CURRENT" == "$(run git rev-parse HEAD)" ]]; then
    warn "No había nada nuevo, pero sigo igual: reconstruyo y reinicio."
  fi
fi

# ─── 2. Backend ──────────────────────────────────────────────────────────────
say "Dependencias"
# Un solo `npm ci` en la raíz instala los cuatro workspaces (backend, las tres
# apps y el paquete compartido) con el lockfile exacto. Se instalan también las
# devDependencies porque TypeScript y Vite hacen falta para compilar.
run npm ci                                  || die "Falló npm ci"
ok "dependencias instaladas"

say "Backend: build"
run npm run build --workspace bankstore-backend || die "Falló el build del backend"
ok "backend compilado en backend/dist"

say "Migraciones"
# El backend las corre solo al arrancar, pero acá se hace explícito para que,
# si una migración falla, falle ANTES de reiniciar el servicio y no deje la
# API caída en un loop de reinicios.
run npm run migrate --workspace bankstore-backend || die "Falló una migración: NO reinicié la API"
ok "base al día"

# ─── 3. Frontend ─────────────────────────────────────────────────────────────
say "Frontends: build de las tres apps"
run npm run build                           || die "Falló el build de los frontends"
for app in tienda comercios admin; do
  [[ -f "apps/$app/dist/index.html" ]] ||
    die "El build de $app no generó apps/$app/dist/index.html"
  ok "$app → apps/$app/dist ($(du -sh "apps/$app/dist" | cut -f1))"
done

# ─── 4. Reiniciar la API ─────────────────────────────────────────────────────
say "Reiniciando bankstore-api"
systemctl restart bankstore-api
sleep 2
systemctl is-active --quiet bankstore-api ||
  die "El servicio no levantó. Mirá qué pasó con:
     sudo journalctl -u bankstore-api -n 50 --no-pager"
ok "bankstore-api activo"

# ─── 5. Datos de prueba ──────────────────────────────────────────────────────
if [[ "${SEED_DEMO_DATA:-false}" == "true" ]]; then
  say "Cargando datos de demo"
  # El seed es idempotente (todo con ON CONFLICT DO UPDATE): no pisa las
  # órdenes ni los usuarios reales, sólo refresca catálogo y bancos.
  # Orden: primero los comercios, después el catálogo. El catálogo del
  # prototipo se publica bajo Electro Sur, así que ese comercio tiene que
  # existir antes; al revés el seed corta con un mensaje claro.
  #
  # Las API keys sólo se generan la primera vez: el secreto no se puede
  # recuperar, así que regenerarlas rompería integraciones ya configuradas.
  # Marcas y árbol de categorías: son estructura compartida, van primero.
  run npm run seed:catalogo --workspace bankstore-backend ||
    warn "El seed de marcas y categorías falló."

  ADMIN_EMAIL="${ADMIN_EMAIL:-admin@bankstore.test}" \
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-bankstore-admin-2026}" \
  MERCHANT_PASSWORD="${MERCHANT_PASSWORD:-comercio-2026-demo}" \
    run npm run seed:marketplace --workspace bankstore-backend ||
      warn "El seed de comercios falló."

  SEED_EMAIL="${SEED_EMAIL:-demo@bankstore.test}" \
  SEED_PASSWORD="${SEED_PASSWORD:-bankstore2026}" \
    run npm run seed --workspace bankstore-backend ||
      warn "El seed del catálogo falló; el resto del deploy está bien."

else
  ok "SEED_DEMO_DATA no está en true: no se toca el catálogo"
fi

# ─── 6. Verificación ─────────────────────────────────────────────────────────
say "Verificando"
API_PORT="${API_PORT:-4020}"
for intento in 1 2 3 4 5; do
  if curl -fsS --max-time 5 "http://127.0.0.1:$API_PORT/health" >/dev/null; then
    ok "la API responde en /health"
    break
  fi
  [[ $intento -eq 5 ]] && die "La API no respondió el healthcheck.
     Está el servicio corriendo pero no contesta. Revisá:
       sudo journalctl -u bankstore-api -n 50 --no-pager
     Para volver a la versión anterior:
       sudo bash $APP_DIR/deploy/deploy.sh --rollback"
  sleep 2
done

# Que el catálogo conteste es lo que confirma que la base está bien conectada:
# /health responde aunque Postgres esté caído.
if curl -fsS --max-time 5 "http://127.0.0.1:$API_PORT/api/catalog/categories" >/dev/null; then
  ok "el catálogo responde (la base está conectada)"
else
  warn "El catálogo no responde: revisá la conexión a Postgres en backend/.env"
fi

for d in "$STORE_DOMAIN" "$MERCHANT_DOMAIN"; do
  if curl -fsS --max-time 5 -o /dev/null "https://$d/"; then
    ok "https://$d responde"
  else
    warn "No pude verificar https://$d desde el servidor."
    warn "Si todavía no pediste los certificados, mirá el final de setup-server.sh."
  fi
done

# El admin se sirve sólo a la intranet. Desde el propio servidor entra si
# 127.0.0.1 está en ADMIN_ALLOWED_CIDRS; si no, un 403 es la respuesta
# CORRECTA y confirma que la restricción está puesta.
admin_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "https://$ADMIN_DOMAIN/" || echo "000")
case "$admin_code" in
  200) ok "https://$ADMIN_DOMAIN responde (este servidor está en la lista permitida)" ;;
  403) ok "https://$ADMIN_DOMAIN devuelve 403: la restricción de intranet está activa" ;;
  *)   warn "https://$ADMIN_DOMAIN respondió $admin_code: revisá el certificado y el DNS" ;;
esac

say "Listo"
echo "  commit desplegado: $(run git rev-parse --short HEAD)"
echo "  tienda:            https://$STORE_DOMAIN"
echo "  comercios:         https://$MERCHANT_DOMAIN"
echo "  admin:             https://$ADMIN_DOMAIN  (sólo intranet)"
echo "  logs:              sudo journalctl -u bankstore-api -f"
$ROLLBACK || echo "  volver atrás:      sudo bash $APP_DIR/deploy/deploy.sh --rollback"
