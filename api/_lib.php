<?php
/* =========================================================================
   STIKE BIKE SHOP: utilidades compartidas de los endpoints PHP (Hostinger).

   Lo usan wompi-sign.php, wompi-order.php, wompi-events.php y sales.php.
   El guion bajo del nombre es a proposito: no es un endpoint, no se llama
   directo (si alguien lo abre en el navegador no imprime nada).

   Secretos: SIEMPRE de variable de entorno o de api/config.local.php (se sube
   a mano por FTP/Administrador de archivos, nunca al repo; ver .gitignore):

     <?php return [
       'WOMPI_INTEGRITY_SECRET' => 'prod_integrity_...',
       'WOMPI_PRIVATE_KEY'      => 'prv_prod_...',
       'ADMIN_API_KEY'          => '<cadena larga al azar; se pega en el panel>',
       'RESEND_API_KEY'         => 're_...',            // opcional, ver correo
       'OWNER_NOTIFY_EMAIL'     => 'dueno@correo.com',  // opcional
       'STORAGE_DIR'            => '/home/uXXXX/stike-private',  // opcional
     ];

   Donde se guardan las ventas: en STORAGE_DIR (por defecto una carpeta
   "stike-private" AL LADO de public_html, o sea fuera de lo que sirve el
   sitio). Ahi viven ventas.jsonl (una venta por linea, solo se agrega) y
   pending/ (pedidos firmados que aun no se pagan). Los datos del cliente
   (nombre, telefono, direccion) quedan SOLO ahi y en el correo al dueno --
   nunca en el repo, que es publico.

   Los precios y las constantes de envio replican lib/pricing.js (Vercel) y
   carrito.html; los tres tienen que decir lo mismo.
   ========================================================================= */

const STIKE_FREE_SHIP = 300000;   // pesos: desde este subtotal el envio es gratis
const STIKE_SHIP_COST = 18000;    // pesos
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

function stike_config($key, $default = null) {
  static $file = null;
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

/* ------------------------------ HTTP saliente ----------------------------- */
function stike_http($method, $url, $headers = [], $body = null) {
  $ch = curl_init($url);
  $opts = [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_TIMEOUT => 15,
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
    $total = $p["price"] * $qty;
    $subtotal += $total;
    $lines[] = [
      "slug" => $slug, "name" => $p["n"] ?? $slug, "qty" => $qty,
      "unitPrice" => $p["price"], "total" => $total,
      "size" => stike_clean_variant($it["size"] ?? null),
      "color" => stike_clean_variant($it["color"] ?? null),
    ];
  }
  $shipping = $subtotal >= STIKE_FREE_SHIP ? 0 : STIKE_SHIP_COST;
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
function stike_wompi_get_transaction($id) {
  $key = stike_config("WOMPI_PRIVATE_KEY");
  if (!$key) throw new ApiError(500, "server_not_configured", "falta WOMPI_PRIVATE_KEY (env o api/config.local.php)");
  $base = stike_config("WOMPI_API_BASE") ?: (str_starts_with($key, "prv_prod_") ? "https://production.wompi.co/v1" : "https://sandbox.wompi.co/v1");
  $res = stike_http("GET", rtrim($base, "/") . "/transactions/" . rawurlencode($id), ["Authorization: Bearer " . $key]);
  if ($res["status"] !== 200 || !isset($res["json"]["data"]) || !is_array($res["json"]["data"])) {
    throw new ApiError(502, "wompi_verify_failed", (string)$res["status"]);
  }
  return $res["json"]["data"];
}

/* Confirma un pago con Wompi (llave privada, del lado del servidor) y registra
   la venta. Lo llaman el regreso del navegador (wompi-order.php) Y el webhook
   (wompi-events.php); ninguno de los dos manda datos del pedido, solo la
   referencia y el id de la transaccion, y lo que se registra sale del pedido
   guardado al firmar. Idempotente por referencia.

   Devuelve ["ignored" => true, ...] si el pago no esta APPROVED. */
function stike_finalize_order($reference, $wompiId) {
  $txn = stike_wompi_get_transaction($wompiId);
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
      ];
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

  /* El correo sale aunque el guardado haya fallado: es la segunda copia. */
  $email = stike_notify_owner($entries, [
    "reference" => $reference, "wompiId" => $wompiId, "customerEmail" => $customerEmail,
    "shipping" => $shipping, "paidInCents" => $paid, "flag" => $flag, "recordError" => $recordError,
  ]);
  if ($recordError !== null) throw new ApiError(500, "storage_unavailable", "pago aprobado pero no se pudo guardar; el dueno fue avisado por correo");
  stike_delete_pending($reference);
  return ["recorded" => count($entries), "email" => $email, "flag" => $flag];
}

/* ---------------------------------- correo ------------------------------- */
function stike_money($n) { return "$" . number_format((float)$n, 0, ",", "."); }
function stike_h($s) { return htmlspecialchars((string)$s, ENT_QUOTES, "UTF-8"); }

/* Aviso al dueno. Con RESEND_API_KEY sale por Resend (entrega confiable); sin
   ella cae a mail() del hosting. Un correo que falla NO tumba la venta. */
function stike_notify_owner($entries, $ctx) {
  $to = stike_config("OWNER_NOTIFY_EMAIL", "jparra375@gmail.com");
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
    . ($shipCost > 0 ? '<br><span style="font-size:12px;color:#666">incluye envío ' . stike_money($shipCost) . "</span>" : "") . "</p>"
    . $ship
    . ($ctx["customerEmail"] ? "<p><b>Email del cliente:</b> " . stike_h($ctx["customerEmail"]) . "</p>" : "")
    . '<p style="color:#999;font-size:12px">También quedó en el panel admin (pestaña Ventas).</p></div>';
  $subject = "Nueva venta Stike — " . stike_money($paidPesos) . " (ref " . $ctx["reference"] . ")";

  try {
    $apiKey = stike_config("RESEND_API_KEY");
    if ($apiKey) {
      $base = rtrim(stike_config("RESEND_API_BASE", "https://api.resend.com"), "/");
      $res = stike_http("POST", $base . "/emails", ["Authorization: Bearer " . $apiKey, "Content-Type: application/json"], json_encode([
        "from" => stike_config("RESEND_FROM", "Stike Bike Shop <onboarding@resend.dev>"),
        "to" => [$to], "subject" => $subject, "html" => $html,
      ], JSON_UNESCAPED_UNICODE));
      if ($res["status"] < 200 || $res["status"] >= 300) throw new RuntimeException("resend " . $res["status"]);
      return ["sent" => "resend"];
    }
    $from = stike_config("MAIL_FROM", "pedidos@stikebikeshop.com");
    $headers = "From: Stike Bike Shop <$from>\r\nContent-Type: text/html; charset=UTF-8\r\nMIME-Version: 1.0";
    if (!@mail($to, "=?UTF-8?B?" . base64_encode($subject) . "?=", $html, $headers)) throw new RuntimeException("mail() fallo");
    return ["sent" => "mail"];
  } catch (Throwable $e) {
    error_log("[stike] correo al dueno fallo: " . $e->getMessage());
    return ["error" => "email_failed"];
  }
}
