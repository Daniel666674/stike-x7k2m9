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

   Que hace: recibe {reference, amount_in_cents, currency} desde el carrito,
   calcula SHA256(reference + amount_in_cents + currency + secreto) y lo
   devuelve. El navegador nunca ve el secreto -- esa es la unica razon de
   que este archivo exista en vez de firmar en assets/js/wompi.js.

   TODO antes de aceptar pagos reales (no bloquea las pruebas en sandbox):
   este endpoint confia en el amount_in_cents que manda el navegador. Para
   plata real hay que recalcular el total del lado del servidor a partir
   del carrito (products-data.js) en vez de firmar lo que llegue, o alguien
   podria pagar 1 peso por un marco de $1.850.000 editando la peticion.
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

$reference = isset($body["reference"]) ? (string)$body["reference"] : "";
$amountInCents = isset($body["amount_in_cents"]) ? $body["amount_in_cents"] : null;
$currency = isset($body["currency"]) ? (string)$body["currency"] : "";

if ($reference === "" || !is_int($amountInCents) && !ctype_digit((string)$amountInCents) || $amountInCents <= 0 || $currency === "") {
  respond(400, ["error" => "missing_or_invalid_fields", "need" => ["reference", "amount_in_cents", "currency"]]);
}
$amountInCents = (string)(int)$amountInCents;

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
]);
