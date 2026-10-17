<?php
/* =========================================================================
   STIKE BIKE SHOP: webhook de eventos de Wompi.

   Por que existe: sin esto la venta solo se registra si el cliente vuelve a
   pago-resultado.html. Si paga y cierra la pestana, el dinero entra y la venta
   no queda. Wompi avisa aca de cada cambio de estado, con o sin navegador.

   URL de eventos (se configura en el panel de Wompi, Desarrolladores):
     https://stikebikeshop.com/api/wompi-events

   Doble candado. (1) Un evento NUNCA registra una venta por lo que diga su
   cuerpo: se toma como un aviso ("mira la transaccion X"), se ignora todo lo
   que afirme y se le pregunta a Wompi directamente, con la llave privada, que
   paso con esa transaccion (stike_finalize_order). Un evento falso no puede
   registrar una venta que Wompi no confirme, y uno real y repetido no
   duplica nada. (2) Si esta WOMPI_EVENTS_SECRET (api/config.local.php), ademas
   se exige que el checksum del evento sea valido; uno sin firma o con firma
   mala se rechaza con 401 sin molestar a Wompi. Sin ese secreto solo opera el
   candado (1), que por si solo ya es suficiente.

   Responde 200 a todo lo que no sea una falla nuestra (verificacion de la URL,
   cuerpo vacio, evento de otro tipo,
   pago rechazado, referencia desconocida) para que Wompi no reintente en vano;
   responde 5xx si no pudimos consultar a Wompi o guardar la venta, para que
   reintente.
   ========================================================================= */

require __DIR__ . "/_lib.php";

stike_run(function () {
  /* Al guardar la URL, Wompi (y cualquier verificador) puede comprobar que
     responda: un GET/HEAD/OPTIONS o un POST vacio tiene que dar 200, no 405 o
     400, o el panel de Wompi dice "URL de eventos invalida". No hay riesgo: sin
     una transaccion real que Wompi confirme, este endpoint no registra nada. */
  $method = $_SERVER["REQUEST_METHOD"] ?? "";
  if (in_array($method, ["GET", "HEAD", "OPTIONS"], true)) respond(200, ["ok" => true, "service" => "wompi-events"]);
  stike_require_method("POST");
  $event = json_decode(file_get_contents("php://input"), true);
  if (!is_array($event)) respond(200, ["ok" => true, "ignored" => "empty"]);

  if (($event["event"] ?? "") !== "transaction.updated") respond(200, ["ok" => true, "ignored" => "event"]);
  $eventsSecret = stike_config("WOMPI_EVENTS_SECRET");
  if ($eventsSecret && !stike_event_checksum_ok($event, $eventsSecret)) {
    error_log("[stike] evento de Wompi con firma invalida (revisa WOMPI_EVENTS_SECRET: debe ser el secreto de EVENTOS del mismo ambiente)");
    respond(401, ["error" => "bad_signature"]);
  }
  $txn = $event["data"]["transaction"] ?? null;
  if (!is_array($txn)) respond(200, ["ok" => true, "ignored" => "payload"]);

  try {
    $reference = stike_valid_reference($txn["reference"] ?? null);
    $wompiId = stike_valid_wompi_id($txn["id"] ?? null);
    $r = stike_finalize_order($reference, $wompiId);
  } catch (ApiError $e) {
    if ($e->status >= 500) throw $e;   // que Wompi reintente
    respond(200, ["ok" => true, "ignored" => $e->errorCode]);
  }
  respond(200, ["ok" => true] + (empty($r["ignored"]) ? $r : ["ignored" => "status", "status" => $r["status"]]));
});
