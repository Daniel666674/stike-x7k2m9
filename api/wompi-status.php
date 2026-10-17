<?php
/* =========================================================================
   STIKE BIKE SHOP: consulta de estado de una transaccion Wompi (Hostinger).

   pago-resultado.html llama aca con ?id=<transaction_id> (el id que Wompi
   agrega a redirect-url al volver del checkout) y muestra el estado
   (APPROVED / DECLINED / PENDING ...). La consulta a Wompi usa la llave
   PRIVADA (WOMPI_PRIVATE_KEY, de la variable de entorno o de
   api/config.local.php; nunca del repo ni del navegador).

   Solo se devuelve lo que la pagina de resultado necesita. La respuesta
   completa de Wompi trae datos del cliente (correo, telefono, medio de pago)
   que no tienen por que viajar al navegador de quien tenga el enlace.
   ========================================================================= */

require __DIR__ . "/_lib.php";

stike_run(function () {
  stike_require_method("GET");
  $id = stike_valid_wompi_id($_GET["id"] ?? null);
  $txn = stike_wompi_get_transaction($id);
  respond(200, ["data" => [
    "id" => $txn["id"] ?? $id,
    "status" => $txn["status"] ?? null,
    "reference" => $txn["reference"] ?? null,
    "amount_in_cents" => $txn["amount_in_cents"] ?? null,
    "currency" => $txn["currency"] ?? null,
    "payment_method_type" => $txn["payment_method_type"] ?? null,
    "status_message" => $txn["status_message"] ?? null,
  ]]);
});
