#!/usr/bin/env bash
# =========================================================================
# STIKE BIKE SHOP: arma la copia limpia del sitio para Hostinger y la empuja
# a la rama de despliegue (por defecto "hostinger-deploy").
#
#   tools/publish-hostinger.sh <url-del-repo-remoto> [rama=hostinger-deploy]
#
# Lo corre .github/workflows/deploy-hostinger.yml. Hostinger (hPanel >
# Avanzado > Git) esta conectado a ESA rama, no a la de trabajo: asi lo que
# llega al hosting es solo lo que el sitio necesita -- sin costos, sin ventas,
# sin herramientas, sin el backend de Vercel. Es el equivalente de los
# "rm" del workflow de GitHub Pages, pero como lista de lo que SI se publica.
#
# Hace un commit nuevo encima de la rama de despliegue (historia lineal, para
# que el "git pull" de Hostinger siempre avance sin conflictos). Si no hay
# cambios, no hace nada.
#
# Para probarlo sin tocar GitHub:  tools/publish-hostinger.sh /ruta/a/un/repo.git
# =========================================================================
set -euo pipefail

REMOTE="${1:?uso: publish-hostinger.sh <url-del-repo-remoto> [rama]}"
BRANCH="${2:-hostinger-deploy}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1) Rama de despliegue existente (para sumar un commit encima) o nueva.
if git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
  git clone --quiet --depth 1 --branch "$BRANCH" "$REMOTE" "$WORK/deploy"
else
  git init --quiet -b "$BRANCH" "$WORK/deploy"
  git -C "$WORK/deploy" remote add origin "$REMOTE"
fi

# 2) Copia limpia de lo que esta commiteado (git archive: nunca arrastra
#    archivos locales sin versionar como .env o api/config.local.php), menos
#    lo interno. Lo que NO debe llegar al hosting:
#    - datos del negocio (costos, ventas, auditoria): nunca se publican
#    - documentos y prototipos internos, herramientas, el backend de Vercel
#    data/site-content.json SI se publica: el sitio lo lee en vivo.
find "$WORK/deploy" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git -C "$SRC" archive --format=tar HEAD | tar -x -C "$WORK/deploy"
cd "$WORK/deploy"
rm -rf .github .gitignore package.json package-lock.json tools vercel-wompi-api bmx-builder \
  data/costs.json data/sales-log.json data/audit-log.json \
  PROPOSAL.md MOTOR.md README.md propuesta.html _template.html CNAME
cd "$SRC"

# 3) Red de seguridad: si algo interno se cuela, no se publica.
for forbidden in data/costs.json data/sales-log.json data/audit-log.json vercel-wompi-api tools .env api/config.local.php PROPOSAL.md; do
  if [ -e "$WORK/deploy/$forbidden" ]; then echo "ERROR: $forbidden quedo en la copia a publicar" >&2; exit 1; fi
done
for required in index.html carrito.html pago-resultado.html .htaccess api/_lib.php api/wompi-sign.php api/wompi-order.php api/wompi-events.php api/sales.php data/site-content.json assets/js/products-data.js; do
  if [ ! -e "$WORK/deploy/$required" ]; then echo "ERROR: falta $required en la copia a publicar" >&2; exit 1; fi
done

# 4) Commit y push (solo si cambio algo).
cd "$WORK/deploy"
git add -A
if git diff --cached --quiet; then echo "Sin cambios que publicar en $BRANCH."; exit 0; fi
REV="$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo desconocido)"
git -c user.name="${GIT_AUTHOR_NAME:-github-actions[bot]}" -c user.email="${GIT_AUTHOR_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}" \
  commit --quiet -m "Deploy a Hostinger desde $REV"
git push --quiet origin "HEAD:refs/heads/$BRANCH"
echo "Publicado en $BRANCH ($(git rev-parse --short HEAD)), $(git ls-files | wc -l) archivos."
