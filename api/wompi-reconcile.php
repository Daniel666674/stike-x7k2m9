<?php
/* =========================================================================
   STIKE BIKE SHOP: «Buscar pagos sin registrar» (boton del panel, Configuracion).

   Si un cliente pago y su venta no aparece (la pagina de resultado no pudo
   confirmar y el aviso de Wompi tampoco llego o fallo), esto recorre los
   pedidos guardados al firmar, le pregunta a Wompi por cada uno y registra
   los que Wompi tiene APROBADOS: venta en el panel, correo al dueno y stock.
   Es seguro repetirlo: una venta ya registrada no se duplica.

   POST, solo con sesion del panel (roles que ven finanzas).
   ========================================================================= */
require __DIR__ . "/_admin.php";

stike_run(function () {
  stike_require_method("POST");
  stike_admin_check_origin();
  $s = stike_admin_require();
  if (!stike_admin_sees_finance($s["role"])) throw new ApiError(403, "forbidden");
  $r = stike_reconcile_pending(25, true);
  respond(200, ["ok" => true] + $r);
});
