/* =========================================================================
   STIKE BIKE SHOP: revision de videos de producto (sin decodificarlos).

   Lee el CONTENEDOR del MP4 (las "cajas": ftyp, moov, trak, stsd, stts...)
   y de ahi saca lo que importa para que el video no sature ni frene el
   sitio: peso, duracion, tamaño, cuadros por segundo, codec, perfil de
   H.264, si tiene audio y si el indice (moov) esta al inicio del archivo
   para empezar a reproducir sin bajarlo entero ("Fast Start").

   Por que no se usa <video> para revisar: un navegador solo puede decir lo
   que logra decodificar, y varios (Firefox en Linux, navegadores embebidos)
   no abren un H.264 perfectamente bueno. Leer las cajas funciona igual en
   todos, y es la misma logica en el panel (navegador) y en las pruebas
   (Node): doble export, como pdp-render.js.

     StikeVideo.inspect(bytes)        -> {ok, ...datos} | {ok:false, error}
     StikeVideo.check(info, fileSize) -> {errors[], warnings[], notes[]}
   ========================================================================= */
(function (root) {
  "use strict";

  /* Los limites. Estan juntos y con su razon: si cambian, cambia el panel,
     la tarjeta de requisitos y las pruebas, todo desde aca. */
  var RULES = {
    maxBytes: 10 * 1024 * 1024,   // tope duro: GitHub, el hosting y el celular del cliente
    niceBytes: 5 * 1024 * 1024,   // lo ideal: se baja casi al instante con datos moviles
    minSec: 2, maxSec: 30,        // un video de producto muestra, no cuenta una historia
    maxShort: 720, maxLong: 1280, // 720p; en vertical 720x1280
    minShort: 360,                // por debajo se ve borroso en cualquier pantalla
    maxFps: 30.5,                 // 60 fps duplica el peso sin que se note en un producto
    maxMbps: 3.2,                 // video + audio juntos
    maxPerProduct: 2,
    softMaxVideos: 100,           // recomendacion para TODA la tienda (viven en el repo y viajan en cada despliegue)
    softMaxBytes: 400 * 1024 * 1024,
    maxReadBytes: 64 * 1024 * 1024, // por encima ni se abre: ya fallo por peso
    profiles: [66, 77, 100],      // Baseline, Main, High: los que abre cualquier celular
  };

  function fourcc(dv, o) {
    return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  }
  function u64(dv, o) { return dv.getUint32(o) * 4294967296 + dv.getUint32(o + 4); }

  /* Cajas hijas entre [start, end). Una caja cortada (archivo incompleto) se
     marca y se recorta al final disponible en vez de lanzar. */
  function boxes(dv, start, end) {
    var out = [], o = start;
    while (o + 8 <= end) {
      var size = dv.getUint32(o), type = fourcc(dv, o + 4), head = 8;
      if (size === 1) {
        if (o + 16 > end) break;
        size = u64(dv, o + 8); head = 16;
      } else if (size === 0) size = end - o;
      if (size < head) break;
      var cut = o + size > end;
      out.push({ type: type, start: o, head: head, content: o + head, end: cut ? end : o + size, truncated: cut });
      if (cut) break;
      o += size;
    }
    return out;
  }
  function find(list, type) { for (var i = 0; i < list.length; i++) if (list[i].type === type) return list[i]; return null; }
  function children(dv, box) { return boxes(dv, box.content, box.end); }

  function parseMvhd(dv, b) {
    var v = dv.getUint8(b.content);
    var o = b.content + 4;
    if (v === 1) return { timescale: dv.getUint32(o + 16), duration: u64(dv, o + 20) };
    return { timescale: dv.getUint32(o + 8), duration: dv.getUint32(o + 12) };
  }
  function parseTkhd(dv, b) {
    var v = dv.getUint8(b.content);
    var m = b.content + (v === 1 ? 52 : 40);            // inicio de la matriz de giro
    var a = dv.getInt32(m), bb = dv.getInt32(m + 4), c = dv.getInt32(m + 12), d = dv.getInt32(m + 16);
    return {
      w: dv.getUint32(m + 36) / 65536, h: dv.getUint32(m + 40) / 65536,
      rotated: a === 0 && d === 0 && bb !== 0 && c !== 0,   // video grabado en vertical: 90 o 270 grados
    };
  }
  function parseMdhd(dv, b) {
    var v = dv.getUint8(b.content);
    var o = b.content + 4;
    if (v === 1) return { timescale: dv.getUint32(o + 16), duration: u64(dv, o + 20) };
    return { timescale: dv.getUint32(o + 8), duration: dv.getUint32(o + 12) };
  }
  function parseStts(dv, b) {
    var n = dv.getUint32(b.content + 4), o = b.content + 8, samples = 0, ticks = 0;
    for (var i = 0; i < n && o + 8 <= b.end; i++, o += 8) {
      var c = dv.getUint32(o), delta = dv.getUint32(o + 4);
      samples += c; ticks += c * delta;
    }
    return { samples: samples, ticks: ticks };
  }
  /* stsd: primera entrada de muestra. De ahi sale el codec (avc1 = H.264) y,
     si es H.264, el perfil que declara su avcC. */
  function parseStsd(dv, b, handler) {
    var entryStart = b.content + 8;
    if (entryStart + 8 > b.end) return {};
    var entrySize = dv.getUint32(entryStart), codec = fourcc(dv, entryStart + 4);
    var entryEnd = Math.min(b.end, entryStart + entrySize);
    var out = { codec: codec };
    if (handler === "vide" && (codec === "avc1" || codec === "avc3")) {
      var kids = boxes(dv, entryStart + 8 + 78, entryEnd);        // 78 = cabecera fija de una entrada de video
      var avcC = find(kids, "avcC");
      if (avcC && avcC.content + 4 <= avcC.end) { out.profile = dv.getUint8(avcC.content + 1); out.level = dv.getUint8(avcC.content + 3); }
    }
    return out;
  }

  function inspect(input) {
    var u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var top;
    try { top = boxes(dv, 0, u8.byteLength); } catch (e) { return { ok: false, error: "unreadable" }; }
    var ftyp = find(top, "ftyp"), moov = find(top, "moov"), mdat = find(top, "mdat");
    if (!ftyp || !moov) return { ok: false, error: "not_mp4" };
    if (moov.truncated || (mdat && mdat.truncated)) return { ok: false, error: "truncated" };   // copia interrumpida: el indice esta pero faltan datos

    var info = {
      ok: true,
      brand: fourcc(dv, ftyp.content),
      faststart: !mdat || moov.start < mdat.start,       // el indice va ANTES de los datos
      fragmented: !!find(top, "moof"),
      video: null, audio: null, duration: 0,
    };
    try {
      var mv = find(children(dv, moov), "mvhd");
      if (mv) { var h = parseMvhd(dv, mv); info.duration = h.timescale ? h.duration / h.timescale : 0; }
      children(dv, moov).filter(function (b) { return b.type === "trak"; }).forEach(function (trak) {
        var tk = children(dv, trak);
        var tkhd = find(tk, "tkhd"), mdia = find(tk, "mdia");
        if (!mdia) return;
        var md = children(dv, mdia);
        var hdlr = find(md, "hdlr"), mdhd = find(md, "mdhd"), minf = find(md, "minf");
        if (!hdlr || !minf) return;
        var handler = fourcc(dv, hdlr.content + 8);
        var stbl = find(children(dv, minf), "stbl");
        if (!stbl) return;
        var st = children(dv, stbl);
        var stsd = find(st, "stsd"), stts = find(st, "stts");
        var desc = stsd ? parseStsd(dv, stsd, handler) : {};
        if (handler === "vide" && !info.video) {
          var dims = tkhd ? parseTkhd(dv, tkhd) : { w: 0, h: 0, rotated: false };
          var ts = mdhd ? parseMdhd(dv, mdhd) : { timescale: 0, duration: 0 };
          var s = stts ? parseStts(dv, stts) : { samples: 0, ticks: 0 };
          var secs = ts.timescale ? (s.ticks || ts.duration) / ts.timescale : 0;
          info.video = {
            codec: desc.codec || "", profile: desc.profile || 0, level: desc.level || 0,
            w: Math.round(dims.rotated ? dims.h : dims.w), h: Math.round(dims.rotated ? dims.w : dims.h),
            rotated: dims.rotated,
            fps: secs > 0 && s.samples ? s.samples / secs : 0,
            frames: s.samples,
          };
          if (!info.duration && secs) info.duration = secs;
        } else if (handler === "soun" && !info.audio) {
          info.audio = { codec: desc.codec || "" };
        }
      });
    } catch (e) { return { ok: false, error: "unreadable" }; }
    if (!info.video) return { ok: false, error: "no_video" };
    return info;
  }

  function mb(n) { return (n / 1048576).toFixed(1).replace(".", ",") + " MB"; }
  function codecName(c) {
    return ({ hvc1: "HEVC (H.265)", hev1: "HEVC (H.265)", vp09: "VP9", av01: "AV1", mp4v: "MPEG-4" })[c] || c || "desconocido";
  }

  /* Cada error dice QUE pasa y COMO se arregla: quien sube el video no tiene
     por que saber que es un codec. */
  function check(info, fileSize) {
    var errors = [], warnings = [], notes = [];
    var size = fileSize || 0;
    if (size > RULES.maxBytes) {
      errors.push("Pesa " + mb(size) + " y el máximo es " + mb(RULES.maxBytes).replace(",0", "") + ". Recórtalo o bájale la calidad (ver «Cómo preparar el video»).");
    }
    if (!info) return { errors: errors, warnings: warnings, notes: notes };   // solo se reviso el peso (archivo demasiado grande para abrirlo)
    if (!info.ok) {
      errors.push({
        not_mp4: "Este archivo no es un MP4 válido. Expórtalo como MP4 (H.264).",
        truncated: "El archivo está incompleto o dañado. Vuelve a exportarlo y a copiarlo.",
        no_video: "El archivo no trae imagen de video.",
        unreadable: "No se pudo leer el archivo. Exporta de nuevo como MP4 (H.264).",
      }[info.error] || "No se pudo leer el archivo como MP4.");
      return { errors: errors, warnings: warnings, notes: notes };
    }
    var v = info.video;
    if (info.brand === "qt  ") errors.push("Es un video de QuickTime (.mov), típico de iPhone y Mac. Expórtalo o conviértelo a MP4.");
    if (info.fragmented) {
      /* Sin moov completo no hay duracion ni fps confiables: el resto de reglas diria disparates. */
      errors.push("Es un MP4 «fragmentado» (streaming). Expórtalo como MP4 normal.");
      return { errors: errors, warnings: warnings, notes: notes };
    }

    if (v.codec !== "avc1" && v.codec !== "avc3") {
      errors.push("El video está en " + codecName(v.codec) + " y tiene que ser H.264. En iPhone: Ajustes › Cámara › Formatos › «Más compatible» antes de grabar, o conviértelo (ver «Cómo preparar el video»).");
    } else if (v.profile && RULES.profiles.indexOf(v.profile) < 0) {
      errors.push("El perfil de H.264 (" + v.profile + ") no se abre en todos los celulares. Usa el perfil «High» o «Main» con color de 8 bits.");
    }

    var short = Math.min(v.w, v.h), long = Math.max(v.w, v.h);
    if (short > RULES.maxShort || long > RULES.maxLong) {
      errors.push("Es demasiado grande (" + v.w + "×" + v.h + "). Máximo " + RULES.maxLong + "×" + RULES.maxShort + " (en vertical " + RULES.maxShort + "×" + RULES.maxLong + "). Más resolución solo hace que pese más.");
    } else if (short < RULES.minShort) {
      warnings.push("Es pequeño (" + v.w + "×" + v.h + ") y se va a ver borroso. Lo ideal es 720p.");
    }

    if (info.duration < RULES.minSec) errors.push("Dura " + info.duration.toFixed(1).replace(".", ",") + " s; mínimo " + RULES.minSec + " s.");
    else if (info.duration > RULES.maxSec) errors.push("Dura " + Math.round(info.duration) + " s y el máximo es " + RULES.maxSec + " s. Recórtalo: muestra el producto, no cuentes la historia.");

    if (v.fps > RULES.maxFps) errors.push("Va a " + Math.round(v.fps) + " cuadros por segundo; el máximo es 30. A 60 fps pesa el doble y en un producto no se nota.");

    if (info.duration > 0 && size > 0) {
      var mbps = size * 8 / info.duration / 1e6;
      if (mbps > RULES.maxMbps && size <= RULES.maxBytes) errors.push("Tiene demasiada tasa de datos (" + mbps.toFixed(1).replace(".", ",") + " Mbps; máximo " + String(RULES.maxMbps).replace(".", ",") + "). Bájale la calidad al exportar.");
    }

    if (!info.faststart) errors.push("Le falta «Fast Start»: el índice del archivo está al final y el navegador tendría que bajarlo entero antes de reproducir. Actívalo al exportar (en HandBrake: «Web optimizado»).");

    if (info.audio) {
      if (info.audio.codec !== "mp4a") errors.push("El audio está en formato «" + info.audio.codec + "» y tiene que ser AAC.");
      else notes.push("Tiene sonido. Está bien, pero si no hace falta quítalo: pesa menos.");
    } else notes.push("Sin audio: ideal, pesa menos.");

    if (size > RULES.niceBytes && size <= RULES.maxBytes) warnings.push("Pesa " + mb(size) + ". Funciona, pero lo ideal es menos de 5 MB para que cargue al instante con datos móviles.");
    return { errors: errors, warnings: warnings, notes: notes };
  }

  var api = { RULES: RULES, inspect: inspect, check: check, mb: mb, codecName: codecName };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StikeVideo = api;
})(typeof window !== "undefined" ? window : globalThis);
