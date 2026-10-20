<?php
/* =========================================================================
   STIKE BIKE SHOP: puente del panel admin a GitHub.

   El panel ya no guarda ningun token en el navegador: pide aca, con su
   cookie de sesion, lo que antes pedia directo a api.github.com, y este
   archivo lo reenvia con el GITHUB_TOKEN del servidor (api/config.local.php).

   Solo sobre ESTE repo y ESTA rama, y solo sobre las rutas que el panel
   realmente usa: un admin no puede, por ejemplo, tocar .github/ (workflows)
   ni api/ (codigo del servidor) desde el panel.

     GET    api/gh.php?path=<ruta>                      -> contenido (+sha)
     PUT    api/gh.php?path=<ruta>  {message, content, sha?}
     DELETE api/gh.php?path=<ruta>  {message, sha}
   ========================================================================= */
require __DIR__ . "/_admin.php";

const STIKE_GH_ALLOWED = '#^(assets/js/products-data\.js|data/(costs|sales-log|audit-log|site-content|stock-applied)\.json|sitemap\.xml|_template\.html|producto/[a-z0-9-]+\.html|assets/img/products/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp)|assets/video/products/[A-Za-z0-9._-]+\.(mp4|jpg))$#';

/* Un video del panel pesa hasta 10 MB (el panel lo exige). Aca se pone un tope un poco mayor
   como segunda barrera: que no entre nada gigante ni un archivo que no sea MP4. */
const STIKE_GH_VIDEO_MAX_BYTES = 12 * 1024 * 1024;

stike_run(function () {
  $session = stike_admin_require();
  $method = $_SERVER["REQUEST_METHOD"] ?? "GET";
  if (!in_array($method, ["GET", "PUT", "DELETE"], true)) throw new ApiError(405, "method_not_allowed");
  if ($method !== "GET") stike_admin_check_origin();

  $path = $_GET["path"] ?? "";
  if (!is_string($path) || strpos($path, "..") !== false || !preg_match(STIKE_GH_ALLOWED, $path)) throw new ApiError(403, "path_not_allowed", $path);

  // Rol "staff" (tienda): ni lee costos ni escribe nada fuera de lo que
  // necesita una venta (stock del catalogo, log de ventas, auditoria).
  if (!stike_admin_sees_finance($session["role"])) {
    if ($path === "data/costs.json") throw new ApiError(404, "not_found");
    if ($method !== "GET" && !preg_match('#^(assets/js/products-data\.js|data/(sales-log|audit-log|stock-applied)\.json)$#', $path)) {
      throw new ApiError(403, "role_not_allowed", $path);
    }
  }

  $body = null;
  if ($method !== "GET") {
    $in = stike_json_body();
    $message = stike_clean_text($in["message"] ?? "", 300);
    // La firma del commit la pone el servidor con el correo de la sesion, no el navegador.
    $message = "[" . $session["email"] . "] " . preg_replace('/^\[[^\]]*\]\s*/', '', $message);
    $body = ["message" => $message, "branch" => STIKE_GH_BRANCH];
    if (isset($in["sha"]) && is_string($in["sha"])) $body["sha"] = $in["sha"];
    if ($method === "PUT") {
      if (!isset($in["content"]) || !is_string($in["content"])) throw new ApiError(400, "missing_content");
      $body["content"] = $in["content"];
      if (preg_match('#\.mp4$#', $path)) {
        $bytes = (int)(strlen($in["content"]) * 3 / 4);
        if ($bytes > STIKE_GH_VIDEO_MAX_BYTES) throw new ApiError(413, "video_too_large", (string)$bytes);
        $head = base64_decode(substr($in["content"], 0, 16), true);        // 12 bytes: tamaño de caja + "ftyp"
        if ($head === false || substr($head, 4, 4) !== "ftyp") throw new ApiError(400, "not_an_mp4");
      }
    }
  }

  // Subir un video por la API de GitHub tarda bastante mas que una foto o un JSON.
  if ($method === "PUT" && preg_match('#\.mp4$#', $path)) { @set_time_limit(170); }
  $res = stike_gh($method, $path, $body, ($method === "PUT" && preg_match('#\.mp4$#', $path)) ? 150 : 15);
  http_response_code($res["status"] ?: 502);
  header("Cache-Control: no-store");
  echo $res["body"] !== "" ? $res["body"] : "{}";
  exit;
});
