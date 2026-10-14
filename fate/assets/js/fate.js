/* =========================================================================
   FATE BMX COLOMBIA: comportamiento minimo
   Sin librerias ni dependencias del resto del sitio. Si este archivo no
   carga, la pagina sigue funcionando: los enlaces y el contenido no dependen
   de el (el menu movil solo se abre con JS, y el escritorio no lo necesita).
   ========================================================================= */
(function () {
  "use strict";

  var header = document.querySelector(".site-header");
  var btn = document.querySelector(".menu-btn");
  var menu = document.getElementById("menu");
  var menuOpen = false;

  /* ---- Menu movil ------------------------------------------------------ */
  function setMenu(open, restoreFocus) {
    if (!btn || !menu) return;
    menuOpen = open;
    menu.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", String(open));
    btn.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
    document.body.classList.toggle("menu-open", open);
    if (open) {
      header.classList.remove("is-hidden");
      var first = menu.querySelector("a");
      if (first) first.focus({ preventScroll: true });
    } else if (restoreFocus) {
      btn.focus({ preventScroll: true });
    }
  }

  if (btn && menu) {
    btn.addEventListener("click", function () { setMenu(!menuOpen, true); });
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) setMenu(false, false);
    });
    document.addEventListener("keydown", function (e) {
      if (!menuOpen) return;
      if (e.key === "Escape") { setMenu(false, true); return; }
      if (e.key !== "Tab") return;
      // Foco atrapado: boton del header + enlaces del menu.
      var f = [btn].concat([].slice.call(menu.querySelectorAll("a")));
      var i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { f[f.length - 1].focus(); e.preventDefault(); }
      else if (!e.shiftKey && i === f.length - 1) { f[0].focus(); e.preventDefault(); }
    });
    window.addEventListener("resize", function () {
      if (menuOpen && window.innerWidth > 860) setMenu(false, false);
    });
  }

  /* ---- Header: filete al hacer scroll, se esconde al bajar ------------- */
  if (header) {
    var lastY = window.scrollY, ticking = false;
    var onScroll = function () {
      var y = window.scrollY;
      header.classList.toggle("is-scrolled", y > 8);
      if (!menuOpen && Math.abs(y - lastY) > 6) {
        if (y > lastY && y > 260) header.classList.add("is-hidden");
        else if (y < lastY) header.classList.remove("is-hidden");
        lastY = y;
      }
      ticking = false;
    };
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
    }, { passive: true });
    onScroll();
  }

  /* ---- Aparicion suave al entrar en pantalla --------------------------- */
  var items = [].slice.call(document.querySelectorAll("[data-reveal]"));
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!items.length) return;
  if (reduce || !("IntersectionObserver" in window)) {
    items.forEach(function (el) { el.classList.add("in"); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });
  items.forEach(function (el) { io.observe(el); });
})();
