<?php
/* =========================================================================
   STIKE BIKE SHOP: utilidades compartidas de los endpoints PHP (Hostinger).

   Lo usan wompi-sign.php, wompi-order.php, wompi-events.php y sales.php.
   El guion bajo del nombre es a proposito: no es un endpoint, no se llama
   directo (si alguien lo abre en el navegador no imprime nada).

   Secretos: SIEMPRE de variable de entorno o de api/config.local.php (se sube
   a mano por FTP/Administrador de archivos, nunca al repo; ver .gitignore):

     <?php return [
       'WOMPI_PUBLIC_KEY'       => 'pub_prod_...',
       'WOMPI_PRIVATE_KEY'      => 'prv_prod_...',
       'WOMPI_INTEGRITY_SECRET' => 'prod_integrity_...',
       'WOMPI_EVENTS_SECRET'    => 'prod_events_...',   // opcional: si esta, cada evento se verifica con su firma
       'ADMIN_API_KEY'          => '<cadena larga al azar; se pega en el panel>',
       'RESEND_API_KEY'         => 're_...',            // opcional; mejor pegarla en el panel (Configuracion > Correo de aviso)
       'OWNER_NOTIFY_EMAIL'     => '<correo de quien recibe las ventas>',  // opcional; tambien se cambia en el panel
       'SMTP_HOST' => 'smtp.hostinger.com', 'SMTP_PORT' => 465,           // opcional: enviar con un correo del dominio (mejor desde el panel)
       'SMTP_USER' => 'ventas@stikebikeshop.com', 'SMTP_PASS' => '<contrasena de ese correo>',
       'STORAGE_DIR'            => '/home/uXXXX/stike-private',  // opcional
     ];

   Donde se guardan las ventas: en STORAGE_DIR (por defecto una carpeta
   "stike-private" AL LADO de public_html, o sea fuera de lo que sirve el
   sitio). Ahi viven ventas.jsonl (una venta por linea, solo se agrega) y
   pending/ (pedidos firmados que aun no se pagan). Los datos del cliente
   (nombre, telefono, direccion) quedan SOLO ahi y en el correo al dueno --
   nunca en el repo, que es publico.

   Los precios replican lib/pricing.js (Vercel) y carrito.html; los tres tienen
   que decir lo mismo. El envio NO se cobra en el pago: se cotiza por WhatsApp.
   ========================================================================= */

/* Los errores de PHP nunca se imprimen en la respuesta (rutas del servidor, valores): van solo al log del servidor. */
@ini_set("display_errors", "0");
@ini_set("log_errors", "1");

/* El ENVIO no se cobra en el pago en linea: depende de la ciudad, el peso y la transportadora, asi que lo calcula la tienda para
   cada pedido, se lo comparte al cliente por WhatsApp y corre por cuenta del cliente. Lo que firma Wompi es solo el valor de los
   productos (stike_price_order devuelve "shipping" => 0). */
const STIKE_MAX_LINES = 50;
const STIKE_MAX_QTY = 20;
const STIKE_CURRENCY = "COP";

class ApiError extends Exception {
  public $status;
  public $errorCode;
  public $detail;
  public function __construct($status, $errorCode, $detail = null) {
    parent::__construct($errorCode);
    $this->status = $status;
    $this->errorCode = $errorCode;
    $this->detail = $detail;
  }
}

function respond($status, $data) {
  http_response_code($status);
  header("Cache-Control: no-store");
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

/* Envuelve un endpoint: ApiError -> su respuesta; cualquier otra cosa -> 500
   generico (el detalle va al log del servidor, nunca al navegador). */
function stike_run($fn) {
  header("Content-Type: application/json; charset=utf-8");
  try {
    $fn();
  } catch (ApiError $e) {
    $out = ["error" => $e->errorCode];
    if ($e->detail !== null) $out["detail"] = $e->detail;
    respond($e->status, $out);
  } catch (Throwable $e) {
    error_log("[stike] " . get_class($e) . ": " . $e->getMessage());
    respond(500, ["error" => "internal_error"]);
  }
}

/* Secretos y ajustes que se pueden corregir desde el panel (api/admin-config.php) sin tocar
   archivos del servidor. Lo guardado ahi manda sobre la variable de entorno y sobre
   api/config.local.php: es lo ultimo que alguien decidio a proposito. La llave
   PUBLICA NO esta aqui: cambiarla redirige el dinero a otra cuenta, asi que solo se
   cambia en el servidor. La privada si (solo busca pagos ya hechos; el panel la
   comprueba con Wompi antes de guardarla). El resto es del correo de aviso de cada venta: la llave
   de Resend (secreta), a quien le llega, desde que remitente sale y la cuenta de correo propia
   (SMTP: servidor, puerto, correo y contraseña, esta ultima secreta) y la conexion con la API de
   Gmail de Google Cloud (ID y secreto de cliente OAuth, y el permiso permanente que Google entrega
   al conectar la cuenta: los dos secretos van cifrados). */
const STIKE_RUNTIME_KEYS = ["WOMPI_INTEGRITY_SECRET", "WOMPI_EVENTS_SECRET", "WOMPI_PRIVATE_KEY", "RESEND_API_KEY", "OWNER_NOTIFY_EMAIL", "RESEND_FROM", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS",
  "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "GMAIL_SENDER"];

function stike_runtime_config_path() { return stike_storage_dir() . "/runtime-config.json"; }

function stike_runtime_config_all() {
  try {
    $path = stike_runtime_config_path();
    if (!is_file($path)) return [];
    $d = json_decode((string)@file_get_contents($path), true);
    return is_array($d) ? $d : [];
  } catch (Throwable $e) {
    return [];   // sin carpeta de datos: se cae a la variable de entorno / el archivo, nunca se rompe el pago por esto
  }
}

/* Lo guardado desde el panel se CIFRA en el disco (AES-256-GCM): aunque alguien llegara a leer la carpeta de datos
   (un respaldo, un error de permisos), no veria las llaves en texto plano. La clave de cifrado sale del
   ADMIN_SESSION_SECRET / ADMIN_API_KEY del servidor (api/config.local.php), que nunca esta en el repositorio ni en la
   carpeta de datos. Si esa clave cambia, lo guardado deja de poder leerse: el servidor vuelve a usar lo de su
   configuracion y el panel avisa que hay que pegar los secretos otra vez. */
function stike_runtime_cipher_key() {
  $m = stike_config("ADMIN_SESSION_SECRET");
  if (!is_string($m) || strlen($m) < 24) $m = stike_config("ADMIN_API_KEY");
  if (!is_string($m) || strlen($m) < 24) return null;
  return hash_hmac("sha256", "stike-runtime-config-v1", $m, true);
}
function stike_runtime_seal($plain) {
  $key = stike_runtime_cipher_key();
  if (!$key || !function_exists("openssl_encrypt")) return null;
  $iv = random_bytes(12);
  $ct = openssl_encrypt($plain, "aes-256-gcm", $key, OPENSSL_RAW_DATA, $iv, $tag);
  return $ct === false ? null : ["enc" => "v1", "iv" => base64_encode($iv), "tag" => base64_encode($tag), "ct" => base64_encode($ct)];
}
/* El valor de una entrada guardada: texto del formato anterior (sin cifrar) o descifrado. null si no se puede leer. */
function stike_runtime_open($entry) {
  if (!is_array($entry)) return null;
  if (is_string($entry["value"] ?? null)) return $entry["value"];
  if (($entry["enc"] ?? null) !== "v1") return null;
  $key = stike_runtime_cipher_key();
  if (!$key || !function_exists("openssl_decrypt")) return null;
  $pt = @openssl_decrypt((string)base64_decode((string)($entry["ct"] ?? "")), "aes-256-gcm", $key, OPENSSL_RAW_DATA, (string)base64_decode((string)($entry["iv"] ?? "")), (string)base64_decode((string)($entry["tag"] ?? "")));
  return $pt === false ? null : $pt;
}
/* Claves guardadas en el panel que YA no se pueden leer (cambio la clave de cifrado del servidor). */
function stike_runtime_config_unreadable() {
  $bad = [];
  foreach (stike_runtime_config_all() as $k => $entry) if (in_array($k, STIKE_RUNTIME_KEYS, true) && stike_runtime_open($entry) === null) $bad[] = $k;
  return $bad;
}

/* Escritura atomica, solo para el dueño del proceso (0600), en la carpeta de datos (fuera del sitio). */
function stike_runtime_config_write($data) {
  $path = stike_runtime_config_path();
  $tmp = $path . "." . bin2hex(random_bytes(4)) . ".tmp";
  $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  if (@file_put_contents($tmp, $json) === false) { @unlink($tmp); throw new ApiError(500, "storage_unavailable", "no se pudo guardar"); }
  @chmod($tmp, 0600);
  if (!@rename($tmp, $path)) { @unlink($tmp); throw new ApiError(500, "storage_unavailable", "no se pudo guardar"); }
}

/* Estado de lo guardado desde el panel: cuantos secretos hay, cuantos van cifrados y cuantos siguen en texto (formato anterior). */
function stike_runtime_config_state() {
  $s = ["total" => 0, "encrypted" => 0, "plain" => 0];
  foreach (stike_runtime_config_all() as $k => $entry) {
    if (!in_array($k, STIKE_RUNTIME_KEYS, true) || !is_array($entry)) continue;
    $s["total"]++;
    if (($entry["enc"] ?? null) === "v1") $s["encrypted"]++;
    elseif (is_string($entry["value"] ?? null)) $s["plain"]++;
  }
  return $s;
}

/* Cifra lo que quedo guardado en texto plano por la version anterior (se llama al abrir el panel). Devuelve cuantos cifro;
   si el servidor no puede cifrar, lo deja como esta (nunca pierde un secreto). */
function stike_runtime_config_upgrade() {
  $all = stike_runtime_config_all();
  $n = 0;
  foreach ($all as $k => $entry) {
    if (!in_array($k, STIKE_RUNTIME_KEYS, true) || !is_array($entry) || !is_string($entry["value"] ?? null) || $entry["value"] === "") continue;
    $sealed = stike_runtime_seal($entry["value"]);
    if (!$sealed) return 0;
    $check = stike_runtime_open($sealed);   // se comprueba que lo cifrado se lee de vuelta antes de soltar el texto
    if ($check !== $entry["value"]) return 0;
    $all[$k] = $sealed + array_diff_key($entry, ["value" => true]);
    $n++;
  }
  if ($n) stike_runtime_config_write($all);
  return $n;
}

function stike_config($key, $default = null) {
  static $file = null;
  if (in_array($key, STIKE_RUNTIME_KEYS, true)) {
    $rv = stike_runtime_open(stike_runtime_config_all()[$key] ?? null);
    if (is_string($rv) && $rv !== "") return $rv;
  }
  $env = getenv($key);
  if ($env !== false && $env !== "") return $env;
  if ($file === null) {
    $file = [];
    $path = __DIR__ . "/config.local.php";
    if (is_file($path)) {
      $cfg = include $path;
      if (is_array($cfg)) $file = $cfg;
    }
  }
  $v = $file[$key] ?? null;
  return ($v !== null && $v !== "") ? $v : $default;
}

function stike_require_method($method) {
  if (($_SERVER["REQUEST_METHOD"] ?? "") !== $method) throw new ApiError(405, "method_not_allowed");
}

function stike_json_body() {
  $body = json_decode(file_get_contents("php://input"), true);
  if (!is_array($body)) throw new ApiError(400, "invalid_json");
  return $body;
}

function stike_valid_reference($v) {
  if (!is_string($v) || !preg_match('/^[A-Za-z0-9_-]{8,64}$/', $v)) throw new ApiError(400, "invalid_reference");
  return $v;
}

function stike_valid_wompi_id($v) {
  if (!is_string($v) || !preg_match('/^[A-Za-z0-9_-]{4,64}$/', $v)) throw new ApiError(400, "invalid_transaction_id");
  return $v;
}

/* Limite simple por IP (archivo en la carpeta de datos). Sirve para que nadie llene el
   disco de pedidos pendientes pidiendo firmas sin parar. Si la carpeta no responde,
   NO se bloquea (un cobro legitimo vale mas que este candado). */
function stike_rate_limited($bucket, $limit, $windowSec) {
  try {
    $ip = $_SERVER["REMOTE_ADDR"] ?? "0";
    $dir = stike_storage_dir() . "/rate";
    if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) return false;
    $path = $dir . "/" . $bucket . "-" . substr(hash("sha256", $ip), 0, 24) . ".json";
    $now = time();
    $fh = @fopen($path, "c+b");
    if (!$fh) return false;
    try {
      if (!flock($fh, LOCK_EX)) return false;
      $hits = json_decode((string)stream_get_contents($fh), true);
      $hits = is_array($hits) ? array_values(array_filter($hits, fn($t) => is_int($t) && $t > $now - $windowSec)) : [];
      $limited = count($hits) >= $limit;
      if (!$limited) $hits[] = $now;
      ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode($hits)); fflush($fh);
      return $limited;
    } finally { flock($fh, LOCK_UN); fclose($fh); }
  } catch (Throwable $e) {
    return false;
  }
}

/* ------------------------------ HTTP saliente ----------------------------- */
function stike_http($method, $url, $headers = [], $body = null, $timeout = 15) {
  $ch = curl_init($url);
  $opts = [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_TIMEOUT => $timeout,
  ];
  if ($body !== null) $opts[CURLOPT_POSTFIELDS] = $body;
  curl_setopt_array($ch, $opts);
  $raw = curl_exec($ch);
  $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err = curl_error($ch);
  curl_close($ch);
  if ($raw === false) return ["status" => 0, "body" => "", "json" => null, "error" => $err];
  return ["status" => $status, "body" => $raw, "json" => json_decode($raw, true), "error" => ""];
}

/* ------------------------------- catalogo -------------------------------- */
/* products-data.js es JS plano: "window.STIKE_PRODUCTS = [ ... ];" */
function stike_load_catalog() {
  $text = @file_get_contents(__DIR__ . "/../assets/js/products-data.js");
  $marker = "window.STIKE_PRODUCTS = ";
  $pos = $text === false ? false : strpos($text, $marker);
  $catalog = null;
  if ($pos !== false) {
    $json = substr($text, $pos + strlen($marker), strrpos($text, ";") - $pos - strlen($marker));
    $catalog = json_decode($json, true);
  }
  if (!is_array($catalog)) throw new ApiError(502, "catalog_parse_failed");
  return $catalog;
}

function stike_clean_variant($v) {
  if ($v === null || $v === "") return null;
  if (!is_string($v) || strlen($v) > 40) throw new ApiError(400, "invalid_item");
  return $v;
}

/* ------------------------------- stock ----------------------------------- */
/* Mismo motor que stikeStockFor (assets/js/data.js): talla y color son pools
   independientes; null = stock sin registrar (no se bloquea la venta). */
function stike_pool_units($pool, $v) {
  foreach ($pool as $row) if (($row["v"] ?? null) === $v) return max(0, (int)($row["u"] ?? 0));
  return 0;
}
/* Con tabla de combinaciones (p.combos = [{s, c, u}]) esa tabla manda. */
function stike_has_combos($p) {
  return !empty($p["combos"]) && is_array($p["combos"]) && !empty($p["sizes"]) && !empty($p["colors"]);
}
function stike_combo_units($p, $size, $color) {
  foreach ($p["combos"] as $row) if (($row["s"] ?? null) === $size && ($row["c"] ?? null) === $color) return max(0, (int)($row["u"] ?? 0));
  return 0;
}
/* Precio unitario para (talla, color): MISMA regla que stikePriceFor en
   assets/js/data.js. El color manda; luego la talla/medida; luego el base. El
   navegador nunca dice cuanto cuesta: esto es lo que se cobra. */
function stike_unit_price($p, $size, $color) {
  foreach ([["colors", $color], ["sizes", $size]] as [$k, $v]) {
    if ($v === null || empty($p[$k]) || !is_array($p[$k])) continue;
    foreach ($p[$k] as $row) {
      if (($row["v"] ?? null) === $v && isset($row["price"]) && is_int($row["price"]) && $row["price"] > 0) return $row["price"];
    }
  }
  return $p["price"];
}
function stike_stock_for($p, $size, $color) {
  if (stike_has_combos($p)) {
    if ($size === null || $color === null) return 0;
    return stike_combo_units($p, $size, $color);
  }
  $sizes = (isset($p["sizes"]) && is_array($p["sizes"]) && count($p["sizes"])) ? $p["sizes"] : null;
  $colors = (isset($p["colors"]) && is_array($p["colors"]) && count($p["colors"])) ? $p["colors"] : null;
  if ($sizes || $colors) {
    $vals = [];
    if ($sizes) { if ($size === null) return 0; $vals[] = stike_pool_units($sizes, $size); }
    if ($colors) { if ($color === null) return 0; $vals[] = stike_pool_units($colors, $color); }
    return min($vals);
  }
  return array_key_exists("units", $p) && is_numeric($p["units"]) ? max(0, (int)$p["units"]) : null;
}
/* Descuenta una venta del producto, en la misma pool en que se vendio. */
function stike_decrement_stock(&$p, $size, $color, $qty) {
  $hit = false;
  if (stike_has_combos($p) && $size !== null && $color !== null && !empty($p["combos"])) {
    foreach ($p["combos"] as &$row) if (($row["s"] ?? null) === $size && ($row["c"] ?? null) === $color) $row["u"] = max(0, (int)$row["u"] - $qty);
    unset($row);
  }
  foreach (["sizes" => $size, "colors" => $color] as $k => $v) {
    if ($v === null || empty($p[$k]) || !is_array($p[$k])) continue;
    foreach ($p[$k] as &$row) if (($row["v"] ?? null) === $v) { $row["u"] = max(0, (int)$row["u"] - $qty); $hit = true; }
    unset($row);
  }
  if (!$hit && empty($p["sizes"]) && empty($p["colors"]) && isset($p["units"]) && is_numeric($p["units"])) {
    $p["units"] = max(0, (int)$p["units"] - $qty);
  }
}

/* El monto SIEMPRE lo calcula el servidor con el catalogo; lo que mande el
   navegador (precio, total, amount_in_cents) se ignora. */
function stike_price_order($catalog, $items) {
  if (!is_array($items) || count($items) === 0) throw new ApiError(400, "empty_order");
  if (count($items) > STIKE_MAX_LINES) throw new ApiError(400, "too_many_lines");

  $bySlug = [];
  foreach ($catalog as $p) { $bySlug[$p["slug"]] = $p; }

  $subtotal = 0;
  $lines = [];
  foreach ($items as $it) {
    $slug = is_array($it) ? ($it["slug"] ?? null) : null;
    $qty = is_array($it) ? ($it["qty"] ?? null) : null;
    if (!is_string($slug) || $slug === "") throw new ApiError(400, "invalid_item");
    if (!is_int($qty) || $qty < 1 || $qty > STIKE_MAX_QTY) throw new ApiError(400, "invalid_qty", $slug);
    $p = $bySlug[$slug] ?? null;
    if (!$p || (array_key_exists("published", $p) && $p["published"] === false)) throw new ApiError(400, "unknown_product", $slug);
    if (!is_int($p["price"] ?? null) || $p["price"] <= 0) throw new ApiError(400, "product_without_price", $slug);
    $size = stike_clean_variant($it["size"] ?? null);
    $color = stike_clean_variant($it["color"] ?? null);
    $avail = stike_stock_for($p, $size, $color);
    if ($avail !== null && $qty > $avail) throw new ApiError(409, "out_of_stock", $slug);
    $unit = stike_unit_price($p, $size, $color);
    $total = $unit * $qty;
    $subtotal += $total;
    $lines[] = [
      "slug" => $slug, "name" => $p["n"] ?? $slug, "qty" => $qty,
      "unitPrice" => $unit, "total" => $total,
      "size" => $size,
      "color" => $color,
    ];
  }
  $shipping = 0;   // el envio se cotiza aparte por WhatsApp y lo paga el cliente: no entra en el cobro
  $total = $subtotal + $shipping;
  return [
    "lines" => $lines, "subtotal" => $subtotal, "shipping" => $shipping,
    "total" => $total, "amountInCents" => $total * 100,
  ];
}

function stike_clean_text($v, $max) {
  if (!is_string($v)) return "";
  $v = trim($v);
  return function_exists("mb_substr") ? mb_substr($v, 0, $max, "UTF-8") : substr($v, 0, $max);
}

/* Datos de entrega: obligatorios (sin ellos el dueno no sabe a donde enviar). */
function stike_clean_shipping($raw) {
  if (!is_array($raw)) throw new ApiError(400, "missing_shipping");
  $s = [
    "name" => stike_clean_text($raw["name"] ?? "", 120),
    "phone" => stike_clean_text($raw["phone"] ?? "", 40),
    "address" => stike_clean_text($raw["address"] ?? "", 200),
    "city" => stike_clean_text($raw["city"] ?? "", 80),
    "notes" => stike_clean_text($raw["notes"] ?? "", 300),
  ];
  foreach (["name", "phone", "address", "city"] as $k) {
    if ($s[$k] === "") throw new ApiError(400, "missing_shipping", $k);
  }
  return $s;
}

function stike_clean_email($v) {
  return (is_string($v) && strlen($v) <= 160 && filter_var($v, FILTER_VALIDATE_EMAIL)) ? $v : null;
}

/* ------------------- stock en GitHub (fuente de la verdad) ----------------
   El catalogo vive en assets/js/products-data.js del repo; de ahi se publica
   al hosting. Cada venta online se descuenta ALLA (con GITHUB_TOKEN en
   api/config.local.php: token fine-grained con Contents read/write sobre el
   repo) y queda anotada en data/stock-applied.json para que nadie la vuelva
   a descontar: ni un reintento de Wompi, ni el panel admin (que concilia las
   ventas online que el servidor no alcanzo a descontar). */
const STIKE_GH_REPO = "Daniel666674/stike-x7k2m9";
const STIKE_GH_BRANCH = "claude/sweet-albattani-ti0w0e";

function stike_gh($method, $path, $body = null, $timeout = 15) {
  $token = stike_config("GITHUB_TOKEN");
  if (!$token) throw new ApiError(500, "github_not_configured");
  $base = getenv("STIKE_GITHUB_API") ?: "https://api.github.com";   // solo pruebas; un visitante no controla el entorno
  $url = $base . "/repos/" . STIKE_GH_REPO . "/contents/" . $path . ($method === "GET" ? "?ref=" . rawurlencode(STIKE_GH_BRANCH) : "");
  $res = stike_http($method, $url, [
    "Authorization: Bearer " . $token, "Accept: application/vnd.github+json",
    "User-Agent: stike-server", "Content-Type: application/json",
  ], $body === null ? null : json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $timeout);
  return $res;
}
function stike_gh_get_text($path) {
  $r = stike_gh("GET", $path);
  if ($r["status"] === 404) return [null, null];
  if ($r["status"] !== 200 || !isset($r["json"]["content"])) throw new ApiError(502, "github_read_failed", "$path {$r["status"]}");
  return [base64_decode($r["json"]["content"]), $r["json"]["sha"]];
}
function stike_gh_put_text($path, $text, $sha, $message) {
  $body = ["message" => $message, "content" => base64_encode($text), "branch" => STIKE_GH_BRANCH];
  if ($sha) $body["sha"] = $sha;
  $r = stike_gh("PUT", $path, $body);
  if ($r["status"] === 200 || $r["status"] === 201) return true;
  if ($r["status"] === 409 || $r["status"] === 422) return false;   // sha viejo: reintentar
  throw new ApiError(502, "github_write_failed", "$path {$r["status"]}");
}

/* Mismo formato que escribe el panel (JSON.stringify con 2 espacios), para
   que los commits del servidor no reformateen el archivo entero. */
function stike_json_2sp($v) {
  $json = json_encode($v, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  return preg_replace_callback('/^( {4})+/m', fn($m) => str_repeat("  ", strlen($m[0]) / 4), $json);
}

/* Descuenta en GitHub las lineas de una venta online. Devuelve true si quedo
   aplicada (ahora o antes), false si GitHub no esta configurado. Idempotente
   por $saleKey. */
function stike_apply_stock_github($saleKey, $entries) {
  if (!stike_config("GITHUB_TOKEN")) return false;
  $marker = "window.STIKE_PRODUCTS = ";
  for ($attempt = 1; $attempt <= 5; $attempt++) {
    [$ledgerText, $ledgerSha] = stike_gh_get_text("data/stock-applied.json");
    $ledger = $ledgerText ? json_decode($ledgerText, true) : [];
    if (!is_array($ledger)) $ledger = [];
    if (in_array($saleKey, $ledger, true)) return true;

    [$text, $sha] = stike_gh_get_text("assets/js/products-data.js");
    $pos = $text === null ? false : strpos($text, $marker);
    if ($pos === false) throw new ApiError(502, "catalog_parse_failed");
    $catalog = json_decode(substr($text, $pos + strlen($marker), strrpos($text, ";") - $pos - strlen($marker)), true);
    if (!is_array($catalog)) throw new ApiError(502, "catalog_parse_failed");
    foreach ($entries as $e) {
      foreach ($catalog as &$p) {
        if (($p["slug"] ?? null) === ($e["slug"] ?? "")) stike_decrement_stock($p, $e["size"] ?? null, $e["color"] ?? null, (int)$e["qty"]);
      }
      unset($p);
    }
    $newText = substr($text, 0, $pos + strlen($marker)) . stike_json_2sp($catalog) . ";\n";
    $names = implode(", ", array_map(fn($e) => $e["qty"] . "x " . ($e["name"] ?? $e["slug"]), $entries));
    if (!stike_gh_put_text("assets/js/products-data.js", $newText, $sha, "[Wompi] Stock: venta online $saleKey ($names)")) { usleep(400000 * $attempt); continue; }

    // El catalogo ya quedo; el ledger se reintenta solo (si fallara, el
    // reintento de arriba volveria a descontar: por eso se insiste aca).
    for ($j = 1; $j <= 5; $j++) {
      [$lt, $ls] = stike_gh_get_text("data/stock-applied.json");
      $l = $lt ? json_decode($lt, true) : [];
      if (!is_array($l)) $l = [];
      if (in_array($saleKey, $l, true)) return true;
      $l[] = $saleKey;
      if (stike_gh_put_text("data/stock-applied.json", json_encode($l, JSON_PRETTY_PRINT) . "\n", $ls, "[Wompi] Stock aplicado: $saleKey")) return true;
      usleep(300000 * $j);
    }
    throw new ApiError(502, "github_write_failed", "stock-applied.json");
  }
  throw new ApiError(502, "github_write_failed", "products-data.js (conflictos)");
}

/* ------------------------------- almacenamiento -------------------------- */
function stike_storage_dir() {
  static $dir = null;
  if ($dir !== null) return $dir;
  $d = stike_config("STORAGE_DIR");
  if (!$d) $d = dirname(__DIR__, 2) . "/stike-private";   // al lado de public_html, fuera del sitio
  $d = rtrim($d, "/\\");
  if (!is_dir($d) && !@mkdir($d, 0750, true) && !is_dir($d)) {
    error_log("[stike] no se pudo crear la carpeta de datos: $d");
    throw new ApiError(500, "storage_unavailable", "no se pudo crear la carpeta de datos");
  }
  if (!is_writable($d)) {
    error_log("[stike] carpeta de datos sin permiso de escritura: $d");
    throw new ApiError(500, "storage_unavailable", "la carpeta de datos no es escribible");
  }
  /* Si por configuracion quedo DENTRO de lo que sirve el sitio, se bloquea el
     acceso web. Lo correcto es tenerla afuera; esto es el cinturon. */
  $real = realpath($d);
  $web = realpath(dirname(__DIR__));
  if ($real && $web && strpos($real . "/", $web . "/") === 0) {
    $ht = $real . "/.htaccess";
    if (!is_file($ht)) @file_put_contents($ht, "Require all denied\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
  }
  return $dir = $d;
}

function stike_sales_path() { return stike_storage_dir() . "/ventas.jsonl"; }

function stike_read_sales() {
  $path = stike_sales_path();
  if (!is_file($path)) return [];
  $out = [];
  $fh = fopen($path, "rb");
  if (!$fh) throw new ApiError(500, "storage_unavailable", "no se pudo leer el registro de ventas");
  flock($fh, LOCK_SH);
  while (($line = fgets($fh)) !== false) {
    $line = trim($line);
    if ($line === "") continue;
    $row = json_decode($line, true);
    if (is_array($row)) $out[] = $row;
  }
  flock($fh, LOCK_UN);
  fclose($fh);
  return $out;
}

/* Agrega las lineas de UNA orden. Devuelve false (sin escribir nada) si esa
   referencia ya estaba registrada: asi el regreso del navegador y el webhook
   de Wompi pueden llegar los dos, o repetirse, sin duplicar la venta. */
function stike_append_order($orderRef, $entries) {
  $fh = fopen(stike_sales_path(), "c+b");
  if (!$fh) throw new ApiError(500, "storage_unavailable", "no se pudo abrir el registro de ventas");
  try {
    if (!flock($fh, LOCK_EX)) throw new ApiError(500, "storage_unavailable", "no se pudo bloquear el registro de ventas");
    rewind($fh);
    while (($line = fgets($fh)) !== false) {
      $row = json_decode(trim($line), true);
      if (is_array($row) && ($row["orderRef"] ?? null) === $orderRef) return false;
    }
    fseek($fh, 0, SEEK_END);
    $payload = "";
    foreach ($entries as $e) $payload .= json_encode($e, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    if (fwrite($fh, $payload) === false) throw new ApiError(500, "storage_unavailable", "no se pudo escribir la venta");
    fflush($fh);
    return true;
  } finally {
    flock($fh, LOCK_UN);
    fclose($fh);
  }
}

function stike_pending_dir() {
  $dir = stike_storage_dir() . "/pending";
  if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) {
    throw new ApiError(500, "storage_unavailable", "no se pudo crear la carpeta de pedidos");
  }
  return $dir;
}

/* El pedido firmado queda guardado hasta que Wompi confirme el pago. Es la
   fuente de verdad de QUE se compro y A DONDE enviarlo: el regreso del
   navegador y el webhook solo aportan el id de la transaccion. */
function stike_save_pending($reference, $data) {
  $dir = stike_pending_dir();
  foreach (glob($dir . "/*.json") ?: [] as $f) {   // limpieza: pedidos sin pagar de hace mas de 14 dias
    if (@filemtime($f) < time() - 14 * 86400) @unlink($f);
  }
  $path = $dir . "/" . $reference . ".json";
  $tmp = $path . "." . bin2hex(random_bytes(4)) . ".tmp";
  if (file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) === false || !@rename($tmp, $path)) {
    @unlink($tmp);
    throw new ApiError(500, "storage_unavailable", "no se pudo guardar el pedido");
  }
}

function stike_load_pending($reference) {
  $path = stike_storage_dir() . "/pending/" . $reference . ".json";
  if (!is_file($path)) return null;
  $d = json_decode((string)file_get_contents($path), true);
  return is_array($d) ? $d : null;
}

function stike_delete_pending($reference) {
  @unlink(stike_storage_dir() . "/pending/" . $reference . ".json");
}

/* Mismo formato que new Date().toISOString() del panel: se compara como texto. */
function stike_now_iso() {
  $t = microtime(true);
  return gmdate("Y-m-d\TH:i:s", (int)$t) . "." . sprintf("%03d", (int)(($t - floor($t)) * 1000)) . "Z";
}

/* ---------------------------------- Wompi -------------------------------- */
/* A que servidor de Wompi se le pregunta por un pago: el del ambiente de la LLAVE PRIVADA.
   Si quedo un WOMPI_API_BASE del ensayo (sandbox.wompi.co) con llaves de produccion, se le
   preguntaria a sandbox por pagos reales: Wompi diria "no existe", el cliente veria "No
   pudimos confirmar el pago" y la venta no se registraria aunque el dinero entro. Por eso
   un servidor oficial del OTRO ambiente se ignora. Cualquier otro host (un Wompi simulado
   en las pruebas locales) se respeta. */
function stike_wompi_api_base($privateKey) {
  $prod = str_starts_with((string)$privateKey, "prv_prod_");
  $official = $prod ? "https://production.wompi.co/v1" : "https://sandbox.wompi.co/v1";
  $cfg = trim((string)stike_config("WOMPI_API_BASE", ""));
  if ($cfg === "") return $official;
  $host = parse_url($cfg, PHP_URL_HOST);
  if (in_array($host, ["sandbox.wompi.co", "production.wompi.co"], true)) return $official;
  return rtrim($cfg, "/");
}

/* Consulta una transaccion a Wompi. Esa consulta es PUBLICA (no pide llave): primero se hace SIN
   Authorization, asi una llave privada vieja, de otro comercio o mal pegada no puede romper la confirmacion de
   un pago; si Wompi llegara a pedirla (401/403), se repite con la llave.
   Justo despues de pagar, Wompi puede tardar uno o dos segundos en dejar ver la transaccion (404) o responder
   con un error pasajero (429, 5xx, sin conexion). Quien CONFIRMA un pago (stike_finalize_order) pide varios
   intentos; la pagina de resultado pide uno y repite ella misma. */
function stike_wompi_get_transaction($id, $attempts = 1) {
  $key = stike_wompi_clean(stike_config("WOMPI_PRIVATE_KEY"));
  if (!$key) throw new ApiError(500, "server_not_configured", "falta WOMPI_PRIVATE_KEY (env o api/config.local.php)");
  $url = rtrim(stike_wompi_api_base($key), "/") . "/transactions/" . rawurlencode($id);
  $res = null;
  for ($i = 1; $i <= max(1, $attempts); $i++) {
    $res = stike_http("GET", $url);
    if ($res["status"] === 401 || $res["status"] === 403) $res = stike_http("GET", $url, ["Authorization: Bearer " . $key]);
    $retryable = $res["status"] === 404 || $res["status"] === 0 || $res["status"] === 429 || $res["status"] >= 500;
    if ($res["status"] === 200 || !$retryable || $i === $attempts) break;
    usleep(1200000);
  }
  if ($res["status"] === 404) throw new ApiError(404, "transaction_not_found");   // no es falla nuestra: Wompi no la conoce todavia, o no existe
  if ($res["status"] !== 200 || !isset($res["json"]["data"]) || !is_array($res["json"]["data"])) {
    throw new ApiError(502, "wompi_verify_failed", (string)$res["status"]);
  }
  return $res["json"]["data"];
}

/* Las transacciones de Wompi con una referencia. Primero se pide SIN llave (puede ser publico, y asi una llave
   privada vieja o mal puesta no lo rompe); si Wompi la exige (401/403) se repite con la llave PRIVADA. 404 = no
   hay nada con esa referencia. Sirve para encontrar pagos aprobados que nunca se registraron
   (stike_reconcile_pending). */
function stike_wompi_find_by_reference($reference) {
  $key = stike_wompi_clean(stike_config("WOMPI_PRIVATE_KEY"));
  if (!$key) throw new ApiError(500, "server_not_configured", "falta WOMPI_PRIVATE_KEY (env o api/config.local.php)");
  $url = rtrim(stike_wompi_api_base($key), "/") . "/transactions?reference=" . rawurlencode($reference);
  $res = stike_http("GET", $url);
  if ($res["status"] === 401 || $res["status"] === 403) $res = stike_http("GET", $url, ["Authorization: Bearer " . $key]);
  if ($res["status"] === 404) return [];
  if ($res["status"] !== 200 || !is_array($res["json"]["data"] ?? null)) throw new ApiError(502, "wompi_lookup_failed", (string)$res["status"]);
  $d = $res["json"]["data"];
  if (isset($d["id"])) $d = [$d];   // por si Wompi devolviera una sola transaccion en vez de una lista
  return array_values(array_filter($d, "is_array"));
}

/* De donde sale una config: variable de entorno del hosting (tiene prioridad) o
   api/config.local.php. Si hay una variable vieja en hPanel, pisa en silencio
   lo que se pegue en el archivo, y el cobro se firma con la llave equivocada. */
function stike_config_sources($key) {
  $pv = in_array($key, STIKE_RUNTIME_KEYS, true) ? stike_runtime_open(stike_runtime_config_all()[$key] ?? null) : null;
  $panel = is_string($pv) && $pv !== "";
  $env = getenv($key);
  $env = ($env !== false && $env !== "") ? (string)$env : null;
  $file = null;
  $path = __DIR__ . "/config.local.php";
  if (is_file($path)) {
    $cfg = include $path;
    if (is_array($cfg) && isset($cfg[$key]) && $cfg[$key] !== "") $file = (string)$cfg[$key];
  }
  return [
    "panel" => $panel, "env" => $env !== null, "file" => $file !== null,
    "differ" => !$panel && $env !== null && $file !== null && stike_wompi_clean($env) !== stike_wompi_clean($file),
  ];
}

/* Las llaves se pegan a mano en api/config.local.php, y al copiar desde el
   panel de Wompi es facil arrastrar un espacio, un salto de linea, unas
   comillas tipograficas o un caracter invisible. Cualquiera de esos cambia la
   firma y Wompi responde "La firma es invalida" sin mas pistas. Ninguna llave
   de Wompi lleva espacios ni comillas, asi que se quitan siempre. */
function stike_wompi_clean($v) {
  if (!is_string($v)) return $v;
  $c = preg_replace('/[\s\x{00A0}\x{200B}-\x{200D}\x{2060}\x{FEFF}]+/u', "", $v);
  if ($c === null) return trim($v);
  $c = preg_replace('/^["\'`\x{201C}\x{201D}\x{2018}\x{2019}]+|["\'`\x{201C}\x{201D}\x{2018}\x{2019}]+$/u', "", $c);
  return $c === null ? trim($v) : $c;
}

/* Que tipo de llave PARECE ser un valor (solo por su prefijo; nunca se
   devuelve el valor). Sirve para decir "pusiste la privada donde va el secreto
   de integridad" en vez de un error sin explicacion. */
function stike_wompi_kind($v) {
  if (!is_string($v) || $v === "") return "vacío";
  if (preg_match('/^pub_(test|prod)_/', $v)) return "la llave PÚBLICA";
  if (preg_match('/^prv_(test|prod)_/', $v)) return "la llave PRIVADA";
  if (preg_match('/^(test|prod)_integrity_/', $v)) return "el secreto de INTEGRIDAD";
  if (preg_match('/^(test|prod)_events_/', $v)) return "el secreto de EVENTOS";
  return "algo que no tiene formato de llave de Wompi";
}

/* Las llaves de Wompi que firman un cobro (publica, privada y secreto de
   integridad) tienen que ser TODAS del mismo ambiente. Si se mezclan (la
   publica de produccion con la privada de sandbox, por ejemplo) no se cobra
   nada y el cliente solo ve un error sin explicacion; aca el servidor se niega
   y dice por que. Cambiar de sandbox a produccion es cambiar estas cuatro
   lineas de api/config.local.php, sin tocar codigo.
   Cada casilla se valida con SU prefijo: antes la de integridad aceptaba
   tambien una llave publica o privada, y el cobro fallaba despues, en el
   widget de Wompi, con "La firma es invalida". */
function stike_wompi_keys() {
  $slots = [
    "WOMPI_PUBLIC_KEY" => ['/^pub_(test|prod)_/', "la llave PÚBLICA (pub_test_… o pub_prod_…)"],
    "WOMPI_PRIVATE_KEY" => ['/^prv_(test|prod)_/', "la llave PRIVADA (prv_test_… o prv_prod_…)"],
    "WOMPI_INTEGRITY_SECRET" => ['/^(test|prod)_integrity_/', "el SECRETO DE INTEGRIDAD (test_integrity_… o prod_integrity_…)"],
  ];
  $keys = [];
  $envs = [];
  foreach ($slots as $name => $slot) {
    $v = stike_wompi_clean(stike_config($name));
    if (!$v) throw new ApiError(500, "server_not_configured", "falta $name (env o api/config.local.php)");
    if (!preg_match($slot[0], $v, $m)) {
      throw new ApiError(500, "server_misconfigured", "$name debe ser " . $slot[1] . ", pero lo que hay parece " . stike_wompi_kind($v) . ". Copia el valor correcto desde el panel de Wompi (Desarrolladores > Secretos para integración técnica).");
    }
    $keys[$name] = $v;
    $envs[$name] = $m[1];
  }
  if (count(array_unique($envs)) !== 1) {
    throw new ApiError(500, "server_misconfigured", "las llaves de Wompi no son todas del mismo ambiente (sandbox o produccion)");
  }
  return ["public" => $keys["WOMPI_PUBLIC_KEY"], "private" => $keys["WOMPI_PRIVATE_KEY"], "integrity" => $keys["WOMPI_INTEGRITY_SECRET"], "environment" => reset($envs)];
}

/* Firma de un EVENTO de Wompi (webhook). Segun la documentacion de Wompi, el
   checksum es SHA256( valores de event.signature.properties tomados de
   event.data, en ese orden, pegados + event.timestamp + secreto de eventos ).
   Llega en event.signature.checksum (y en el header X-Event-Checksum). El
   secreto de eventos es OTRO distinto al de integridad: panel de Wompi >
   Desarrolladores > Secretos para integracion tecnica > Eventos. */
function stike_event_checksum_ok($event, $secret) {
  $sig = $event["signature"] ?? null;
  $props = is_array($sig) ? ($sig["properties"] ?? null) : null;
  $given = is_array($sig) ? ($sig["checksum"] ?? null) : null;
  if (!is_string($given) || $given === "") $given = $_SERVER["HTTP_X_EVENT_CHECKSUM"] ?? null;
  $ts = $event["timestamp"] ?? null;
  if (!is_array($props) || !is_string($given) || $given === "" || (!is_int($ts) && !is_string($ts))) return false;
  $concat = "";
  foreach ($props as $path) {
    if (!is_string($path)) return false;
    $v = $event["data"] ?? null;
    foreach (explode(".", $path) as $k) $v = is_array($v) ? ($v[$k] ?? null) : null;
    if (is_array($v)) return false;
    $concat .= is_bool($v) ? ($v ? "true" : "false") : (string)($v ?? "");
  }
  return hash_equals(strtolower(hash("sha256", $concat . $ts . $secret)), strtolower($given));
}

/* Confirma un pago con Wompi (llave privada, del lado del servidor) y registra
   la venta. Lo llaman el regreso del navegador (wompi-order.php) Y el webhook
   (wompi-events.php); ninguno de los dos manda datos del pedido, solo la
   referencia y el id de la transaccion, y lo que se registra sale del pedido
   guardado al firmar. Idempotente por referencia.

   Devuelve ["ignored" => true, ...] si el pago no esta APPROVED. */
function stike_finalize_order($reference, $wompiId, $trusted = null) {
  /* $trusted: la transaccion YA confirmada por un canal autentico (un evento con checksum valido, o la lista
     que Wompi devolvio a nuestra llave privada). Nunca viene del navegador. Sin ella se le pregunta a Wompi. */
  if (is_array($trusted) && ($trusted["id"] ?? null) === $wompiId && ($trusted["reference"] ?? null) === $reference) $txn = $trusted;
  else $txn = stike_wompi_get_transaction($wompiId, 3);   // 3 intentos: recien pagado, Wompi puede tardar un par de segundos en mostrarla
  if (($txn["reference"] ?? null) !== $reference) throw new ApiError(400, "reference_mismatch");
  if (($txn["status"] ?? null) !== "APPROVED") return ["ignored" => true, "status" => $txn["status"] ?? null];

  $paid = (int)($txn["amount_in_cents"] ?? 0);
  $pending = stike_load_pending($reference);
  $ts = stike_now_iso();
  $admin = "Wompi (ref $reference)";
  $flag = null;
  $shipping = null;
  $customerEmail = stike_clean_email($txn["customer_email"] ?? null);
  $entries = [];

  if ($pending && is_array($pending["lines"] ?? null)) {
    $shipping = $pending["shipping"] ?? null;
    $customerEmail = $pending["customerEmail"] ?? $customerEmail;
    if ((int)($pending["amountInCents"] ?? -1) !== $paid) $flag = "amount_mismatch";
    foreach ($pending["lines"] as $l) {
      $entries[] = [
        "ts" => $ts, "slug" => $l["slug"], "name" => $l["name"],
        "size" => $l["size"] ?? null, "color" => $l["color"] ?? null,
        "qty" => $l["qty"], "unitPrice" => $l["unitPrice"], "total" => $l["total"],
        "admin" => $admin, "source" => "wompi", "orderRef" => $reference, "wompiId" => $wompiId,
        "customerEmail" => $customerEmail, "shipping" => $shipping,
      ] + (!empty($pending["shippingAck"]) ? ["shippingAck" => true] : []);   // el cliente acepto que el envio va por su cuenta
    }
  }
  if (!$entries) {
    /* Pago aprobado del que no tenemos el pedido (se firmo antes de este
       servidor, o se borro). Nunca se pierde: queda una linea con el monto y
       el correo avisa para reconciliar a mano en el panel de Wompi. */
    $flag = "no_pending_order";
    $pesos = intdiv($paid, 100);
    $entries[] = [
      "ts" => $ts, "slug" => "pago-sin-pedido", "name" => "Pago Wompi sin pedido guardado",
      "size" => null, "color" => null, "qty" => 1, "unitPrice" => $pesos, "total" => $pesos,
      "admin" => $admin, "source" => "wompi", "orderRef" => $reference, "wompiId" => $wompiId,
      "customerEmail" => $customerEmail, "shipping" => null,
    ];
  }
  if ($flag) {
    foreach ($entries as &$e) { $e["flag"] = $flag; $e["paidInCents"] = $paid; }
    unset($e);
  }

  $recorded = false;
  $recordError = null;
  try {
    $recorded = stike_append_order($reference, $entries);
  } catch (ApiError $e) {
    $recordError = $e->errorCode;
    error_log("[stike] no se pudo registrar la venta $reference: " . $e->errorCode);
  }
  if ($recordError === null && !$recorded) return ["alreadyRecorded" => true];

  /* Stock: si falla (GitHub caido, sin token) la venta igual queda y el panel
     admin la descuenta al abrirse (concilia contra data/stock-applied.json). */
  $stockApplied = false;
  if ($flag !== "no_pending_order") {
    try { $stockApplied = stike_apply_stock_github("wompi:" . $reference, $entries); }
    catch (ApiError $e) { error_log("[stike] stock no descontado para $reference: " . $e->errorCode . " " . ($e->detail ?? "")); }
  }

  /* El correo sale aunque el guardado haya fallado: es la segunda copia. */
  $email = stike_notify_owner($entries, [
    "reference" => $reference, "wompiId" => $wompiId, "customerEmail" => $customerEmail,
    "shipping" => $shipping, "paidInCents" => $paid, "flag" => $flag, "recordError" => $recordError,
    "shippingAck" => !empty($pending["shippingAck"]),
  ]);
  if ($recordError !== null) throw new ApiError(500, "storage_unavailable", "pago aprobado pero no se pudo guardar; el dueno fue avisado por correo");
  stike_delete_pending($reference);
  /* Esto sale tal cual al navegador del cliente (wompi-order.php): del correo solo se dice si salio, nunca a quien ni por que fallo. */
  $emailOut = empty($email["error"]) ? ["sent" => $email["sent"] ?? null] : ["error" => "email_failed"];
  return ["recorded" => count($entries), "email" => $emailOut, "flag" => $flag];
}

/* Busca pagos APROBADOS que nunca se registraron (el cliente pago y la pagina no pudo confirmar, y el aviso de
   Wompi tampoco llego o fallo). Recorre los pedidos guardados al firmar, le pregunta a Wompi por cada
   referencia y registra los aprobados (venta + correo al dueno + stock + aviso en el panel). Se llama al abrir
   el panel, cada minuto mientras esta abierto, con el boton «Buscar pagos sin registrar» y cuando llega un aviso
   de Wompi. Cada pedido se revisa a los 90 s, 10 min, 1 h, 6 h y 24 h de creado; $force los revisa todos ya.
   Nunca lanza: devuelve un resumen. */
function stike_reconcile_pending($max = 6, $force = false) {
  $out = ["checked" => 0, "recovered" => [], "errors" => [], "waiting" => 0];
  try {
    $dir = stike_pending_dir();
    $lock = stike_storage_dir() . "/reconcile.at";
    if (!$force && is_file($lock) && (int)@file_get_contents($lock) > time() - 60) { $out["skipped"] = "throttled"; return $out; }
    @file_put_contents($lock, (string)time());
    stike_mail_outbox_flush(3);   // avisos de venta que no pudieron salir: se reintentan
    $schedule = [90, 600, 3600, 21600, 86400];
    $now = time();
    foreach (glob($dir . "/*.json") ?: [] as $f) {
      if ($out["checked"] >= $max) { $out["waiting"]++; continue; }
      $p = json_decode((string)@file_get_contents($f), true);
      if (!is_array($p) || !is_string($p["reference"] ?? null)) continue;
      $age = $now - (strtotime($p["createdAt"] ?? "") ?: (int)@filemtime($f));
      $tries = (int)($p["rc"] ?? 0);
      $due = $force ? $age >= 45 : ($tries < count($schedule) && $age >= $schedule[$tries]);
      if (!$due) { $out["waiting"]++; continue; }
      $out["checked"]++;
      try {
        $approved = null;
        foreach (stike_wompi_find_by_reference($p["reference"]) as $t) {
          if (($t["status"] ?? null) === "APPROVED" && ($t["reference"] ?? null) === $p["reference"] && is_string($t["id"] ?? null)) { $approved = $t; break; }
        }
        if ($approved) {
          $r = stike_finalize_order($p["reference"], $approved["id"], $approved);
          $out["recovered"][] = ["reference" => $p["reference"], "wompiId" => $approved["id"], "result" => $r];
          error_log("[stike] pago recuperado por reconciliacion: " . $p["reference"] . " (" . $approved["id"] . ")");
        } else {
          $p["rc"] = $tries + 1; $p["rcAt"] = stike_now_iso();   // aun sin pago aprobado: se vuelve a mirar mas tarde
          $tmp = $f . "." . bin2hex(random_bytes(4)) . ".tmp";
          if (@file_put_contents($tmp, json_encode($p, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) !== false) @rename($tmp, $f);
        }
      } catch (ApiError $e) {
        if ($e->errorCode === "wompi_lookup_failed" && in_array($e->detail, ["401", "403"], true)) {
          $out["errors"][] = ["error" => "wompi_key_rejected", "detail" => $e->detail];   // una sola vez: no tiene sentido insistir pedido por pedido
          break;
        }
        $out["errors"][] = ["reference" => $p["reference"], "error" => $e->errorCode, "detail" => $e->detail];
      }
    }
  } catch (Throwable $e) {
    error_log("[stike] reconciliacion: " . get_class($e) . ": " . $e->getMessage());
    $out["errors"][] = ["error" => "reconcile_failed"];
  }
  return $out;
}

/* ---------------------------------- correo ------------------------------- */
function stike_money($n) { return "$" . number_format((float)$n, 0, ",", "."); }
function stike_h($s) { return htmlspecialchars((string)$s, ENT_QUOTES, "UTF-8"); }

/* Correos validos de un texto (separados por coma, punto y coma o espacio), sin repetir. */
function stike_parse_emails($raw, $max = 5) {
  $out = [];
  foreach (preg_split('/[\s,;]+/', (string)$raw) ?: [] as $a) {
    $a = trim($a, " \t\n\r\0\x0B<>\"'");
    if ($a === "" || strlen($a) > 120 || !filter_var($a, FILTER_VALIDATE_EMAIL)) continue;
    foreach ($out as $x) if (strcasecmp($x, $a) === 0) continue 2;
    $out[] = $a;
    if (count($out) >= $max) break;
  }
  return $out;
}
/* Quienes reciben el aviso de cada venta: OWNER_NOTIFY_EMAIL (panel, variable de entorno o config.local.php) puede traer varios. */
function stike_owner_recipients() {
  $list = stike_parse_emails(stike_config("OWNER_NOTIFY_EMAIL", ""));
  return $list ?: ["jparra375@gmail.com"];
}
function stike_mask_email($a) { return preg_replace('/^(.).*(@.*)$/', '$1***$2', (string)$a); }

/* Remitente: «Nombre <correo>» o solo el correo -> [nombre, correo], o null si no es valido. */
function stike_parse_sender($raw, $defName = "Stike Bike Shop") {
  $raw = trim((string)$raw);
  if (preg_match('/^(.*)<\s*([^<>\s]+@[^<>\s]+)\s*>$/', $raw, $m) && filter_var($m[2], FILTER_VALIDATE_EMAIL)) {
    $name = trim(str_replace(['"', "\r", "\n", "<", ">"], "", $m[1]), " \t'");
    return [$name !== "" ? $name : $defName, $m[2]];
  }
  if ($raw !== "" && filter_var($raw, FILTER_VALIDATE_EMAIL)) return [$defName, $raw];
  return null;
}
/* Remitente para Resend: el de RESEND_FROM; sin el, el de pruebas de Resend (solo llega al correo de la cuenta de Resend). */
function stike_resend_from() {
  $p = stike_parse_sender(stike_config("RESEND_FROM", ""));
  return $p ? $p[0] . " <" . $p[1] . ">" : "Stike Bike Shop <onboarding@resend.dev>";
}

/* Texto plano de un correo HTML (la otra mitad de un correo bien armado; ayuda a que no caiga en spam). */
function stike_html_to_text($html) {
  $t = preg_replace('~<(br|/p|/h\d|/tr|/div|/li)\b[^>]*>~i', "\n", (string)$html);
  $t = preg_replace('~</t[dh]>~i', "  ", $t);
  $t = html_entity_decode(strip_tags($t), ENT_QUOTES | ENT_HTML5, "UTF-8");
  $t = preg_replace("/[ \t]+/", " ", $t);
  $t = preg_replace("/\n[ \t]+/", "\n", $t);
  return trim(preg_replace("/\n{3,}/", "\n\n", $t));
}
/* Asunto con acentos o simbolos, codificado en partes cortas (un solo bloque largo lo rechazan algunos servidores). */
function stike_mime_subject($s) {
  if (function_exists("mb_encode_mimeheader")) {
    $r = @mb_encode_mimeheader((string)$s, "UTF-8", "B", "\r\n", 9);
    if (is_string($r) && $r !== "") return $r;
  }
  return "=?UTF-8?B?" . base64_encode((string)$s) . "?=";
}

/* Lo que Resend contesta cuando no envia, explicado para el panel (sin la llave, nunca). -> ["code" => ..., "detail" => ...] */
function stike_resend_explain($status, $json, $err = "") {
  $name = is_array($json) ? (string)($json["name"] ?? "") : "";
  $msg = is_array($json) ? (string)($json["message"] ?? "") : "";
  if ($status === 0) return ["code" => "unreachable", "detail" => "No se pudo conectar con Resend" . ($err ? " (" . $err . ")" : "") . ". Suele ser momentáneo."];
  if ($status === 429) return ["code" => "rate_limited", "detail" => "Resend pide esperar un momento (demasiados envíos seguidos o se agotó el límite del plan)."];
  if ($status >= 500) return ["code" => "resend_down", "detail" => "Resend tuvo un problema (" . $status . "). Suele ser momentáneo."];
  if ($status === 401 || $name === "invalid_api_key" || $name === "missing_api_key") return ["code" => "key_rejected", "detail" => "Resend RECHAZÓ la llave. Crea otra en resend.com → API Keys (permiso «Sending access») y pégala de nuevo en el panel."];
  if (stripos($msg, "own email address") !== false || stripos($msg, "verify a domain") !== false) {
    $own = preg_match('/\(([^)\s]+@[^)\s]+)\)/', $msg, $m) ? $m[1] : null;
    return ["code" => "sandbox_only", "detail" => "Con el remitente de pruebas de Resend (onboarding@resend.dev) solo se puede enviar al correo con el que se creó la cuenta de Resend" . ($own ? " (" . $own . ")" : "") . ". Dos salidas: (1) pon ese mismo correo como destinatario en el panel, o (2) en resend.com → Domains verifica stikebikeshop.com y pon como remitente, por ejemplo, ventas@stikebikeshop.com."];
  }
  if (stripos($msg, "not verified") !== false) return ["code" => "domain_not_verified", "detail" => "El dominio del remitente no está verificado en Resend. En resend.com → Domains agrega los registros DNS que te muestra (en hPanel → Dominio → DNS) y pulsa Verify. Mientras tanto deja el remitente vacío para usar el de pruebas."];
  $short = function_exists("mb_substr") ? mb_substr($msg, 0, 200) : substr($msg, 0, 200);
  return ["code" => "rejected", "detail" => "Resend no aceptó el correo (" . $status . ($short !== "" ? ": " . $short : "") . ")."];
}

/* Envia por Resend. -> ["ok" => true] o ["ok" => false, "code" => ..., "detail" => ..., "status" => ...] */
function stike_resend_send($apiKey, $to, $subject, $html) {
  $base = rtrim(stike_config("RESEND_API_BASE", "https://api.resend.com"), "/");
  $res = stike_http("POST", $base . "/emails", ["Authorization: Bearer " . $apiKey, "Content-Type: application/json"], json_encode([
    "from" => stike_resend_from(), "to" => array_values($to), "subject" => $subject, "html" => $html, "text" => stike_html_to_text($html),
  ], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE), 20);
  if ($res["status"] >= 200 && $res["status"] < 300) return ["ok" => true, "id" => is_array($res["json"]) ? ($res["json"]["id"] ?? null) : null];
  return ["ok" => false, "status" => $res["status"]] + stike_resend_explain($res["status"], $res["json"], $res["error"] ?? "");
}

/* Cabeceras (sin To ni Subject) y cuerpo de un correo texto + HTML, armado como lo espera Gmail: las dos partes en base64 (una linea
   HTML larga sin codificar viola el limite de 998 caracteres y la rechazan o la mandan a spam), Date y Message-ID. Lo usan mail() y SMTP.
   -> [cabeceras, cuerpo] */
function stike_build_mime($fromName, $fromAddr, $html) {
  $domain = substr((string)strrchr($fromAddr, "@"), 1) ?: "stikebikeshop.com";
  $bound = "stike_" . bin2hex(random_bytes(8));
  $headers = implode("\r\n", [
    "From: " . stike_mime_subject($fromName) . " <" . $fromAddr . ">",
    "Date: " . date("r"),
    "Message-ID: <" . bin2hex(random_bytes(12)) . "@" . $domain . ">",
    "MIME-Version: 1.0",
    "Content-Type: multipart/alternative; boundary=\"" . $bound . "\"",
    "Auto-Submitted: auto-generated",
    "X-Auto-Response-Suppress: All",
  ]);
  $body = "--$bound\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode(stike_html_to_text($html)), 76, "\r\n")
    . "--$bound\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode((string)$html), 76, "\r\n")
    . "--$bound--\r\n";
  return [$headers, $body];
}

/* Correo del hosting (mail()): remitente de sobre (-f) y asunto codificado por partes. Es el ULTIMO recurso: PHP dice «enviado» aunque
   Gmail lo descarte o lo mande a spam. */
function stike_mail_fallback($to, $subject, $html) {
  $from = stike_parse_sender(stike_config("MAIL_FROM", "pedidos@stikebikeshop.com")) ?: ["Stike Bike Shop", "pedidos@stikebikeshop.com"];
  [$headers, $body] = stike_build_mime($from[0], $from[1], $html);
  $list = implode(", ", $to);
  $subj = stike_mime_subject($subject);
  if (@mail($list, $subj, $body, $headers, "-f" . $from[1])) return true;
  return (bool)@mail($list, $subj, $body, $headers);   // algunos hostings no aceptan el parametro -f
}

/* ------------- SMTP: enviar con un correo del propio dominio (p. ej. ventas@stikebikeshop.com de Hostinger) o Gmail -------------
   El servidor entra a la cuenta de correo con su usuario y contraseña (como un programa de correo) y manda el aviso desde ahi: sale
   firmado por el servidor de correo de verdad (SPF/DKIM del dominio), que es lo que Gmail exige para no mandarlo a spam.
   Configuracion (panel o api/config.local.php): SMTP_HOST (smtp.hostinger.com), SMTP_PORT (465), SMTP_USER (el correo), SMTP_PASS. */
function stike_smtp_config() {
  $host = strtolower(trim((string)stike_config("SMTP_HOST", "")));
  $user = trim((string)stike_config("SMTP_USER", ""));
  $pass = (string)stike_config("SMTP_PASS", "");
  if ($host === "" || $user === "" || $pass === "") return null;
  $port = (int)stike_config("SMTP_PORT", 465);
  return ["host" => $host, "port" => ($port >= 1 && $port <= 65535) ? $port : 465, "user" => $user, "pass" => $pass];
}
/* ssl = conexion segura desde el primer byte (puerto 465); starttls = empieza normal y se vuelve segura (587). "none" (texto plano)
   solo existe contra la propia maquina, para las pruebas. */
function stike_smtp_security($host, $port) {
  $s = strtolower(trim((string)stike_config("SMTP_SECURE", "")));
  if ($s === "none" && in_array($host, ["127.0.0.1", "localhost", "::1"], true)) return "none";
  if ($s === "ssl" || $s === "starttls") return $s;
  return $port === 465 ? "ssl" : "starttls";
}
/* Una respuesta del servidor (puede venir en varias lineas: «250-...» y al final «250 ...»). -> [codigo, texto] */
function stike_smtp_read($fp) {
  $text = ""; $code = 0;
  for ($i = 0; $i < 100; $i++) {
    $line = fgets($fp, 2048);
    if ($line === false) return [0, $text !== "" ? trim($text) : "sin respuesta del servidor (se cortó o tardó demasiado)"];
    $text .= trim($line) . "\n";
    if (!preg_match('/^(\d{3})([ -])/', $line, $m)) break;
    $code = (int)$m[1];
    if ($m[2] === " ") break;
  }
  return [$code, trim($text)];
}
function stike_smtp_cmd($fp, $line) { @fwrite($fp, $line . "\r\n"); return stike_smtp_read($fp); }
/* Lo que contesto el servidor, sin saltos de linea y corto, para mostrarlo en el panel. */
function stike_smtp_short($text) {
  $t = trim((string)preg_replace('/\s+/', " ", (string)$text));
  return function_exists("mb_substr") ? mb_substr($t, 0, 160) : substr($t, 0, 160);
}
function stike_smtp_fail($code, $detail) { return ["ok" => false, "code" => $code, "detail" => $detail]; }

/* Abre la conexion, la asegura (TLS) e inicia sesion. -> ["ok" => true, "fp" => recurso] o ["ok" => false, "code", "detail"] */
function stike_smtp_open($cfg) {
  $host = $cfg["host"]; $port = $cfg["port"]; $sec = stike_smtp_security($host, $port);
  $insecure = getenv("STIKE_SMTP_INSECURE") === "1";   // solo pruebas (certificado propio); un visitante no controla el entorno
  $ctx = stream_context_create(["ssl" => ["verify_peer" => !$insecure, "verify_peer_name" => !$insecure, "allow_self_signed" => $insecure, "SNI_enabled" => true, "peer_name" => $host]]);
  $errno = 0; $errstr = "";
  $fp = @stream_socket_client(($sec === "ssl" ? "ssl://" : "tcp://") . $host . ":" . $port, $errno, $errstr, 12, STREAM_CLIENT_CONNECT, $ctx);
  if (!$fp) return stike_smtp_fail("smtp_unreachable", "No se pudo conectar a $host:$port (" . ($errstr !== "" ? $errstr : "sin respuesta") . "). Revisa el servidor y el puerto (Hostinger: smtp.hostinger.com, puerto 465).");
  stream_set_timeout($fp, 15);
  $bye = function ($r) use ($fp) { @fclose($fp); return $r; };
  [$c, $t] = stike_smtp_read($fp);
  if ($c !== 220) return $bye(stike_smtp_fail("smtp_bad_greeting", "El servidor $host no respondió como un servidor de correo (" . stike_smtp_short($t) . "). Revisa el servidor y el puerto."));
  $me = "stikebikeshop.com";
  [$c, $t] = stike_smtp_cmd($fp, "EHLO $me");
  if ($c !== 250) return $bye(stike_smtp_fail("smtp_bad_greeting", "El servidor $host no aceptó la presentación (" . stike_smtp_short($t) . ")."));
  if ($sec === "starttls") {
    if (stripos($t, "STARTTLS") === false) return $bye(stike_smtp_fail("smtp_no_tls", "El servidor $host no ofrece conexión segura (STARTTLS) en el puerto $port. Usa el puerto 465."));
    [$c, $x] = stike_smtp_cmd($fp, "STARTTLS");
    if ($c !== 220) return $bye(stike_smtp_fail("smtp_no_tls", "El servidor $host no aceptó la conexión segura (" . stike_smtp_short($x) . ")."));
    if (!@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) return $bye(stike_smtp_fail("smtp_tls_failed", "No se pudo establecer la conexión segura (TLS) con $host: el certificado del servidor no es válido o no coincide con el nombre."));
    [$c, $t] = stike_smtp_cmd($fp, "EHLO $me");
    if ($c !== 250) return $bye(stike_smtp_fail("smtp_bad_greeting", "El servidor $host no aceptó la presentación segura (" . stike_smtp_short($t) . ")."));
  }
  $mechs = preg_match('/^250[ -]AUTH[ =]([^\n]*)/mi', $t, $m) ? strtoupper($m[1]) : "";
  if ($mechs === "") return $bye(stike_smtp_fail("smtp_no_auth", "El servidor $host no ofrece inicio de sesión (AUTH). Usa el servidor y puerto de SALIDA (SMTP) de tu correo."));
  if (strpos($mechs, "PLAIN") !== false) {
    [$c, $x] = stike_smtp_cmd($fp, "AUTH PLAIN " . base64_encode("\0" . $cfg["user"] . "\0" . $cfg["pass"]));
  } elseif (strpos($mechs, "LOGIN") !== false) {
    [$c, $x] = stike_smtp_cmd($fp, "AUTH LOGIN");
    if ($c === 334) { [$c, $x] = stike_smtp_cmd($fp, base64_encode($cfg["user"])); if ($c === 334) [$c, $x] = stike_smtp_cmd($fp, base64_encode($cfg["pass"])); }
  } else {
    return $bye(stike_smtp_fail("smtp_no_auth", "El servidor $host solo ofrece formas de inicio de sesión que este sitio no usa (" . stike_smtp_short($mechs) . ")."));
  }
  if ($c !== 235) {
    $gmail = strpos($host, "gmail") !== false || strpos($host, "google") !== false || (bool)preg_match('/@(gmail|googlemail)\.com$/i', $cfg["user"]);
    return $bye(stike_smtp_fail("smtp_auth_failed", "El servidor de correo rechazó el usuario o la contraseña (" . $c . ": " . stike_smtp_short($x) . ")."
      . ($gmail ? " Gmail pide una «contraseña de aplicación» (Cuenta de Google → Seguridad → Verificación en dos pasos → Contraseñas de aplicaciones), no la contraseña normal." : " Revisa que el correo esté completo (ventas@tudominio.com) y la contraseña bien copiada.")));
  }
  return ["ok" => true, "fp" => $fp];
}
/* Solo comprueba que se puede entrar (conexion + TLS + usuario y contraseña); no envia nada. */
function stike_smtp_check($cfg) {
  $o = stike_smtp_open($cfg);
  if (empty($o["ok"])) return $o;
  stike_smtp_cmd($o["fp"], "QUIT"); @fclose($o["fp"]);
  return ["ok" => true];
}
/* Envia un correo (texto + HTML) a $to desde la propia cuenta. -> ["ok" => true] o ["ok" => false, "code", "detail"] */
function stike_smtp_send($cfg, $to, $subject, $html) {
  $o = stike_smtp_open($cfg);
  if (empty($o["ok"])) return $o;
  $fp = $o["fp"];
  try {
    $from = $cfg["user"];   // Hostinger y Gmail exigen que el remitente sea la propia cuenta
    [$c, $t] = stike_smtp_cmd($fp, "MAIL FROM:<$from>");
    if ($c !== 250) return stike_smtp_fail("smtp_sender_rejected", "El servidor no aceptó el remitente $from (" . $c . ": " . stike_smtp_short($t) . "). El remitente tiene que ser el mismo correo con el que se inicia sesión.");
    $ok = 0; $bad = null;
    foreach ($to as $r) {
      [$c, $t] = stike_smtp_cmd($fp, "RCPT TO:<$r>");
      if ($c === 250 || $c === 251) $ok++; else $bad = $bad ?: stike_smtp_fail("smtp_recipient_rejected", "El servidor no aceptó el destinatario $r (" . $c . ": " . stike_smtp_short($t) . ").");
    }
    if (!$ok) return $bad;
    [$c, $t] = stike_smtp_cmd($fp, "DATA");
    if ($c !== 354) return stike_smtp_fail("smtp_data_rejected", "El servidor no aceptó el mensaje (" . $c . ": " . stike_smtp_short($t) . ").");
    [$hdr, $body] = stike_build_mime("Stike Bike Shop", $from, $html);
    $msg = "To: " . implode(", ", $to) . "\r\nSubject: " . stike_mime_subject($subject) . "\r\n" . $hdr . "\r\n\r\n" . $body;
    $msg = preg_replace('/^\./m', "..", preg_replace('/\r\n|\r|\n/', "\r\n", $msg));   // fin de linea de correo y «.» al inicio de linea duplicado
    @fwrite($fp, $msg . "\r\n.\r\n");
    [$c, $t] = stike_smtp_read($fp);
    if ($c !== 250) return stike_smtp_fail("smtp_data_rejected", "El servidor no aceptó el mensaje (" . $c . ": " . stike_smtp_short($t) . ").");
    stike_smtp_cmd($fp, "QUIT");
    return ["ok" => true];
  } finally {
    @fclose($fp);
  }
}

/* ------------- API de Gmail (Google Cloud): enviar desde una cuenta de Google conectada desde el panel -------------
   Sin servidor de correo ni cuentas en servicios nuevos: en Google Cloud Console se crea un «ID de cliente OAuth» (proyecto de Google
   que ya usa el login del panel), se pega en el panel y se pulsa «Conectar con Google». Google le pide permiso a la cuenta UNA vez
   (solo para enviar correos) y devuelve un permiso permanente (refresh token) que se guarda cifrado. Desde ahi, cada aviso sale por
   la API de Gmail (users.messages.send) desde esa cuenta, con SPF y DKIM de Google. */
function stike_google_url($which) {
  $d = ["oauth" => "https://oauth2.googleapis.com", "auth" => "https://accounts.google.com/o/oauth2/v2/auth", "gmail" => "https://gmail.googleapis.com"];
  $env = ["oauth" => "GOOGLE_OAUTH_BASE", "auth" => "GOOGLE_AUTH_URL", "gmail" => "GMAIL_API_BASE"][$which];
  return rtrim((string)stike_config($env, $d[$which]), "/");   // solo pruebas cambian esto: un visitante no controla el entorno
}
function stike_public_base() { return rtrim((string)stike_config("SITE_URL", "https://stikebikeshop.com"), "/"); }
function stike_gmail_redirect_uri() { return stike_public_base() . "/api/gmail-callback"; }
/* ID y secreto de cliente OAuth guardados (para poder pedir permiso), o null. */
function stike_gmail_client() {
  $id = trim((string)stike_config("GMAIL_CLIENT_ID", "")); $secret = trim((string)stike_config("GMAIL_CLIENT_SECRET", ""));
  return ($id !== "" && $secret !== "") ? ["id" => $id, "secret" => $secret] : null;
}
/* Todo lo necesario para enviar (cliente + permiso permanente + cuenta conectada), o null. */
function stike_gmail_config() {
  $c = stike_gmail_client();
  $rt = trim((string)stike_config("GMAIL_REFRESH_TOKEN", "")); $sender = trim((string)stike_config("GMAIL_SENDER", ""));
  if (!$c || $rt === "" || !filter_var($sender, FILTER_VALIDATE_EMAIL)) return null;
  return ["client_id" => $c["id"], "client_secret" => $c["secret"], "refresh_token" => $rt, "sender" => $sender];
}
function stike_gmail_fail($code, $detail) { return ["ok" => false, "code" => $code, "detail" => $detail]; }
/* Cambia el permiso permanente por un token de acceso (dura una hora; no se guarda: un aviso cada tanto no justifica cachearlo). */
function stike_gmail_token($cfg) {
  $res = stike_http("POST", stike_google_url("oauth") . "/token", ["Content-Type: application/x-www-form-urlencoded"], http_build_query([
    "client_id" => $cfg["client_id"], "client_secret" => $cfg["client_secret"], "refresh_token" => $cfg["refresh_token"], "grant_type" => "refresh_token",
  ]), 15);
  if ($res["status"] === 200 && is_array($res["json"]) && is_string($res["json"]["access_token"] ?? null) && $res["json"]["access_token"] !== "") return ["ok" => true, "token" => $res["json"]["access_token"]];
  $err = is_array($res["json"]) && is_string($res["json"]["error"] ?? null) ? $res["json"]["error"] : "";
  if ($res["status"] === 0) return stike_gmail_fail("gmail_unreachable", "No se pudo conectar con Google (" . ($res["error"] ?: "sin respuesta") . "). Suele ser momentáneo.");
  if ($err === "invalid_grant") return stike_gmail_fail("gmail_disconnected", "Google desconectó la cuenta de Gmail: se cambió su contraseña, se quitó el permiso o pasaron 7 días con la app en «Pruebas» en Google Cloud. Conéctala de nuevo en el panel (y publica la app en Google Cloud para que no se repita).");
  if ($err === "invalid_client" || $err === "unauthorized_client") return stike_gmail_fail("gmail_client_rejected", "Google no reconoce el ID o el secreto de cliente guardados. Revísalos en Google Cloud → Credenciales y pégalos de nuevo.");
  if ($res["status"] === 429 || $res["status"] >= 500) return stike_gmail_fail("gmail_down", "Google no respondió bien (" . $res["status"] . "). Suele ser momentáneo.");
  return stike_gmail_fail("gmail_token_failed", "Google no entregó permiso para enviar (" . $res["status"] . ($err !== "" ? ": " . $err : "") . ").");
}
/* Envia un correo (texto + HTML) a $to desde la cuenta conectada. -> ["ok" => true] o ["ok" => false, "code", "detail"] */
function stike_gmail_send($cfg, $to, $subject, $html) {
  $t = stike_gmail_token($cfg);
  if (empty($t["ok"])) return $t;
  [$hdr, $body] = stike_build_mime("Stike Bike Shop", $cfg["sender"], $html);
  $raw = "To: " . implode(", ", $to) . "\r\nSubject: " . stike_mime_subject($subject) . "\r\n" . $hdr . "\r\n\r\n" . $body;
  $res = stike_http("POST", stike_google_url("gmail") . "/gmail/v1/users/me/messages/send", ["Authorization: Bearer " . $t["token"], "Content-Type: application/json"],
    json_encode(["raw" => rtrim(strtr(base64_encode($raw), "+/", "-_"), "=")]), 20);
  if ($res["status"] >= 200 && $res["status"] < 300) return ["ok" => true, "id" => is_array($res["json"]) ? ($res["json"]["id"] ?? null) : null];
  $e = (is_array($res["json"]) && is_array($res["json"]["error"] ?? null)) ? $res["json"]["error"] : [];
  $reason = (string)($e["errors"][0]["reason"] ?? ($e["details"][0]["reason"] ?? ""));
  $msg = (string)($e["message"] ?? "");
  $st = $res["status"];
  if ($st === 0) return stike_gmail_fail("gmail_unreachable", "No se pudo conectar con Gmail (" . ($res["error"] ?: "sin respuesta") . "). Suele ser momentáneo.");
  if ($st === 401) return stike_gmail_fail("gmail_token_rejected", "Google rechazó el permiso de envío (401). Conecta la cuenta de nuevo en el panel.");
  if ($st === 403 && (stripos($reason, "accessNotConfigured") !== false || $reason === "SERVICE_DISABLED" || stripos($msg, "has not been used") !== false || stripos($msg, "is disabled") !== false)) {
    return stike_gmail_fail("gmail_api_disabled", "La API de Gmail no está activada en tu proyecto de Google Cloud. Entra a console.cloud.google.com → APIs y servicios → Biblioteca → «Gmail API» → Habilitar, espera un minuto y vuelve a probar.");
  }
  if ($st === 403 && (stripos($reason, "insufficient") !== false || stripos($msg, "insufficient") !== false || stripos($msg, "scope") !== false)) {
    return stike_gmail_fail("gmail_scope", "A la cuenta conectada le falta el permiso de enviar correos. Desconéctala y vuelve a conectarla aceptando el permiso «Enviar correos».");
  }
  if ($st === 429 || stripos($reason, "ratelimit") !== false || stripos($reason, "quota") !== false) return stike_gmail_fail("gmail_rate_limited", "Gmail pide esperar: se alcanzó el límite de envíos de la cuenta.");
  if ($st >= 500) return stike_gmail_fail("gmail_down", "Gmail tuvo un problema (" . $st . "). Suele ser momentáneo.");
  $short = function_exists("mb_substr") ? mb_substr($msg, 0, 160) : substr($msg, 0, 160);
  return stike_gmail_fail("gmail_rejected", "Gmail no aceptó el mensaje (" . $st . ($short !== "" ? ": " . $short : "") . ").");
}
/* Pedir permiso: la URL a la que se manda al dueño (la cuenta elige y acepta ahi) y el «state» que ata el regreso a quien lo pidio. */
function stike_gmail_auth_url($clientId, $state) {
  return stike_google_url("auth") . "?" . http_build_query([
    "client_id" => $clientId, "redirect_uri" => stike_gmail_redirect_uri(), "response_type" => "code",
    "scope" => "https://www.googleapis.com/auth/gmail.send openid email",
    "access_type" => "offline", "prompt" => "consent", "state" => $state,
  ], "", "&", PHP_QUERY_RFC3986);
}
function stike_oauth_state_dir() {
  $d = stike_storage_dir() . "/oauth-state";
  if (!is_dir($d) && !@mkdir($d, 0750, true) && !is_dir($d)) throw new ApiError(500, "storage_unavailable");
  return $d;
}
function stike_oauth_state_new($email) {
  $d = stike_oauth_state_dir();
  foreach (glob($d . "/*.json") ?: [] as $f) if (@filemtime($f) < time() - 3600) @unlink($f);
  $s = bin2hex(random_bytes(32));
  if (@file_put_contents($d . "/" . $s . ".json", json_encode(["by" => $email, "at" => time()])) === false) throw new ApiError(500, "storage_unavailable");
  @chmod($d . "/" . $s . ".json", 0600);
  return $s;
}
/* Un solo uso y 10 minutos de vida. -> ["by" => correo de quien lo pidio] o null. */
function stike_oauth_state_take($s) {
  if (!is_string($s) || !preg_match('/^[a-f0-9]{64}$/', $s)) return null;
  $f = stike_oauth_state_dir() . "/" . $s . ".json";
  if (!is_file($f)) return null;
  $d = json_decode((string)@file_get_contents($f), true);
  @unlink($f);
  return (is_array($d) && time() - (int)($d["at"] ?? 0) <= 600) ? $d : null;
}

/* Ultimo resultado de cada tipo de correo (venta, prueba, alerta): lo lee el panel para decir con claridad si el aviso esta llegando. */
function stike_note_mail($kind, $via, $ok, $code = null, $detail = null, $extra = []) {
  try {
    $path = stike_storage_dir() . "/last-mail.json";
    $all = is_file($path) ? json_decode((string)@file_get_contents($path), true) : [];
    if (!is_array($all)) $all = [];
    $short = $detail === null ? null : (function_exists("mb_substr") ? mb_substr((string)$detail, 0, 300) : substr((string)$detail, 0, 300));
    $all[$kind] = ["at" => stike_now_iso(), "via" => $via, "ok" => (bool)$ok, "error" => $code, "detail" => $short] + $extra;
    @file_put_contents($path, json_encode($all, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE));
  } catch (Throwable $e) { /* nunca por esto se rompe una venta */ }
}

/* Bandeja de reintento: un aviso que NINGUN canal pudo enviar se guarda y se vuelve a intentar (2 min, 4, 8... hasta 1 h entre intentos,
   durante 48 h) cada vez que el panel revisa pagos. Asi un corte de Resend o del hosting no pierde el aviso de una venta. */
function stike_mail_outbox_add($kind, $subject, $html) {
  try {
    $dir = stike_storage_dir() . "/outbox";
    if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) return false;
    if (count(glob($dir . "/*.json") ?: []) >= 30) return false;
    $f = $dir . "/" . date("YmdHis") . "-" . bin2hex(random_bytes(4)) . ".json";
    $tmp = $f . ".tmp";
    if (@file_put_contents($tmp, json_encode(["kind" => $kind, "subject" => $subject, "html" => $html, "at" => stike_now_iso(), "tries" => 0], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE)) === false) return false;
    @chmod($tmp, 0600);
    return @rename($tmp, $f);
  } catch (Throwable $e) { return false; }
}
function stike_mail_outbox_flush($max = 3) {
  $sent = 0;
  try {
    $dir = stike_storage_dir() . "/outbox";
    if (!is_dir($dir)) return 0;
    $n = 0;
    foreach (glob($dir . "/*.json") ?: [] as $f) {
      if ($n >= $max) break;
      $p = json_decode((string)@file_get_contents($f), true);
      if (!is_array($p) || !is_string($p["subject"] ?? null) || !is_string($p["html"] ?? null)) { @unlink($f); continue; }
      $tries = (int)($p["tries"] ?? 0);
      $age = time() - (strtotime((string)($p["at"] ?? "")) ?: (int)@filemtime($f));
      if ($age > 172800 || $tries >= 12) { @unlink($f); continue; }
      if ($tries > 0 && time() - (int)($p["lastTry"] ?? 0) < min(3600, 120 * (2 ** $tries))) continue;
      $n++;
      $late = '<p style="background:#fff7e0;border:1px solid #f0d58a;padding:8px 10px;border-radius:6px;font-family:system-ui,sans-serif;font-size:13px;max-width:480px;margin:0 auto 10px">Este aviso se reenvió porque el primer envío falló (' . stike_h($p["at"] ?? "") . ').</p>';
      $r = stike_send_owner_mail($p["subject"], $late . $p["html"], ["kind" => (string)($p["kind"] ?? "venta"), "fromOutbox" => true]);
      if (empty($r["error"])) { @unlink($f); $sent++; continue; }
      $p["tries"] = $tries + 1; $p["lastTry"] = time();
      $tmp = $f . "." . bin2hex(random_bytes(4)) . ".tmp";
      if (@file_put_contents($tmp, json_encode($p, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE)) !== false) @rename($tmp, $f);
    }
  } catch (Throwable $e) { error_log("[stike] bandeja de correos: " . get_class($e)); }
  return $sent;
}

/* Envia un correo al dueno. Orden: Resend (si hay llave) -> la cuenta de Gmail conectada (API de Google) -> el correo propio por SMTP
   -> el correo del hosting (mail(), que no garantiza nada). Cada uno solo se prueba si el anterior fallo o no esta configurado. Nunca lanza.
   $opts: kind = venta | prueba | alerta (para el registro del panel); noQueue = no guardar para reintentar; fromOutbox.
   Devuelve ["sent" => "resend"|"gmail"|"smtp"|"mail", "to" => [...], "resendError" => null|["code","detail"], "gmailError", "smtpError"]
   o ["error" => "email_failed", ...]. OJO: lo que sale al navegador de un cliente (wompi-order.php) nunca lleva este arreglo
   completo: ver stike_finalize_order. */
function stike_send_owner_mail($subject, $html, $opts = []) {
  $kind = (string)($opts["kind"] ?? "venta");
  $to = (!empty($opts["to"]) && is_array($opts["to"])) ? array_values($opts["to"]) : stike_owner_recipients();   // to: solo avisos internos (p. ej. al cambiar el destinatario)
  $resendErr = null; $gmailErr = null; $smtpErr = null;
  try {
    $apiKey = stike_config("RESEND_API_KEY");
    if ($apiKey) {
      $r = stike_resend_send($apiKey, $to, $subject, $html);
      if (!empty($r["ok"])) { stike_note_mail($kind, "resend", true); return ["sent" => "resend", "to" => $to, "resendError" => null, "gmailError" => null, "smtpError" => null]; }
      $resendErr = ["code" => $r["code"], "detail" => $r["detail"]];
      error_log("[stike] Resend no envio el correo ($kind): " . $r["code"] . " (" . ($r["status"] ?? "?") . ")");
    }
    $gmail = stike_gmail_config();
    if ($gmail) {
      $r = stike_gmail_send($gmail, $to, $subject, $html);
      if (!empty($r["ok"])) {
        stike_note_mail($kind, "gmail", true, $resendErr["code"] ?? null, $resendErr["detail"] ?? null, ["fellBack" => (bool)$resendErr]);
        return ["sent" => "gmail", "to" => $to, "resendError" => $resendErr, "gmailError" => null, "smtpError" => null];
      }
      $gmailErr = ["code" => $r["code"], "detail" => $r["detail"]];
      error_log("[stike] Gmail no envio el correo ($kind): " . $r["code"]);
    }
    $smtp = stike_smtp_config();
    if ($smtp) {
      $r = stike_smtp_send($smtp, $to, $subject, $html);
      if (!empty($r["ok"])) {
        $f1 = $resendErr ?: $gmailErr;
        stike_note_mail($kind, "smtp", true, $f1["code"] ?? null, $f1["detail"] ?? null, ["fellBack" => (bool)$f1]);
        return ["sent" => "smtp", "to" => $to, "resendError" => $resendErr, "gmailError" => $gmailErr, "smtpError" => null];
      }
      $smtpErr = ["code" => $r["code"], "detail" => $r["detail"]];
      error_log("[stike] SMTP no envio el correo ($kind): " . $r["code"]);
    }
    $first = $resendErr ?: ($gmailErr ?: $smtpErr);   // lo primero que fallo (lo que el panel le explica al dueno)
    if (stike_mail_fallback($to, $subject, $html)) {
      stike_note_mail($kind, "mail", true, $first["code"] ?? null, $first["detail"] ?? null, ["fellBack" => (bool)$first]);
      return ["sent" => "mail", "to" => $to, "resendError" => $resendErr, "gmailError" => $gmailErr, "smtpError" => $smtpErr];
    }
    error_log("[stike] mail() del hosting no envio el correo ($kind)");
  } catch (Throwable $e) {
    error_log("[stike] correo al dueno fallo: " . get_class($e) . ": " . $e->getMessage());
  }
  $first = $resendErr ?: ($gmailErr ?: $smtpErr);
  stike_note_mail($kind, null, false, $first["code"] ?? "mail_failed", $first["detail"] ?? "El correo del hosting (mail) no aceptó el mensaje.");
  $queued = false;
  if ($kind === "venta" && empty($opts["noQueue"]) && empty($opts["fromOutbox"])) $queued = stike_mail_outbox_add($kind, $subject, $html);
  return ["error" => "email_failed", "to" => $to, "resendError" => $resendErr, "gmailError" => $gmailErr, "smtpError" => $smtpErr, "queued" => $queued];
}

/* Aviso de que el cobro se cayo (no de una venta). Como maximo uno por tipo cada
   $everySec segundos, para no llenar el correo si cien clientes lo intentan. Sin esto el
   dueno se entera cuando un cliente le escribe; con esto, la primera vez que alguien
   intenta pagar y no se puede. */
function stike_alert_owner($kind, $title, $detail, $everySec = 21600) {
  try {
    $dir = stike_storage_dir() . "/alerts";
    if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) return false;
    $f = $dir . "/" . preg_replace('/[^a-z0-9_-]/i', "_", $kind) . ".txt";
    if (is_file($f) && (int)@file_get_contents($f) > time() - $everySec) return false;
    @file_put_contents($f, (string)time());
    $html = '<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">'
      . '<h2 style="color:#b00;margin-bottom:4px">' . stike_h($title) . '</h2>'
      . '<p>Un cliente intentó pagar en stikebikeshop.com y no pudo.</p>'
      . '<p style="background:#f7f7f7;padding:10px;border-radius:6px">' . stike_h($detail) . '</p>'
      . '<p>Entra al panel → <b>Configuración</b> para corregirlo. Mientras tanto los clientes ven la opción de pedir por WhatsApp.</p>'
      . '<p style="color:#999;font-size:12px">Este aviso se envía como máximo una vez cada ' . (int)round($everySec / 3600) . ' horas.</p></div>';
    $r = stike_send_owner_mail("⚠ El pago en línea de Stike no está funcionando", $html, ["kind" => "alerta", "noQueue" => true]);
    if (!empty($r["error"])) { @unlink($f); return false; }   // no salio: que el proximo intento de un cliente vuelva a avisar (no esperar 6 horas)
    return true;
  } catch (Throwable $e) {
    return false;
  }
}

/* Ultimo evento que Wompi mando a api/wompi-events: lo lee el panel para que el dueno vea
   con sus ojos que la URL de eventos de PRODUCCION quedo bien puesta. */
function stike_note_event($result, $reference = null, $status = null) {
  try {
    $dir = stike_storage_dir();
    if ($result === "firma_invalida") {
      /* Los avisos con firma falsa se cuentan APARTE: si se anotaran como «ultimo evento», cualquiera que probara la direccion
         taparia en el panel el ultimo evento real de Wompi. */
      $path = $dir . "/last-bad-event.json";
      $prev = is_file($path) ? json_decode((string)@file_get_contents($path), true) : null;
      $recent = is_array($prev) && !empty($prev["since"]) && (time() - (int)strtotime((string)$prev["since"])) < 7 * 86400;
      @file_put_contents($path, json_encode(["at" => stike_now_iso(), "since" => $recent ? $prev["since"] : stike_now_iso(), "count" => $recent ? (int)($prev["count"] ?? 0) + 1 : 1]));
      return;
    }
    @file_put_contents($dir . "/last-event.json", json_encode(["at" => stike_now_iso(), "result" => $result, "reference" => $reference, "status" => $status], JSON_UNESCAPED_UNICODE));
  } catch (Throwable $e) { /* nunca por esto se rechaza un evento */ }
}

/* Telefono del cliente en formato de WhatsApp (57 + 10 digitos), o null si no se puede saber con seguridad. */
function stike_wa_phone($raw) {
  $d = preg_replace('/\D+/', "", (string)$raw);
  if (strlen($d) === 10 && $d[0] === "3") return "57" . $d;
  if (strlen($d) === 12 && substr($d, 0, 2) === "57" && $d[2] === "3") return $d;
  return null;
}
function stike_wa_link($phoneRaw, $text) {
  $p = stike_wa_phone($phoneRaw);
  return $p ? "https://wa.me/" . $p . "?text=" . rawurlencode($text) : null;
}

/* Aviso al dueno. Con RESEND_API_KEY sale por Resend (entrega confiable); sin
   ella cae a mail() del hosting. Un correo que falla NO tumba la venta. */
function stike_notify_owner($entries, $ctx) {
  $items = 0;
  $rows = "";
  foreach ($entries as $e) {
    $variant = implode(", ", array_filter([$e["size"] ?? null, $e["color"] ?? null]));
    $rows .= '<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e5e5">' . stike_h($e["name"]) . ($variant ? " (" . stike_h($variant) . ")" : "")
      . '</td><td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:center">' . (int)$e["qty"]
      . '</td><td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right">' . stike_money($e["total"]) . "</td></tr>";
    $items += (int)$e["total"];
  }
  $paidPesos = intdiv((int)$ctx["paidInCents"], 100);
  $shipCost = $paidPesos - $items;

  $warn = "";
  if ($ctx["recordError"]) $warn .= '<p style="color:#b00"><b>No se pudo guardar esta venta en el servidor</b> (' . stike_h($ctx["recordError"]) . '). Anótala a mano en el panel.</p>';
  if ($ctx["flag"] === "amount_mismatch") $warn .= '<p style="color:#b00"><b>Revisar a mano:</b> el monto cobrado no coincide con el pedido guardado. Confirma con el cliente antes de enviar.</p>';
  if ($ctx["flag"] === "no_pending_order") $warn .= '<p style="color:#b00"><b>Pago sin pedido guardado:</b> Wompi aprobó este pago pero no tenemos qué compró ni a dónde enviarlo. Búscalo por la referencia en el panel de Wompi y contacta al cliente.</p>';

  /* El envio NO se cobro en el pago: lo cotiza la tienda y se lo comparte al cliente por WhatsApp (corre por su cuenta). Los pedidos
     que quedaron en curso ANTES de este cambio pagaron envio dentro del total ($shipCost > 0): esos no llevan este bloque. */
  $quote = "";
  if ($shipCost <= 0 && $ctx["shipping"] && $ctx["flag"] !== "no_pending_order") {
    $who = trim((string)($ctx["shipping"]["name"] ?? ""));
    $city = trim((string)($ctx["shipping"]["city"] ?? ""));
    $wa = stike_wa_link($ctx["shipping"]["phone"] ?? "", "Hola" . ($who !== "" ? " " . $who : "") . "! Te escribimos de Stike Bike Shop por tu pedido " . $ctx["reference"] . ". Ya recibimos tu pago. El envío a " . ($city !== "" ? $city : "tu ciudad") . " (va por tu cuenta) cuesta $");
    $quote = '<div style="background:#fff7e0;border:1px solid #f0d58a;border-radius:8px;padding:10px 12px;margin:12px 0;font-size:14px">'
      . '<b>El envío NO se cobró en este pago.</b> Calcúlalo' . ($city !== "" ? " para " . stike_h($city) : "") . ' y compártelo con el cliente por WhatsApp: el envío va por cuenta del cliente y se despacha cuando lo confirme y lo pague.'
      . (!empty($ctx["shippingAck"]) ? '<br><span style="font-size:12px;color:#666">El cliente aceptó esto al pagar (casilla del carrito).</span>' : "")
      . ($wa ? '<br><a href="' . stike_h($wa) . '" style="display:inline-block;margin-top:8px;background:#25d366;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px;font-weight:600">Escribirle por WhatsApp</a>' : "")
      . "</div>";
  }

  $ship = $ctx["shipping"]
    ? "<p><b>Enviar a:</b><br>" . stike_h($ctx["shipping"]["name"]) . " — " . stike_h($ctx["shipping"]["phone"]) . "<br>"
      . stike_h($ctx["shipping"]["address"]) . ", " . stike_h($ctx["shipping"]["city"])
      . ($ctx["shipping"]["notes"] !== "" ? "<br><i>Notas: " . stike_h($ctx["shipping"]["notes"]) . "</i>" : "") . "</p>"
    : "";

  $html = '<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">'
    . '<h2 style="margin-bottom:4px">Nueva venta — Stike Bike Shop</h2>'
    . '<p style="color:#666;margin-top:0">Referencia Wompi: ' . stike_h($ctx["reference"]) . " · ID " . stike_h($ctx["wompiId"]) . "</p>"
    . $warn
    . '<table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr>'
    . '<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #222">Producto</th>'
    . '<th style="text-align:center;padding:6px 10px;border-bottom:2px solid #222">Cant.</th>'
    . '<th style="text-align:right;padding:6px 10px;border-bottom:2px solid #222">Total</th></tr></thead><tbody>' . $rows . "</tbody></table>"
    . '<p style="text-align:right;font-size:16px;margin-top:10px"><b>Total pagado: ' . stike_money($paidPesos) . "</b>"
    . ($shipCost > 0 ? '<br><span style="font-size:12px;color:#666">incluye envío ' . stike_money($shipCost) . "</span>" : '<br><span style="font-size:12px;color:#666">solo productos: el envío no está incluido</span>') . "</p>"
    . $quote
    . $ship
    . ($ctx["customerEmail"] ? "<p><b>Email del cliente:</b> " . stike_h($ctx["customerEmail"]) . "</p>" : "")
    . '<p style="color:#999;font-size:12px">También quedó en el panel admin (pestaña Ventas).</p></div>';
  $subject = "Nueva venta Stike — " . stike_money($paidPesos) . ($quote !== "" ? " · cotizar envío" : "") . " (ref " . $ctx["reference"] . ")";

  return stike_send_owner_mail($subject, $html, ["kind" => "venta"]);
}
