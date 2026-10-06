/* =========================================================================
   STIKE BIKE SHOP: cobro con Wompi (Checkout Web, redireccion GET a
   checkout.wompi.co/p/).

   Como funciona:
     1. Generamos una referencia unica para el pedido y el monto en
        centavos (COP no tiene centavos reales, pero la API de Wompi los
        pide igual: monto * 100).
     2. Le pedimos la firma de integridad a WOMPI_SIGN_ENDPOINT -- un
        backend que conoce el secreto de integridad. Este archivo NUNCA
        toca ese secreto; si lo hiciera, cualquiera podria leerlo con
        "ver codigo fuente" y firmar lo que quisiera.
     3. Con la firma en mano, armamos un <form method="GET"> y lo mandamos
        a Wompi. Wompi se encarga del resto (tarjeta, PSE, Nequi...) y al
        terminar manda al cliente de vuelta a redirect-url con el id de la
        transaccion.

   WOMPI_SIGN_ENDPOINT hoy NO existe en produccion (el sitio vive en
   GitHub Pages, que no corre PHP) -- api/wompi-sign.php esta listo para
   subirse a Hostinger en la migracion. Hasta que eso pase, este modulo se
   deja cargado pero sin enganchar al boton "Pagar ahora" en vivo (ver
   carrito.html): se probo contra el sandbox real de Wompi corriendo el
   backend localmente (tools/wompi-sign.mjs + un server de prueba).
   ========================================================================= */
(function (root) {
  "use strict";

  const WOMPI_PUBLIC_KEY = "pub_test_nF4Pq5VzI7bxkazitsOzrZ6R8vCrgdhE";
  const WOMPI_CURRENCY = "COP";
  const WOMPI_CHECKOUT_URL = "https://checkout.wompi.co/p/";

  /* Se pisa en pruebas locales (ver tools/wompi-dev-server.mjs). En
     produccion, una vez exista Hostinger, pasa a "/api/wompi-sign.php". */
  const WOMPI_SIGN_ENDPOINT = (root.STIKE_WOMPI_SIGN_ENDPOINT) || "/api/wompi-sign.php";

  function wompiReference() {
    const rand = Math.random().toString(36).slice(2, 8);
    return `stike-${Date.now()}-${rand}`;
  }

  function wompiRedirectUrl() {
    return new URL("pago-resultado.html", document.baseURI).href;
  }

  /* totalPesos: numero en pesos colombianos (no centavos). customerEmail
     es opcional, Wompi lo usa para prellenar el checkout. */
  async function stikeWompiCheckout(totalPesos, customerEmail) {
    const reference = wompiReference();
    const amountInCents = Math.round(totalPesos * 100);

    const res = await fetch(WOMPI_SIGN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference, amount_in_cents: amountInCents, currency: WOMPI_CURRENCY }),
    });
    if (!res.ok) {
      throw new Error(`wompi-sign respondio ${res.status}`);
    }
    const data = await res.json();
    if (!data.signature) {
      throw new Error("wompi-sign no devolvio firma");
    }

    const fields = {
      "public-key": WOMPI_PUBLIC_KEY,
      currency: WOMPI_CURRENCY,
      "amount-in-cents": String(amountInCents),
      reference,
      "signature:integrity": data.signature,
      "redirect-url": wompiRedirectUrl(),
    };
    if (customerEmail) fields["customer-data:email"] = customerEmail;

    const form = document.createElement("form");
    form.method = "GET";
    form.action = WOMPI_CHECKOUT_URL;
    form.style.display = "none";
    for (const [name, value] of Object.entries(fields)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  }

  root.stikeWompiCheckout = stikeWompiCheckout;
})(typeof window !== "undefined" ? window : globalThis);
