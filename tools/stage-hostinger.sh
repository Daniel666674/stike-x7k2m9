#!/usr/bin/env bash
# =========================================================================
# STIKE BIKE SHOP: arma la copia limpia del sitio que se sube a Hostinger.
#
#   tools/stage-hostinger.sh <carpeta-de-salida>
#
# La usa tools/publish-hostinger.sh (que corre .github/workflows/deploy-hostinger.yml)
# para armar la rama que Hostinger descarga. Lo que llega al hosting es SOLO lo que el sitio necesita: sin costos, sin ventas,
# sin herramientas, sin el backend de Vercel. Es una lista de lo que se QUITA
# de lo commiteado, mas una red de seguridad que aborta si algo interno se cuela.
#
# Usa lo que esta commiteado (git archive), asi que nunca arrastra archivos
# locales sin versionar como .env o api/config.local.php.
# =========================================================================
set -euo pipefail

OUT="${1:?uso: stage-hostinger.sh <carpeta-de-salida>}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -e "$OUT" ] && [ -n "$(ls -A "$OUT" 2>/dev/null)" ]; then
  echo "ERROR: $OUT ya existe y no esta vacia" >&2; exit 1
fi
mkdir -p "$OUT"
git -C "$SRC" archive --format=tar HEAD | tar -x -C "$OUT"

# SEO/GEO automatico: con el catalogo vigente se regeneran las paginas de
# tipo y de marca, el head de las paginas fijas, robots.txt, llms.txt, el feed
# de Google, las redirecciones 301, las fichas de producto y el sitemap
# (tools/build-seo.mjs y tools/build-pages.mjs, con STIKE_ROOT apuntando a esta
# copia). Si algo falla NO se frena el deploy: el stock y los precios tienen que
# llegar igual, y el repo ya trae la ultima version generada.
if command -v node >/dev/null 2>&1; then
  if ! ( STIKE_ROOT="$OUT" node "$SRC/tools/build-seo.mjs" && STIKE_ROOT="$OUT" node "$SRC/tools/build-pages.mjs" ); then
    echo "AVISO: no se pudo regenerar el SEO; se publica lo que esta commiteado." >&2
  fi
else
  echo "AVISO: no hay node; no se regenero el SEO (se publica lo commiteado)." >&2
fi

# Lo que NO debe llegar al hosting:
#  - datos del negocio (costos, ventas, auditoria): nunca se publican
#  - documentos y prototipos internos, herramientas, el backend de Vercel
# data/site-content.json SI se publica: el sitio lo lee en vivo.
( cd "$OUT" && rm -rf .github .gitignore package.json package-lock.json tools vercel-wompi-api bmx-builder \
    data/costs.json data/sales-log.json data/audit-log.json \
    PROPOSAL.md MOTOR.md README.md SEO.md propuesta.html _template.html CNAME )

# Cache-busting: el ?v= de los .js/.css (catalogo incluido) pasa a ser un hash
# de su contenido, para que ningun cache (navegador o CDN) sirva uno viejo.
if command -v node >/dev/null 2>&1; then
  node "$SRC/tools/stamp-assets.mjs" "$OUT"
else
  echo "AVISO: no hay node; no se estamparon los assets (los ?v= quedan como estan)." >&2
fi

# Red de seguridad: si algo interno se cuela, no se publica.
for forbidden in data/costs.json data/sales-log.json data/audit-log.json vercel-wompi-api tools .env api/config.local.php PROPOSAL.md SEO.md; do
  if [ -e "$OUT/$forbidden" ]; then echo "ERROR: $forbidden quedo en la copia a publicar" >&2; exit 1; fi
done
for required in index.html carrito.html pago-resultado.html .htaccess api/_lib.php api/wompi-sign.php api/wompi-order.php api/wompi-events.php api/sales.php api/sync.php api/_admin.php api/admin-login.php api/admin-health.php api/gh.php admin.php admin.html admin.js data/site-content.json assets/js/products-data.js robots.txt sitemap.xml llms.txt 404.html; do
  if [ ! -e "$OUT/$required" ]; then echo "ERROR: falta $required en la copia a publicar" >&2; exit 1; fi
done

echo "Copia lista en $OUT: $(find "$OUT" -type f | wc -l) archivos."
