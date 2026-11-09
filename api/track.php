<?php
/* =========================================================================
   STIKE BIKE SHOP: recibe los eventos del contador propio (assets/js/analytics.js, navigator.sendBeacon).

   Siempre contesta 204 sin cuerpo (no le dice a nadie si algo se descarto ni por que) y nunca imprime errores. Solo cuenta:
   pedidos POST del propio sitio, de navegadores que no parecen robots, hasta 120 por minuto por IP, con eventos y valores
   de las listas permitidas (ver api/_track.php). No guarda IP, navegador ni identificadores.
   ========================================================================= */
require __DIR__ . "/_track.php";

header("Cache-Control: no-store");
if (($_SERVER["REQUEST_METHOD"] ?? "") !== "POST") { http_response_code(405); header("Allow: POST"); exit; }

try {
  if (stike_fp_origin_ok() && !stike_fp_is_bot($_SERVER["HTTP_USER_AGENT"] ?? "")) {
    $raw = file_get_contents("php://input", false, null, 0, 2048);
    $parsed = $raw === false ? null : stike_fp_parse($raw);
    if ($parsed && !stike_rate_limited("track", (int)(getenv("STIKE_TRACK_RATE_LIMIT") ?: 120), 60)) stike_fp_record($parsed[0], $parsed[1]);
  }
} catch (Throwable $e) {
  error_log("[stike] track: " . get_class($e) . ": " . $e->getMessage());
}
http_response_code(204);
