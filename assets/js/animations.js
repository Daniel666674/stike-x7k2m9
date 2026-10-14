;(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- Page loader ---- */
  const loader = document.createElement('div');
  loader.id = 'stike-loader';
  loader.setAttribute('aria-hidden', 'true');
  loader.innerHTML = '<div class="loader-inner"><div class="loader-ring"></div><span class="loader-text">' + (window.STIKE_LOADER_TEXT || 'STIKE') + '</span></div>';
  if (document.body) document.body.insertBefore(loader, document.body.firstChild);
  window.addEventListener('load', function () {
    loader.classList.add('done');
    setTimeout(function () { if (loader.parentNode) loader.parentNode.removeChild(loader); }, 700);
  });

  /* ---- Scroll progress bar ---- */
  var bar = document.createElement('div');
  bar.className = 'scroll-progress';
  if (document.body) document.body.appendChild(bar);
  var barTick = false;
  window.addEventListener('scroll', function () {
    if (barTick) return;
    barTick = true;
    requestAnimationFrame(function () {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + '%';
      barTick = false;
    });
  }, { passive: true });

  /* ---- Volver arriba ---- */
  var backToTop = document.createElement('button');
  backToTop.className = 'back-to-top';
  backToTop.type = 'button';
  backToTop.setAttribute('aria-label', 'Volver arriba');
  backToTop.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
  if (document.body) document.body.appendChild(backToTop);
  backToTop.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  });
  var backToTopTick = false;
  window.addEventListener('scroll', function () {
    if (backToTopTick) return;
    backToTopTick = true;
    requestAnimationFrame(function () {
      backToTop.classList.toggle('show', window.scrollY > 600);
      backToTopTick = false;
    });
  }, { passive: true });

  /* ---- Auto-tag more elements so the whole site animates ---- */
  document.querySelectorAll('.section-head, .cta-band .wrap, .tl-item, .map-embed, .contact-card, .about-hero > div, .pdp-info, .pdp-gallery')
    .forEach(function (el) { el.classList.add('reveal'); });
  document.querySelectorAll('.brand-grid, .ig-grid, .values, .props')
    .forEach(function (el) { el.classList.add('stagger'); });

  /* ---- Scroll reveal ---- */
  var revealObs = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      revealObs.unobserve(e.target);
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  /* ---- Stagger ---- */
  var staggerObs = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var children = Array.prototype.slice.call(e.target.children);
      children.forEach(function (child, i) {
        child.style.transitionDelay = (i * 72) + 'ms';
        child.classList.add('in');
      });
      staggerObs.unobserve(e.target);
    });
  }, { threshold: 0.06 });

  function observeAll() {
    document.querySelectorAll('.reveal').forEach(function (el) { revealObs.observe(el); });
    document.querySelectorAll('.stagger').forEach(function (el) { staggerObs.observe(el); });
  }
  observeAll();

  /* ---- Hero parallax (copy drifts up + fades on scroll) ---- */
  var heroCopy = document.querySelector('.hero-copy');
  if (heroCopy && !reduceMotion) {
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var y = window.scrollY;
        if (y < window.innerHeight) {
          heroCopy.style.transform = 'translateY(' + (y * 0.16) + 'px)';
          heroCopy.style.opacity = Math.max(0, 1 - y / 620);
        }
        ticking = false;
      });
    }, { passive: true });
  }

  /* ---- Stat counters ---- */
  var statObs = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var b = entry.target.querySelector('b');
      if (!b || b.dataset.done) return;
      b.dataset.done = '1';
      var raw = b.textContent;
      var m = raw.match(/[\d.]+/);
      if (!m) return;
      var num = parseFloat(m[0]);
      var pre = raw.slice(0, m.index);
      var suf = raw.slice(m.index + m[0].length);
      var dur = 1600;
      var t0 = performance.now();
      (function step(t) {
        var p = Math.min((t - t0) / dur, 1);
        var ease = 1 - Math.pow(1 - p, 3);
        b.textContent = pre + Math.round(ease * num) + suf;
        if (p < 1) requestAnimationFrame(step);
      })(t0);
      statObs.unobserve(entry.target);
    });
  }, { threshold: 0.6 });
  document.querySelectorAll('.stat').forEach(function (el) { statObs.observe(el); });

  /* ---- Glitch ---- */
  document.querySelectorAll('.glitch').forEach(function (el) {
    el.dataset.text = el.textContent;
    var interval = Math.random() * 3500 + 2000;
    setInterval(function () {
      el.classList.add('glitching');
      setTimeout(function () { el.classList.remove('glitching'); }, 240);
    }, interval);
  });

  /* ---- Headline reveal: words rise in sequence ----
     Split on words (not characters) so screen readers still read a normal
     sentence and the line can still wrap naturally. */
  if (!reduceMotion) {
    document.querySelectorAll('[data-reveal-words]').forEach(function (el) {
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      var textNodes = [], n;
      while ((n = walker.nextNode())) { if (n.nodeValue.trim()) textNodes.push(n); }
      var i = 0;
      textNodes.forEach(function (node) {
        var frag = document.createDocumentFragment();
        node.nodeValue.split(/(\s+)/).forEach(function (part) {
          if (!part.trim()) { frag.appendChild(document.createTextNode(part)); return; }
          var outer = document.createElement('span');
          outer.className = 'rw';
          var inner = document.createElement('span');
          inner.className = 'rw-i';
          inner.textContent = part;
          inner.style.transitionDelay = (i++ * 55) + 'ms';
          outer.appendChild(inner);
          frag.appendChild(outer);
        });
        node.parentNode.replaceChild(frag, node);
      });
      requestAnimationFrame(function () { el.classList.add('rw-in'); });
    });
  }

  /* ---- Marquee reacts to scroll ----
     Speeds up and leans in the direction you're scrolling, then settles.
     A ticker that ignores the page it sits in is the giveaway that it's
     decoration; this one is tied to the reader's own motion. */
  /* The skew goes on the .marquee wrapper, not on .track: .track already
     runs a CSS keyframe animation on `transform`, and an active animation
     beats an inline style, so a skew set there would be silently dropped.
     Wrapper skews, track carries the speed. */
  var marquees = document.querySelectorAll('.marquee');
  if (marquees.length && !reduceMotion) {
    var lastY = window.scrollY, vel = 0, marqTick = false;
    var applyMarq = function () {
      var skew = Math.max(-6, Math.min(6, vel * 0.22));
      var speed = Math.min(2.6, 1 + Math.abs(vel) * 0.035);
      marquees.forEach(function (m) {
        m.style.transform = 'skewX(' + skew.toFixed(2) + 'deg)';
        var t = m.querySelector('.track');
        if (t) t.style.animationDuration = (40 / speed).toFixed(2) + 's';
      });
      vel *= 0.9;
      if (Math.abs(vel) > 0.1) requestAnimationFrame(applyMarq);
      else {
        marquees.forEach(function (m) {
          m.style.transform = '';
          var t = m.querySelector('.track');
          if (t) t.style.animationDuration = '';
        });
        marqTick = false;
      }
    };
    window.addEventListener('scroll', function () {
      vel = window.scrollY - lastY;
      lastY = window.scrollY;
      if (!marqTick) { marqTick = true; requestAnimationFrame(applyMarq); }
    }, { passive: true });
  }

  /* ---- Product grids: cards rise in sequence as the row arrives ----
     Grids are rendered by JS after this file runs, so watch for the cards
     appearing instead of assuming they're in the DOM already. */
  var gridObs = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.style.transitionDelay = (Math.min(e.target.dataset.i || 0, 8) * 60) + 'ms';
      e.target.classList.add('in');
      gridObs.unobserve(e.target);
    });
  }, { threshold: 0.05, rootMargin: '0px 0px -30px 0px' });

  function armCards() {
    document.querySelectorAll('.product-grid .card:not([data-armed])').forEach(function (card, i) {
      card.dataset.armed = '1';
      card.dataset.i = i % 9;
      card.classList.add('card-rise');
      gridObs.observe(card);
    });
  }
  armCards();
  if (!reduceMotion) {
    document.querySelectorAll('.product-grid').forEach(function (grid) {
      new MutationObserver(armCards).observe(grid, { childList: true });
    });
  }

})();
