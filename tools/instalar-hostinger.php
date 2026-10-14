<?php
/* =========================================================================
   STIKE BIKE SHOP: instalador de un solo archivo para Hostinger.

   Para cuando el "Git" de hPanel no funciona. Se sube ESTE archivo a la carpeta
   public_html de stikebikeshop.com (Administrador de archivos > Subir), se abre
   https://stikebikeshop.com/instalar-hostinger.php y se pulsa el boton. El
   servidor de Hostinger baja el sitio listo de GitHub (rama hostinger-deploy,
   la copia limpia que arma tools/publish-hostinger.sh) y lo descomprime en la
   carpeta donde esta este archivo. Al terminar bien, se borra solo.

   - No pide ni guarda llaves. La fuente (repo y rama) esta fija aqui abajo.
   - Sobrescribe archivos con el mismo nombre, no borra los demas, y NUNCA toca
     api/config.local.php (las llaves del servidor; ademas no esta en el repo).
   - Se puede volver a correr: deja el sitio igual al de GitHub.
   ========================================================================= */

const STIKE_ZIP_URL = "https://github.com/Daniel666674/stike-x7k2m9/archive/refs/heads/hostinger-deploy.zip";
const STIKE_KEEP = ["api/config.local.php"];   // nunca se sobrescribe
const STIKE_REQUIRED = ["index.html", ".htaccess", "api/wompi-sign.php", "api/_lib.php", "data/site-content.json"];

function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES, "UTF-8"); }

function page(string $body, int $status = 200): void {
  http_response_code($status);
  header("Content-Type: text/html; charset=utf-8");
  header("Cache-Control: no-store");
  echo '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
     . '<title>Stike installer</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px}'
     . 'button{font:inherit;padding:12px 22px;border:0;border-radius:8px;background:#111;color:#fff;cursor:pointer}'
     . 'code,pre{background:#f2f2f2;padding:2px 6px;border-radius:4px}pre{padding:12px;overflow:auto}.ok{color:#0a7a2f}.bad{color:#b00020}</style>'
     . $body;
}

function download(string $url, string $dest): void {
  $fh = fopen($dest, "wb");
  if (!$fh) throw new RuntimeException("Cannot write a temporary file ($dest).");
  if (function_exists("curl_init")) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_FILE => $fh, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 5,
      CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP, CURLOPT_CONNECTTIMEOUT => 20,
      CURLOPT_TIMEOUT => 280, CURLOPT_USERAGENT => "stike-installer",
    ]);
    $ok = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    fclose($fh);
    if (!$ok || $code !== 200) throw new RuntimeException("Download failed (HTTP $code). $err");
    return;
  }
  // Sin curl: flujo de PHP (necesita allow_url_fopen).
  $in = @fopen($url, "rb", false, stream_context_create(["http" => ["follow_location" => 1, "timeout" => 280, "user_agent" => "stike-installer"]]));
  if (!$in) { fclose($fh); throw new RuntimeException("Download failed: this server has neither curl nor allow_url_fopen."); }
  stream_copy_to_stream($in, $fh);
  fclose($in); fclose($fh);
}

function install(string $root, string $url): array {
  if (!class_exists("ZipArchive")) throw new RuntimeException("This server's PHP has no ZipArchive.");
  $tmp = null;
  foreach ([sys_get_temp_dir(), dirname($root), $root] as $dir) {
    if ($dir && is_dir($dir) && is_writable($dir)) { $tmp = tempnam($dir, "stike"); break; }
  }
  if (!$tmp) throw new RuntimeException("No writable folder for the temporary download.");
  try {
    download($url, $tmp);
    $size = filesize($tmp);
    if ($size < 100000 || file_get_contents($tmp, false, null, 0, 2) !== "PK") throw new RuntimeException("What was downloaded is not the site ZIP ($size bytes).");
    $zip = new ZipArchive();
    if ($zip->open($tmp) !== true) throw new RuntimeException("The downloaded ZIP could not be opened.");
    $first = $zip->getNameIndex(0);
    $prefix = substr($first, 0, strpos($first, "/") + 1);   // GitHub envuelve todo en "repo-rama/"
    $files = 0; $bytes = 0; $skipped = []; $errors = [];
    for ($i = 0; $i < $zip->numFiles; $i++) {
      $name = $zip->getNameIndex($i);
      if ($prefix !== "" && strpos($name, $prefix) !== 0) continue;
      $rel = substr($name, strlen($prefix));
      if ($rel === "" || strpos($rel, "..") !== false || $rel[0] === "/" || preg_match('#(^|/)\.git(/|$)#', $rel)) continue;
      if (in_array($rel, STIKE_KEEP, true)) { $skipped[] = $rel; continue; }
      $dest = $root . "/" . $rel;
      if (substr($rel, -1) === "/") {
        if (!is_dir($dest) && !@mkdir($dest, 0755, true)) $errors[] = "folder $rel";
        continue;
      }
      if (!is_dir(dirname($dest)) && !@mkdir(dirname($dest), 0755, true)) { $errors[] = $rel; continue; }
      $in = $zip->getStream($name);
      $out = $in ? @fopen($dest . ".part", "wb") : false;
      if (!$in || !$out) { $errors[] = $rel; if ($in) fclose($in); continue; }
      $bytes += (int)stream_copy_to_stream($in, $out);
      fclose($in); fclose($out);
      if (!@rename($dest . ".part", $dest)) { @unlink($dest . ".part"); $errors[] = $rel; continue; }
      $files++;
    }
    $zip->close();
  } finally {
    @unlink($tmp);
  }
  $missing = array_values(array_filter(STIKE_REQUIRED, fn($f) => !is_file($root . "/" . $f)));
  return ["files" => $files, "bytes" => $bytes, "errors" => $errors, "missing" => $missing, "skipped" => $skipped];
}

$root = rtrim(str_replace("\\", "/", getenv("STIKE_INSTALL_ROOT") ?: __DIR__), "/");
$url = getenv("STIKE_INSTALL_ZIP") ?: STIKE_ZIP_URL;   // las variables de entorno no las controla un visitante web

if (($_SERVER["REQUEST_METHOD"] ?? "GET") !== "POST") {
  page('<h1>Install the Stike Bike Shop site</h1>'
     . '<p>This downloads the finished site from GitHub into <code>' . h($root) . '</code> and unpacks it. '
     . 'Existing files with the same name are replaced; other files are left alone; the server keys file '
     . '<code>api/config.local.php</code> is never touched.</p>'
     . '<form method="post"><button type="submit">Install the site now</button></form>'
     . '<p>It takes up to a minute. Do not close the page.</p>');
  exit;
}

set_time_limit(0);
ignore_user_abort(true);
try {
  $r = install($root, $url);
} catch (Throwable $e) {
  page('<h1 class="bad">Could not install</h1><p>' . h($e->getMessage()) . '</p><p>Send this message to Claude. The file stays here; you can delete it from File Manager.</p>', 500);
  exit;
}

$ok = !$r["errors"] && !$r["missing"];
$out = '<h1 class="' . ($ok ? "ok" : "bad") . '">' . ($ok ? "Site installed" : "Installed with problems") . '</h1>'
     . '<p>' . $r["files"] . ' files (' . round($r["bytes"] / 1048576, 1) . ' MB) written.</p>';
if ($r["missing"]) $out .= '<p class="bad">Missing after install: <code>' . h(implode(", ", $r["missing"])) . '</code></p>';
if ($r["errors"]) $out .= '<p class="bad">Could not write ' . count($r["errors"]) . ' item(s), for example: <code>' . h(implode(", ", array_slice($r["errors"], 0, 5))) . '</code></p>';
foreach (["default.php", "index.php"] as $placeholder) {
  if (is_file($root . "/" . $placeholder)) $out .= '<p class="bad">Delete <code>' . $placeholder . '</code> in File Manager: it is a leftover page that can hide the site.</p>';
}
if ($ok) {
  $out .= '<p>Open <a href="/">the home page</a> to check it. This installer deleted itself' . (@unlink(__FILE__) ? "." : ", <b>but could not</b>: delete <code>instalar-hostinger.php</code> from File Manager.") . '</p>';
} else {
  $out .= '<p>Send this page (a screenshot) to Claude. The installer stays so it can be run again.</p>';
}
page($out, $ok ? 200 : 500);
