#!/usr/bin/env node
/* =========================================================================
   STIKE BIKE SHOP: firma de integridad de Wompi (uso en Node, para pruebas
   locales contra el sandbox real antes de que exista un backend en vivo).

   La formula es la misma que api/wompi-sign.php va a correr en Hostinger:
   SHA256(reference + amountInCents + currency + integritySecret), hex.

   El secreto SIEMPRE sale de una variable de entorno (.env, no versionado).
   Nunca lo pongas en el codigo ni en un archivo que se suba al repo: este
   archivo solo sabe LEER el secreto, no lo contiene.
   ========================================================================= */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function loadEnv(envPath = path.join(ROOT, ".env")) {
  const out = {};
  let raw;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

export function signWompiTransaction({ reference, amountInCents, currency, integritySecret }) {
  if (!reference || !amountInCents || !currency || !integritySecret) {
    throw new Error("signWompiTransaction: faltan reference, amountInCents, currency o integritySecret");
  }
  const concat = `${reference}${amountInCents}${currency}${integritySecret}`;
  return createHash("sha256").update(concat).digest("hex");
}

/* CLI: node tools/wompi-sign.mjs <reference> <amountInCents> <currency=COP> */
if (import.meta.url === `file://${process.argv[1]}`) {
  const [reference, amountInCents, currency = "COP"] = process.argv.slice(2);
  if (!reference || !amountInCents) {
    console.error("uso: node tools/wompi-sign.mjs <reference> <amountInCents> [currency=COP]");
    process.exit(1);
  }
  const env = loadEnv();
  const integritySecret = env.WOMPI_INTEGRITY_SECRET;
  if (!integritySecret) {
    console.error("falta WOMPI_INTEGRITY_SECRET en .env");
    process.exit(1);
  }
  const signature = signWompiTransaction({ reference, amountInCents, currency, integritySecret });
  console.log(signature);
}
