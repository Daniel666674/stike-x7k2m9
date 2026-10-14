/* =========================================================================
   STIKE BIKE SHOP: editor de fotos del panel admin
   Se abre desde el "Editar" de cada foto en el grid de un producto
   (admin.js, renderPhotoGrid). No sabe nada de pendingUploads ni de
   GitHub: recibe una URL de imagen, devuelve un Blob editado via callback.
   admin.js decide donde guardarlo (siempre pendingUploads.set(path, file),
   tanto para una foto recien agregada como para una ya publicada -- ver
   uploadPendingPhotos, que sube cualquier path presente ahi sin importar
   si ya existia en GitHub).

   Rotar/voltear/recortar/fondo blanco son DESTRUCTIVOS (se hornean en
   baseCanvas al aplicarlos); brillo/contraste/saturacion son un filtro que
   se recalcula en cada preview y se hornea recien al exportar. Restablecer
   vuelve todo a la imagen tal como se cargo.
   ========================================================================= */
(function () {
  const MAX_WORK_DIM = 2000;   // resolucion de trabajo/export (mas que de sobra: compressImageFile la vuelve a bajar a 1600 al publicar)
  const MAX_DISPLAY_DIM = 620; // tamano en pantalla del lienzo dentro del modal
  const MIN_CROP = 40;         // minimo del recorte, en pixeles de PANTALLA

  let els = null;        // referencias del DOM del modal (se crea una sola vez, se reusa)
  let baseCanvas, originalCanvas; // <canvas> fuera del DOM: pixeles de trabajo y copia intacta para "Restablecer"
  let crop = null;       // {x,y,w,h} en pixeles de baseCanvas (imagen completa por defecto)
  let adjust = { brightness: 0, contrast: 0, saturate: 0 }; // -100..100
  let onSaveCb = null;
  let dragState = null;  // interaccion en curso sobre el recorte (mover/estirar)

  /* ---------------------------- UI: una sola vez ------------------------ */
  function ensureModal() {
    if (els) return els;
    const root = document.createElement("div");
    root.className = "pe-overlay";
    root.innerHTML = `
      <div class="pe-modal">
        <div class="pe-head">
          <h3>Editar foto</h3>
          <button type="button" class="btn ghost sm" data-pe="close">Cerrar ✕</button>
        </div>
        <div class="pe-body">
          <div class="pe-stage" data-pe="stage">
            <canvas data-pe="canvas"></canvas>
            <div class="pe-cropmask" data-pe="mask-top"></div>
            <div class="pe-cropmask" data-pe="mask-bottom"></div>
            <div class="pe-cropmask" data-pe="mask-left"></div>
            <div class="pe-cropmask" data-pe="mask-right"></div>
            <div class="pe-cropbox" data-pe="cropbox">
              <div class="pe-handle" data-h="nw"></div>
              <div class="pe-handle" data-h="ne"></div>
              <div class="pe-handle" data-h="sw"></div>
              <div class="pe-handle" data-h="se"></div>
            </div>
            <div class="pe-loading" data-pe="loading">Procesando…</div>
          </div>
          <div class="pe-tools">
            <div class="pe-group">
              <label class="pe-label">Girar / voltear</label>
              <div class="pe-row">
                <button type="button" class="btn ghost sm" data-pe="rotate-l" title="Girar 90° a la izquierda">⟲ 90°</button>
                <button type="button" class="btn ghost sm" data-pe="rotate-r" title="Girar 90° a la derecha">⟳ 90°</button>
                <button type="button" class="btn ghost sm" data-pe="flip-h" title="Voltear horizontal">⇋ Voltear</button>
              </div>
            </div>
            <div class="pe-group">
              <label class="pe-label">Recorte <span class="hint">— arrastra las esquinas o mueve el cuadro</span></label>
              <div class="pe-row">
                <button type="button" class="btn ghost sm" data-pe="crop-square">Cuadrado 1:1</button>
                <button type="button" class="btn ghost sm" data-pe="crop-reset">Foto completa</button>
              </div>
            </div>
            <div class="pe-group">
              <label class="pe-label">Fondo</label>
              <div class="pe-row">
                <button type="button" class="btn cyan sm" data-pe="whiten">✨ Emparejar fondo blanco</button>
              </div>
              <p class="hint pe-hint">Mide el color en el borde de la foto y lo iguala a blanco. Aplícalo antes de recortar muy ajustado — funciona mejor si todavía se ve fondo alrededor de la prenda.</p>
            </div>
            <div class="pe-group">
              <label class="pe-label">Ajustes</label>
              <div class="pe-slider">
                <span>Brillo</span><input type="range" min="-60" max="60" value="0" data-pe="brightness"><b data-pe="brightness-val">0</b>
                <button type="button" class="btn ghost sm" data-pe="brightness-auto" title="Medir el brillo del fondo y nivelarlo contra el resto del catálogo">Auto</button>
              </div>
              <div class="pe-slider"><span>Contraste</span><input type="range" min="-60" max="60" value="0" data-pe="contrast"><b data-pe="contrast-val">0</b></div>
              <div class="pe-slider"><span>Saturación</span><input type="range" min="-60" max="60" value="0" data-pe="saturate"><b data-pe="saturate-val">0</b></div>
              <p class="hint pe-hint">"Auto" mide el fondo de ESTA foto y ajusta el brillo a un nivel estándar, para que varias fotos con exposición distinta queden parejas entre sí.</p>
            </div>
          </div>
        </div>
        <div class="pe-foot">
          <button type="button" class="btn ghost sm" data-pe="reset">Restablecer</button>
          <div class="pe-foot-right">
            <button type="button" class="btn ghost" data-pe="cancel">Cancelar</button>
            <button type="button" class="btn cyan" data-pe="save">Guardar edición</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(root);

    els = {
      root,
      stage: root.querySelector('[data-pe="stage"]'),
      canvas: root.querySelector('[data-pe="canvas"]'),
      cropbox: root.querySelector('[data-pe="cropbox"]'),
      maskTop: root.querySelector('[data-pe="mask-top"]'),
      maskBottom: root.querySelector('[data-pe="mask-bottom"]'),
      maskLeft: root.querySelector('[data-pe="mask-left"]'),
      maskRight: root.querySelector('[data-pe="mask-right"]'),
      loading: root.querySelector('[data-pe="loading"]'),
      brightness: root.querySelector('[data-pe="brightness"]'),
      contrast: root.querySelector('[data-pe="contrast"]'),
      saturate: root.querySelector('[data-pe="saturate"]'),
      brightnessVal: root.querySelector('[data-pe="brightness-val"]'),
      contrastVal: root.querySelector('[data-pe="contrast-val"]'),
      saturateVal: root.querySelector('[data-pe="saturate-val"]'),
      brightnessAuto: root.querySelector('[data-pe="brightness-auto"]'),
    };

    root.querySelector('[data-pe="close"]').addEventListener("click", closeEditor);
    root.querySelector('[data-pe="cancel"]').addEventListener("click", closeEditor);
    root.addEventListener("click", e => { if (e.target === root) closeEditor(); });
    root.querySelector('[data-pe="save"]').addEventListener("click", handleSave);
    root.querySelector('[data-pe="reset"]').addEventListener("click", handleReset);
    root.querySelector('[data-pe="rotate-l"]').addEventListener("click", () => rotate(-90));
    root.querySelector('[data-pe="rotate-r"]').addEventListener("click", () => rotate(90));
    root.querySelector('[data-pe="flip-h"]').addEventListener("click", flipHorizontal);
    root.querySelector('[data-pe="crop-square"]').addEventListener("click", cropToSquare);
    root.querySelector('[data-pe="crop-reset"]').addEventListener("click", cropToFull);
    root.querySelector('[data-pe="whiten"]').addEventListener("click", handleWhiten);
    root.querySelector('[data-pe="brightness-auto"]').addEventListener("click", handleAutoBrightness);

    for (const key of ["brightness", "contrast", "saturate"]) {
      els[key].addEventListener("input", () => {
        adjust[key] = parseInt(els[key].value, 10) || 0;
        els[key + "Val"].textContent = adjust[key] > 0 ? `+${adjust[key]}` : String(adjust[key]);
        redrawCanvas();
      });
    }

    setupCropDragging();
    return els;
  }

  /* --------------------------- Carga de imagen --------------------------- */
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("No se pudo cargar la foto"));
      img.src = src;
    });
  }

  function makeCanvasFrom(img) {
    const scale = Math.min(1, MAX_WORK_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    return c;
  }
  function cloneCanvas(src) {
    const c = document.createElement("canvas");
    c.width = src.width; c.height = src.height;
    c.getContext("2d").drawImage(src, 0, 0);
    return c;
  }

  /* ------------------------------ API pública ---------------------------- */
  async function openPhotoEditor(src, opts) {
    opts = opts || {};
    onSaveCb = typeof opts.onSave === "function" ? opts.onSave : null;
    const modal = ensureModal();
    modal.root.classList.add("open");
    setLoading(true, "Cargando foto…");
    try {
      const img = await loadImage(src);
      originalCanvas = makeCanvasFrom(img);
      baseCanvas = cloneCanvas(originalCanvas);
      adjust = { brightness: 0, contrast: 0, saturate: 0 };
      for (const key of ["brightness", "contrast", "saturate"]) {
        els[key].value = 0; els[key + "Val"].textContent = "0";
      }
      cropToFull();
      redrawCanvas();
    } catch (err) {
      alert("No se pudo abrir la foto para editar: " + err.message);
      closeEditor();
    } finally {
      setLoading(false);
    }
  }
  window.openPhotoEditor = openPhotoEditor;

  function closeEditor() {
    if (!els) return;
    els.root.classList.remove("open");
    baseCanvas = originalCanvas = null;
    onSaveCb = null;
  }

  function setLoading(v, label) {
    if (!els) return;
    els.loading.textContent = label || "Procesando…";
    els.loading.classList.toggle("show", !!v);
    els.root.querySelectorAll("button, input").forEach(b => { b.disabled = v; });
  }

  /* ------------------------- Girar / voltear (bake) ----------------------- */
  function rotate(deg) {
    const src = baseCanvas;
    const c = document.createElement("canvas");
    c.width = src.height; c.height = src.width;
    const ctx = c.getContext("2d");
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    baseCanvas = c;
    cropToFull(); // el encuadre anterior ya no tiene sentido con las dimensiones nuevas
    redrawCanvas();
  }
  function flipHorizontal() {
    const src = baseCanvas;
    const c = document.createElement("canvas");
    c.width = src.width; c.height = src.height;
    const ctx = c.getContext("2d");
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(src, 0, 0);
    baseCanvas = c;
    if (crop) crop = { x: src.width - crop.x - crop.w, y: crop.y, w: crop.w, h: crop.h }; // el recorte se refleja con la foto
    redrawCanvas();
    updateCropOverlay();
  }

  function handleReset() {
    if (!originalCanvas) return;
    baseCanvas = cloneCanvas(originalCanvas);
    adjust = { brightness: 0, contrast: 0, saturate: 0 };
    for (const key of ["brightness", "contrast", "saturate"]) {
      els[key].value = 0; els[key + "Val"].textContent = "0";
    }
    cropToFull();
    redrawCanvas();
  }

  /* -------------------------------- Filtro -------------------------------- */
  function filterString() {
    const b = 100 + adjust.brightness, c = 100 + adjust.contrast, s = 100 + adjust.saturate;
    return `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;
  }

  /* --------------------------- Lienzo + escala --------------------------- */
  let displayScale = 1; // baseCanvas px -> px en pantalla
  function redrawCanvas() {
    if (!baseCanvas) return;
    const scale = Math.min(1, MAX_DISPLAY_DIM / Math.max(baseCanvas.width, baseCanvas.height));
    displayScale = scale;
    const cv = els.canvas;
    cv.width = Math.round(baseCanvas.width * scale);
    cv.height = Math.round(baseCanvas.height * scale);
    const ctx = cv.getContext("2d");
    ctx.filter = filterString();
    ctx.drawImage(baseCanvas, 0, 0, cv.width, cv.height);
    ctx.filter = "none";
    updateCropOverlay();
  }

  /* --------------------------------- Recorte -------------------------------- */
  function cropToFull() {
    crop = { x: 0, y: 0, w: baseCanvas.width, h: baseCanvas.height };
    updateCropOverlay();
  }
  function cropToSquare() {
    if (!baseCanvas) return;
    const side = Math.min(baseCanvas.width, baseCanvas.height);
    crop = {
      x: Math.round((baseCanvas.width - side) / 2),
      y: Math.round((baseCanvas.height - side) / 2),
      w: side, h: side,
    };
    updateCropOverlay();
  }

  function updateCropOverlay() {
    if (!crop || !els) return;
    const cv = els.canvas;
    const stageRect = { w: cv.width, h: cv.height };
    const x = Math.round(crop.x * displayScale), y = Math.round(crop.y * displayScale);
    const w = Math.round(crop.w * displayScale), h = Math.round(crop.h * displayScale);
    els.cropbox.style.left = x + "px"; els.cropbox.style.top = y + "px";
    els.cropbox.style.width = w + "px"; els.cropbox.style.height = h + "px";
    els.maskTop.style.cssText = `left:0;top:0;width:${stageRect.w}px;height:${y}px`;
    els.maskBottom.style.cssText = `left:0;top:${y + h}px;width:${stageRect.w}px;height:${Math.max(0, stageRect.h - y - h)}px`;
    els.maskLeft.style.cssText = `left:0;top:${y}px;width:${x}px;height:${h}px`;
    els.maskRight.style.cssText = `left:${x + w}px;top:${y}px;width:${Math.max(0, stageRect.w - x - w)}px;height:${h}px`;
  }

  function setupCropDragging() {
    const box = els.cropbox;
    box.addEventListener("pointerdown", e => {
      const handle = e.target.getAttribute && e.target.getAttribute("data-h");
      const stage = els.stage.getBoundingClientRect();
      dragState = {
        handle: handle || "move",
        startX: e.clientX, startY: e.clientY,
        stage,
        crop0: { ...crop },
      };
      e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    window.addEventListener("pointermove", e => {
      if (!dragState || !baseCanvas) return;
      const dx = (e.clientX - dragState.startX) / displayScale;
      const dy = (e.clientY - dragState.startY) / displayScale;
      const minCropBase = MIN_CROP / displayScale;
      let { x, y, w, h } = dragState.crop0;
      const W = baseCanvas.width, H = baseCanvas.height;
      if (dragState.handle === "move") {
        x = clamp(dragState.crop0.x + dx, 0, W - w);
        y = clamp(dragState.crop0.y + dy, 0, H - h);
      } else {
        let x2 = x + w, y2 = y + h;
        if (dragState.handle.includes("w")) x = clamp(x + dx, 0, x2 - minCropBase);
        if (dragState.handle.includes("e")) x2 = clamp(x2 + dx, x + minCropBase, W);
        if (dragState.handle.includes("n")) y = clamp(y + dy, 0, y2 - minCropBase);
        if (dragState.handle.includes("s")) y2 = clamp(y2 + dy, y + minCropBase, H);
        w = x2 - x; h = y2 - y;
      }
      crop = { x, y, w, h };
      updateCropOverlay();
    });
    window.addEventListener("pointerup", () => { dragState = null; });
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ------------------------ Fondo blanco (destructivo) --------------------- */
  /* Misma idea que tools/whiten-bg.mjs (ver ese archivo para la explicacion
     completa): la prenda suele llenar casi todo el cuadro, asi que el fondo
     solo se puede medir con certeza en el marco exterior de la foto. Se
     ajusta ahi una superficie suave por canal (R/G/B) y se usa para aclarar
     y neutralizar el resto, sin tocar el contraste propio de la prenda. */
  function solveLinearSystem(A, b, n) {
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
      [A[col], A[pivot]] = [A[pivot], A[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
      const div = A[col][col] || 1e-9;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = A[r][col] / div;
        if (!factor) continue;
        for (let c = col; c < n; c++) A[r][c] -= factor * A[col][c];
        b[r] -= factor * b[col];
      }
    }
    return b.map((v, i) => v / (A[i][i] || 1e-9));
  }
  function fitQuadratic(points, zIndex) {
    const N = 6;
    const AtA = Array.from({ length: N }, () => new Array(N).fill(0));
    const Atb = new Array(N).fill(0);
    const basis = new Array(N);
    for (const p of points) {
      const u = p[0], v = p[1], z = p[zIndex];
      basis[0] = 1; basis[1] = u; basis[2] = v; basis[3] = u * v; basis[4] = u * u; basis[5] = v * v;
      for (let i = 0; i < N; i++) {
        Atb[i] += basis[i] * z;
        for (let j = 0; j < N; j++) AtA[i][j] += basis[i] * basis[j];
      }
    }
    return solveLinearSystem(AtA, Atb, N);
  }
  const evalQuadratic = (c, u, v) => c[0] + c[1] * u + c[2] * v + c[3] * u * v + c[4] * u * u + c[5] * v * v;

  /* ------------------- Filtro min/max separable (morfologia) -------------- */
  /* La prenda es un bloque solido; un doblez del papel de fondo es una
     linea delgada -- ambos pueden tener un residual igual de alto contra
     la superficie de fondo (un doblez es una sombra dura), asi que lo que
     los distingue es la FORMA, no el numero. Cierre (rellena huecos chicos
     DENTRO de la prenda: bordado claro, textura jaspeada que por color se
     confunde con fondo) y despues apertura (borra lineas delgadas FUERA de
     la prenda: el doblez) separan uno de otro sin tocar el contraste de la
     prenda. Ver tools/whiten-bg.mjs para el mismo algoritmo en Node. */
  function slideFilter(arr, n, radius, isMin) {
    const out = new Float32Array(n);
    const deque = new Int32Array(n);
    let head = 0, tail = 0;
    for (let i = 0; i < n; i++) {
      const v = arr[i];
      while (tail > head && (isMin ? arr[deque[tail - 1]] >= v : arr[deque[tail - 1]] <= v)) tail--;
      deque[tail++] = i;
      if (deque[head] <= i - (2 * radius + 1)) head++;
      if (i >= radius) out[i - radius] = arr[deque[head]];
    }
    for (let i = n; i < n + radius; i++) {
      while (tail > head && deque[head] <= i - (2 * radius + 1)) head++;
      if (i - radius < n) out[i - radius] = arr[deque[head]];
    }
    return out;
  }
  function erodeDilate2D(mask, w, h, radius, isMin) {
    const rowPass = new Float32Array(w * h);
    const rowBuf = new Float32Array(w);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) rowBuf[x] = mask[y * w + x];
      const filtered = slideFilter(rowBuf, w, radius, isMin);
      for (let x = 0; x < w; x++) rowPass[y * w + x] = filtered[x];
    }
    const out = new Float32Array(w * h);
    const colBuf = new Float32Array(h);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) colBuf[y] = rowPass[y * w + x];
      const filtered = slideFilter(colBuf, h, radius, isMin);
      for (let y = 0; y < h; y++) out[y * w + x] = filtered[y];
    }
    return out;
  }
  const opening = (mask, w, h, r) => erodeDilate2D(erodeDilate2D(mask, w, h, r, true), w, h, r, false);
  const closing = (mask, w, h, r) => erodeDilate2D(erodeDilate2D(mask, w, h, r, false), w, h, r, true);
  function boxBlur(mask, w, h, radius) {
    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += mask[y * w + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / (2 * radius + 1);
        sum += mask[y * w + clamp(x + radius + 1, 0, w - 1)] - mask[y * w + clamp(x - radius, 0, w - 1)];
      }
    }
    const out = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += tmp[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / (2 * radius + 1);
        sum += tmp[clamp(y + radius + 1, 0, h - 1) * w + x] - tmp[clamp(y - radius, 0, h - 1) * w + x];
      }
    }
    return out;
  }

  /* Devuelve imageData modificada, o null si el marco de la foto no
     parece fondo confiable (la prenda llega hasta el borde en casi todos
     lados) -- en ese caso no se toca nada, mejor que arruinarla. */
  function whitenImageData(imageData, targetWhite) {
    const { data, width: w, height: h } = imageData;
    const marginX = Math.max(3, Math.round(w * 0.045));
    const marginY = Math.max(3, Math.round(h * 0.045));
    const points = [];
    const addPoint = (x, y) => {
      const idx = (y * w + x) * 4;
      points.push([x / w, y / h, data[idx], data[idx + 1], data[idx + 2]]);
    };
    const stepX = Math.max(1, Math.round(w / 60)), stepY = Math.max(1, Math.round(h / 60));
    for (let x = 0; x < w; x += stepX) {
      for (let y = 0; y < marginY; y += 2) addPoint(x, y);
      for (let y = h - marginY; y < h; y += 2) addPoint(x, y);
    }
    for (let y = 0; y < h; y += stepY) {
      for (let x = 0; x < marginX; x += 2) addPoint(x, y);
      for (let x = w - marginX; x < w; x += 2) addPoint(x, y);
    }

    // Ajuste robusto: 3 vueltas, descartando el 40% que peor encaja en
    // cada una (son prenda que llego hasta el marco, no fondo real).
    let survivors = points;
    let coefR, coefG, coefB;
    for (let iter = 0; iter < 3; iter++) {
      coefR = fitQuadratic(survivors, 2); coefG = fitQuadratic(survivors, 3); coefB = fitQuadratic(survivors, 4);
      if (iter === 2) break;
      const withResidual = points.map(p => {
        const pr = evalQuadratic(coefR, p[0], p[1]), pg = evalQuadratic(coefG, p[0], p[1]), pb = evalQuadratic(coefB, p[0], p[1]);
        return [p, Math.max(Math.abs(p[2] - pr), Math.abs(p[3] - pg), Math.abs(p[4] - pb))];
      });
      withResidual.sort((a, b) => a[1] - b[1]);
      const keepCount = Math.max(30, Math.round(withResidual.length * 0.6));
      survivors = withResidual.slice(0, keepCount).map(([p]) => p);
    }
    const rangeOf = idx => { let lo = 255, hi = 0; for (const p of survivors) { if (p[idx] < lo) lo = p[idx]; if (p[idx] > hi) hi = p[idx]; } return [lo, hi]; };
    const [rLo, rHi] = rangeOf(2), [gLo, gHi] = rangeOf(3), [bLo, bHi] = rangeOf(4);
    // Para decidir si el fondo es CONFIABLE se usa un rango por percentiles
    // (10-90), no el minimo/maximo real: un solo punto rezagado que el
    // ajuste robusto no alcanzo a descartar no representa al grueso del marco.
    const percentileRangeOf = idx => {
      const vals = survivors.map(p => p[idx]).sort((a, b) => a - b);
      return [vals[Math.floor(vals.length * 0.1)], vals[Math.ceil(vals.length * 0.9) - 1]];
    };
    const [rLoP, rHiP] = percentileRangeOf(2), [gLoP, gHiP] = percentileRangeOf(3), [bLoP, bHiP] = percentileRangeOf(4);
    const spread = Math.max(rHiP - rLoP, gHiP - gLoP, bHiP - bLoP);
    if (!(spread < 70 && (rLoP + gLoP + bLoP) / 3 > 120)) return null; // sin fondo confiable

    const pad = 12;
    const predAt = (x, y) => {
      const u = x / w, v = y / h;
      return [
        clamp(evalQuadratic(coefR, u, v), rLo - pad, rHi + pad),
        clamp(evalQuadratic(coefG, u, v), gLo - pad, gHi + pad),
        clamp(evalQuadratic(coefB, u, v), bLo - pad, bHi + pad),
      ];
    };

    const fgThreshold = 22, morphRadius = 2, featherRadius = 3;
    const fgMask = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const [predR, predG, predB] = predAt(x, y);
        const residual = Math.max(Math.abs(data[idx] - predR), Math.abs(data[idx + 1] - predG), Math.abs(data[idx + 2] - predB));
        fgMask[y * w + x] = residual > fgThreshold ? 1 : 0;
      }
    }
    const softMask = boxBlur(opening(closing(fgMask, w, h, morphRadius), w, h, morphRadius), w, h, featherRadius);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const [predR, predG, predB] = predAt(x, y);
        const gR = clamp(targetWhite / Math.max(1, predR), 0.85, 1.6);
        const gG = clamp(targetWhite / Math.max(1, predG), 0.85, 1.6);
        const gB = clamp(targetWhite / Math.max(1, predB), 0.85, 1.6);
        const corrR = Math.min(255, data[idx] * gR), corrG = Math.min(255, data[idx + 1] * gG), corrB = Math.min(255, data[idx + 2] * gB);
        const fgScore = clamp(softMask[y * w + x], 0, 1), bgScore = 1 - fgScore;
        data[idx] = corrR * fgScore + targetWhite * bgScore;
        data[idx + 1] = corrG * fgScore + targetWhite * bgScore;
        data[idx + 2] = corrB * fgScore + targetWhite * bgScore;
      }
    }
    return imageData;
  }

  /* Mismo principio que el fondo blanco: el promedio de TODA la foto no
     sirve de referencia (una prenda oscura de sobra "pesa" el promedio
     hacia abajo aunque la exposicion este bien), asi que se mide solo el
     marco exterior -- el fondo real -- y ese es el numero que se nivela
     contra un valor de referencia fijo. Dos fotos con el mismo fondo pero
     tomadas con exposiciones distintas quedan con el mismo brillo. */
  function sampleBorderLuma(canvas) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const marginX = Math.max(2, Math.round(w * 0.045));
    const marginY = Math.max(2, Math.round(h * 0.045));
    const { data } = ctx.getImageData(0, 0, w, h);
    let sum = 0, count = 0;
    const sample = (x, y) => {
      const idx = (y * w + x) * 4;
      sum += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      count++;
    };
    for (let x = 0; x < w; x += 6) {
      for (let y = 0; y < marginY; y += 3) sample(x, y);
      for (let y = h - marginY; y < h; y += 3) sample(x, y);
    }
    for (let y = 0; y < h; y += 6) {
      for (let x = 0; x < marginX; x += 3) sample(x, y);
      for (let x = w - marginX; x < w; x += 3) sample(x, y);
    }
    return count ? sum / count : 128;
  }
  const AUTO_BRIGHTNESS_TARGET = 222; // marco/fondo de referencia: bastante claro sin llegar a quemarse, igual en todas las fotos
  function handleAutoBrightness() {
    if (!baseCanvas) return;
    const currentLuma = sampleBorderLuma(baseCanvas);
    const percent = clamp((AUTO_BRIGHTNESS_TARGET / Math.max(1, currentLuma)) * 100, 40, 160);
    adjust.brightness = clamp(Math.round(percent - 100), -60, 60);
    els.brightness.value = adjust.brightness;
    els.brightnessVal.textContent = adjust.brightness > 0 ? `+${adjust.brightness}` : String(adjust.brightness);
    redrawCanvas();
  }

  function handleWhiten() {
    if (!baseCanvas) return;
    setLoading(true, "Emparejando fondo…");
    // requestAnimationFrame para que el navegador alcance a pintar el "Procesando…" antes de bloquear el hilo con el loop de pixeles
    requestAnimationFrame(() => {
      setTimeout(() => {
        try {
          const ctx = baseCanvas.getContext("2d");
          const imageData = ctx.getImageData(0, 0, baseCanvas.width, baseCanvas.height);
          const result = whitenImageData(imageData, 253);
          if (!result) {
            alert("No se detectó un fondo confiable en esta foto (la prenda llega hasta casi todo el borde). No se tocó nada — recorta menos ajustado o usa otra foto como base.");
            return;
          }
          ctx.putImageData(result, 0, 0);
          redrawCanvas();
        } finally {
          setLoading(false);
        }
      }, 20);
    });
  }

  /* --------------------------------- Guardar -------------------------------- */
  function handleSave() {
    if (!baseCanvas || !crop) return;
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(crop.w));
    out.height = Math.max(1, Math.round(crop.h));
    const ctx = out.getContext("2d");
    ctx.filter = filterString();
    ctx.drawImage(baseCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
    out.toBlob(blob => {
      if (!blob) { alert("No se pudo guardar la edición, intenta de nuevo."); return; }
      const file = new File([blob], "foto-editada.jpg", { type: "image/jpeg" });
      if (onSaveCb) onSaveCb(file);
      closeEditor();
    }, "image/jpeg", 0.92);
  }
})();
