#!/usr/bin/env node
/* =========================================================================
   STIKE BIKE SHOP: avisa a los buscadores que usan IndexNow (Bing, y con eso
   Copilot y la busqueda de ChatGPT, mas Yandex y otros) de las paginas que
   cambiaron en este deploy. Sin esto, Bing tarda dias o semanas en enterarse
   de un producto nuevo o de un precio nuevo.

     node tools/indexnow.mjs --since <sha>   solo lo que cambio desde ese commit
     node tools/indexnow.mjs --all           todas las URL del sitemap
     node tools/indexnow.mjs --dry           muestra lo que enviaria, no envia

   Lo corre .github/workflows/deploy-hostinger.yml DESPUES de publicar. Nunca
   falla el deploy: si no hay red o IndexNow no responde, solo lo dice.
   Google no usa IndexNow; a Google lo alimentan sitemap.xml y Search Console.
   ========================================================================= */
import { execFileSync } from "node:child_process";
import { SITE, read, indexNowKey, ROOT } from "./lib-catalog.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };
const DRY = flag("--dry");

const SKIP = /^(admin|propuesta|carrito|pago-resultado|producto|marca-fate|404|_template)\.html$/;

function urlFor(file) {
  if (file === "index.html") return SITE.url("");
  if (/^(producto|categoria|marca)\/[^/]+\.html$/.test(file)) return SITE.url(file);
  if (/^fate\/[^/]*\.html$/.test(file)) return SITE.url(file.replace(/index\.html$/, ""));
  if (/^[^/]+\.html$/.test(file) && !SKIP.test(file)) return SITE.url(file);
  return null;
}

let urls;
if (flag("--all")) {
  urls = [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
} else {
  let since = val("--since");
  if (!since || /^0+$/.test(since)) since = "HEAD~1";
  let files = [];
  try {
    files = execFileSync("git", ["diff", "--name-only", since, "HEAD"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch (e) { console.log("IndexNow: no se pudo leer el diff (" + e.message.split("\n")[0] + "); nada que avisar."); process.exit(0); }
  urls = files.map(urlFor).filter(Boolean);
  /* Si cambio el catalogo, la tienda y el inicio tambien cambiaron. */
  if (files.includes("assets/js/products-data.js")) urls.push(SITE.url("tienda.html"), SITE.url(""));
}
urls = [...new Set(urls)].slice(0, 500);
if (!urls.length) { console.log("IndexNow: ninguna pagina publica cambio; nada que avisar."); process.exit(0); }

const key = indexNowKey();
const keyLocation = SITE.url(`${key}.txt`);
console.log(`IndexNow: ${urls.length} URL${urls.length === 1 ? "" : "s"}${DRY ? " (--dry)" : ""}`);
urls.slice(0, 8).forEach((u) => console.log("  · " + u));
if (DRY) process.exit(0);

try {
  /* La llave tiene que estar publicada o IndexNow rechaza el aviso. */
  const chk = await fetch(keyLocation, { signal: AbortSignal.timeout(15000) });
  const body = chk.ok ? (await chk.text()).trim() : "";
  if (body !== key) { console.log(`IndexNow: ${keyLocation} todavia no responde con la llave (HTTP ${chk.status}); se avisara en el proximo deploy.`); process.exit(0); }
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ host: SITE.domain, key, keyLocation, urlList: urls }),
  });
  console.log(`IndexNow: HTTP ${res.status} ${res.status === 200 || res.status === 202 ? "(aceptado)" : "(no aceptado)"}`);
} catch (e) {
  console.log("IndexNow: no se pudo avisar (" + e.message + "). No afecta al sitio.");
}
