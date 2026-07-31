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

       1. DNS del dominio apuntando a este servidor
       2. sudo git clone -b main https://github.com/napy77/bankstore.git /opt/bankstore
       3. sudo cp /opt/bankstore/deploy/bankstore.env.example /etc/bankstore-deploy.env
          sudo nano /etc/bankstore-deploy.env
       4. sudo bash /opt/bankstore/deploy/setup-server.sh
       5. sudo certbot --nginx -d <dominio> --redirect
       6. sudo bash /opt/bankstore/deploy/deploy.sh   ← recién acá

     Está todo detallado en deploy/README.md"
}

[[ -f "$CONFIG" ]] || setup_primero "Falta $CONFIG."
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
say "Backend: dependencias y build"
# `npm ci` respeta el lockfile exacto. Se instalan también las devDependencies
# porque TypeScript hace falta para compilar; después no molestan.
run npm ci --prefix backend                 || die "Falló npm ci del backend"
run npm run build --prefix backend          || die "Falló el build del backend"
ok "backend compilado en backend/dist"

say "Migraciones"
# El backend las corre solo al arrancar, pero acá se hace explícito para que,
# si una migración falla, falle ANTES de reiniciar el servicio y no deje la
# API caída en un loop de reinicios.
run npm run migrate --prefix backend        || die "Falló una migración: NO reinicié la API"
ok "base al día"

# ─── 3. Frontend ─────────────────────────────────────────────────────────────
say "Frontend: dependencias y build"
run npm ci                                  || die "Falló npm ci del frontend"
run npm run build                           || die "Falló el build del frontend"
[[ -f dist/index.html ]] || die "El build no generó dist/index.html"
ok "frontend compilado en dist/ ($(du -sh dist | cut -f1))"

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
  SEED_EMAIL="${SEED_EMAIL:-demo@bankstore.test}" \
  SEED_PASSWORD="${SEED_PASSWORD:-bankstore2026}" \
    run npm run seed --prefix backend || warn "El seed del catálogo falló; el resto del deploy está bien."

  # Comercios, usuarios de back-office y acuerdos. Va aparte porque en una
  # instalación real el catálogo se carga distinto pero los comercios y el
  # admin siguen haciendo falta.
  #
  # Las API keys sólo se generan la primera vez: el secreto no se puede
  # recuperar, así que regenerarlas rompería integraciones ya configuradas.
  ADMIN_EMAIL="${ADMIN_EMAIL:-admin@bankstore.test}" \
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-bankstore-admin-2026}" \
  MERCHANT_PASSWORD="${MERCHANT_PASSWORD:-comercio-2026-demo}" \
    run npm run seed:marketplace --prefix backend || warn "El seed de comercios falló."
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

if curl -fsS --max-time 5 -o /dev/null "https://$DOMAIN/"; then
  ok "https://$DOMAIN sirve el frontend"
else
  warn "No pude verificar https://$DOMAIN desde el servidor."
  warn "Si todavía no pediste el certificado:"
  warn "    sudo certbot --nginx -d $DOMAIN --redirect"
fi

say "Listo"
echo "  commit desplegado: $(run git rev-parse --short HEAD)"
echo "  sitio:             https://$DOMAIN"
echo "  logs:              sudo journalctl -u bankstore-api -f"
$ROLLBACK || echo "  volver atrás:      sudo bash $APP_DIR/deploy/deploy.sh --rollback"
