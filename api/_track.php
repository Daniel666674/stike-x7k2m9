<?php
/* =========================================================================
   STIKE BIKE SHOP: contador propio de eventos del sitio (respaldo de Google Analytics).

   Por que existe: Google Analytics lo tapan los bloqueadores de anuncios y de rastreo (entre 10 % y 30 % de los
   visitantes de una tienda como esta) y tarda hasta un dia en mostrar datos. Los clics a WhatsApp, lo que se agrega al
   carrito y las visitas se cuentan TAMBIEN aca, en el propio servidor, para tener siempre una cifra de comparacion y para
   que el panel muestre algo desde el primer dia.

   Privacidad: son CONTEOS AGREGADOS por dia. No se guarda la IP, ni el navegador, ni ningun identificador, ni se pone
   ninguna cookie; no hay forma de saber quien hizo cada clic. Del mensaje de WhatsApp no se guarda nada (ni siquiera se
   envia aca). Si la persona rechazo las cookies opcionales, assets/js/analytics.js no manda nada.

   Cada dia es un archivo pequeño (analytics/fp-AAAA-MM-DD.json en la carpeta de datos del servidor, fuera del sitio) con
   contadores por evento y, de cada evento, por lugar, pagina, producto, dispositivo y hora. Los lee api/analytics.php
   (panel, solo roles con acceso a finanzas). Se conservan 400 dias.

   El guion bajo del nombre: no es un endpoint (el .htaccess lo bloquea). El endpoint es api/track.php.
   ========================================================================= */
require_once __DIR__ . "/_lib.php";

const STIKE_FP_TZ = "America/Bogota";
const STIKE_FP_KEEP_DAYS = 400;
const STIKE_FP_MAX_KEYS = 400;          // por mapa y por dia: lo que pase se junta en «_otros» (nadie puede inflar el disco)
const STIKE_FP_EVENTS = ["page_view", "view_item", "whatsapp_click", "add_to_cart", "begin_checkout", "search", "contact_click", "generate_lead", "share"];
const STIKE_FP_LOCS = ["floating_button", "header", "menu", "footer", "product_page", "cart", "build", "payment_result", "contact_page", "home", "fate", "form_fallback", "blog", "other"];
const STIKE_FP_PAGE_TYPES = ["home", "catalog", "product", "cart", "payment_result", "build", "contact", "blog", "fate", "legal", "other"];
const STIKE_FP_REFS = ["direct", "search", "social", "campaign", "internal", "other"];
const STIKE_FP_METHODS = ["phone", "email", "maps", "instagram", "facebook", "tiktok"];
const STIKE_FP_FORMS = ["contact", "newsletter"];

function stike_fp_dir() {
  $dir = stike_storage_dir() . "/analytics";
  if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) throw new ApiError(500, "storage_unavailable");
  return $dir;
}

/* [«AAAA-MM-DD», hora 0-23] en hora de Colombia (el dia del negocio, no el del servidor). */
function stike_fp_when($ts = null) {
  $d = new DateTime("@" . (int)($ts ?? time()));
  $d->setTimezone(new DateTimeZone(STIKE_FP_TZ));
  return [$d->format("Y-m-d"), (int)$d->format("G")];
}

function stike_fp_clean_path($p) {
  if (!is_string($p) || $p === "" || $p[0] !== "/") return null;
  $p = preg_replace('/[?#].*$/', "", $p);
  $p = preg_replace('#/index\.html$#', "/", $p);
  if (strlen($p) > 120 || !preg_match('#^/[A-Za-z0-9_./%-]*$#', $p) || strpos($p, "..") !== false) return null;
  return $p;
}
function stike_fp_clean_slug($s) {
  return (is_string($s) && preg_match('/^[a-z0-9][a-z0-9-]{0,79}$/', $s)) ? $s : null;
}
/* Lo que alguien escribio en el buscador: solo letras, numeros y espacios (sin correos, telefonos ni enlaces), corto. */
function stike_fp_clean_term($t) {
  if (!is_string($t)) return null;
  $t = mb_strtolower(trim($t), "UTF-8");
  $t = preg_replace('/[^\p{L}\p{N} ]+/u', " ", $t);
  $t = trim(preg_replace('/\s+/u', " ", $t));
  if ($t === "" || mb_strlen($t, "UTF-8") < 2 || mb_strlen($t, "UTF-8") > 40) return null;
  if (preg_match('/\d{6,}/', $t)) return null;   // un numero largo es un telefono o una cedula, no una busqueda de producto
  return $t;
}
function stike_fp_enum($v, $allowed, $default = null) { return (is_string($v) && in_array($v, $allowed, true)) ? $v : $default; }

function stike_fp_bump(&$map, $key, $cap = STIKE_FP_MAX_KEYS) {
  if (!is_array($map)) $map = [];
  if (!isset($map[$key]) && count($map) >= $cap) $key = "_otros";
  $map[$key] = (isset($map[$key]) ? (int)$map[$key] : 0) + 1;
}

/* Anota un evento ya validado. $p: loc, pt, path, slug, dev, ref, q, m, f. Devuelve true si quedo escrito. */
function stike_fp_record($event, $p, $ts = null) {
  if (!in_array($event, STIKE_FP_EVENTS, true)) return false;
  [$day, $hour] = stike_fp_when($ts);
  $file = stike_fp_dir() . "/fp-" . $day . ".json";
  $fh = @fopen($file, "c+b");
  if (!$fh) return false;
  try {
    if (!flock($fh, LOCK_EX)) return false;
    $data = json_decode((string)stream_get_contents($fh), true);
    if (!is_array($data) || !isset($data["ev"]) || !is_array($data["ev"])) $data = ["v" => 1, "day" => $day, "ev" => []];
    if (!isset($data["ev"][$event]) || !is_array($data["ev"][$event])) $data["ev"][$event] = ["n" => 0];
    $e = &$data["ev"][$event];
    $e["n"] = (int)($e["n"] ?? 0) + 1;
    stike_fp_bump($e["hour"], (string)$hour, 24);
    if (!empty($p["dev"])) stike_fp_bump($e["dev"], $p["dev"], 3);
    if (!empty($p["pt"])) stike_fp_bump($e["pt"], $p["pt"], 12);
    if (!empty($p["loc"])) stike_fp_bump($e["loc"], $p["loc"], 20);
    if (!empty($p["path"])) stike_fp_bump($e["path"], $p["path"]);
    if (!empty($p["slug"])) stike_fp_bump($e["slug"], $p["slug"]);
    if (!empty($p["ref"])) stike_fp_bump($e["ref"], $p["ref"], 8);
    if (!empty($p["q"])) stike_fp_bump($e["q"], $p["q"]);
    if (!empty($p["m"])) stike_fp_bump($e["m"], $p["m"], 8);
    if (!empty($p["f"])) stike_fp_bump($e["f"], $p["f"], 4);
    unset($e);
    ftruncate($fh, 0); rewind($fh);
    fwrite($fh, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    fflush($fh);
  } finally { flock($fh, LOCK_UN); fclose($fh); }
  if (random_int(1, 300) === 1) stike_fp_prune();
  return true;
}

function stike_fp_prune() {
  try {
    $limit = stike_fp_when(time() - STIKE_FP_KEEP_DAYS * 86400)[0];
    foreach (glob(stike_fp_dir() . "/fp-*.json") ?: [] as $f) {
      if (preg_match('/fp-(\d{4}-\d{2}-\d{2})\.json$/', $f, $m) && $m[1] < $limit) @unlink($f);
    }
  } catch (Throwable $e) {}
}

/* ---------------------------------- lectura ---------------------------------- */

function stike_fp_days_between($from, $to) {
  $a = DateTime::createFromFormat("Y-m-d", $from, new DateTimeZone(STIKE_FP_TZ));
  $b = DateTime::createFromFormat("Y-m-d", $to, new DateTimeZone(STIKE_FP_TZ));
  if (!$a || !$b || $a > $b) return [];
  $out = [];
  while ($a <= $b && count($out) < 800) { $out[] = $a->format("Y-m-d"); $a->modify("+1 day"); }
  return $out;
}

function stike_fp_merge_map(&$into, $from) {
  if (!is_array($from)) return;
  foreach ($from as $k => $n) $into[$k] = (isset($into[$k]) ? $into[$k] : 0) + (int)$n;
}

/* Suma varios dias: ["days" => [dia => [evento => n]], "ev" => [evento => [n, loc, pt, path, slug, dev, hour, ref, q, m, f]], "first" => primer dia con datos]. */
function stike_fp_summary($from, $to) {
  $dir = stike_fp_dir();
  $out = ["from" => $from, "to" => $to, "days" => [], "ev" => [], "first" => null];
  foreach (stike_fp_days_between($from, $to) as $day) {
    $out["days"][$day] = [];
    $file = $dir . "/fp-" . $day . ".json";
    if (!is_file($file)) continue;
    $fh = @fopen($file, "rb");
    if (!$fh) continue;
    flock($fh, LOCK_SH);
    $data = json_decode((string)stream_get_contents($fh), true);
    flock($fh, LOCK_UN); fclose($fh);
    if (!is_array($data) || !is_array($data["ev"] ?? null)) continue;
    if ($out["first"] === null) $out["first"] = $day;
    foreach ($data["ev"] as $name => $e) {
      if (!is_array($e)) continue;
      $out["days"][$day][$name] = (int)($e["n"] ?? 0);
      if (!isset($out["ev"][$name])) $out["ev"][$name] = ["n" => 0];
      $out["ev"][$name]["n"] += (int)($e["n"] ?? 0);
      foreach (["hour", "dev", "pt", "loc", "path", "slug", "ref", "q", "m", "f"] as $dim) {
        if (isset($e[$dim])) { if (!isset($out["ev"][$name][$dim])) $out["ev"][$name][$dim] = []; stike_fp_merge_map($out["ev"][$name][$dim], $e[$dim]); }
      }
    }
  }
  return $out;
}

/* ------------------------- validacion de lo que llega del navegador ------------------------- */

function stike_fp_site_host() {
  $h = strtolower((string)parse_url(stike_public_base(), PHP_URL_HOST));
  return preg_replace('/^www\./', "", $h);
}
function stike_fp_origin_ok() {
  $src = $_SERVER["HTTP_ORIGIN"] ?? ($_SERVER["HTTP_REFERER"] ?? "");
  if ($src === "") return true;   // algunos navegadores con privacidad reforzada no mandan ninguno: no es motivo para descartar
  $h = strtolower((string)parse_url($src, PHP_URL_HOST));
  return preg_replace('/^www\./', "", $h) === stike_fp_site_host();
}
function stike_fp_is_bot($ua) {
  $ua = (string)$ua;
  return $ua === "" || preg_match('/bot|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|uptime|monitor|preview|facebookexternalhit|curl|wget|python-requests|go-http-client|java\//i', $ua) === 1;
}

/* Convierte el cuerpo del navegador en [evento, props] o null. Solo pasa lo que esta en las listas de arriba. */
function stike_fp_parse($raw) {
  $b = json_decode((string)$raw, true);
  if (!is_array($b)) return null;
  $event = stike_fp_enum($b["e"] ?? null, STIKE_FP_EVENTS);
  if (!$event) return null;
  $p = [
    "dev" => stike_fp_enum($b["d"] ?? null, ["m", "d"], "d"),
    "pt" => stike_fp_enum($b["t"] ?? null, STIKE_FP_PAGE_TYPES, "other"),
    "path" => stike_fp_clean_path($b["p"] ?? null),
    "slug" => stike_fp_clean_slug($b["s"] ?? null),
  ];
  if ($event === "whatsapp_click") $p["loc"] = stike_fp_enum($b["l"] ?? null, STIKE_FP_LOCS, "other");
  if ($event === "page_view") $p["ref"] = stike_fp_enum($b["r"] ?? null, STIKE_FP_REFS, "other");
  if ($event === "search") { $p["q"] = stike_fp_clean_term($b["q"] ?? null); if (!$p["q"]) return null; }
  if ($event === "contact_click") { $p["m"] = stike_fp_enum($b["m"] ?? null, STIKE_FP_METHODS); if (!$p["m"]) return null; }
  if ($event === "generate_lead") { $p["f"] = stike_fp_enum($b["f"] ?? null, STIKE_FP_FORMS); if (!$p["f"]) return null; }
  return [$event, $p];
}
