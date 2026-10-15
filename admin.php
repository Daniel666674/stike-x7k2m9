<?php
/* =========================================================================
   STIKE BIKE SHOP: puerta del panel admin.

   El .htaccess manda aca todo pedido de admin.html y admin.js. Sin sesion
   valida (ver api/_admin.php) no se entrega NADA del panel: ni el HTML ni el
   codigo, solo la pantalla de inicio de sesion con Google.
   ========================================================================= */
require __DIR__ . "/api/_admin.php";

$file = ($_GET["f"] ?? "html") === "js" ? "js" : "html";
$session = stike_admin_session();

header("Cache-Control: no-store");
header("X-Robots-Tag: noindex, nofollow");

if ($session) {
  if ($file === "js") {
    header("Content-Type: application/javascript; charset=utf-8");
    readfile(__DIR__ . "/admin.js");
  } else {
    header("Content-Type: text/html; charset=utf-8");
    readfile(__DIR__ . "/admin.html");
  }
  exit;
}

if ($file === "js") { http_response_code(401); header("Content-Type: application/javascript"); echo "/* sin sesion */"; exit; }

header("Content-Type: text/html; charset=utf-8");
$clientId = htmlspecialchars(STIKE_OAUTH_CLIENT_ID, ENT_QUOTES);
?><!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Stike · Panel admin</title>
<link rel="icon" href="assets/img/logo-stike.png">
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#141619;color:#e9ecef;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .card{background:#1c1f24;border:1px solid #2a2e35;border-radius:16px;padding:34px 30px;width:min(360px,calc(100vw - 32px));text-align:center}
  .card img{height:58px}
  h1{font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#8b929b;margin:12px 0 18px}
  p{color:#8b929b;font-size:13.5px;margin:0 0 20px}
  #g{display:flex;justify-content:center;min-height:44px}
  #note{color:#ff6b78;font-size:13px;margin-top:16px;min-height:1em}
</style>
<script src="https://accounts.google.com/gsi/client" async defer></script>
</head><body>
<div class="card">
  <img src="assets/img/logo-stike.png" alt="Stike">
  <h1>Panel admin</h1>
  <p>Inicia sesión con una cuenta de Google autorizada.</p>
  <div id="g"></div>
  <div id="note"></div>
</div>
<script>
  const note = document.getElementById("note");
  const msgs = {
    not_authorized: "Esa cuenta no está autorizada para entrar al panel.",
    email_not_verified: "Esa cuenta de Google no tiene el correo verificado.",
    google_rejected: "Google no pudo verificar la sesión. Intenta de nuevo.",
  };
  async function onCredential(r) {
    note.textContent = "Verificando...";
    try {
      const res = await fetch("api/admin-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: r.credential }), credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { location.reload(); return; }
      note.textContent = msgs[data.error] || "No se pudo iniciar sesión.";
    } catch (e) { note.textContent = "Sin conexión. Intenta de nuevo."; }
  }
  (function wait(n) {
    if (window.google && google.accounts && google.accounts.id) {
      google.accounts.id.initialize({ client_id: "<?= $clientId ?>", callback: onCredential, ux_mode: "popup" });
      google.accounts.id.renderButton(document.getElementById("g"), { theme: "outline", size: "large", text: "signin_with", width: 280 });
    } else if (n > 0) setTimeout(() => wait(n - 1), 100);
    else note.textContent = "No se pudo cargar el inicio de sesión de Google. Revisa tu conexión.";
  })(80);
</script>
</body></html>
