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
      $src[] = "$lbl: " . ($x["panel"] ? "guardado desde el panel (prevalece)" : ($x["env"] ? "variable de entorno del hosting" : "api/config.local.php"));
      if ($x["differ"]) $pisa = true;
    }
    $add("wompi_source", !$pisa, "De dónde salen las llaves", implode(" · ", $src) . ($pisa ? ". ¡Ojo!: hay una variable de entorno en el hosting distinta a la del archivo, y la variable GANA. Bórrala en hPanel o iguálala." : ""));
    $add("wompi_integrity", true, "Secreto de integridad (el que firma cada cobro)", "Termina en …" . substr($int, -4) . " · " . strlen($int) . " caracteres · " . ($env === "prod" ? "producción" : "sandbox") . ". Si Wompi dice «La firma es inválida», compáralo con Wompi > Desarrolladores > Secretos para integración técnica > Integridad (no el de Eventos)." . $fix);
    $base = stike_wompi_api_base($k["private"]);   // el servidor de Wompi del ambiente de las llaves (nunca el del otro ambiente)
    $r = stike_http("GET", rtrim($base, "/") . "/merchants/" . rawurlencode($k["public"]));
    $m = is_array($r["json"]["data"] ?? null) ? $r["json"]["data"] : [];
    $mName = trim((string)($m["name"] ?? ""));
    $inactive = $r["status"] === 200 && array_key_exists("active", $m) && $m["active"] === false;
    $add("wompi_reach", $r["status"] === 200 && !$inactive, "Wompi reconoce la llave pública",
      $r["status"] === 200 ? ($inactive ? "El comercio «" . $mName . "» aparece INACTIVO en Wompi: pídeles que lo activen para cobrar." : "OK" . ($mName !== "" ? " · comercio: " . $mName : "")) : "Wompi respondió " . ($r["status"] ?: "sin conexión"));
    // La llave privada se prueba preguntando por una transaccion que no existe: 404 = la reconocio; 401/403 = no.
    $pr = stike_http("GET", rtrim($base, "/") . "/transactions/stike-comprobacion-inexistente", ["Authorization: Bearer " . $k["private"]]);
    $privOk = $pr["status"] === 404;
    $add("wompi_private", $privOk, "Wompi acepta la llave privada (la que confirma los pagos)",
      $privOk ? "OK: sin esto no se podrían confirmar los pagos ni registrar las ventas" : ($pr["status"] === 401 || $pr["status"] === 403
        ? "Wompi RECHAZÓ la llave privada: ¿es del mismo ambiente y del mismo comercio que la pública?" : "Wompi respondió " . ($pr["status"] ?: "sin conexión")));
  } catch (ApiError $e) {
    $add("wompi_keys", false, "Llaves de Wompi", $e->detail ?: $e->errorCode);
  }
  $add("wompi_prod", $env === "prod", "Modo producción", $env === "prod" ? "Las ventas se cobran de verdad" : "Todavía en sandbox: cambia las 3 llaves por las de producción");

  // Eventos de Wompi: la URL tiene que estar puesta en Wompi, en la pestana de ESTE ambiente (produccion y
  // sandbox tienen cada una la suya). Aca se ve si de verdad han llegado.
  $ev = null;
  try { $evPath = stike_storage_dir() . "/last-event.json"; if (is_file($evPath)) $ev = json_decode((string)file_get_contents($evPath), true); } catch (Throwable $e) {}
  if (is_array($ev) && !empty($ev["at"])) {
    $ago = max(0, time() - (int)strtotime($ev["at"]));
    $when = $ago < 3600 ? "hace " . max(1, intdiv($ago, 60)) . " min" : ($ago < 172800 ? "hace " . intdiv($ago, 3600) . " h" : "hace " . intdiv($ago, 86400) . " días");
    $bad = in_array($ev["result"] ?? "", ["firma_invalida"], true) || str_starts_with((string)($ev["result"] ?? ""), "error:");
    $add("wompi_last_event", !$bad, "Eventos de Wompi (aviso de cada pago)", "Último evento recibido " . $when . " · " . ($ev["result"] ?? "?") . ($bad ? ". Revisa WOMPI_EVENTS_SECRET (debe ser el secreto de EVENTOS de este ambiente)." : ""));
  } else {
    $add("wompi_last_event", false, "Eventos de Wompi (aviso de cada pago)", "Todavía no ha llegado ninguno. En Wompi, pestaña " . ($env === "prod" ? "PRODUCCIÓN" : "Sandbox") . " → Desarrolladores → URL de eventos, pega: https://stikebikeshop.com/api/wompi-events . Se marca ✔ solo cuando Wompi avisa de un pago (haz la compra de prueba).");
  }

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

  $required = ["wompi_keys", "wompi_reach", "wompi_private", "wompi_source", "wompi_prod", "github", "storage", "https"];
  $ready = true;
  foreach ($checks as $c) if (in_array($c["id"], $required, true) && !$c["ok"]) $ready = false;
  respond(200, ["ready" => $ready, "checks" => $checks, "eventsUrl" => "https://stikebikeshop.com/api/wompi-events"]);
});
