#!/usr/bin/env bash
# =========================================================================
# STIKE BIKE SHOP: arma la copia limpia del sitio y la empuja a la rama que
# Hostinger descarga (por defecto "hostinger-deploy").
#
#   tools/publish-hostinger.sh <url-del-repo-remoto> [rama=hostinger-deploy]
#
# Lo corre .github/workflows/deploy-hostinger.yml en cada publicacion. Hostinger
# (hPanel > Avanzado > Git) esta conectado a ESA rama, no a la de trabajo: asi
# lo que llega al hosting es solo lo que el sitio necesita -- sin costos, sin
# ventas, sin herramientas, sin el backend de Vercel. La lista de lo que se
# quita (y la red de seguridad que aborta si algo interno se cuela) vive en
# tools/stage-hostinger.sh.
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

# 1) Copia limpia (aborta aqui, antes de tocar nada, si algo interno se cuela).
"$SRC/tools/stage-hostinger.sh" "$WORK/stage"

# 2) Rama de despliegue existente (para sumar un commit encima) o nueva.
if git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
  git clone --quiet --depth 1 --branch "$BRANCH" "$REMOTE" "$WORK/deploy"
else
  git init --quiet -b "$BRANCH" "$WORK/deploy"
  git -C "$WORK/deploy" remote add origin "$REMOTE"
fi

# 3) La rama queda IGUAL a la copia limpia: lo que se borro del sitio se borra tambien.
find "$WORK/deploy" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a "$WORK/stage/." "$WORK/deploy/"

# 4) Commit y push (solo si cambio algo).
cd "$WORK/deploy"
git add -A
if git diff --cached --quiet; then echo "Sin cambios que publicar en $BRANCH."; exit 0; fi
REV="$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo desconocido)"
git -c user.name="${GIT_AUTHOR_NAME:-github-actions[bot]}" -c user.email="${GIT_AUTHOR_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}" \
  commit --quiet -m "Deploy a Hostinger desde $REV"
git push --quiet origin "HEAD:refs/heads/$BRANCH"
echo "Publicado en $BRANCH ($(git rev-parse --short HEAD)), $(git ls-files | wc -l) archivos."
