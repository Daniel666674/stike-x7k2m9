/* =========================================================================
   STIKE BIKE SHOP: videos del INICIO (index.html), controlados desde el panel
   (admin > Contenido del sitio) por data/site-content.json:

     home.video      {type:"youtube", id}  |  {type:"mp4", src, poster?, w, h}
                     el recuadro grande de arriba (sin la clave: el de siempre,
                     el de YouTube que trae el HTML en data-yt-id)
     home.clipLeft   {src, poster?, w, h}  clip vertical, izquierda del titular
     home.clipRight  {src, poster?, w, h}  clip vertical, derecha del titular
                     (sin la clave: las fotos de siempre)

   Reglas de carga (para no frenar ni saturar el sitio):
   - La portada es una imagen. YouTube / el MP4 solo se piden cuando la pagina
     termino de cargar (arranque automatico, mudo) o cuando se toca play.
   - El arranque automatico NO corre con "menos movimiento", ahorro de datos,
     conexion 2G/3G, pestaña en segundo plano o el video fuera de la pantalla.
   - Los clips laterales solo se cargan en el lado que se ve (en celular se ven
     dos abajo; en escritorio, uno a cada lado) y con las mismas protecciones.

   En la vista previa del panel (?admin-preview=1) no se pide el manifiesto ni
   arranca nada solo: el panel llama a StikeHomeMedia.applyConfig(...) con lo
   guardado y lo que aun no se publica (incluidos archivos locales blob:).
   ========================================================================= */
(function (root) {
  "use strict";
  var doc = document;
  var PREVIEW = doc.documentElement.classList.contains("admin-preview");
  var SITE_FILE = /^assets\/video\/site\/[A-Za-z0-9._-]+\.(mp4|jpg)$/;
  var YT_ID = /^[A-Za-z0-9_-]{11}$/;
  var ytThumb = function (id) { return "https://img.youtube.com/vi/" + id + "/hqdefault.jpg"; };

  /* ---- validacion del manifiesto: el sitio solo acepta SUS archivos y IDs bien formados ---- */
  function okFile(path, allowBlob) {
    return typeof path === "string" && (SITE_FILE.test(path) || (allowBlob && /^blob:/.test(path)));
  }
  function cleanClip(c) {
    if (!c || typeof c !== "object" || !okFile(c.src, PREVIEW) || !/\.mp4$|^blob:/.test(c.src)) return null;
    return { src: c.src, poster: okFile(c.poster, PREVIEW) ? c.poster : "", w: +c.w || 0, h: +c.h || 0 };
  }
  function cleanVideo(v) {
    if (!v || typeof v !== "object") return null;
    if (v.type === "youtube") return YT_ID.test(v.id || "") ? { type: "youtube", id: v.id } : null;
    if (v.type === "mp4") { var c = cleanClip(v); return c ? { type: "mp4", src: c.src, poster: c.poster, w: c.w, h: c.h } : null; }
    return null;
  }
  function fromManifest(m) {
    m = m || {};
    return { video: cleanVideo(m["home.video"]), clipLeft: cleanClip(m["home.clipLeft"]), clipRight: cleanClip(m["home.clipRight"]) };
  }

  /* ---- cuando SI se puede arrancar solo ---- */
  function mayAutoStart() {
    var c = navigator.connection || {};
    var calm = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return !(calm || c.saveData || /^(slow-2g|2g|3g)$/.test(c.effectiveType || ""));
  }

  var feature = function () { return doc.querySelector('[data-video="feature"]'); };

  /* ======================= API de YouTube (se pide al arrancar, no antes) ======================= */
  var ytApiPromise = null;
  function loadYouTubeApi() {
    if (ytApiPromise) return ytApiPromise;
    ytApiPromise = new Promise(function (resolve, reject) {
      if (root.YT && root.YT.Player) { resolve(root.YT); return; }
      var prevReady = root.onYouTubeIframeAPIReady;
      root.onYouTubeIframeAPIReady = function () { if (prevReady) prevReady(); resolve(root.YT); };
      var tag = doc.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      tag.onerror = function () { reject(new Error("no cargo la API de YouTube")); };   // bloqueador de anuncios, red caida, politica de seguridad
      doc.head.appendChild(tag);
      setTimeout(function () { reject(new Error("la API de YouTube tardo demasiado")); }, 6000);   // si ya cargo, no hace nada
    });
    return ytApiPromise;
  }

  /* Piezas comunes: boton "Activar sonido", enlace de salida, reloj de temporizadores. */
  function makeSoundButton() {
    var b = doc.createElement("button");
    b.className = "rd-sound"; b.type = "button"; b.hidden = true;
    b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg><span>Activar sonido</span>';
    return b;
  }
  function captionText(slot) {
    var c = slot.querySelector("figcaption");
    return c ? c.textContent.replace(/\s+/g, " ").trim() : "";
  }

  /* ======================= Arranque de YouTube =======================
     Si la API no llega (o el reproductor no avisa que esta listo en 6 s) se usa el iframe simple de
     youtube-nocookie.com, que no necesita ningun script; y si ni eso carga, a los 7 s aparece un enlace para verlo en
     YouTube: nunca queda una caja negra sin salida. opts.auto = arranque solo al cargar la pagina: va MUDO (los
     navegadores no dejan otra), en bucle, con "Activar sonido"; si el navegador igual lo frena, a los 6 s se vuelve a
     la portada con su play. */
  function startYouTube(slot, auto) {
    var ID = slot.dataset.ytCurrent, TITLE = "Video: " + (captionText(slot) || "Stike");
    slot.classList.add("playing", "yt");
    var mount = doc.createElement("div");
    mount.id = "yt-feature-player";
    slot.insertBefore(mount, slot.firstChild);
    var link = doc.createElement("a");
    link.className = "rd-yt-link"; link.hidden = true; link.target = "_blank"; link.rel = "noopener";
    link.href = "https://www.youtube.com/watch?v=" + ID; link.textContent = "¿No carga? Verlo en YouTube ↗";
    slot.appendChild(link);
    var sound = makeSoundButton();
    if (auto) slot.appendChild(sound);
    var player = null, settled = false, apiReady = false, pausedByScroll = false, timers = [], io = null, dead = false;
    var later = function (fn, ms) { timers.push(setTimeout(fn, ms)); };
    var ready = function () { settled = true; apiReady = true; slot.classList.add("yt-ready"); link.hidden = true; };
    var plain = function () {
      if (settled || dead) return;
      settled = true;
      var f = doc.createElement("iframe");
      f.src = "https://www.youtube-nocookie.com/embed/" + ID + "?autoplay=1&rel=0&playsinline=1&modestbranding=1" + (auto ? "&mute=1&loop=1&playlist=" + ID : "");
      f.title = TITLE; f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen"; f.allowFullscreen = true;
      /* "load" salta aunque el navegador haya bloqueado el iframe (muestra su pagina de error), asi que solo quita el
         indicador de carga; el enlace de salida se queda disponible. */
      f.addEventListener("load", function () { slot.classList.add("yt-ready"); });
      var cur = slot.querySelector("#yt-feature-player");
      if (cur) cur.replaceWith(f); else slot.insertBefore(f, slot.firstChild);
    };
    var stop = function () {
      dead = true;
      timers.forEach(clearTimeout);
      if (io) io.disconnect();
      try { if (player && player.destroy) player.destroy(); } catch (e) {}
      player = null;
    };
    sound.addEventListener("click", function () { if (player) { player.unMute(); player.setVolume(100); } sound.hidden = true; });
    later(function () { if (!apiReady) link.hidden = false; }, 7000);
    loadYouTubeApi().then(function (YT) {
      if (dead) return;
      var forceHd = function (e) { e.target.setPlaybackQuality("hd1080"); };
      var vars = { autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1, vq: "hd1080" };
      if (auto) { vars.mute = 1; vars.loop = 1; vars.playlist = ID; }
      new YT.Player("yt-feature-player", {
        videoId: ID, width: "100%", height: "100%", playerVars: vars,
        events: {
          onReady: function (e) {
            if (settled || dead) return;
            player = e.target; ready(); forceHd(e);
            if (auto) e.target.mute();
            e.target.playVideo();
            if (auto) later(function () { if (!slot.classList.contains("yt-playing")) resetFeature(slot); }, 6000);   // el navegador no lo dejo arrancar
          },
          onStateChange: function (e) {
            if (e.data !== YT.PlayerState.PLAYING) return;
            forceHd(e);
            slot.classList.add("yt-playing");
            sound.hidden = !(auto && e.target.isMuted && e.target.isMuted());
          },
        },
      });
      later(function () { if (!settled) plain(); }, 6000);
    }).catch(plain);
    /* Mudo en segundo plano: si sale de la pantalla se pausa y al volver sigue. Con sonido activado no se toca. */
    if (auto && "IntersectionObserver" in root) {
      io = new IntersectionObserver(function (entries) {
        var en = entries[0];
        if (!player || !player.getPlayerState || !player.isMuted) return;
        if (en.intersectionRatio < 0.25) { if (player.isMuted() && player.getPlayerState() === 1) { player.pauseVideo(); pausedByScroll = true; } }
        else if (pausedByScroll) { pausedByScroll = false; player.playVideo(); }
      }, { threshold: [0, 0.25, 0.5] });
      io.observe(slot);
    }
    return { stop: stop };
  }

  /* ======================= Arranque del MP4 propio (mismas reglas que YouTube) ======================= */
  function startMp4(slot, auto) {
    slot.classList.add("playing", "yt");
    var img = slot.querySelector(":scope > img");
    var v = doc.createElement("video");
    v.className = "rd-video"; v.playsInline = true; v.setAttribute("playsinline", ""); v.preload = "metadata"; v.controls = true;
    v.setAttribute("aria-label", "Video: " + (captionText(slot) || "Stike"));
    if (img) v.poster = img.getAttribute("src");
    if (auto) { v.muted = true; v.loop = true; }
    slot.insertBefore(v, slot.firstChild);
    var sound = makeSoundButton();
    if (auto) slot.appendChild(sound);
    var timers = [], io = null, dead = false, pausedByScroll = false;
    var later = function (fn, ms) { timers.push(setTimeout(fn, ms)); };
    v.addEventListener("playing", function () { slot.classList.add("yt-ready", "yt-playing"); sound.hidden = !(auto && v.muted); });
    v.addEventListener("loadeddata", function () { slot.classList.add("yt-ready"); });
    v.addEventListener("volumechange", function () { if (!v.muted) sound.hidden = true; });
    v.addEventListener("error", function () { if (!dead) resetFeature(slot); });
    sound.addEventListener("click", function () { v.muted = false; v.volume = 1; sound.hidden = true; });
    v.src = slot.dataset.mp4;
    var p = v.play();
    if (p && p.catch) p.catch(function () { if (auto && !dead) resetFeature(slot); });
    if (auto) later(function () { if (!slot.classList.contains("yt-playing")) resetFeature(slot); }, 6000);   // el navegador no lo dejo arrancar
    if (auto && "IntersectionObserver" in root) {
      io = new IntersectionObserver(function (entries) {
        var en = entries[0];
        if (en.intersectionRatio < 0.25) { if (v.muted && !v.paused) { v.pause(); pausedByScroll = true; } }
        else if (pausedByScroll) { pausedByScroll = false; v.play().catch(function () {}); }
      }, { threshold: [0, 0.25, 0.5] });
      io.observe(slot);
    }
    return { stop: function () { dead = true; timers.forEach(clearTimeout); if (io) io.disconnect(); v.pause(); v.removeAttribute("src"); v.load(); } };
  }

  /* ======================= El recuadro grande (feature) ======================= */
  /* Vuelve a la portada con su boton de play, como si nada hubiera arrancado. */
  function resetFeature(slot) {
    if (slot._ctl) { slot._ctl.stop(); slot._ctl = null; }
    slot.querySelectorAll("#yt-feature-player, iframe, video.rd-video, .rd-yt-link, .rd-sound").forEach(function (n) { n.remove(); });
    slot.classList.remove("playing", "yt", "yt-ready", "yt-playing");
    delete slot.dataset.started;
  }
  function startFeature(slot, auto) {
    if (!slot || slot.dataset.started === "1") return;
    slot.dataset.started = "1";
    slot._ctl = slot.dataset.kind === "mp4" ? startMp4(slot, auto) : startYouTube(slot, auto);
  }
  /* Pone la portada, el tipo y los datos del video que toca mostrar. */
  function renderFeature(video) {
    var slot = feature();
    if (!slot) return;
    resetFeature(slot);
    var img = slot.querySelector(":scope > img");
    var play = slot.querySelector(".rd-play");
    var cap = captionText(slot);
    if (video && video.type === "mp4") {
      slot.dataset.kind = "mp4"; slot.dataset.mp4 = video.src;
      var ratio = video.w && video.h ? video.w / video.h : 16 / 9;
      slot.classList.toggle("contain", Math.abs(ratio - 16 / 9) > 0.2);       // si no es 16:9 se ve entero, con barras, no recortado
      img.src = video.poster || slot.dataset.fallbackPoster || img.src;
    } else {
      var id = (video && video.id) || slot.dataset.ytId;
      slot.dataset.kind = "youtube"; slot.dataset.ytCurrent = id; delete slot.dataset.mp4;
      slot.classList.remove("contain");
      img.src = ytThumb(id);
    }
    img.alt = "Video: " + cap;
    if (play) play.setAttribute("aria-label", "Ver video: " + cap);
  }

  /* El arranque automatico: espera a que la pagina termine de cargar y a un momento libre; solo con la pestaña
     visible y el video a la vista; y solo si la persona/la conexion lo permiten. */
  function autoStartFeature(slot) {
    if (!slot || PREVIEW || !mayAutoStart()) return;
    var begin = function () {
      if (slot.dataset.started === "1") return;                  // ya lo toco alguien
      if (doc.hidden) { doc.addEventListener("visibilitychange", begin, { once: true }); return; }
      if (!("IntersectionObserver" in root)) { startFeature(slot, true); return; }
      var io = new IntersectionObserver(function (entries) { if (entries[0].intersectionRatio >= 0.4) { io.disconnect(); startFeature(slot, true); } }, { threshold: [0.4] });
      io.observe(slot);
    };
    var idle = function (cb) { return root.requestIdleCallback ? root.requestIdleCallback(cb, { timeout: 2500 }) : setTimeout(cb, 600); };
    var go = function () { idle(begin); };
    if (doc.readyState === "complete") go(); else root.addEventListener("load", go, { once: true });
  }

  /* ======================= Clips laterales (mudos, en bucle) ======================= */
  var clips = { heroLeft: null, heroRight: null };
  function syncClips() {
    ["heroLeft", "heroRight"].forEach(function (name) {
      var clip = clips[name];
      doc.querySelectorAll('[data-video="' + name + '"]').forEach(function (slot) {
        var shown = slot.getClientRects().length > 0;             // el lado oculto (otro tamaño de pantalla) no carga nada
        var vid = slot.querySelector("video.rd-clip");
        var want = clip && shown && (PREVIEW || mayAutoStart());
        if (!want) {
          if (vid) { vid.pause(); vid.removeAttribute("src"); vid.load(); vid.remove(); }
          slot.classList.remove("has-clip");
          return;
        }
        if (vid && vid.getAttribute("data-src") === clip.src) return;
        if (vid) vid.remove();
        var img = slot.querySelector(":scope > img");
        var v = doc.createElement("video");
        v.className = "rd-clip"; v.setAttribute("data-src", clip.src);
        v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.preload = "metadata";
        v.setAttribute("aria-hidden", "true");
        if (clip.poster) v.poster = clip.poster; else if (img) v.poster = img.getAttribute("src");
        v.src = clip.src;
        slot.insertBefore(v, slot.firstChild);
        slot.classList.add("has-clip");
        var p = v.play(); if (p && p.catch) p.catch(function () {});
      });
    });
  }
  var resizeTimer = null;
  root.addEventListener("resize", function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(syncClips, 150); });

  /* ======================= API publica ======================= */
  function applyConfig(cfg) {
    cfg = cfg || {};
    renderFeature(cfg.video || null);
    clips.heroLeft = cfg.clipLeft || null;
    clips.heroRight = cfg.clipRight || null;
    syncClips();
  }
  function init() {
    var slot = feature();
    if (slot) {
      var play = slot.querySelector(".rd-play");
      if (play) play.addEventListener("click", function () { startFeature(slot, false); });
      if (!slot.dataset.fallbackPoster) slot.dataset.fallbackPoster = "assets/img/hero/bike-bl.jpg";
      if (!slot.dataset.kind) { slot.dataset.kind = "youtube"; slot.dataset.ytCurrent = slot.dataset.ytId; }   // el de siempre
    }
    if (PREVIEW) return;                                          // en la vista previa lo pone el panel
    (root.stikeLoadContent ? root.stikeLoadContent() : Promise.resolve({})).then(function (m) {
      var cfg = fromManifest(m);
      if (cfg.video || cfg.clipLeft || cfg.clipRight) applyConfig(cfg);
      autoStartFeature(feature());
    });
  }

  root.StikeHomeMedia = { init: init, applyConfig: applyConfig, fromManifest: fromManifest, ytThumb: ytThumb, _startFeature: startFeature };
})(typeof window !== "undefined" ? window : globalThis);
