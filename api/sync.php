<?php
/* =========================================================================
   STIKE BIKE SHOP: actualizacion automatica del sitio desde GitHub.

   Hostinger no descarga de GitHub por su cuenta (el "Git" de hPanel no
   conecta), asi que cuando el panel admin publica, el workflow de GitHub
   (.github/workflows/deploy-hostinger.yml) deja la copia limpia en la rama
   hostinger-deploy y le avisa a ESTE endpoint:

     POST /api/sync        Authorization: Bearer <SYNC_TOKEN>
     {"sha": "<commit de hostinger-deploy, 40 hex>"}

   El servidor baja ESE commit de GitHub (repo y rama fijos aqui abajo; el
   llamador solo elige el commit), reemplaza los archivos que cambiaron, borra
   los que ya no estan en el repo (solo entre los que el mismo sync instalo
   antes) y recuerda el commit para no repetir trabajo. Nunca toca
   api/config.local.php ni archivos ajenos al sitio (por ejemplo la carpeta de
   datos stike-private, que esta fuera de public_html).

   SYNC_TOKEN es una cadena larga al azar (minimo 24) en api/config.local.php y,
   igual, en el secret HOSTINGER_SYNC_TOKEN de GitHub. Si no esta en el
   servidor, este endpoint no hace nada (nunca queda abierto por omision). Con
   token y todo, lo peor que puede pasar es que el sitio se iguale al contenido
   publico de la rama: el llamador no puede meter archivos propios.
   ========================================================================= */

require __DIR__ . "/_lib.php";

const STIKE_SYNC_REPO = "Daniel666674/stike-x7k2m9";
const STIKE_SYNC_KEEP = ["api/config.local.php"];   // nunca se sobrescribe ni se borra
const STIKE_SYNC_REQUIRED = ["index.html", ".htaccess", "api/wompi-sign.php", "api/_lib.php", "api/sync.php", "data/site-content.json"];

function stike_sync_safe_path($rel) {
  return $rel !== "" && $rel[0] !== "/" && strpos($rel, "..") === false && strpos($rel, "\\") === false
    && !preg_match('#(^|/)\.git(/|$)#', $rel) && !in_array($rel, STIKE_SYNC_KEEP, true);
}

function stike_sync_download($url, $dest) {
  $fh = fopen($dest, "wb");
  if (!$fh) throw new ApiError(500, "sync_failed", "no se pudo crear el archivo temporal");
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_FILE => $fh, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 5,
    CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP, CURLOPT_CONNECTTIMEOUT => 20,
    CURLOPT_TIMEOUT => 240, CURLOPT_USERAGENT => "stike-sync",
  ]);
  $ok = curl_exec($ch);
  $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  $err = curl_error($ch);
  curl_close($ch);
  fclose($fh);
  if (!$ok || $code !== 200) throw new ApiError(500, "sync_failed", "descarga fallida (HTTP $code) $err");
  if (file_get_contents($dest, false, null, 0, 2) !== "PK") throw new ApiError(500, "sync_failed", "lo descargado no es un ZIP");
}

stike_run(function () {
  stike_require_method("POST");
  $token = stike_config("SYNC_TOKEN");
  if (!$token || strlen($token) < 24) throw new ApiError(503, "sync_not_configured");

  $auth = $_SERVER["HTTP_AUTHORIZATION"] ?? $_SERVER["REDIRECT_HTTP_AUTHORIZATION"] ?? "";
  if (!$auth && function_exists("getallheaders")) {
    foreach (getallheaders() as $k => $v) { if (strtolower($k) === "authorization") $auth = $v; }
  }
  $given = preg_match('/^Bearer\s+(.+)$/i', $auth, $m) ? trim($m[1]) : "";
  if ($given === "" || !hash_equals($token, $given)) {
    usleep(400000);   // frena la fuerza bruta
    throw new ApiError(401, "unauthorized");
  }

  $body = stike_json_body();
  $sha = $body["sha"] ?? null;
  if (!is_string($sha) || !preg_match('/^[0-9a-f]{40}$/', $sha)) throw new ApiError(400, "invalid_sha");
  if (!class_exists("ZipArchive") || !function_exists("curl_init")) throw new ApiError(500, "sync_failed", "falta ZipArchive o curl en este PHP");

  @set_time_limit(0);
  ignore_user_abort(true);
  $root = rtrim(str_replace("\\", "/", dirname(__DIR__)), "/");
  $storage = stike_storage_dir();

  $lock = fopen($storage . "/sync.lock", "c");
  if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) throw new ApiError(409, "sync_busy");

  $statePath = $storage . "/sync-state.json";
  $state = is_file($statePath) ? json_decode((string)file_get_contents($statePath), true) : null;
  $oldFiles = is_array($state["files"] ?? null) ? $state["files"] : [];
  if (($state["sha"] ?? null) === $sha) respond(200, ["ok" => true, "status" => "up_to_date", "sha" => $sha]);

  $base = getenv("STIKE_SYNC_BASE") ?: ("https://github.com/" . STIKE_SYNC_REPO . "/archive/");   // el entorno no lo controla un visitante
  $tmp = tempnam($storage, "sync");
  $zip = null;
  $result = null;
  try {
    stike_sync_download($base . $sha . ".zip", $tmp);
    $zip = new ZipArchive();
    if ($zip->open($tmp) !== true) throw new ApiError(500, "sync_failed", "no se pudo abrir el ZIP");
    $first = (string)$zip->getNameIndex(0);
    $prefix = substr($first, 0, (int)strpos($first, "/") + 1);   // GitHub envuelve todo en "repo-commit/"

    /* 1) Que el ZIP traiga un sitio completo ANTES de tocar nada. */
    $names = [];
    for ($i = 0; $i < $zip->numFiles; $i++) {
      $n = (string)$zip->getNameIndex($i);
      if ($prefix === "" || strpos($n, $prefix) === 0) $names[substr($n, strlen($prefix))] = $i;
    }
    foreach (STIKE_SYNC_REQUIRED as $req) {
      if (!isset($names[$req])) throw new ApiError(500, "sync_failed", "el ZIP no trae $req; no se toco nada");
    }

    /* 2) Escribir: lo igual no se reescribe (tamano + crc), lo distinto se reemplaza de forma atomica. */
    $written = 0; $unchanged = 0; $errors = []; $newFiles = [];
    foreach ($names as $rel => $i) {
      if (!stike_sync_safe_path($rel)) continue;
      $dest = $root . "/" . $rel;
      if (substr($rel, -1) === "/") {
        if (!is_dir($dest) && !@mkdir($dest, 0755, true)) $errors[] = $rel;
        continue;
      }
      $newFiles[] = $rel;
      $st = $zip->statIndex($i);
      if (is_file($dest) && filesize($dest) === $st["size"] && hash_file("crc32b", $dest) === sprintf("%08x", $st["crc"])) { $unchanged++; continue; }
      if (!is_dir(dirname($dest)) && !@mkdir(dirname($dest), 0755, true)) { $errors[] = $rel; continue; }
      $in = $zip->getStream($zip->getNameIndex($i));
      $out = $in ? @fopen($dest . ".part", "wb") : false;
      if (!$in || !$out) { $errors[] = $rel; if ($in) fclose($in); continue; }
      stream_copy_to_stream($in, $out);
      fclose($in); fclose($out);
      if (!@rename($dest . ".part", $dest)) { @unlink($dest . ".part"); $errors[] = $rel; continue; }
      $written++;
    }
    if ($errors) throw new ApiError(500, "sync_failed", "no se pudo escribir " . count($errors) . " archivo(s), por ejemplo: " . implode(", ", array_slice($errors, 0, 3)));

    /* 3) Borrar lo que antes instalo este sync y ya no esta en el repo (nunca archivos ajenos). */
    $deleted = 0;
    foreach (array_diff($oldFiles, $newFiles) as $rel) {
      if (is_string($rel) && stike_sync_safe_path($rel) && is_file($root . "/" . $rel) && @unlink($root . "/" . $rel)) $deleted++;
    }

    file_put_contents($statePath, json_encode(["sha" => $sha, "at" => stike_now_iso(), "files" => $newFiles], JSON_UNESCAPED_SLASHES));
    $result = ["ok" => true, "status" => "updated", "sha" => $sha, "written" => $written, "unchanged" => $unchanged, "deleted" => $deleted];
  } finally {
    if ($zip) @$zip->close();
    @unlink($tmp);
  }
  respond(200, $result);   // fuera del try: respond() hace exit y PHP no corre el finally en un exit
});
