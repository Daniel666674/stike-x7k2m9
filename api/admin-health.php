<?php
/* =========================================================================
   STIKE BIKE SHOP: chequeo de "listo para cobrar" (solo con sesion admin).

   Responde que esta configurado y que falta, SIN devolver nunca el valor de
   una llave: solo si existe, su ambiente (sandbox/produccion) y si funciona.
   Lo muestra la pestana Configuracion del panel.
   ========================================================================= */
require __DIR__ . "/_admin.php";

stike_run(function () {
  stike_require_method("GET");
  stike_admin_require();
  $checks = [];
  $add = function ($id, $ok, $label, $detail) use (&$checks) { $checks[] = ["id" => $id, "ok" => $ok, "label" => $label, "detail" => $detail]; };

  // Wompi: las tres llaves, mismo ambiente, y que la privada funcione.
  $env = null;
  try {
    $k = stike_wompi_keys();
    $env = $k["environment"];
    $add("wompi_keys", true, "Llaves de Wompi", $env === "prod" ? "Producción (cobros reales)" : "Sandbox (pruebas, no cobra)");
    // Para comparar a ojo con el panel de Wompi sin exponer el secreto: ambiente, largo y las 4 ultimas letras.
    $raw = (string)stike_config("WOMPI_INTEGRITY_SECRET");
    $int = $k["integrity"];
    $fix = $raw !== $int ? " · tenía espacios o comillas de más (el servidor ya los ignora, pero conviene limpiarlos)" : "";
    $src = [];
    $pisa = false;
    foreach (["WOMPI_PUBLIC_KEY" => "pública", "WOMPI_PRIVATE_KEY" => "privada", "WOMPI_INTEGRITY_SECRET" => "integridad"] as $n => $lbl) {
      $x = stike_config_sources($n);
      $src[] = "$lbl: " . ($x["env"] ? "variable de entorno del hosting" : "api/config.local.php");
      if ($x["differ"]) $pisa = true;
    }
    $add("wompi_source", !$pisa, "De dónde salen las llaves", implode(" · ", $src) . ($pisa ? ". ¡Ojo!: hay una variable de entorno en el hosting distinta a la del archivo, y la variable GANA. Bórrala en hPanel o iguálala." : ""));
    $add("wompi_integrity", true, "Secreto de integridad (el que firma cada cobro)", "Termina en …" . substr($int, -4) . " · " . strlen($int) . " caracteres · " . ($env === "prod" ? "producción" : "sandbox") . ". Si Wompi dice «La firma es inválida», compáralo con Wompi > Desarrolladores > Secretos para integración técnica > Integridad (no el de Eventos)." . $fix);
    $base = stike_config("WOMPI_API_BASE") ?: ($env === "prod" ? "https://production.wompi.co/v1" : "https://sandbox.wompi.co/v1");
    $r = stike_http("GET", rtrim($base, "/") . "/merchants/" . rawurlencode($k["public"]));
    $add("wompi_reach", $r["status"] === 200, "Wompi reconoce la llave pública", $r["status"] === 200 ? "OK" : "Wompi respondió " . ($r["status"] ?: "sin conexión"));
  } catch (ApiError $e) {
    $add("wompi_keys", false, "Llaves de Wompi", $e->detail ?: $e->errorCode);
  }
  $add("wompi_prod", $env === "prod", "Modo producción", $env === "prod" ? "Las ventas se cobran de verdad" : "Todavía en sandbox: cambia las 3 llaves por las de producción");

  // GitHub (panel + descuento automatico de stock de ventas online).
  if (!stike_config("GITHUB_TOKEN")) {
    $add("github", false, "GitHub (catálogo y stock)", "Falta GITHUB_TOKEN en api/config.local.php");
  } else {
    $r = stike_gh("GET", "assets/js/products-data.js");
    $add("github", $r["status"] === 200, "GitHub (catálogo y stock)", $r["status"] === 200 ? "OK" : "GitHub respondió " . ($r["status"] ?: "sin conexión") . " (token inválido o sin acceso al repo)");
  }

  // Donde se guardan pedidos y ventas.
  try {
    $dir = stike_storage_dir();
    $add("storage", is_writable($dir), "Registro de ventas en el servidor", is_writable($dir) ? "OK" : "La carpeta no se puede escribir");
  } catch (ApiError $e) {
    $add("storage", false, "Registro de ventas en el servidor", $e->detail ?: $e->errorCode);
  }

  $add("wompi_events", (bool)stike_config("WOMPI_EVENTS_SECRET"), "Firma de los eventos de Wompi (opcional)",
    stike_config("WOMPI_EVENTS_SECRET") ? "OK: cada evento se verifica con el secreto de eventos" : "Opcional: sin WOMPI_EVENTS_SECRET los eventos igual se confirman consultando a Wompi, pero no se verifica su firma");
  $add("sync", strlen((string)stike_config("SYNC_TOKEN")) >= 24, "Publicación automática (SYNC_TOKEN)", strlen((string)stike_config("SYNC_TOKEN")) >= 24 ? "OK" : "Falta SYNC_TOKEN");
  $add("email", (bool)stike_config("RESEND_API_KEY") && (bool)stike_config("OWNER_NOTIFY_EMAIL"), "Correo de cada venta (Resend)",
    stike_config("RESEND_API_KEY") ? (stike_config("OWNER_NOTIFY_EMAIL") ? "OK" : "Falta OWNER_NOTIFY_EMAIL") : "Opcional: sin RESEND_API_KEY el aviso sale por el correo del hosting y puede caer en spam");
  $add("https", !empty($_SERVER["HTTPS"]) || ($_SERVER["HTTP_X_FORWARDED_PROTO"] ?? "") === "https", "HTTPS", "Requerido por Wompi");

  $required = ["wompi_keys", "wompi_reach", "wompi_source", "wompi_prod", "github", "storage", "https"];
  $ready = true;
  foreach ($checks as $c) if (in_array($c["id"], $required, true) && !$c["ok"]) $ready = false;
  respond(200, ["ready" => $ready, "checks" => $checks, "eventsUrl" => "https://stikebikeshop.com/api/wompi-events"]);
});
