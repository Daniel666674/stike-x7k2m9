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

const STIKE_GH_ALLOWED = '#^(assets/js/products-data\.js|data/(costs|sales-log|audit-log|site-content|stock-applied)\.json|sitemap\.xml|_template\.html|producto/[a-z0-9-]+\.html|assets/img/products/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp))$#';

stike_run(function () {
  $session = stike_admin_require();
  $method = $_SERVER["REQUEST_METHOD"] ?? "GET";
  if (!in_array($method, ["GET", "PUT", "DELETE"], true)) throw new ApiError(405, "method_not_allowed");
  if ($method !== "GET") stike_admin_check_origin();

  $path = $_GET["path"] ?? "";
  if (!is_string($path) || strpos($path, "..") !== false || !preg_match(STIKE_GH_ALLOWED, $path)) throw new ApiError(403, "path_not_allowed", $path);

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
    }
  }

  $res = stike_gh($method, $path, $body);
  http_response_code($res["status"] ?: 502);
  header("Cache-Control: no-store");
  echo $res["body"] !== "" ? $res["body"] : "{}";
  exit;
});
