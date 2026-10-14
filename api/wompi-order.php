<?php
/* =========================================================================
   STIKE BIKE SHOP: registra la venta cuando el cliente vuelve de Wompi
   (pago-resultado.html llama aca con la referencia y el id de la transaccion).

   No se confia en nada que mande el navegador salvo esos dos datos: la venta
   se confirma con Wompi (llave privada) y lo que se registra sale del pedido
   guardado al firmar (wompi-sign.php). Idempotente: recargar la pagina de
   resultado, o que ademas llegue el webhook, no duplica nada.

   Guarda la venta en el servidor (la lee el panel via sales.php) y avisa al
   dueno por correo. Ver stike_finalize_order en _lib.php.
   ========================================================================= */

require __DIR__ . "/_lib.php";

stike_run(function () {
  stike_require_method("POST");
  $body = stike_json_body();
  $reference = stike_valid_reference($body["reference"] ?? null);
  $wompiId = stike_valid_wompi_id($body["wompiId"] ?? null);

  $r = stike_finalize_order($reference, $wompiId);
  if (!empty($r["ignored"])) throw new ApiError(400, "transaction_not_approved");
  respond(200, ["ok" => true] + $r);
});
