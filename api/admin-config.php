<?php
/* =========================================================================
   STIKE BIKE SHOP: corregir desde el panel los secretos de Wompi que firman
   el cobro (secreto de INTEGRIDAD y, opcional, el de EVENTOS), sin editar
   archivos en el servidor.

   Por que existe: pegar mal el secreto de integridad en api/config.local.php
   (la llave privada en vez del secreto, un espacio de mas, el de eventos...)
   deja el pago caido con un error que el cliente no entiende. Aca se pega,
   se valida al instante y se guarda; el cobro empieza a firmar con el nuevo.

   Solo duenos y desarrolladores. Solo estos dos secretos: las llaves PUBLICA
   y PRIVADA no se cambian desde aca porque cambiarlas redirige el dinero a
   otra cuenta, asi que siguen viviendo solo en el servidor. Un secreto de
   integridad equivocado solo hace que el pago falle; no mueve dinero.

   POST { key, value }  -> guarda (value = el secreto)
   POST { key, clear: true } -> quita lo guardado aca y vuelve a lo del servidor

   Nunca devuelve el secreto: solo si quedo bien, el ambiente y las ultimas 4
   letras para compararlas a ojo con el panel de Wompi.
   ========================================================================= */
require __DIR__ . "/_admin.php";

stike_run(function () {
  stike_require_method("POST");
  stike_admin_check_origin();
  $s = stike_admin_require();
  if (!in_array($s["role"], ["owner", "developer"], true)) throw new ApiError(403, "forbidden");

  $body = stike_json_body();
  $key = $body["key"] ?? null;
  $rules = [
    "WOMPI_INTEGRITY_SECRET" => ['/^(test|prod)_integrity_[A-Za-z0-9_-]{8,}$/', "el SECRETO DE INTEGRIDAD (empieza por test_integrity_ o prod_integrity_)"],
    "WOMPI_EVENTS_SECRET" => ['/^(test|prod)_events_[A-Za-z0-9_-]{8,}$/', "el secreto de EVENTOS (empieza por test_events_ o prod_events_)"],
  ];
  if (!is_string($key) || !isset($rules[$key])) throw new ApiError(400, "invalid_key");

  $all = stike_runtime_config_all();

  if (!empty($body["clear"])) {
    unset($all[$key]);
    stike_runtime_config_write($all);
    error_log("[stike] $key: se quito lo guardado desde el panel (" . $s["email"] . ")");
    respond(200, ["ok" => true, "cleared" => true, "key" => $key]);
  }

  $value = stike_wompi_clean($body["value"] ?? "");
  if (!is_string($value) || $value === "") throw new ApiError(400, "empty_value", "Pega el valor completo del secreto.");
  if (!preg_match($rules[$key][0], $value, $m)) {
    throw new ApiError(400, "wrong_kind", "Eso no es " . $rules[$key][1] . "; lo que pegaste parece " . stike_wompi_kind($value) . ". En Wompi: Desarrolladores > Secretos para integración técnica.");
  }
  $env = $m[1];

  /* Tiene que ser del mismo ambiente que la llave publica (sandbox con sandbox, produccion con produccion). */
  $pub = stike_wompi_clean(stike_config("WOMPI_PUBLIC_KEY"));
  if (is_string($pub) && preg_match('/^pub_(test|prod)_/', $pub, $pm) && $pm[1] !== $env) {
    throw new ApiError(400, "wrong_environment", "La llave pública del servidor es de " . ($pm[1] === "prod" ? "PRODUCCIÓN" : "SANDBOX (pruebas)") . " pero este secreto es de " . ($env === "prod" ? "PRODUCCIÓN" : "SANDBOX (pruebas)") . ". Copia el de la misma pestaña (Sandbox o Producción) de Wompi.");
  }

  $all[$key] = ["value" => $value, "by" => $s["email"], "at" => stike_now_iso()];
  stike_runtime_config_write($all);
  error_log("[stike] $key guardado desde el panel por " . $s["email"] . " (ambiente $env, " . strlen($value) . " caracteres)");
  respond(200, ["ok" => true, "key" => $key, "environment" => $env, "length" => strlen($value), "tail" => substr($value, -4)]);
});

/* Escritura atomica, solo para el dueño del proceso (0600), en la carpeta de datos (fuera del sitio). */
function stike_runtime_config_write($data) {
  $path = stike_runtime_config_path();
  $tmp = $path . "." . bin2hex(random_bytes(4)) . ".tmp";
  $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  if (@file_put_contents($tmp, $json) === false) { @unlink($tmp); throw new ApiError(500, "storage_unavailable", "no se pudo guardar"); }
  @chmod($tmp, 0600);
  if (!@rename($tmp, $path)) { @unlink($tmp); throw new ApiError(500, "storage_unavailable", "no se pudo guardar"); }
}
