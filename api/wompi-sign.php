<?php
/* =========================================================================
   STIKE BIKE SHOP: firma de integridad de Wompi (backend real, Hostinger).

   Este archivo es el UNICO lugar donde el secreto de integridad de Wompi
   puede existir. Nunca lo hardcodees aca ni lo subas al repo -- lo lee
   _lib.php de la variable de entorno WOMPI_INTEGRITY_SECRET o de
   api/config.local.php (se sube a mano; ver .gitignore y _lib.php).

   Que hace: recibe {reference, items:[{slug, qty, size?, color?}], shipping,
   customerEmail?} desde el carrito. Calcula el monto AQUI con los precios del
   catalogo publicado (assets/js/products-data.js), guarda el pedido (que se
   compro y a donde enviarlo) y firma
   SHA256(reference + amount_in_cents + currency + secreto).

   El navegador nunca manda ni decide el monto: cualquier amount_in_cents que
   llegue en la peticion se ignora. Sin eso, alguien podria pagar 1 peso por
   un marco de $1.850.000 editando la peticion.

   El pedido guardado es lo que despues permite registrar la venta aunque el
   cliente pague y cierre la pestana (ver wompi-events.php). Si no se puede
   guardar, NO se firma: preferimos no cobrar a cobrar algo que no podemos
   registrar.
   ========================================================================= */

require __DIR__ . "/_lib.php";

stike_run(function () {
  stike_require_method("POST");
  $body = stike_json_body();

  $reference = stike_valid_reference($body["reference"] ?? null);
  $priced = stike_price_order(stike_load_catalog(), $body["items"] ?? null);
  $shipping = stike_clean_shipping($body["shipping"] ?? null);
  $customerEmail = stike_clean_email($body["customerEmail"] ?? null);

  $secret = stike_config("WOMPI_INTEGRITY_SECRET");
  if (!$secret) throw new ApiError(500, "server_not_configured", "falta WOMPI_INTEGRITY_SECRET (env o api/config.local.php)");

  stike_save_pending($reference, [
    "reference" => $reference, "createdAt" => stike_now_iso(),
    "lines" => $priced["lines"], "subtotal" => $priced["subtotal"], "shippingCost" => $priced["shipping"],
    "amountInCents" => $priced["amountInCents"],
    "shipping" => $shipping, "customerEmail" => $customerEmail,
  ]);

  $signature = hash("sha256", $reference . $priced["amountInCents"] . STIKE_CURRENCY . $secret);

  respond(200, [
    "reference" => $reference,
    "amount_in_cents" => $priced["amountInCents"],
    "currency" => STIKE_CURRENCY,
    "signature" => $signature,
    "subtotal" => $priced["subtotal"],
    "shipping" => $priced["shipping"],
    "total" => $priced["total"],
  ]);
});
