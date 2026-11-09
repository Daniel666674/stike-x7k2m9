<?php
/* =========================================================================
   STIKE BIKE SHOP: lectura de Google Analytics 4 y de Search Console con una CUENTA DE SERVICIO.

   Por que una cuenta de servicio y no «Conectar con Google» (como el correo): es una cuenta robot que se agrega como lector en
   GA4 y en Search Console. No vence a los 7 dias (como un permiso en modo «Pruebas»), no se rompe si alguien cambia su
   contraseña y no hace falta que ninguna persona haga clic para renovar nada. El servidor firma un JWT (RS256) con la llave
   privada del archivo JSON, Google le devuelve un token de 1 hora, y con el token llama a las APIs:
     - Google Analytics Data API (v1beta): reportes y tiempo real.
     - Search Console API (webmasters v3): consultas, paginas, sitemaps.

   Seguridad: la llave JSON se pega SOLO en el panel (Analitica > Conexion con Google) y se guarda CIFRADA en el servidor
   (stike_runtime_seal). Nunca vuelve al navegador: lo unico que se muestra es el correo de la cuenta de servicio (que no es un
   secreto: hay que agregarlo en Google Analytics y en Search Console). El token de 1 hora se guarda en la carpeta de datos del
   servidor (fuera del sitio) para no pedir uno por cada consulta.

   Todo error de Google se traduce a una frase que dice QUE hacer (API sin activar, cuenta sin permiso, propiedad equivocada...).
   El guion bajo del nombre: no es un endpoint (el .htaccess lo bloquea). Lo usa api/analytics.php.
   ========================================================================= */
require_once __DIR__ . "/_lib.php";
require_once __DIR__ . "/_track.php";

const STIKE_G_SCOPE_GA = "https://www.googleapis.com/auth/analytics.readonly";
const STIKE_G_SCOPE_GSC = "https://www.googleapis.com/auth/webmasters.readonly";
const STIKE_G_SCOPE_GSC_WRITE = "https://www.googleapis.com/auth/webmasters";

function stike_g_b64url($s) { return rtrim(strtr(base64_encode($s), "+/", "-_"), "="); }
function stike_g_fail($code, $detail) { return ["ok" => false, "code" => $code, "detail" => $detail]; }

function stike_g_cache_dir() {
  $d = stike_storage_dir() . "/analytics-cache";
  if (!is_dir($d) && !@mkdir($d, 0750, true) && !is_dir($d)) throw new ApiError(500, "storage_unavailable");
  return $d;
}

/* ---------------------------------- la cuenta de servicio ---------------------------------- */

/* El archivo JSON guardado, ya leido, o null si no hay o esta mal formado. */
function stike_g_sa() {
  $raw = (string)stike_config("GOOGLE_SA_JSON", "");
  if ($raw === "") return null;
  $j = json_decode($raw, true);
  if (!is_array($j) || ($j["type"] ?? "") !== "service_account") return null;
  $email = (string)($j["client_email"] ?? ""); $key = (string)($j["private_key"] ?? "");
  if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strpos($key, "PRIVATE KEY") === false) return null;
  return ["email" => $email, "key" => $key, "project" => (string)($j["project_id"] ?? "")];
}

/* Valida el JSON que se pega en el panel (sin guardarlo). -> ["ok" => true, "json" => texto compacto, "email", "project"] o ["ok" => false, "code", "detail"]. */
function stike_g_sa_validate($raw) {
  $raw = trim((string)$raw);
  if ($raw === "") return stike_g_fail("sa_empty", "Pega el contenido del archivo JSON de la cuenta de servicio.");
  if (strlen($raw) > 12000) return stike_g_fail("sa_too_big", "Eso es demasiado largo para ser la llave de una cuenta de servicio (debe ser el JSON que descargó Google Cloud, de unos 2 KB).");
  $j = json_decode($raw, true);
  if (!is_array($j)) return stike_g_fail("sa_not_json", "Eso no es un JSON válido. Abre el archivo que descargaste de Google Cloud con el Bloc de notas, copia TODO (desde la primera «{» hasta la última «}») y pégalo.");
  if (($j["type"] ?? "") !== "service_account") return stike_g_fail("sa_wrong_type", "Ese JSON no es de una cuenta de servicio (debe decir \"type\": \"service_account\"). Si es el de un «ID de cliente de OAuth», no sirve aquí: en Google Cloud → IAM → Cuentas de servicio crea una y descarga su llave en JSON.");
  $email = (string)($j["client_email"] ?? "");
  if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !preg_match('/\.gserviceaccount\.com$/i', $email)) return stike_g_fail("sa_no_email", "Al JSON le falta el correo de la cuenta de servicio (client_email, termina en .iam.gserviceaccount.com). ¿Se copió completo?");
  $key = (string)($j["private_key"] ?? "");
  // las marcas van partidas para que el escaner de secretos (tools/secrets-scan-test.mjs) no las confunda con una llave
  if (strpos($key, "-----BEGIN " . "PRIVATE KEY-----") === false || strpos($key, "-----END " . "PRIVATE KEY-----") === false) return stike_g_fail("sa_no_key", "Al JSON le falta la llave privada (private_key). ¿Se copió completo?");
  if (!function_exists("openssl_pkey_get_private") || !@openssl_pkey_get_private($key)) return stike_g_fail("sa_key_invalid", "La llave privada del JSON no se pudo leer. Descarga una llave nueva (Cuentas de servicio → Claves → Agregar clave → JSON) y pégala completa.");
  // solo se guarda lo necesario (sin ID de llave ni URLs): menos que proteger
  $slim = ["type" => "service_account", "project_id" => (string)($j["project_id"] ?? ""), "private_key_id" => (string)($j["private_key_id"] ?? ""), "private_key" => $key, "client_email" => $email, "client_id" => (string)($j["client_id"] ?? "")];
  return ["ok" => true, "json" => json_encode($slim, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "email" => $email, "project" => $slim["project_id"]];
}

/* Token de acceso de 1 hora para un permiso (scope). Se reutiliza hasta 2 minutos antes de vencer. */
function stike_g_token($scope) {
  $sa = stike_g_sa();
  if (!$sa) return stike_g_fail("google_not_configured", "Todavía no hay una cuenta de servicio de Google guardada. Pega la llave JSON en Analítica → Conexión con Google.");
  $file = stike_g_cache_dir() . "/token-" . substr(hash("sha256", $sa["email"] . "|" . $scope), 0, 24) . ".json";
  $c = is_file($file) ? json_decode((string)@file_get_contents($file), true) : null;
  if (is_array($c) && is_string($c["t"] ?? null) && (int)($c["exp"] ?? 0) > time() + 120) return ["ok" => true, "token" => $c["t"]];
  if (!function_exists("openssl_sign")) return stike_g_fail("google_no_openssl", "Este servidor no tiene la extensión OpenSSL de PHP, que hace falta para firmar el acceso a Google. Pídele a Hostinger que la active.");
  $now = time();
  $aud = stike_google_url("oauth") . "/token";
  $head = stike_g_b64url(json_encode(["alg" => "RS256", "typ" => "JWT"]));
  $claims = stike_g_b64url(json_encode(["iss" => $sa["email"], "scope" => $scope, "aud" => $aud, "iat" => $now, "exp" => $now + 3300]));
  $pk = @openssl_pkey_get_private($sa["key"]);
  if (!$pk) return stike_g_fail("google_key_invalid", "La llave privada guardada no se puede leer. Descarga una llave nueva de la cuenta de servicio y pégala otra vez.");
  $sig = "";
  if (!openssl_sign($head . "." . $claims, $sig, $pk, OPENSSL_ALGO_SHA256)) return stike_g_fail("google_sign_failed", "No se pudo firmar el acceso a Google con la llave guardada. Pégala otra vez.");
  $res = stike_http("POST", $aud, ["Content-Type: application/x-www-form-urlencoded"], http_build_query([
    "grant_type" => "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion" => $head . "." . $claims . "." . stike_g_b64url($sig),
  ]), 15);
  $j = is_array($res["json"]) ? $res["json"] : [];
  if ($res["status"] === 200 && is_string($j["access_token"] ?? null) && $j["access_token"] !== "") {
    $tmp = $file . "." . bin2hex(random_bytes(4)) . ".tmp";
    if (@file_put_contents($tmp, json_encode(["t" => $j["access_token"], "exp" => $now + max(60, (int)($j["expires_in"] ?? 3300))])) !== false) { @chmod($tmp, 0600); @rename($tmp, $file); }
    return ["ok" => true, "token" => $j["access_token"]];
  }
  $err = is_string($j["error"] ?? null) ? $j["error"] : "";
  if ($res["status"] === 0) return stike_g_fail("google_unreachable", "No se pudo conectar con Google (" . ($res["error"] ?: "sin respuesta") . "). Suele ser momentáneo: vuelve a intentar.");
  if ($err === "invalid_grant") return stike_g_fail("google_key_rejected", "Google rechazó la llave de la cuenta de servicio (invalid_grant). Casi siempre es que la llave se borró en Google Cloud (IAM → Cuentas de servicio → Claves) o que la cuenta se eliminó. Crea una llave nueva en JSON y pégala otra vez. (Si acabas de crearla, espera un minuto.)");
  if ($err === "invalid_scope" || $err === "unauthorized_client") return stike_g_fail("google_scope_rejected", "Google no dejó usar esa cuenta de servicio para leer Analytics o Search Console (" . $err . "). Revisa en Google Cloud que las APIs estén activadas en el mismo proyecto de la cuenta.");
  if ($res["status"] === 429 || $res["status"] >= 500) return stike_g_fail("google_down", "Google no respondió bien (" . $res["status"] . "). Suele ser momentáneo: vuelve a intentar.");
  return stike_g_fail("google_token_failed", "Google no entregó acceso (" . $res["status"] . ($err !== "" ? ": " . $err : "") . ").");
}

/* ------------------------------------ llamadas a las APIs ------------------------------------ */

/* Traduce un error de Google a una frase que dice QUE hacer. $svc: ga4 | gsc. $ctx: property / site para nombrar lo que se revisó. */
function stike_g_explain($svc, $res, $ctx = []) {
  $st = (int)$res["status"];
  $j = is_array($res["json"]) ? $res["json"] : [];
  if ($st === 0) return stike_g_fail("google_unreachable", "No se pudo conectar con Google (" . ($res["error"] ?: "sin respuesta") . "). Suele ser momentáneo: vuelve a intentar.");
  $e = is_array($j["error"] ?? null) ? $j["error"] : [];
  $msg = (string)($e["message"] ?? ""); $status = (string)($e["status"] ?? "");
  $reason = ""; $act = "";
  foreach (is_array($e["details"] ?? null) ? $e["details"] : [] as $d) {
    if (is_array($d) && is_string($d["reason"] ?? null)) { $reason = $d["reason"]; $act = (string)($d["metadata"]["activationUrl"] ?? ""); break; }
  }
  $api = $svc === "ga4" ? "Google Analytics Data API" : "Google Search Console API";
  $sa = stike_g_sa(); $who = $sa ? $sa["email"] : "la cuenta de servicio";
  if ($reason === "SERVICE_DISABLED" || preg_match('/has not been used in project|is disabled|accessNotConfigured/i', $msg)) {
    $link = preg_match('#^https://console\.(developers|cloud)\.google\.com/#', $act) ? " Actívala aquí: " . $act . " y espera un par de minutos." : " En Google Cloud → APIs y servicios → Biblioteca busca «" . $api . "» y pulsa Habilitar (en el mismo proyecto de la cuenta de servicio).";
    return stike_g_fail($svc . "_api_disabled", "La «" . $api . "» no está activada en el proyecto de Google Cloud." . $link);
  }
  if ($st === 403 || $status === "PERMISSION_DENIED") {
    if ($svc === "ga4") return stike_g_fail("ga4_no_access", "Google Analytics no le deja leer la propiedad " . ($ctx["property"] ?? "") . " a " . $who . ". En Analytics → Administrar → Acceso a la propiedad → «+» → Agregar usuarios: pega ese correo con el rol «Lector». Revisa también que el ID de propiedad sea el correcto (son solo números, en Administrar → Detalles de la propiedad).");
    return stike_g_fail("gsc_no_access", "Search Console no le deja leer la propiedad «" . ($ctx["site"] ?? "") . "» a " . $who . ". En Search Console → Configuración → Usuarios y permisos → Agregar usuario: pega ese correo con el permiso «Restringido» (o «Completo» si quieres enviar el sitemap desde el panel). Revisa que la propiedad escrita sea exactamente la misma que ves en Search Console.");
  }
  if ($st === 401) return stike_g_fail("google_unauthorized", "Google rechazó el acceso (401). Pega otra vez la llave JSON de la cuenta de servicio.");
  if ($st === 404) return stike_g_fail($svc . "_not_found", $svc === "ga4" ? "Google Analytics no encuentra la propiedad " . ($ctx["property"] ?? "") . ". Revisa el ID de propiedad (solo números)." : "Search Console no encuentra la propiedad «" . ($ctx["site"] ?? "") . "». Revisa cómo está escrita (dominio: sc-domain:stikebikeshop.com; o con dirección: https://stikebikeshop.com/).");
  if ($st === 400) {
    if (preg_match('/customEvent|not a valid (dimension|metric)|Field .* is not|Did you mean/i', $msg)) return stike_g_fail("ga4_bad_field", "GA4 no reconoce uno de los campos pedidos: " . mb_substr($msg, 0, 160));
    if ($svc === "ga4" && preg_match('/propert/i', $msg)) return stike_g_fail("ga4_bad_property", "El ID de propiedad de GA4 no es válido (" . ($ctx["property"] ?? "") . "). Son solo números: Administrar → Detalles de la propiedad → «ID de propiedad».");
    return stike_g_fail($svc . "_bad_request", "Google no entendió la consulta: " . mb_substr($msg, 0, 200));
  }
  if ($st === 429 || $status === "RESOURCE_EXHAUSTED") return stike_g_fail("google_quota", "Google limitó las consultas por un rato (cuota). Espera unos minutos y vuelve a intentar.");
  if ($st >= 500) return stike_g_fail("google_down", "Google no respondió bien (" . $st . "). Suele ser momentáneo: vuelve a intentar.");
  return stike_g_fail($svc . "_error", "Google respondió " . $st . ($msg !== "" ? ": " . mb_substr($msg, 0, 200) : "") . ".");
}

function stike_g_call($svc, $scope, $method, $url, $body = null, $ctx = []) {
  $t = stike_g_token($scope);
  if (empty($t["ok"])) return $t;
  $headers = ["Authorization: Bearer " . $t["token"], "Accept: application/json"];
  if ($body !== null) $headers[] = "Content-Type: application/json";
  $res = stike_http($method, $url, $headers, $body === null ? ($method === "PUT" ? "" : null) : json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 30);
  if ($res["status"] >= 200 && $res["status"] < 300) return ["ok" => true, "json" => is_array($res["json"]) ? $res["json"] : []];
  if ($res["status"] === 401) @unlink(stike_g_cache_dir() . "/token-" . substr(hash("sha256", (stike_g_sa()["email"] ?? "") . "|" . $scope), 0, 24) . ".json");   // un token que Google ya no acepta no se reutiliza
  return stike_g_explain($svc, $res, $ctx);
}

/* Cache en disco de resultados BUENOS (los errores no se guardan: al arreglar la configuracion se ve de inmediato). */
function stike_g_cached($key, $ttl, $fn, $refresh = false) {
  $file = stike_g_cache_dir() . "/c-" . substr(hash("sha256", $key), 0, 32) . ".json";
  if (!$refresh && is_file($file)) {
    $c = json_decode((string)@file_get_contents($file), true);
    if (is_array($c) && isset($c["t"]) && is_array($c["d"] ?? null) && time() - (int)$c["t"] < $ttl) return $c["d"] + ["cached" => true, "cachedAt" => (int)$c["t"]];
  }
  $d = $fn();
  if (is_array($d) && !empty($d["ok"])) {
    $tmp = $file . "." . bin2hex(random_bytes(4)) . ".tmp";
    if (@file_put_contents($tmp, json_encode(["t" => time(), "d" => $d], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) !== false) { @chmod($tmp, 0600); @rename($tmp, $file); }
  }
  return $d;
}

/* ------------------------------------- Google Analytics 4 ------------------------------------- */

function stike_ga4_property() {
  $p = preg_replace('/\D/', "", (string)stike_config("GA4_PROPERTY_ID", ""));
  return strlen($p) >= 5 ? $p : null;
}
function stike_ga4_url($path) { return stike_google_url("ga4data") . "/v1beta/properties/" . stike_ga4_property() . $path; }

/* Un reporte de la API de datos. $range: lista de {startDate, endDate, name}. opts: limit, order, event (lista de eventName), filter. */
function stike_ga4_rep($dims, $mets, $range, $opts = []) {
  $r = ["dateRanges" => $range, "dimensions" => array_map(fn($d) => ["name" => $d], $dims), "metrics" => array_map(fn($m) => ["name" => $m], $mets)];
  if (!empty($opts["limit"])) $r["limit"] = (string)$opts["limit"];
  if (!empty($opts["order"])) $r["orderBys"] = $opts["order"];
  if (!empty($opts["event"])) $r["dimensionFilter"] = ["filter" => ["fieldName" => "eventName", "inListFilter" => ["values" => array_values($opts["event"])]]];
  return $r;
}
function stike_ga4_order_metric($name, $desc = true) { return [["metric" => ["metricName" => $name], "desc" => $desc]]; }
function stike_ga4_order_dim($name) { return [["dimension" => ["dimensionName" => $name]]]; }

/* Filas de la API -> arreglos asociativos {dimension => texto, metrica => numero}. Con dos rangos de fechas, cada fila trae «dateRange». */
function stike_ga4_normalize($rep) {
  $dh = array_map(fn($h) => (string)($h["name"] ?? ""), is_array($rep["dimensionHeaders"] ?? null) ? $rep["dimensionHeaders"] : []);
  $mh = array_map(fn($h) => (string)($h["name"] ?? ""), is_array($rep["metricHeaders"] ?? null) ? $rep["metricHeaders"] : []);
  $rows = [];
  foreach (is_array($rep["rows"] ?? null) ? $rep["rows"] : [] as $row) {
    $o = [];
    foreach (is_array($row["dimensionValues"] ?? null) ? $row["dimensionValues"] : [] as $i => $v) $o[$dh[$i] ?? "d" . $i] = (string)($v["value"] ?? "");
    foreach (is_array($row["metricValues"] ?? null) ? $row["metricValues"] : [] as $i => $v) $o[$mh[$i] ?? "m" . $i] = (float)($v["value"] ?? 0);
    $rows[] = $o;
  }
  return $rows;
}

/* Hasta 5 reportes en una llamada. -> ["ok" => true, "reports" => [filas, ...]] o el error explicado. */
function stike_ga4_batch($reports) {
  $prop = stike_ga4_property();
  if (!$prop) return stike_g_fail("ga4_not_configured", "Falta el ID de la propiedad de GA4 (solo números: Administrar → Detalles de la propiedad). Escríbelo en Analítica → Conexión con Google.");
  $r = stike_g_call("ga4", STIKE_G_SCOPE_GA, "POST", stike_ga4_url(":batchRunReports"), ["requests" => $reports], ["property" => $prop]);
  if (empty($r["ok"])) return $r;
  $out = [];
  foreach (is_array($r["json"]["reports"] ?? null) ? $r["json"]["reports"] : [] as $rep) $out[] = stike_ga4_normalize(is_array($rep) ? $rep : []);
  return ["ok" => true, "reports" => $out];
}
function stike_ga4_realtime($body) {
  $prop = stike_ga4_property();
  if (!$prop) return stike_g_fail("ga4_not_configured", "Falta el ID de la propiedad de GA4.");
  $r = stike_g_call("ga4", STIKE_G_SCOPE_GA, "POST", stike_ga4_url(":runRealtimeReport"), $body, ["property" => $prop]);
  if (empty($r["ok"])) return $r;
  return ["ok" => true, "rows" => stike_ga4_normalize($r["json"])];
}
function stike_ga4_metadata() {
  $prop = stike_ga4_property();
  if (!$prop) return stike_g_fail("ga4_not_configured", "Falta el ID de la propiedad de GA4.");
  return stike_g_call("ga4", STIKE_G_SCOPE_GA, "GET", stike_ga4_url("/metadata"), null, ["property" => $prop]);
}

/* ------------------------------------------ Search Console ------------------------------------------ */

function stike_gsc_site() {
  $s = trim((string)stike_config("GSC_SITE_URL", ""));
  return $s !== "" ? $s : null;
}
function stike_gsc_url($path) { return stike_google_url("gsc") . "/webmasters/v3/sites/" . rawurlencode((string)stike_gsc_site()) . $path; }

function stike_gsc_query($body) {
  $site = stike_gsc_site();
  if (!$site) return stike_g_fail("gsc_not_configured", "Falta la propiedad de Search Console (por ejemplo sc-domain:stikebikeshop.com). Escríbela en Analítica → Conexión con Google.");
  $r = stike_g_call("gsc", STIKE_G_SCOPE_GSC, "POST", stike_gsc_url("/searchAnalytics/query"), $body, ["site" => $site]);
  if (empty($r["ok"])) return $r;
  $rows = [];
  foreach (is_array($r["json"]["rows"] ?? null) ? $r["json"]["rows"] : [] as $row) {
    $rows[] = ["keys" => array_map("strval", is_array($row["keys"] ?? null) ? $row["keys"] : []), "clicks" => (float)($row["clicks"] ?? 0), "impressions" => (float)($row["impressions"] ?? 0), "ctr" => (float)($row["ctr"] ?? 0), "position" => (float)($row["position"] ?? 0)];
  }
  return ["ok" => true, "rows" => $rows];
}
function stike_gsc_sites() {
  return stike_g_call("gsc", STIKE_G_SCOPE_GSC, "GET", stike_google_url("gsc") . "/webmasters/v3/sites", null, ["site" => (string)stike_gsc_site()]);
}
function stike_gsc_sitemaps() {
  $site = stike_gsc_site();
  if (!$site) return stike_g_fail("gsc_not_configured", "Falta la propiedad de Search Console.");
  return stike_g_call("gsc", STIKE_G_SCOPE_GSC, "GET", stike_gsc_url("/sitemaps"), null, ["site" => $site]);
}
function stike_gsc_submit_sitemap($feed) {
  $site = stike_gsc_site();
  if (!$site) return stike_g_fail("gsc_not_configured", "Falta la propiedad de Search Console.");
  return stike_g_call("gsc", STIKE_G_SCOPE_GSC_WRITE, "PUT", stike_gsc_url("/sitemaps/" . rawurlencode($feed)), null, ["site" => $site]);
}

/* ------------------------------------------------ fechas ------------------------------------------------ */

/* Rango pedido ("today", "7d", "28d", "90d") en hora de Colombia, mas el periodo anterior de la misma duracion.
   $lag: dias de retraso del final (Search Console tarda ~2 dias en tener datos). */
function stike_an_range($key, $lag = 0) {
  $days = ["today" => 1, "7d" => 7, "28d" => 28, "90d" => 90][$key] ?? 28;
  $tz = new DateTimeZone(STIKE_FP_TZ);
  $to = new DateTime("today", $tz);
  if ($lag) $to->modify("-" . $lag . " days");
  $from = (clone $to)->modify("-" . ($days - 1) . " days");
  $pto = (clone $from)->modify("-1 day");
  $pfrom = (clone $pto)->modify("-" . ($days - 1) . " days");
  return ["key" => array_key_exists($key, ["today" => 1, "7d" => 1, "28d" => 1, "90d" => 1]) ? $key : "28d", "days" => $days,
          "from" => $from->format("Y-m-d"), "to" => $to->format("Y-m-d"), "prevFrom" => $pfrom->format("Y-m-d"), "prevTo" => $pto->format("Y-m-d")];
}
