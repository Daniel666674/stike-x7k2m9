<?php
/* =========================================================================
   STIKE BIKE SHOP: consulta de estado de una transaccion Wompi (Hostinger).

   Igual que wompi-sign.php, el secreto (aca la llave PRIVADA, prv_...) sale
   de la variable de entorno WOMPI_PRIVATE_KEY o de api/config.local.php
   (nunca del repo). Wompi exige esta llave por Bearer para consultar una
   transaccion por id -- la publica ya no sirve para esto.

   pago-resultado.html llama a este endpoint con ?id=<transaction_id> (el
   id que Wompi agrega a redirect-url al volver del checkout) y muestra el
   estado (APPROVED/DECLINED/PENDING) sin que el navegador toque la llave
   privada en ningun momento.
   ========================================================================= */

header("Content-Type: application/json; charset=utf-8");

function respond($status, $data) {
  http_response_code($status);
  echo json_encode($data);
  exit;
}

$id = isset($_GET["id"]) ? trim($_GET["id"]) : "";
if ($id === "") {
  respond(400, ["error" => "missing_id"]);
}

$privateKey = getenv("WOMPI_PRIVATE_KEY") ?: null;
if (!$privateKey) {
  $localConfigPath = __DIR__ . "/config.local.php";
  if (is_file($localConfigPath)) {
    $cfg = include $localConfigPath;
    $privateKey = $cfg["WOMPI_PRIVATE_KEY"] ?? null;
  }
}
if (!$privateKey) {
  respond(500, ["error" => "server_not_configured", "detail" => "falta WOMPI_PRIVATE_KEY (env o api/config.local.php)"]);
}

$base = str_starts_with($privateKey, "prv_prod_") ? "https://production.wompi.co/v1" : "https://sandbox.wompi.co/v1";

$ch = curl_init("{$base}/transactions/" . rawurlencode($id));
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => ["Authorization: Bearer {$privateKey}"],
  CURLOPT_TIMEOUT => 15,
]);
$body = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr = curl_error($ch);
curl_close($ch);

if ($body === false) {
  respond(502, ["error" => "wompi_unreachable", "detail" => $curlErr]);
}

http_response_code($httpCode ?: 502);
echo $body;
