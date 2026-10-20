/* =========================================================================
   Buscador en TODOS los desplegables del panel (admin.html).

   Cualquier <select> del panel -- filtros de categoria / subcategoria /
   marca / estado, el editor de producto, la venta rapida, los colores de las
   fotos... -- abre una lista con una barra para escribir: se ven las letras
   que va tecleando y la lista se acorta a lo que coincide (sin importar
   mayusculas ni tildes: "camiseta" encuentra "Cámisetas").

   No reemplaza los <select>: sigue siendo el mismo elemento (con su valor,
   su estilo y sus eventos "change"/"input"), solo cambia la lista que se
   despliega. Por eso funciona igual con los desplegables que el panel crea
   despues (editor, ventanas), sin que admin.js tenga que saberlo.

   Teclado: con el desplegable enfocado, escribir una letra, Espacio o la
   flecha abajo lo abre. Dentro: flechas para moverse, Enter para elegir,
   Esc para cerrar. Para dejar un <select> con su lista nativa:
   data-native="1".
   ========================================================================= */
(function () {
  if (window.__stikeSelectSearch) return;
  window.__stikeSelectSearch = true;

  var CSS = [
    ".cs-pop{position:fixed;z-index:100000;display:none;flex-direction:column;min-width:220px;background:var(--panel,#202329);border:1px solid var(--line,#33373f);border-top:2px solid var(--accent,#22d3ee);border-radius:10px;box-shadow:0 18px 44px rgba(0,0,0,.55);overflow:hidden;font:14px/1.4 \"Inter\",system-ui,sans-serif;color:var(--ink,#f1f2f4)}",
    ".cs-pop.open{display:flex}",
    ".cs-bar{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--line,#33373f);background:var(--bg-2,#1c1f24)}",
    ".cs-bar svg{flex:none;color:var(--muted,#93979f)}",
    ".cs-pop .cs-q{flex:1;min-width:0;width:100%;background:transparent;border:0;outline:0;color:var(--ink,#f1f2f4);font:inherit;padding:2px 0}",
    ".cs-pop .cs-q::placeholder{color:var(--muted,#93979f)}",
    ".cs-clear{flex:none;border:0;background:transparent;color:var(--muted,#93979f);cursor:pointer;font-size:16px;line-height:1;padding:2px 4px;border-radius:4px;display:none}",
    ".cs-clear:hover{color:var(--ink,#f1f2f4);background:var(--panel-2,#262a31)}",
    ".cs-pop.has-q .cs-clear{display:block}",
    ".cs-list{list-style:none;margin:0;padding:4px;overflow:auto;flex:1;min-height:0;overscroll-behavior:contain}",
    ".cs-opt{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 10px;border-radius:7px;cursor:pointer}",
    ".cs-opt.act{background:var(--accent-soft,#123540)}",
    ".cs-opt.sel{font-weight:600;color:var(--accent,#22d3ee)}",
    ".cs-opt.sel::after{content:\"\\2713\";flex:none;font-size:12px}",
    ".cs-opt.dis{opacity:.4;cursor:not-allowed}",
    ".cs-opt mark{background:transparent;color:var(--accent,#22d3ee);font-weight:700;text-decoration:underline;text-underline-offset:2px}",
    ".cs-grp{padding:8px 10px 3px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#93979f)}",
    ".cs-empty{padding:16px 10px;text-align:center;color:var(--muted,#93979f)}",
    ".cs-foot{display:flex;justify-content:space-between;gap:10px;padding:6px 12px;border-top:1px solid var(--line,#33373f);font-size:11px;white-space:nowrap;color:var(--muted,#93979f);background:var(--bg-2,#1c1f24)}"
  ].join("\n");
  var style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  var SEARCH_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';

  /* ---- texto sin mayusculas ni tildes, con mapa de posiciones al original ---- */
  function fold(str) {
    var s = "", map = [];
    for (var i = 0; i < str.length; i++) {
      var ch = str[i].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      for (var j = 0; j < ch.length; j++) { s += ch[j]; map.push(i); }
    }
    return { s: s, map: map };
  }
  function esc(t) { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function highlight(text, folded, words) {
    var ranges = [];
    words.forEach(function (w) {
      var at = folded.s.indexOf(w);
      if (at > -1) ranges.push([folded.map[at], folded.map[at + w.length - 1] + 1]);
    });
    if (!ranges.length) return esc(text);
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [ranges[0].slice()];
    for (var i = 1; i < ranges.length; i++) {
      var last = merged[merged.length - 1];
      if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1]); else merged.push(ranges[i].slice());
    }
    var out = "", pos = 0;
    merged.forEach(function (r) { out += esc(text.slice(pos, r[0])) + "<mark>" + esc(text.slice(r[0], r[1])) + "</mark>"; pos = r[1]; });
    return out + esc(text.slice(pos));
  }

  /* Utilidades de texto que reutiliza la busqueda global del panel (admin.js). */
  window.stikeSearchUtil = { fold: fold, highlight: highlight, esc: esc };

  /* ---- ventana unica, compartida por todos los desplegables ---- */
  var pop, qInput, listEl, countEl, clearBtn;
  var curSel = null, all = [], view = [], active = -1, uid = 0;

  function build() {
    pop = document.createElement("div");
    pop.className = "cs-pop";
    pop.innerHTML =
      '<div class="cs-bar">' + SEARCH_SVG +
      '<input class="cs-q" type="text" placeholder="Escribe para buscar…" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Buscar en la lista" role="combobox" aria-expanded="true" aria-autocomplete="list">' +
      '<button type="button" class="cs-clear" aria-label="Borrar búsqueda" tabindex="-1">×</button></div>' +
      '<ul class="cs-list" role="listbox"></ul>' +
      '<div class="cs-foot"><span class="cs-count"></span><span>↑↓ mover · Enter elegir · Esc salir</span></div>';
    document.body.appendChild(pop);
    qInput = pop.querySelector(".cs-q");
    listEl = pop.querySelector(".cs-list");
    countEl = pop.querySelector(".cs-count");
    clearBtn = pop.querySelector(".cs-clear");
    pop.id = "cs-pop-" + (++uid);
    listEl.id = pop.id + "-list";
    qInput.setAttribute("aria-controls", listEl.id);

    qInput.addEventListener("input", function () { filter(qInput.value); });
    qInput.addEventListener("keydown", onKey, true);
    clearBtn.addEventListener("mousedown", function (e) {
      e.preventDefault(); qInput.value = ""; filter(""); qInput.focus();
    });
    listEl.addEventListener("mousedown", function (e) {
      e.preventDefault();                       // que el campo no pierda el foco
      var li = e.target.closest(".cs-opt");
      if (li && !li.classList.contains("dis")) choose(+li.getAttribute("data-i"));
    });
    listEl.addEventListener("mousemove", function (e) {
      var li = e.target.closest(".cs-opt");
      if (!li || li.classList.contains("dis")) return;
      var idx = view.findIndex(function (v) { return v.type === "opt" && v.index === +li.getAttribute("data-i"); });
      if (idx !== active) setActive(idx, false);
    });
  }

  function collect(sel) {
    var out = [];
    Array.prototype.forEach.call(sel.children, function (ch) {
      if (ch.tagName === "OPTGROUP") {
        out.push({ type: "grp", label: ch.label });
        Array.prototype.forEach.call(ch.children, function (o) { if (!o.hidden) out.push(item(sel, o)); });
      } else if (ch.tagName === "OPTION" && !ch.hidden) out.push(item(sel, ch));
    });
    return out;
  }
  function item(sel, o) {
    var text = (o.textContent || "").replace(/\s+/g, " ").trim() || "—";
    return { type: "opt", index: o.index, text: text, folded: fold(text), disabled: o.disabled || (o.parentNode.tagName === "OPTGROUP" && o.parentNode.disabled), selected: o.index === sel.selectedIndex };
  }

  function filter(q) {
    var words = fold(q.trim()).s.split(/\s+/).filter(Boolean);
    pop.classList.toggle("has-q", !!q);
    var out = [], pendingGrp = null, total = 0;
    all.forEach(function (it) {
      if (it.type === "grp") { pendingGrp = it; return; }
      total++;
      var ok = words.every(function (w) { return it.folded.s.indexOf(w) > -1; });
      if (!ok) return;
      if (pendingGrp) { out.push(pendingGrp); pendingGrp = null; }
      out.push(it);
    });
    // grupos sin ninguna coincidencia no se muestran (pendingGrp solo se agrega con una coincidencia)
    view = out;
    var n = out.filter(function (v) { return v.type === "opt"; }).length;
    var html = "";
    out.forEach(function (it) {
      if (it.type === "grp") { html += '<li class="cs-grp" role="presentation">' + esc(it.label || "") + "</li>"; return; }
      html += '<li class="cs-opt' + (it.selected ? " sel" : "") + (it.disabled ? " dis" : "") + '" role="option" id="' + pop.id + "-o" + it.index + '" data-i="' + it.index + '"' +
        (it.selected ? ' aria-selected="true"' : "") + (it.disabled ? ' aria-disabled="true"' : "") + ">" +
        '<span>' + (words.length ? highlight(it.text, it.folded, words) : esc(it.text)) + "</span></li>";
    });
    if (!n) html = '<li class="cs-empty" role="presentation">Sin resultados para “' + esc(q.trim()) + "”</li>";
    listEl.innerHTML = html;
    countEl.textContent = words.length ? n + " de " + total : total + (total === 1 ? " opción" : " opciones");
    // activo: la opcion elegida si sigue visible; si no, la primera disponible
    var first = view.findIndex(function (v) { return v.type === "opt" && !v.disabled; });
    var selIdx = view.findIndex(function (v) { return v.type === "opt" && v.selected && !v.disabled; });
    setActive(words.length ? first : (selIdx > -1 ? selIdx : first), true);
    place();
  }

  function setActive(i, scroll) {
    active = i;
    var prev = listEl.querySelector(".cs-opt.act");
    if (prev) prev.classList.remove("act");
    if (i < 0 || !view[i]) { qInput.removeAttribute("aria-activedescendant"); return; }
    var li = listEl.querySelector('.cs-opt[data-i="' + view[i].index + '"]');
    if (!li) return;
    li.classList.add("act");
    qInput.setAttribute("aria-activedescendant", li.id);
    if (scroll) {
      var top = li.offsetTop, bottom = top + li.offsetHeight;
      if (top < listEl.scrollTop + 4) listEl.scrollTop = Math.max(0, top - 30);
      else if (bottom > listEl.scrollTop + listEl.clientHeight - 4) listEl.scrollTop = bottom - listEl.clientHeight + 6;
    }
  }
  function move(dir) {
    var i = active;
    do { i += dir; } while (view[i] && (view[i].type !== "opt" || view[i].disabled));
    if (view[i]) setActive(i, true);
  }

  function place() {
    if (!curSel) return;
    var r = curSel.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    var w = Math.min(Math.max(r.width, 320), vw - 16);
    var left = Math.min(Math.max(8, r.left), vw - w - 8);
    var below = vh - r.bottom - 10, above = r.top - 10;
    var openUp = below < 260 && above > below;
    var maxH = Math.max(160, Math.min(420, openUp ? above : below));
    pop.style.width = w + "px";
    pop.style.left = left + "px";
    pop.style.maxHeight = maxH + "px";
    if (openUp) { pop.style.top = "auto"; pop.style.bottom = (vh - r.top + 4) + "px"; }
    else { pop.style.bottom = "auto"; pop.style.top = (r.bottom + 4) + "px"; }
  }

  function open(sel, prefill) {
    if (!pop) build();
    if (curSel === sel && pop.classList.contains("open")) { if (prefill) { qInput.value += prefill; filter(qInput.value); } return; }
    close(false);
    curSel = sel;
    all = collect(sel);
    sel.setAttribute("aria-expanded", "true");
    qInput.value = prefill || "";
    pop.classList.add("open");
    filter(qInput.value);
    qInput.focus();
    if (prefill) qInput.setSelectionRange(qInput.value.length, qInput.value.length);
  }
  function close(refocus) {
    if (!pop || !curSel) return;
    var sel = curSel;
    pop.classList.remove("open");
    sel.removeAttribute("aria-expanded");
    curSel = null; all = []; view = []; active = -1;
    if (refocus && document.body.contains(sel)) sel.focus();
  }
  function choose(optIndex) {
    var sel = curSel;
    if (!sel) return;
    var o = sel.options[optIndex];
    if (!o || o.disabled) return;
    var changed = sel.selectedIndex !== optIndex;
    close(true);
    if (changed) {
      sel.selectedIndex = optIndex;
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function onKey(e) {
    var k = e.key;
    if (k === "ArrowDown") { e.preventDefault(); move(1); }
    else if (k === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (k === "PageDown") { e.preventDefault(); for (var a = 0; a < 7; a++) move(1); }
    else if (k === "PageUp") { e.preventDefault(); for (var b = 0; b < 7; b++) move(-1); }
    else if (k === "Home" && !qInput.value) { e.preventDefault(); setActive(view.findIndex(function (v) { return v.type === "opt" && !v.disabled; }), true); }
    else if (k === "End" && !qInput.value) { e.preventDefault(); for (var c = view.length - 1; c >= 0; c--) if (view[c].type === "opt" && !view[c].disabled) { setActive(c, true); break; } }
    else if (k === "Enter") { e.preventDefault(); e.stopPropagation(); if (active > -1 && view[active]) choose(view[active].index); }
    else if (k === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (k === "Tab") { close(false); }
    else return;
    if (k !== "Tab") e.stopPropagation();
  }

  /* ---- que <select> se mejoran ---- */
  function eligible(el) {
    return el && el.tagName === "SELECT" && !el.multiple && !(el.size > 1) && !el.disabled &&
      !el.hasAttribute("data-native") && !(pop && pop.contains(el));
  }

  document.addEventListener("mousedown", function (e) {
    var sel = e.target.closest ? e.target.closest("select") : null;
    if (eligible(sel) && e.button === 0) {
      e.preventDefault();                                 // sin lista nativa
      if (curSel === sel) close(true); else { sel.focus(); open(sel); }
      return;
    }
    if (pop && curSel && !pop.contains(e.target)) close(false);
  }, true);
  document.addEventListener("click", function (e) {
    var sel = e.target.closest ? e.target.closest("select") : null;
    if (eligible(sel)) e.preventDefault();
  }, true);
  document.addEventListener("keydown", function (e) {
    var t = e.target;
    if (!eligible(t) || (pop && pop.contains(t))) return;
    if (e.ctrlKey || e.metaKey) return;
    var k = e.key;
    if (k === " " || k === "ArrowDown" || k === "ArrowUp" || k === "F4" || (e.altKey && k === "ArrowDown")) {
      e.preventDefault(); open(t); return;
    }
    if (k.length === 1 && !e.altKey) { e.preventDefault(); open(t, k); }
  }, true);
  window.addEventListener("resize", function () { close(false); });
  document.addEventListener("scroll", function (e) {
    if (curSel && !(pop && pop.contains(e.target))) place();
  }, true);
  document.addEventListener("focusin", function (e) {
    // si el foco se va a otro campo (Tab, clic en otro lado), se cierra
    if (curSel && pop && !pop.contains(e.target) && e.target !== curSel) close(false);
  });
})();
