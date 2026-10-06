#!/usr/bin/env node
/* =========================================================================
   STIKE BIKE SHOP: consulta de estado de una transaccion Wompi (Node, para
   pruebas locales). Espejo de api/wompi-status.php -- ver ese archivo para
   la version que corre en Hostinger.

   Wompi exige la llave PRIVADA (Bearer) para consultar una transaccion por
   id; la publica ya no alcanza. Por eso esto, igual que la firma, tiene
   que vivir en un backend y nunca en el navegador.
   ========================================================================= */
import { loadEnv } from "./wompi-sign.mjs";

export function wompiApiBase(privateKey) {
  return privateKey.startsWith("prv_prod_") ? "https://production.wompi.co/v1" : "https://sandbox.wompi.co/v1";
}

export async function fetchWompiTransaction(id, privateKey) {
  const base = wompiApiBase(privateKey);
  const res = await fetch(`${base}/transactions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${privateKey}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(`Wompi respondio ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const id = process.argv[2];
  if (!id) {
    console.error("uso: node tools/wompi-status.mjs <transaction_id>");
    process.exit(1);
  }
  const env = loadEnv();
  const privateKey = env.WOMPI_PRIVATE_KEY;
  if (!privateKey) {
    console.error("falta WOMPI_PRIVATE_KEY en .env");
    process.exit(1);
  }
  const data = await fetchWompiTransaction(id, privateKey);
  console.log(JSON.stringify(data, null, 2));
}
