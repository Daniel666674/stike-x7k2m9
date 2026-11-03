<?php
/* =========================================================================
   STIKE BIKE SHOP: corregir desde el panel lo que el cobro y los avisos
   necesitan, sin editar archivos en el servidor.

   1) Secretos de Wompi que firman el cobro: el de INTEGRIDAD, el de EVENTOS y la
      llave PRIVADA.
   2) El correo de aviso de cada venta: la llave de Resend, quien recibe los avisos
      y el remitente.

   Por que existe: pegar mal un secreto en api/config.local.php (la llave privada
   en vez del secreto, un espacio de mas...) deja el pago caido con un error que
   el cliente no entiende, y el correo del hosting casi nunca llega a Gmail. Aca
   se pega, se valida al instante y se guarda; el servidor empieza a usarlo ya.

   Solo duenos y desarrolladores. Las llaves PUBLICA y de GitHub no se cambian
   desde aca (la publica redirige el dinero a otra cuenta), asi que siguen
   viviendo solo en el servidor. Un secreto de integridad equivocado solo hace
   que el pago falle; no mueve dinero.

   POST { key, value }  -> guarda (value = el secreto o el ajuste)
   POST { key, clear: true } -> quita lo guardado aca y vuelve a lo del servidor
   POST { action: "test_email" } -> manda un correo de prueba y explica el resultado

   Nunca devuelve un secreto: solo si quedo bien, el ambiente y las ultimas 4
   letras para compararlas a ojo. Los ajustes que no son secretos (a quien le
   llega el correo, el remitente) si se devuelven: no hay nada que ocultar.
   ========================================================================= */
require __DIR__ . "/_admin.php";

stike_run(function () {
  stike_require_method("POST");
  stike_admin_check_origin();
  $s = stike_admin_require();
  if (!in_array($s["role"], ["owner", "developer"], true)) throw new ApiError(403, "forbidden");

  $body = stike_json_body();

  /* «Enviar correo de prueba»: el mismo camino que usa el aviso de cada venta, para ver ya si llega y, si no, por que. */
  if (($body["action"] ?? "") === "test_email") {
    $r = stike_send_owner_mail("Prueba de correo — Stike Bike Shop", '<div style="font-family:system-ui,sans-serif;max-width:480px"><h2>Si lees esto, el aviso de cada venta llega.</h2><p>Lo pidió ' . stike_h($s["email"]) . ' desde el panel (Configuración → Pagos y servidor).</p></div>', ["kind" => "prueba", "noQueue" => true]);
    $ok = empty($r["error"]);
    respond(200, [
      "ok" => $ok,
      "via" => $r["sent"] ?? null,
      "to" => implode(", ", array_map("stike_mask_email", $r["to"] ?? [])),
      "error" => $r["error"] ?? null,
      "reliable" => $ok && in_array($r["sent"] ?? null, ["resend", "smtp"], true),
      "resendConfigured" => (bool)stike_config("RESEND_API_KEY"),
      "smtpConfigured" => (bool)stike_smtp_config(),
      "resendError" => $r["resendError"] ?? null,   // {code, detail}: lo que dijo Resend, ya explicado (nunca lleva la llave)
      "smtpError" => $r["smtpError"] ?? null,       // {code, detail}: lo que dijo el servidor de correo, ya explicado (nunca lleva la contraseña)
    ]);
  }

  /* ---- Correo propio por SMTP: un correo del dominio (ventas@stikebikeshop.com de Hostinger) o Gmail con «contraseña de aplicación» ---- */
  if (($body["action"] ?? "") === "smtp_clear") {
    $all = stike_runtime_config_all();
    foreach (["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"] as $k) unset($all[$k]);
    stike_runtime_config_write($all);
    error_log("[stike] SMTP: se quito lo guardado desde el panel (" . $s["email"] . ")");
    respond(200, ["ok" => true, "cleared" => true]);
  }
  if (($body["action"] ?? "") === "smtp_save") {
    $insecure = getenv("STIKE_SMTP_INSECURE") === "1";   // solo pruebas locales
    $host = strtolower(trim((string)($body["host"] ?? "")));
    $port = (int)($body["port"] ?? 465);
    $user = trim((string)($body["user"] ?? ""));
    $pass = trim((string)($body["pass"] ?? ""));
    if (preg_match('/^[a-z]{4}( [a-z]{4}){3}$/', $pass)) $pass = str_replace(" ", "", $pass);   // la «contraseña de aplicación» de Google se muestra en 4 grupos
    if (!preg_match('/^[a-z0-9]([a-z0-9.-]{0,98}[a-z0-9])?$/', $host) || strpos($host, "..") !== false) throw new ApiError(400, "invalid_host", "Escribe el servidor de correo saliente, por ejemplo smtp.hostinger.com.");
    if ($port < 1 || $port > 65535 || (!$insecure && !in_array($port, [465, 587, 2525], true))) throw new ApiError(400, "invalid_port", "El puerto del correo saliente es 465 (recomendado) o 587.");
    if (!filter_var($user, FILTER_VALIDATE_EMAIL)) throw new ApiError(400, "invalid_user", "Escribe el correo completo con el que inicias sesión, por ejemplo ventas@stikebikeshop.com.");
    if ($pass === "" || strlen($pass) > 200 || preg_match('/[\r\n\0]/', $pass)) throw new ApiError(400, "empty_value", "Escribe la contraseña de ese correo.");
    $ip = filter_var($host, FILTER_VALIDATE_IP) ? $host : gethostbyname($host);
    if (!filter_var($ip, FILTER_VALIDATE_IP)) throw new ApiError(400, "smtp_unreachable", "No se encontró el servidor «" . $host . "». Revisa cómo está escrito (Hostinger: smtp.hostinger.com).");
    if (!$insecure && !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) throw new ApiError(400, "invalid_host", "Ese servidor no es un servidor de correo de internet.");
    /* Se entra de verdad a la cuenta ANTES de guardar (conexion segura + usuario y contraseña): si algo esta mal, no se guarda. */
    $chk = stike_smtp_check(["host" => $host, "port" => $port, "user" => $user, "pass" => $pass]);
    if (empty($chk["ok"])) throw new ApiError(in_array($chk["code"], ["smtp_auth_failed", "smtp_sender_rejected"], true) ? 400 : 502, $chk["code"], $chk["detail"]);
    $all = stike_runtime_config_all();
    $sealedAll = true;
    foreach (["SMTP_HOST" => $host, "SMTP_PORT" => (string)$port, "SMTP_USER" => $user, "SMTP_PASS" => $pass] as $k => $v) {
      $sealed = stike_runtime_seal($v);
      if (!$sealed) $sealedAll = false;
      $all[$k] = ($sealed ?: ["value" => $v]) + ["by" => $s["email"], "at" => stike_now_iso()];
    }
    stike_runtime_config_write($all);
    error_log("[stike] SMTP guardado desde el panel por " . $s["email"] . " (" . $host . ":" . $port . ")");
    respond(200, ["ok" => true, "host" => $host, "port" => $port, "user" => $user, "secure" => stike_smtp_security($host, $port), "encrypted" => $sealedAll]);
  }

  $key = $body["key"] ?? null;
  $rules = [
    "WOMPI_INTEGRITY_SECRET" => ['/^(test|prod)_integrity_[A-Za-z0-9_-]{8,}$/', "el SECRETO DE INTEGRIDAD (empieza por test_integrity_ o prod_integrity_)"],
    "WOMPI_EVENTS_SECRET" => ['/^(test|prod)_events_[A-Za-z0-9_-]{8,}$/', "el secreto de EVENTOS (empieza por test_events_ o prod_events_)"],
    "WOMPI_PRIVATE_KEY" => ['/^prv_(test|prod)_[A-Za-z0-9_-]{8,}$/', "la llave PRIVADA (empieza por prv_test_ o prv_prod_)"],
  ];
  $mailKeys = ["RESEND_API_KEY", "OWNER_NOTIFY_EMAIL", "RESEND_FROM"];
  if (!is_string($key) || (!isset($rules[$key]) && !in_array($key, $mailKeys, true))) throw new ApiError(400, "invalid_key");

  $all = stike_runtime_config_all();

  if (!empty($body["clear"])) {
    unset($all[$key]);
    stike_runtime_config_write($all);
    error_log("[stike] $key: se quito lo guardado desde el panel (" . $s["email"] . ")");
    respond(200, ["ok" => true, "cleared" => true, "key" => $key]);
  }

  /* ---- Correo de aviso de cada venta ---- */
  if (in_array($key, $mailKeys, true)) {
    $raw = $body["value"] ?? "";
    if (!is_string($raw) || trim($raw) === "") throw new ApiError(400, "empty_value", "Escribe o pega el valor completo.");

    if ($key === "OWNER_NOTIFY_EMAIL") {
      $list = stike_parse_emails($raw);
      if (!$list) throw new ApiError(400, "wrong_kind", "Eso no parece un correo. Escribe uno o varios separados por coma, por ejemplo: dueno@gmail.com, socio@gmail.com.");
      $value = implode(", ", $list);
      $before = stike_owner_recipients();
      $sealed = stike_runtime_seal($value);
      $all[$key] = ($sealed ?: ["value" => $value]) + ["by" => $s["email"], "at" => stike_now_iso()];
      stike_runtime_config_write($all);
      error_log("[stike] OWNER_NOTIFY_EMAIL cambiado desde el panel por " . $s["email"] . " (" . count($list) . " correo(s))");
      /* Cambiar a quien le llegan las ventas (nombre, telefono y direccion de los clientes) es delicado: a los que lo recibian hasta ahora
         les llega un aviso de quien lo cambio y a donde. */
      if (array_map("strtolower", $before) !== array_map("strtolower", $list)) {
        stike_send_owner_mail("Cambió el correo que recibe los avisos de venta — Stike Bike Shop",
          '<div style="font-family:system-ui,sans-serif;max-width:480px"><h2>Cambió el correo de los avisos de venta</h2><p>' . stike_h($s["email"]) . ' lo cambió desde el panel.</p><p><b>Antes:</b> ' . stike_h(implode(", ", $before)) . '<br><b>Ahora:</b> ' . stike_h($value) . '</p><p>Si no fuiste tú, entra al panel y revísalo.</p></div>',
          ["kind" => "alerta", "noQueue" => true, "to" => array_values(array_unique(array_merge($before, $list)))]);
      }
      respond(200, ["ok" => true, "key" => $key, "value" => $value, "count" => count($list), "encrypted" => (bool)$sealed]);
    }

    if ($key === "RESEND_FROM") {
      $p = stike_parse_sender($raw);
      if (!$p) throw new ApiError(400, "wrong_kind", "Escribe el remitente como  Stike Bike Shop <ventas@stikebikeshop.com>  o solo el correo.");
      $value = $p[0] . " <" . $p[1] . ">";
      $sealed = stike_runtime_seal($value);
      $all[$key] = ($sealed ?: ["value" => $value]) + ["by" => $s["email"], "at" => stike_now_iso()];
      stike_runtime_config_write($all);
      error_log("[stike] RESEND_FROM guardado desde el panel por " . $s["email"]);
      respond(200, ["ok" => true, "key" => $key, "value" => $value, "usesTestSender" => strcasecmp(substr(strrchr($p[1], "@"), 1), "resend.dev") === 0, "encrypted" => (bool)$sealed]);
    }

    /* RESEND_API_KEY: se comprueba con Resend ANTES de guardarla (si la rechaza no se guarda). */
    $value = stike_wompi_clean($raw);
    if (!preg_match('/^re_[A-Za-z0-9_]{16,}$/', $value)) {
      throw new ApiError(400, "wrong_kind", "Eso no es una llave de Resend (empieza por re_). En resend.com → API Keys → Create API Key (permiso «Sending access»), copia la llave completa.");
    }
    $base = rtrim((string)stike_config("RESEND_API_BASE", "https://api.resend.com"), "/");
    $res = stike_http("GET", $base . "/domains", ["Authorization: Bearer " . $value], null, 15);
    $rname = is_array($res["json"]) ? (string)($res["json"]["name"] ?? "") : "";
    $restricted = $res["status"] === 401 && $rname === "restricted_api_key";   // llave que solo puede ENVIAR: es justo la que se recomienda
    if (!$restricted && ($res["status"] === 401 || $res["status"] === 403)) {
      throw new ApiError(400, "key_rejected", "Resend RECHAZÓ esa llave (" . $res["status"] . "). Crea otra en resend.com → API Keys → Create API Key y cópiala completa.");
    }
    if (!$restricted && ($res["status"] < 200 || $res["status"] >= 300)) {
      throw new ApiError(502, "resend_unreachable", "No se pudo comprobar la llave con Resend (respondió " . ($res["status"] ?: "sin conexión") . "). Inténtalo de nuevo en un momento.");
    }
    $domains = null;
    if (!$restricted && is_array($res["json"]["data"] ?? null)) {
      $domains = [];
      foreach ($res["json"]["data"] as $d) if (is_array($d) && is_string($d["name"] ?? null)) $domains[] = ["name" => $d["name"], "status" => (string)($d["status"] ?? "")];
    }
    $sealed = stike_runtime_seal($value);
    $all[$key] = ($sealed ?: ["value" => $value]) + ["by" => $s["email"], "at" => stike_now_iso()];
    stike_runtime_config_write($all);
    error_log("[stike] RESEND_API_KEY guardado desde el panel por " . $s["email"] . " (" . strlen($value) . " caracteres)");
    respond(200, ["ok" => true, "key" => $key, "length" => strlen($value), "tail" => substr($value, -4), "restricted" => $restricted, "domains" => $domains, "encrypted" => (bool)$sealed]);
  }

  /* ---- Secretos de Wompi ---- */
  $value = stike_wompi_clean($body["value"] ?? "");
  if (!is_string($value) || $value === "") throw new ApiError(400, "empty_value", "Pega el valor completo del secreto.");
  if (!preg_match($rules[$key][0], $value, $m)) {
    throw new ApiError(400, "wrong_kind", "Eso no es " . $rules[$key][1] . "; lo que pegaste parece " . stike_wompi_kind($value) . ". En Wompi: Desarrolladores > Secretos para integración técnica.");
  }
  $env = $m[1];

  /* Tiene que ser del mismo ambiente que la llave publica (sandbox con sandbox, produccion con produccion). */
  $pub = stike_wompi_clean(stike_config("WOMPI_PUBLIC_KEY"));
  if (is_string($pub) && preg_match('/^pub_(test|prod)_/', $pub, $pm) && $pm[1] !== $env) {
    throw new ApiError(400, "wrong_environment", "La llave pública del servidor es de " . ($pm[1] === "prod" ? "PRODUCCIÓN" : "SANDBOX (pruebas)") . " pero este secreto es de " . ($env === "prod" ? "PRODUCCIÓN" : "SANDBOX (pruebas)") . ". Copia el de la misma pestaña (Sandbox o Producción) de Wompi.");
  }

  /* La llave privada se prueba con Wompi ANTES de guardarla: si la rechaza (401/403) no se guarda. */
  if ($key === "WOMPI_PRIVATE_KEY") {
    $res = stike_http("GET", rtrim(stike_wompi_api_base($value), "/") . "/transactions?reference=stike-comprobacion-de-llave", ["Authorization: Bearer " . $value]);
    if ($res["status"] === 401 || $res["status"] === 403) {
      throw new ApiError(400, "key_rejected", "Wompi RECHAZÓ esa llave privada (" . $res["status"] . "). En Wompi, pestaña " . ($env === "prod" ? "PRODUCCIÓN" : "Sandbox") . ": Desarrolladores → Llaves del API → Llave privada → Mostrar, y cópiala completa.");
    }
    if (!in_array($res["status"], [200, 404], true)) {
      throw new ApiError(502, "wompi_unreachable", "No se pudo comprobar la llave con Wompi (respondió " . ($res["status"] ?: "sin conexión") . "). Inténtalo de nuevo en un momento.");
    }
  }

  $sealed = stike_runtime_seal($value);   // cifrado en el disco; solo si el servidor no puede cifrar queda en texto (0600, fuera del sitio)
  $all[$key] = ($sealed ?: ["value" => $value]) + ["by" => $s["email"], "at" => stike_now_iso()];
  stike_runtime_config_write($all);
  error_log("[stike] $key guardado desde el panel por " . $s["email"] . " (ambiente $env, " . strlen($value) . " caracteres)");
  respond(200, ["ok" => true, "key" => $key, "environment" => $env, "length" => strlen($value), "tail" => substr($value, -4), "encrypted" => (bool)$sealed]);
});
