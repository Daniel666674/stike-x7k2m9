<?php
/* =========================================================================
   STIKE BIKE SHOP: firma de integridad de Wompi (backend real, Hostinger).

   Este archivo es el UNICO lugar donde el secreto de integridad de Wompi
   puede existir. Nunca lo hardcodees aca ni lo subas al repo -- lo lee de:
     1. la variable de entorno WOMPI_INTEGRITY_SECRET (si el panel de
        Hostinger permite configurarla), o si no
     2. config.local.php, un archivo que subes a mano por FTP/Administrador
        de archivos, al lado de este (api/config.local.php), con:
          <?php return ['WOMPI_INTEGRITY_SECRET' => 'prv_integrity_...'];
        Ese archivo NUNCA se commitea (ver .gitignore: api/config.local.php).

   Que hace: recibe {reference, items:[{slug, qty}]} desde el carrito,
   calcula el monto AQUI con los precios del catalogo publicado
   (assets/js/products-data.js, al lado de esta carpeta), y firma
   SHA256(reference + amount_in_cents + currency + secreto). Devuelve el monto
   y la firma. El navegador nunca manda ni decide el monto: cualquier
   amount_in_cents que llegue en la peticion se ignora. Sin eso, alguien
   podria pagar 1 peso por un marco de $1.850.000 editando la peticion.

   FREE_SHIP y SHIP_COST replican carrito.html y vercel-wompi-api/lib/pricing.js;
   los tres tienen que decir lo mismo (tools/wompi-pricing-test.mjs cubre el de
   Vercel). El navegador nunca ve el secreto -- esa es la razon de que este
   archivo exista en vez de firmar en assets/js/wompi.js.
   ========================================================================= */

header("Content-Type: application/json; charset=utf-8");

function respond($status, $data) {
  http_response_code($status);
  echo json_encode($data);
  exit;
}

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
  respond(405, ["error" => "method_not_allowed"]);
}

$body = json_decode(file_get_contents("php://input"), true);
if (!is_array($body)) {
  respond(400, ["error" => "invalid_json"]);
}

const FREE_SHIP = 300000;   // pesos: desde este subtotal el envio es gratis
const SHIP_COST = 18000;    // pesos
const MAX_LINES = 50;
const MAX_QTY = 20;
const CURRENCY = "COP";

$reference = isset($body["reference"]) && is_string($body["reference"]) ? $body["reference"] : "";
if (!preg_match('/^[A-Za-z0-9_-]{8,64}$/', $reference)) {
  respond(400, ["error" => "invalid_reference"]);
}

$items = $body["items"] ?? null;
if (!is_array($items) || count($items) === 0) {
  respond(400, ["error" => "empty_order"]);
}
if (count($items) > MAX_LINES) {
  respond(400, ["error" => "too_many_lines"]);
}

// products-data.js es JS plano: "window.STIKE_PRODUCTS = [ ... ];"
$catalogText = @file_get_contents(__DIR__ . "/../assets/js/products-data.js");
$marker = "window.STIKE_PRODUCTS = ";
$pos = $catalogText === false ? false : strpos($catalogText, $marker);
$catalog = null;
if ($pos !== false) {
  $json = substr($catalogText, $pos + strlen($marker), strrpos($catalogText, ";") - $pos - strlen($marker));
  $catalog = json_decode($json, true);
}
if (!is_array($catalog)) {
  respond(502, ["error" => "catalog_parse_failed"]);
}
$bySlug = [];
foreach ($catalog as $p) { $bySlug[$p["slug"]] = $p; }

$subtotal = 0;
foreach ($items as $it) {
  $slug = is_array($it) ? ($it["slug"] ?? null) : null;
  $qty = is_array($it) ? ($it["qty"] ?? null) : null;
  if (!is_string($slug) || $slug === "") { respond(400, ["error" => "invalid_item"]); }
  if (!is_int($qty) || $qty < 1 || $qty > MAX_QTY) { respond(400, ["error" => "invalid_qty", "detail" => $slug]); }
  $p = $bySlug[$slug] ?? null;
  if (!$p || (array_key_exists("published", $p) && $p["published"] === false)) {
    respond(400, ["error" => "unknown_product", "detail" => $slug]);
  }
  if (!is_int($p["price"] ?? null) || $p["price"] <= 0) {
    respond(400, ["error" => "product_without_price", "detail" => $slug]);
  }
  $subtotal += $p["price"] * $qty;
}
$shipping = $subtotal >= FREE_SHIP ? 0 : SHIP_COST;
$total = $subtotal + $shipping;
$amountInCents = (string)($total * 100);
$currency = CURRENCY;

$secret = getenv("WOMPI_INTEGRITY_SECRET") ?: null;
if (!$secret) {
  $localConfigPath = __DIR__ . "/config.local.php";
  if (is_file($localConfigPath)) {
    $cfg = include $localConfigPath;
    $secret = $cfg["WOMPI_INTEGRITY_SECRET"] ?? null;
  }
}
if (!$secret) {
  respond(500, ["error" => "server_not_configured", "detail" => "falta WOMPI_INTEGRITY_SECRET (env o api/config.local.php)"]);
}

$signature = hash("sha256", $reference . $amountInCents . $currency . $secret);

respond(200, [
  "reference" => $reference,
  "amount_in_cents" => (int)$amountInCents,
  "currency" => $currency,
  "signature" => $signature,
  "subtotal" => $subtotal,
  "shipping" => $shipping,
  "total" => $total,
]);
