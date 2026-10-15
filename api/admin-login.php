<?php
/* POST {"credential": "<ID token de Google>"} -> cookie de sesion del panel.
   DELETE -> cierra la sesion. GET -> {email, role} de la sesion actual o 401. */
require __DIR__ . "/_admin.php";

stike_run(function () {
  $method = $_SERVER["REQUEST_METHOD"] ?? "";
  if ($method === "GET") {
    respond(200, stike_admin_require());
  }
  if ($method === "DELETE") {
    stike_admin_check_origin();
    stike_admin_clear();
    respond(200, ["ok" => true]);
  }
  stike_require_method("POST");
  stike_admin_check_origin();
  $body = stike_json_body();
  $email = stike_verify_google_credential($body["credential"] ?? null);
  $role = stike_admin_role($email);
  if (!$role) {
    usleep(400000);
    throw new ApiError(403, "not_authorized", $email);
  }
  stike_admin_issue($email, $role);
  respond(200, ["email" => $email, "role" => $role]);
});
