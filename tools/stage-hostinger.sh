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

# Lo que NO debe llegar al hosting:
#  - datos del negocio (costos, ventas, auditoria): nunca se publican
#  - documentos y prototipos internos, herramientas, el backend de Vercel
# data/site-content.json SI se publica: el sitio lo lee en vivo.
( cd "$OUT" && rm -rf .github .gitignore package.json package-lock.json tools vercel-wompi-api bmx-builder \
    data/costs.json data/sales-log.json data/audit-log.json \
    PROPOSAL.md MOTOR.md README.md propuesta.html _template.html CNAME )

# Red de seguridad: si algo interno se cuela, no se publica.
for forbidden in data/costs.json data/sales-log.json data/audit-log.json vercel-wompi-api tools .env api/config.local.php PROPOSAL.md; do
  if [ -e "$OUT/$forbidden" ]; then echo "ERROR: $forbidden quedo en la copia a publicar" >&2; exit 1; fi
done
for required in index.html carrito.html pago-resultado.html .htaccess api/_lib.php api/wompi-sign.php api/wompi-order.php api/wompi-events.php api/sales.php api/sync.php data/site-content.json assets/js/products-data.js; do
  if [ ! -e "$OUT/$required" ]; then echo "ERROR: falta $required en la copia a publicar" >&2; exit 1; fi
done

echo "Copia lista en $OUT: $(find "$OUT" -type f | wc -l) archivos."
