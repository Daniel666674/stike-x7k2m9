/* =========================================================================
   STIKE BIKE SHOP: cobro con Wompi, embebido en la pagina (Widget) con
   caida automatica al Checkout Web por redireccion si el widget no carga.

   Como funciona (ruta normal, Widget):
     1. Generamos una referencia unica para el pedido y el monto en
        centavos (COP no tiene centavos reales, pero la API de Wompi los
        pide igual: monto * 100).
     2. Le pedimos la firma de integridad a WOMPI_SIGN_ENDPOINT -- un
        backend que conoce el secreto de integridad. Este archivo NUNCA
        toca ese secreto; si lo hiciera, cualquiera podria leerlo con
        "ver codigo fuente" y firmar lo que quisiera.
     3. Cargamos checkout.wompi.co/widget.js y abrimos el modal del
        widget con esos datos. El cliente mete tarjeta/PSE/Nequi AHI
        MISMO, sin salir de stike-x7k2m9 -- antes esto era una
        redireccion de pagina completa a checkout.wompi.co.
     4. Al terminar, Wompi manda el navegador a redirectUrl con el id de
        la transaccion (igual que la version anterior por redireccion),
        asi que pago-resultado.html sigue siendo quien confirma el pago,
        registra la venta y avisa por WhatsApp -- eso no cambia nada.
        Por si el redirect automatico fallara, el callback de open()
        hace el mismo redirect a mano como red de seguridad.

   Si el widget.js no llega a cargar (bloqueador de contenido, red rara),
   stikeWompiCheckout cae sola a la version anterior: un <form GET> que
   manda derecho a checkout.wompi.co/p/. Mismo backend de firma para las
   dos rutas, nada que duplicar ahi.
   ========================================================================= */
(function (root) {
  "use strict";

  const WOMPI_PUBLIC_KEY = "pub_test_nF4Pq5VzI7bxkazitsOzrZ6R8vCrgdhE";
  const WOMPI_CURRENCY = "COP";
  const WOMPI_WIDGET_SRC = "https://checkout.wompi.co/widget.js";
  const WOMPI_CHECKOUT_URL = "https://checkout.wompi.co/p/";

  /* Backend temporal en Vercel mientras se prueba el flujo completo en el
     dominio real (GitHub Pages no corre PHP). Se pisa con
     window.STIKE_WOMPI_SIGN_ENDPOINT en pruebas locales (ver
     tools/wompi-dev-server.mjs). Cuando exista Hostinger, esto pasa a
     "/api/wompi-sign.php" y este backend temporal se borra. */
  const WOMPI_SIGN_ENDPOINT = (root.STIKE_WOMPI_SIGN_ENDPOINT) || "https://stike-wompi-api.vercel.app/api/wompi-sign";

  function wompiReference() {
    const rand = Math.random().toString(36).slice(2, 8);
    return `stike-${Date.now()}-${rand}`;
  }

  function wompiRedirectUrl() {
    return new URL("pago-resultado.html", document.baseURI).href;
  }

  async function signTransaction(reference, amountInCents) {
    const res = await fetch(WOMPI_SIGN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference, amount_in_cents: amountInCents, currency: WOMPI_CURRENCY }),
    });
    if (!res.ok) throw new Error(`wompi-sign respondio ${res.status}`);
    const data = await res.json();
    if (!data.signature) throw new Error("wompi-sign no devolvio firma");
    return data.signature;
  }

  /* <form method="GET"> clasico a checkout.wompi.co/p/ -- la ruta de
     siempre, usada solo como red de seguridad si el widget no carga. */
  function redirectCheckout(reference, amountInCents, signature, customerEmail) {
    const fields = {
      "public-key": WOMPI_PUBLIC_KEY,
      currency: WOMPI_CURRENCY,
      "amount-in-cents": String(amountInCents),
      reference,
      "signature:integrity": signature,
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

  let widgetScriptPromise = null;
  function loadWompiWidget() {
    if (widgetScriptPromise) return widgetScriptPromise;
    widgetScriptPromise = new Promise((resolve, reject) => {
      if (root.WidgetCheckout) { resolve(); return; }
      const tag = document.createElement("script");
      tag.src = WOMPI_WIDGET_SRC;
      tag.onload = () => (root.WidgetCheckout ? resolve() : reject(new Error("widget.js cargo pero no definio WidgetCheckout")));
      tag.onerror = () => reject(new Error("No se pudo cargar checkout.wompi.co/widget.js"));
      document.head.appendChild(tag);
    });
    return widgetScriptPromise;
  }

  /* totalPesos: numero en pesos colombianos (no centavos). customerEmail
     es opcional, Wompi lo usa para prellenar el checkout. */
  async function stikeWompiCheckout(totalPesos, customerEmail) {
    const reference = wompiReference();
    const amountInCents = Math.round(totalPesos * 100);
    const signature = await signTransaction(reference, amountInCents);

    try {
      await loadWompiWidget();
    } catch (err) {
      console.warn("Wompi widget no disponible, usando redireccion:", err);
      redirectCheckout(reference, amountInCents, signature, customerEmail);
      return;
    }

    const checkoutConfig = {
      currency: WOMPI_CURRENCY,
      amountInCents,
      reference,
      publicKey: WOMPI_PUBLIC_KEY,
      signature: { integrity: signature },
      redirectUrl: wompiRedirectUrl(),
    };
    if (customerEmail) checkoutConfig.customerData = { email: customerEmail };

    const checkout = new root.WidgetCheckout(checkoutConfig);
    checkout.open(result => {
      /* Wompi deberia redirigir solo (redirectUrl); esto es solo una red
         de seguridad por si ese redirect automatico no se dispara. */
      const txn = result && result.transaction;
      if (txn && txn.id) {
        location.href = `${wompiRedirectUrl()}?id=${encodeURIComponent(txn.id)}`;
      }
    });
  }

  root.stikeWompiCheckout = stikeWompiCheckout;
})(typeof window !== "undefined" ? window : globalThis);
