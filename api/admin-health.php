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

  // Que ambiente tiene CADA llave por separado (aunque otra este mal): asi el panel nunca dice "sandbox"
  // solo porque no pudo validar el conjunto.
  $seen = [];
  $summary = [];
  foreach (["Llave pública" => ["WOMPI_PUBLIC_KEY", '/^pub_(test|prod)_/'], "Llave privada" => ["WOMPI_PRIVATE_KEY", '/^prv_(test|prod)_/'], "Secreto de integridad" => ["WOMPI_INTEGRITY_SECRET", '/^(test|prod)_integrity_/']] as $lbl => [$name, $re]) {
    $v = stike_wompi_clean(stike_config($name));
    if (!is_string($v) || $v === "") { $seen[$lbl] = null; $summary[] = "$lbl: falta"; }
    elseif (preg_match($re, $v, $mm)) { $seen[$lbl] = $mm[1]; $summary[] = "$lbl: " . ($mm[1] === "prod" ? "producción" : "pruebas (sandbox)"); }
    else { $seen[$lbl] = false; $summary[] = "$lbl: ✕ está mal (lo que hay parece " . stike_wompi_kind($v) . ")"; }
  }

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
    // La llave privada: se prueba con la lista de transacciones de Wompi (la consulta de UNA transaccion es publica y
    // no sirve para saber si la llave vale). 401/403 = Wompi no la acepta. No frena los cobros (el pago ya no depende
    // de ella) pero SI la busqueda automatica de pagos sin registrar.
    $pr = stike_http("GET", rtrim($base, "/") . "/transactions?reference=stike-comprobacion-de-llave", ["Authorization: Bearer " . $k["private"]]);
    $privOk = in_array($pr["status"], [200, 404], true);
    $add("wompi_private", $privOk, "Wompi acepta la llave privada (busca pagos sin registrar)",
      $privOk ? "OK" : (in_array($pr["status"], [401, 403], true)
        ? "Wompi RECHAZÓ la llave privada del servidor (" . $pr["status"] . "). Los cobros no se afectan, pero no se pueden buscar pagos sin registrar. Pega la correcta abajo, en «Llave privada de Wompi»."
        : "Wompi respondió " . ($pr["status"] ?: "sin conexión") . "."));
  } catch (ApiError $e) {
    $add("wompi_keys", false, "Llaves de Wompi", $e->detail ?: $e->errorCode);
  }
  if ($env !== null) {
    $add("wompi_prod", $env === "prod", "Modo producción", $env === "prod" ? "Las ventas se cobran de verdad" : "Las llaves son de PRUEBAS (sandbox): no cobra de verdad. Para cobrar, cambia las 3 por las de producción.");
  } else {
    $add("wompi_prod", false, "Modo producción", "Todavía no se puede confirmar, porque las llaves no pasan la revisión de arriba. Esto es lo que hay en el servidor → " . implode(" · ", $summary) . ".");
  }
  $envName = $env ?? (is_string($seen["Llave pública"] ?? null) ? $seen["Llave pública"] : null);   // la llave publica manda si el conjunto no valida

  // Eventos de Wompi: la URL tiene que estar puesta en Wompi, en la pestana de ESTE ambiente (produccion y
  // sandbox tienen cada una la suya). Aca se ve si de verdad han llegado.
  $ev = null; $badEv = null;
  try {
    $dirEv = stike_storage_dir();
    if (is_file($dirEv . "/last-event.json")) $ev = json_decode((string)file_get_contents($dirEv . "/last-event.json"), true);
    if (is_file($dirEv . "/last-bad-event.json")) $badEv = json_decode((string)file_get_contents($dirEv . "/last-bad-event.json"), true);
  } catch (Throwable $e) {}
  /* La version anterior anotaba los avisos con firma falsa como «ultimo evento»: eso no es un evento real. */
  if (is_array($ev) && ($ev["result"] ?? "") === "firma_invalida") {
    if (!is_array($badEv) || strtotime((string)($badEv["at"] ?? "")) < strtotime((string)($ev["at"] ?? ""))) $badEv = ["at" => $ev["at"] ?? null, "count" => 1];
    $ev = null;
  }
  $evWhen = function ($iso) {
    $ago = max(0, time() - (int)strtotime((string)$iso));
    return $ago < 3600 ? "hace " . max(1, intdiv($ago, 60)) . " min" : ($ago < 172800 ? "hace " . intdiv($ago, 3600) . " h" : "hace " . intdiv($ago, 86400) . " días");
  };
  $badNote = (is_array($badEv) && !empty($badEv["at"]) && time() - (int)strtotime((string)$badEv["at"]) < 7 * 86400)
    ? " Llegaron " . max(1, (int)($badEv["count"] ?? 1)) . " aviso(s) con firma no válida (el último " . $evWhen($badEv["at"]) . "): si Wompi ya está enviando eventos de verdad, el secreto de eventos pegado no es el de este ambiente; si no esperabas ninguno, alguien probó la dirección (no registra nada)."
    : "";
  if (is_array($ev) && !empty($ev["at"])) {
    $evErr = str_starts_with((string)($ev["result"] ?? ""), "error:");
    $add("wompi_last_event", !$evErr, "Eventos de Wompi (aviso de cada pago)", "Último evento recibido " . $evWhen($ev["at"]) . " · " . ($ev["result"] ?? "?") . ($evErr ? ". Revisa que la URL de eventos y el secreto de eventos sean los de este ambiente." : "") . $badNote);
  } else {
    $add("wompi_last_event", false, "Eventos de Wompi (aviso de cada pago)", "Todavía no ha llegado ninguno válido. En Wompi, pestaña " . ($envName === "prod" ? "PRODUCCIÓN" : ($envName === "test" ? "Sandbox" : "PRODUCCIÓN (o Sandbox si tus llaves son de pruebas)")) . " → Desarrolladores → URL de eventos, pega: https://stikebikeshop.com/api/wompi-events . Se marca ✔ solo cuando Wompi avisa de un pago (haz la compra de prueba)." . $badNote);
  }

  // Secretos guardados desde el panel: los que quedaron en texto plano (version anterior) se cifran ahora, y se avisa si alguno
  // ya no se puede leer (cambio la clave interna del servidor).
  try { stike_runtime_config_upgrade(); } catch (Throwable $e) { error_log("[stike] no se pudo cifrar lo guardado desde el panel: " . get_class($e)); }
  $unreadable = stike_runtime_config_unreadable();
  $rstate = stike_runtime_config_state();
  if ($unreadable) {
    $add("wompi_panel_unreadable", false, "Secretos guardados desde el panel", "No se pueden leer (" . implode(", ", $unreadable) . "): cambió la clave interna del servidor. Vuelve a pegarlos abajo; mientras tanto el servidor usa lo de su archivo de configuración.");
  } elseif ($rstate["total"] > 0) {
    $add("wompi_panel_encrypted", $rstate["plain"] === 0, "Secretos guardados desde el panel",
      $rstate["plain"] === 0 ? "Cifrados en el servidor (AES-256): " . $rstate["encrypted"] . " guardado(s), ninguno en texto plano" : $rstate["plain"] . " siguen en texto plano porque este servidor no puede cifrar (falta la extensión openssl de PHP); quedan solo legibles por el servidor.");
  }

  // Pagos aprobados que no se habian registrado: al abrir el panel se buscan y se registran (venta + correo + stock).
  $rc = stike_reconcile_pending(4);
  if (!empty($rc["recovered"])) {
    $add("wompi_recovered", true, "Pagos recuperados ahora mismo", count($rc["recovered"]) . " venta(s) que Wompi tenía aprobadas y no estaban en el panel quedaron registradas (revisa Ventas y el correo).");
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

  $required = ["wompi_keys", "wompi_reach", "wompi_source", "wompi_prod", "github", "storage", "https"];
  $ready = true;
  foreach ($checks as $c) if (in_array($c["id"], $required, true) && !$c["ok"]) $ready = false;
  respond(200, ["ready" => $ready, "checks" => $checks, "eventsUrl" => "https://stikebikeshop.com/api/wompi-events", "recovered" => count($rc["recovered"] ?? [])]);
});
