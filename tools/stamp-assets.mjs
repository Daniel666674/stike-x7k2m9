#!/usr/bin/env node
/* =========================================================================
   STIKE BIKE SHOP: estampa el "?v=" de los .js/.css con un hash de su
   CONTENIDO, dentro de la copia que se sube a Hostinger.

     node tools/stamp-assets.mjs <carpeta-de-la-copia>

   Por que existe: el hosting (y el CDN que tenga delante) guarda los .js y
   .css un año, e incluso puede ignorar el "no-cache" del catalogo. La unica
   forma segura de que todo visitante reciba el archivo nuevo es que su URL
   cambie. Aca SI se estampa assets/js/products-data.js (el catalogo con el
   stock): cada publicacion del panel dispara un despliegue, y cada despliegue
   deja en TODAS las paginas el hash del catalogo que de verdad se subio.

   Solo toca la copia (carpeta de salida), nunca el repo de trabajo.
   ========================================================================= */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.existsSync(root)) { console.error("uso: stamp-assets.mjs <carpeta>"); process.exit(1); }

const RE = /((?:src|href)=")((?:\.{1,2}\/)*assets\/(?:js|css)\/[A-Za-z0-9._-]+\.(?:js|css))(\?v=[^"]*)?(")/g;
const cache = new Map();
const hash = (rel) => {
  if (!cache.has(rel)) {
    const abs = path.join(root, rel);
    cache.set(rel, fs.existsSync(abs) ? crypto.createHash("sha1").update(fs.readFileSync(abs)).digest("hex").slice(0, 10) : null);
  }
  return cache.get(rel);
};

let files = 0, refs = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { walk(abs); continue; }
    if (!e.name.endsWith(".html")) continue;
    const before = fs.readFileSync(abs, "utf8");
    const after = before.replace(RE, (m, pre, file, q, post) => {
      const h = hash(file.replace(/^(?:\.{1,2}\/)+/, ""));
      if (!h) return m;
      refs++;
      return `${pre}${file}?v=${h}${post}`;
    });
    if (after !== before) { fs.writeFileSync(abs, after); files++; }
  }
})(root);
console.log(`Assets estampados: ${refs} referencias en ${files} paginas.`);
