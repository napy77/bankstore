#!/usr/bin/env python3
"""
Verifica que cada subdominio exponga sólo las rutas de API que le tocan.

No reemplaza a `nginx -t` (que valida la sintaxis); esto valida la INTENCIÓN,
que es lo que un error de sintaxis no te va a decir: que /api/admin no se
alcance desde la tienda pública.

Simula el orden de resolución de `location` de Nginx:
  1. `= /ruta`      exacto, gana siempre
  2. prefijos       se recuerda el más largo
  3. `^~ /prefijo`  si el más largo lo tiene, se usa y NO se evalúan regex
  4. `~ regex`      en orden de aparición, el primero que matchea gana
  5. si ningún regex matchea, se usa el prefijo recordado

    python3 deploy/verificar-ruteo.py
"""
import re
import sys
from pathlib import Path

PLANTILLA = Path(__file__).parent / "nginx" / "bankstore.conf.template"


def parsear_bloques(texto):
    """Devuelve {server_name: [(tipo, patrón, cuerpo), ...]} por server block."""
    bloques = {}
    for cuerpo in re.findall(r"^server \{(.*?)^\}", texto, re.S | re.M):
        nombre = re.search(r"server_name\s+(\S+);", cuerpo)
        if not nombre:
            continue
        locations = []
        for m in re.finditer(r"^\s{4}location\s+(=|\^~|~\*|~)?\s*(\S+)\s*\{", cuerpo, re.M):
            modificador, patron = m.group(1) or "", m.group(2)
            # Cuerpo aproximado: hasta el próximo location de primer nivel
            resto = cuerpo[m.end():]
            fin = re.search(r"^\s{4}location\s", resto, re.M)
            locations.append((modificador, patron, resto[: fin.start() if fin else None]))
        bloques[nombre.group(1)] = locations
    return bloques


def normalizar(uri):
    """
    Nginx colapsa los `..` y las barras repetidas ANTES de elegir el location.
    Sin esto, /api/../api/admin/x parecería no matchear el filtro y daría una
    falsa sensación de seguridad en la simulación (en el servidor real sí
    matchea, porque para cuando se evalúan los location ya es /api/admin/x).
    """
    partes = []
    for parte in uri.split("/"):
        if parte == "..":
            if partes:
                partes.pop()
        elif parte not in ("", "."):
            partes.append(parte)
    normalizada = "/" + "/".join(partes)
    return normalizada + "/" if uri.endswith("/") and normalizada != "/" else normalizada


def resolver(locations, uri):
    """Qué location gana para esta URI, siguiendo el orden de Nginx."""
    uri = normalizar(uri)
    for mod, patron, cuerpo in locations:
        if mod == "=" and uri == patron:
            return patron, cuerpo

    mejor_prefijo = None
    for mod, patron, cuerpo in locations:
        if mod in ("", "^~") and uri.startswith(patron):
            if mejor_prefijo is None or len(patron) > len(mejor_prefijo[1]):
                mejor_prefijo = (mod, patron, cuerpo)

    if mejor_prefijo and mejor_prefijo[0] == "^~":
        return mejor_prefijo[1], mejor_prefijo[2]

    for mod, patron, cuerpo in locations:
        if mod == "~" and re.search(patron, uri):
            return patron, cuerpo

    if mejor_prefijo:
        return mejor_prefijo[1], mejor_prefijo[2]
    return None, ""


def destino(cuerpo):
    if "bankstore-proxy.conf" in cuerpo or "proxy_pass" in cuerpo:
        return "backend"
    if "return 404" in cuerpo:
        return "404"
    if "try_files" in cuerpo:
        return "spa"
    return "?"


# (uri, tienda, comercios, admin) — qué DEBE pasar en cada subdominio
CASOS = [
    # Comprador
    ("/api/auth/login",            "backend", "404",     "404"),
    ("/api/catalog/products",      "backend", "404",     "backend"),
    ("/api/cards",                 "backend", "404",     "404"),
    ("/api/orders",                "backend", "404",     "404"),
    # Back-office
    ("/api/staff/login",           "404",     "backend", "backend"),
    ("/api/merchant/products",     "404",     "backend", "404"),
    ("/api/merchant/api-keys",     "404",     "backend", "404"),
    # Administración: sólo desde el subdominio restringido
    ("/api/admin/merchants",       "404",     "404",     "backend"),
    ("/api/admin/agreements",      "404",     "404",     "backend"),
    ("/api/admin/settlements",     "404",     "404",     "backend"),
    ("/api/admin/staff",           "404",     "404",     "backend"),
    # Integración de comercios
    ("/api/v1/products",           "404",     "backend", "404"),
    ("/api/v1/stock",              "404",     "backend", "404"),
    # Intentos de esquivar el filtro
    ("/api/adminx/cosa",           "404",     "404",     "404"),
    ("/api/administracion",        "404",     "404",     "404"),
    ("/api/../api/admin/merchants","404",     "404",     "backend"),
    ("/api/",                      "404",     "404",     "404"),
    ("/api/loquesea",              "404",     "404",     "404"),
    # Navegación del SPA
    ("/",                          "spa",     "spa",     "spa"),
    ("/producto/p_abc",            "spa",     "spa",     "spa"),
]

DOMINIOS = ["__STORE_DOMAIN__", "__MERCHANT_DOMAIN__", "__ADMIN_DOMAIN__"]
ETIQUETAS = ["tienda", "comercios", "admin"]

bloques = parsear_bloques(PLANTILLA.read_text())
faltan = [d for d in DOMINIOS if d not in bloques]
if faltan:
    sys.exit(f"No encontré los server blocks: {faltan}")

fallos = []
print(f"{'ruta':<30} {'tienda':>10} {'comercios':>10} {'admin':>10}")
print("─" * 64)
for uri, *esperados in CASOS:
    obtenidos = []
    for dominio in DOMINIOS:
        _, cuerpo = resolver(bloques[dominio], uri)
        obtenidos.append(destino(cuerpo))
    ok = obtenidos == esperados
    marca = " " if ok else "  ✗"
    print(f"{uri:<30} " + " ".join(f"{o:>10}" for o in obtenidos) + marca)
    if not ok:
        fallos.append((uri, esperados, obtenidos))

print("─" * 64)
if fallos:
    print(f"\n{len(fallos)} caso(s) mal ruteados:\n")
    for uri, esp, obt in fallos:
        for etiqueta, e, o in zip(ETIQUETAS, esp, obt):
            if e != o:
                print(f"  {uri} en {etiqueta}: esperaba {e}, da {o}")
    sys.exit(1)

print(f"✓ {len(CASOS)} rutas verificadas. /api/admin sólo se alcanza desde el subdominio de administración.")
