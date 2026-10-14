<?php
/* =========================================================================
   STIKE BIKE SHOP: ventas online para el panel admin (pestana Ventas).

   GET con   Authorization: Bearer <ADMIN_API_KEY>
   devuelve la lista de ventas guardadas en el servidor (incluye nombre,
   telefono y direccion del cliente: por eso exige clave).

   ADMIN_API_KEY es una cadena larga al azar que se pone en api/config.local.php
   (o en la variable de entorno) y que cada administrador pega UNA vez en el
   panel, pestana Configuracion -- igual que el token de GitHub. Se guarda solo
   en ese navegador. Si no esta configurada en el servidor, este endpoint
   NO responde nada (nunca queda abierto por omision).
   ========================================================================= */

require __DIR__ . "/_lib.php";

stike_run(function () {
  stike_require_method("GET");
  $key = stike_config("ADMIN_API_KEY");
  if (!$key || strlen($key) < 24) throw new ApiError(500, "server_not_configured", "falta ADMIN_API_KEY (minimo 24 caracteres)");

  $auth = $_SERVER["HTTP_AUTHORIZATION"] ?? $_SERVER["REDIRECT_HTTP_AUTHORIZATION"] ?? "";
  if (!$auth && function_exists("getallheaders")) {
    foreach (getallheaders() as $k => $v) { if (strtolower($k) === "authorization") $auth = $v; }
  }
  $given = preg_match('/^Bearer\s+(.+)$/i', $auth, $m) ? trim($m[1]) : "";
  if ($given === "" || !hash_equals($key, $given)) {
    usleep(400000);   // frena la fuerza bruta
    throw new ApiError(401, "unauthorized");
  }

  respond(200, stike_read_sales());
});
