<?php
/* =========================================================================
   STIKE BIKE SHOP: regreso de Google al conectar la cuenta de Gmail que envia
   los avisos de venta (panel -> Configuracion -> «Correo de aviso» -> opcion C).

   Flujo: el dueño o el desarrollador pulsa «Conectar con Google» en el panel; el
   panel (admin-config.php, accion gmail_connect_start) crea un «state» de un solo
   uso y lo manda a Google. Google le pide a la cuenta que elija y acepte (solo
   el permiso de ENVIAR correos) y vuelve aqui con ?code=...&state=...

   Esta direccion es publica a proposito (la llama el navegador desde Google, y
   la cookie de la sesion del panel no viaja en ese regreso), asi que NO se fia de
   quien llega: solo sirve con un «state» vigente (10 minutos, un solo uso) que
   creo una sesion de dueño o desarrollador. Cambia el codigo por el permiso
   permanente, lo guarda CIFRADO, y manda al navegador de vuelta al panel con un
   codigo corto de resultado. Nunca muestra ni devuelve ningun token.
   ========================================================================= */
require __DIR__ . "/_lib.php";

function stike_gmail_bounce($qs) {
  header("Content-Type: text/html; charset=utf-8");
  header("Cache-Control: no-store");
  header("Referrer-Policy: no-referrer");
  $url = "/admin.html?" . $qs;
  echo '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    . '<meta name="robots" content="noindex"><meta http-equiv="refresh" content="1;url=' . stike_h($url) . '"><title>Volviendo al panel…</title></head>'
    . '<body style="font-family:system-ui,sans-serif;background:#141516;color:#eee;padding:40px"><p>Volviendo al panel… '
    . '<a style="color:#52f0d8" href="' . stike_h($url) . '">Si no pasa nada, haz clic aquí</a>.</p></body></html>';
  exit;
}
function stike_gmail_fail_back($reason, $google = "") {
  $q = "gmail=error&r=" . rawurlencode($reason);
  if ($google !== "" && preg_match('/^[a-z_]{1,40}$/', $google)) $q .= "&e=" . rawurlencode($google);
  stike_gmail_bounce($q);
}

try {
  if (($_SERVER["REQUEST_METHOD"] ?? "") !== "GET") { http_response_code(405); exit; }
  if (isset($_GET["error"])) {
    $e = (string)$_GET["error"];
    stike_gmail_fail_back($e === "access_denied" ? "denied" : "exchange", $e === "access_denied" ? "" : $e);
  }
  $state = stike_oauth_state_take($_GET["state"] ?? null);
  if (!$state) stike_gmail_fail_back("state");
  $client = stike_gmail_client();
  $code = $_GET["code"] ?? null;
  if (!$client) stike_gmail_fail_back("client");
  if (!is_string($code) || $code === "" || strlen($code) > 2048) stike_gmail_fail_back("exchange");

  $res = stike_http("POST", stike_google_url("oauth") . "/token", ["Content-Type: application/x-www-form-urlencoded"], http_build_query([
    "code" => $code, "client_id" => $client["id"], "client_secret" => $client["secret"],
    "redirect_uri" => stike_gmail_redirect_uri(), "grant_type" => "authorization_code",
  ]), 15);
  $j = is_array($res["json"]) ? $res["json"] : [];
  if ($res["status"] !== 200) {
    error_log("[stike] Gmail: Google rechazo el codigo (" . $res["status"] . " " . (is_string($j["error"] ?? null) ? $j["error"] : "") . ")");
    stike_gmail_fail_back("exchange", is_string($j["error"] ?? null) ? $j["error"] : "");
  }
  $refresh = is_string($j["refresh_token"] ?? null) ? $j["refresh_token"] : "";
  if ($refresh === "") stike_gmail_fail_back("no_refresh");
  /* La cuenta que acepto: viene en el id_token que Google entrega directo en esta respuesta (por HTTPS), sin pasar por el navegador. */
  $email = "";
  if (is_string($j["id_token"] ?? null) && substr_count($j["id_token"], ".") === 2) {
    $claims = json_decode((string)base64_decode(strtr(explode(".", $j["id_token"])[1], "-_", "+/")), true);
    if (is_array($claims) && is_string($claims["email"] ?? null) && filter_var($claims["email"], FILTER_VALIDATE_EMAIL) && ($claims["email_verified"] ?? true) !== false) $email = strtolower($claims["email"]);
  }
  if ($email === "") stike_gmail_fail_back("no_email");

  $all = stike_runtime_config_all();
  foreach (["GMAIL_REFRESH_TOKEN" => $refresh, "GMAIL_SENDER" => $email] as $k => $v) {
    $sealed = stike_runtime_seal($v);
    $all[$k] = ($sealed ?: ["value" => $v]) + ["by" => $state["by"], "at" => stike_now_iso()];
  }
  stike_runtime_config_write($all);
  error_log("[stike] Gmail conectado por " . $state["by"] . " (cuenta " . $email . ")");
  stike_gmail_bounce("gmail=ok");
} catch (Throwable $e) {
  error_log("[stike] gmail-callback: " . get_class($e) . ": " . $e->getMessage());
  stike_gmail_fail_back("save");
}
