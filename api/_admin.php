<?php
/* =========================================================================
   STIKE BIKE SHOP: sesion del panel admin (barrera REAL, en el servidor).

   Antes el login de admin.html era solo de pantalla: la pagina y su codigo
   eran publicos y la "sesion" vivia en sessionStorage, que cualquiera podia
   escribir desde la consola. Ahora:

   - admin.php no entrega admin.html ni admin.js sin una cookie de sesion
     valida; sin ella solo muestra la pantalla de "Iniciar sesion con Google".
   - api/admin-login.php verifica el ID token de Google EN EL SERVIDOR
     (firma, audiencia = nuestro Client ID, correo verificado, no vencido) y
     que el correo este en STIKE_ADMIN_EMAILS. Recien ahi emite la cookie.
   - La cookie es HttpOnly (el JavaScript no la puede leer), Secure,
     SameSite=Strict, firmada con HMAC y con vencimiento. En cada pedido se
     vuelve a revisar que el correo siga en la lista.
   - El navegador ya no guarda ninguna llave: GitHub se habla por
     api/gh.php con el GITHUB_TOKEN del servidor, y las ventas online por
     api/sales.php con la misma cookie.

   El guion bajo del nombre: no es un endpoint (el .htaccess lo bloquea).
   ========================================================================= */

require_once __DIR__ . "/_lib.php";

/* Quien puede ENTRAR al panel y quien ve costos/margen (rol "owner").
   Para agregar a alguien: sumarlo aca y publicar. */
const STIKE_ADMIN_EMAILS = [
  "daniel.f.acosta96@gmail.com",
  "camilor9507@gmail.com",
  "jparra375@gmail.com",
];
const STIKE_OWNER_EMAILS = [
  "daniel.f.acosta96@gmail.com",
  "jparra375@gmail.com",
];
const STIKE_OAUTH_CLIENT_ID = "752305520255-7e2abc762p3saer5sube25jh9rt9jle7.apps.googleusercontent.com";
const STIKE_ADMIN_COOKIE = "stike_admin";
const STIKE_ADMIN_TTL = 43200;   // 12 horas

function stike_admin_role($email) {
  $email = strtolower(trim((string)$email));
  foreach (STIKE_ADMIN_EMAILS as $e) {
    if (strtolower($e) === $email) {
      foreach (STIKE_OWNER_EMAILS as $o) if (strtolower($o) === $email) return "owner";
      return "employee";
    }
  }
  return null;
}

/* Clave de firma de las cookies. Se deriva de ADMIN_API_KEY (que ya esta en
   config.local.php) para no pedir otra llave; se puede fijar aparte con
   ADMIN_SESSION_SECRET. Cambiarla cierra todas las sesiones abiertas. */
function stike_admin_secret() {
  $s = stike_config("ADMIN_SESSION_SECRET");
  if ($s && strlen($s) >= 24) return $s;
  $k = stike_config("ADMIN_API_KEY");
  if (!$k || strlen($k) < 24) throw new ApiError(500, "server_not_configured", "falta ADMIN_API_KEY en api/config.local.php");
  return hash_hmac("sha256", "stike-admin-session-v1", $k);
}

function stike_b64u($s) { return rtrim(strtr(base64_encode($s), "+/", "-_"), "="); }
function stike_b64u_dec($s) { return base64_decode(strtr($s, "-_", "+/")); }

function stike_admin_issue($email, $role) {
  $payload = stike_b64u(json_encode(["e" => $email, "r" => $role, "x" => time() + STIKE_ADMIN_TTL]));
  $sig = stike_b64u(hash_hmac("sha256", $payload, stike_admin_secret(), true));
  setcookie(STIKE_ADMIN_COOKIE, "$payload.$sig", [
    "expires" => time() + STIKE_ADMIN_TTL, "path" => "/",
    "secure" => !empty($_SERVER["HTTPS"]) || getenv("STIKE_INSECURE_COOKIE") !== "1",
    "httponly" => true, "samesite" => "Strict",
  ]);
}

function stike_admin_clear() {
  setcookie(STIKE_ADMIN_COOKIE, "", ["expires" => 1, "path" => "/", "secure" => getenv("STIKE_INSECURE_COOKIE") !== "1", "httponly" => true, "samesite" => "Strict"]);
}

/* Devuelve ["email" => ..., "role" => ...] o null. Revalida la lista. */
function stike_admin_session() {
  $raw = $_COOKIE[STIKE_ADMIN_COOKIE] ?? "";
  if (!is_string($raw) || substr_count($raw, ".") !== 1) return null;
  [$payload, $sig] = explode(".", $raw);
  try { $secret = stike_admin_secret(); } catch (ApiError $e) { return null; }
  $expected = stike_b64u(hash_hmac("sha256", $payload, $secret, true));
  if (!hash_equals($expected, $sig)) return null;
  $data = json_decode(stike_b64u_dec($payload), true);
  if (!is_array($data) || ($data["x"] ?? 0) < time()) return null;
  $role = stike_admin_role($data["e"] ?? "");
  if (!$role) return null;
  return ["email" => strtolower($data["e"]), "role" => $role];
}

function stike_admin_require() {
  $s = stike_admin_session();
  if (!$s) throw new ApiError(401, "not_logged_in");
  return $s;
}

/* Pedidos que cambian algo: ademas de SameSite=Strict, el Origin (si viene)
   tiene que ser este mismo sitio. */
function stike_admin_check_origin() {
  $origin = $_SERVER["HTTP_ORIGIN"] ?? "";
  if ($origin === "") return;
  $host = $_SERVER["HTTP_HOST"] ?? "";
  if (parse_url($origin, PHP_URL_HOST) !== preg_replace('/:\d+$/', '', $host)) throw new ApiError(403, "bad_origin");
}

/* Verifica el ID token de Google en el servidor. */
function stike_verify_google_credential($idToken) {
  if (!is_string($idToken) || strlen($idToken) > 4096 || !preg_match('/^[A-Za-z0-9._-]+$/', $idToken)) throw new ApiError(400, "invalid_credential");
  $base = getenv("STIKE_GOOGLE_TOKENINFO") ?: "https://oauth2.googleapis.com/tokeninfo";   // solo pruebas
  $res = stike_http("GET", $base . "?id_token=" . rawurlencode($idToken));
  if ($res["status"] !== 200 || !is_array($res["json"])) throw new ApiError(401, "google_rejected");
  $info = $res["json"];
  if (($info["aud"] ?? null) !== STIKE_OAUTH_CLIENT_ID) throw new ApiError(401, "wrong_audience");
  if (!in_array($info["iss"] ?? "", ["accounts.google.com", "https://accounts.google.com"], true)) throw new ApiError(401, "wrong_issuer");
  if (($info["email_verified"] ?? null) !== "true" && ($info["email_verified"] ?? null) !== true) throw new ApiError(401, "email_not_verified");
  if ((int)($info["exp"] ?? 0) < time()) throw new ApiError(401, "expired");
  return strtolower((string)($info["email"] ?? ""));
}
