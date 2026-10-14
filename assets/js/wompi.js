/* =========================================================================
   STIKE BIKE SHOP: cobro con Wompi, embebido en la pagina (Widget) con
   caida automatica al Checkout Web por redireccion si el widget no carga.

   Como funciona (ruta normal, Widget):
     1. Generamos una referencia unica para el pedido.
     2. Le mandamos a WOMPI_API.sign los productos (slug + cantidad),
        NUNCA un monto. El backend calcula el total con los precios del
        catalogo y devuelve el monto en centavos (COP no tiene centavos
        reales, pero la API de Wompi los pide igual: monto * 100) junto
        con la firma de integridad. Este archivo NUNCA toca el secreto; si
        lo hiciera, cualquiera podria leerlo con "ver codigo fuente" y
        firmar lo que quisiera. Si el total del servidor no es el que el
        cliente vio en el carrito, se frena aca, antes de abrir Wompi.
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

  /* A donde se le pide la firma, el estado y el registro de la venta.
     - En stikebikeshop.com (Hostinger) es el PHP del mismo sitio: /api/...
       (el .htaccess traduce /api/wompi-sign a api/wompi-sign.php).
     - En cualquier otro lado (la demo en GitHub Pages, que no corre PHP) es
       el backend temporal en Vercel. Se borra cuando el sitio viva solo en
       Hostinger.
     Cada ruta se puede pisar con window.STIKE_WOMPI_{SIGN,STATUS,ORDER}_ENDPOINT
     (pruebas locales, ver tools/wompi-dev-server.mjs). */
  const OWN_DOMAIN = typeof location !== "undefined" && /(^|\.)stikebikeshop\.com$/.test(location.hostname);
  const API_BASE = OWN_DOMAIN ? new URL("api/", document.baseURI).href : "https://stike-wompi-api.vercel.app/api/";
  const WOMPI_API = {
    sign: root.STIKE_WOMPI_SIGN_ENDPOINT || API_BASE + "wompi-sign",
    status: root.STIKE_WOMPI_STATUS_ENDPOINT || API_BASE + "wompi-status",
    order: root.STIKE_WOMPI_ORDER_ENDPOINT || API_BASE + "wompi-order",
  };
  root.STIKE_WOMPI_API = WOMPI_API;   // pago-resultado.html usa status y order

  function wompiReference() {
    const rand = Math.random().toString(36).slice(2, 8);
    return `stike-${Date.now()}-${rand}`;
  }

  function wompiRedirectUrl() {
    return new URL("pago-resultado.html", document.baseURI).href;
  }

  async function signTransaction(reference, items, shipping, customerEmail) {
    const res = await fetch(WOMPI_API.sign, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference, items, shipping: shipping || null, customerEmail: customerEmail || null }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`wompi-sign respondio ${res.status}: ${(data && data.error) || "sin detalle"}`);
    if (!data || !data.signature || !data.amount_in_cents) throw new Error("wompi-sign no devolvio firma o monto");
    return data;
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

  /* items: [{ slug, qty, size?, color? }], las filas del carrito.
     expectedTotalPesos: el total (en pesos, no centavos) que el cliente ve
     en pantalla; si el servidor calcula otro, se lanza un error con
     code "price_mismatch" y NO se abre Wompi.
     opts.shipping (nombre, telefono, direccion, ciudad, notas): se guarda en
     el servidor junto con el pedido, para que la venta quede completa aunque
     el cliente pague y cierre la pestana. opts.customerEmail es opcional,
     Wompi lo usa para prellenar el checkout. */
  async function stikeWompiCheckout(items, expectedTotalPesos, opts) {
    const { shipping, customerEmail } = opts || {};
    const reference = wompiReference();
    const signed = await signTransaction(
      reference,
      items.map(r => ({ slug: r.slug, qty: r.qty, size: r.size || null, color: r.color || null })),
      shipping, customerEmail
    );
    const amountInCents = signed.amount_in_cents;
    const signature = signed.signature;

    if (expectedTotalPesos != null && amountInCents !== Math.round(expectedTotalPesos * 100)) {
      const err = new Error(`El total del servidor (${amountInCents / 100}) no coincide con el del carrito (${expectedTotalPesos})`);
      err.code = "price_mismatch";
      throw err;
    }

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
