// Marquee scroll glue for the book-detail stage: measures the topbar so
// the fixed stage starts below it, drives the cover parallax from the snap
// container's scroll position, tracks the active dot, and wires the dot rail
// to smooth-scroll between stops. Pure presentation — no app state. Installed
// from a post-mount effect (rule 07: SSR/WASM markup identical); re-running
// it (uuid change, refetch) replaces the previous listeners instead of
// stacking them.
(function () {
  var snap = document.getElementById('bdmq-snap');
  if (!snap) return;
  var cover = document.getElementById('bdmq-coverpx');
  var dots = Array.prototype.slice.call(document.querySelectorAll('.bdmq-dotrow'));
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Tear down the previous install (SPA nav between books remounts nothing —
  // the page component persists — so listeners must not accumulate).
  if (window.__omnibusMarquee && window.__omnibusMarquee.teardown) window.__omnibusMarquee.teardown();

  function measureTopbar() {
    var bar = document.querySelector('.atrium-topbar');
    if (bar) {
      document.documentElement.style.setProperty('--bdmq-top', bar.offsetHeight + 'px');
    }
  }

  function overshoot() {
    return cover ? Math.max(0, cover.offsetHeight - snap.clientHeight) : 0;
  }

  function paint() {
    var over = overshoot();
    if (cover) {
      if (reduced) {
        cover.style.transform = 'translateY(' + over / 2 + 'px)';
      } else {
        var p = snap.scrollTop / Math.max(1, snap.scrollHeight - snap.clientHeight);
        cover.style.transform = 'translateY(' + (over / 2 - p * over) + 'px)';
      }
    }
    var at = Math.max(
      0,
      Math.min(dots.length - 1, Math.round(snap.scrollTop / Math.max(1, snap.clientHeight)))
    );
    for (var i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i === at);
  }

  // The stop the rail still marks from the reading this one replaced.
  function marked() {
    for (var i = 0; i < dots.length; i++) if (dots[i].classList.contains('on')) return i;
    return 0;
  }

  function onResize() {
    measureTopbar();
    paint();
  }

  var dotHandlers = dots.map(function (d, i) {
    var h = function () {
      snap.scrollTo({ top: i * snap.clientHeight, behavior: reduced ? 'auto' : 'smooth' });
    };
    d.addEventListener('click', h);
    return h;
  });
  snap.addEventListener('scroll', paint, { passive: true });
  window.addEventListener('resize', onResize);

  window.__omnibusMarquee = {
    teardown: function () {
      snap.removeEventListener('scroll', paint);
      window.removeEventListener('resize', onResize);
      for (var i = 0; i < dots.length; i++) dots[i].removeEventListener('click', dotHandlers[i]);
      window.__omnibusMarquee = null;
    },
  };

  measureTopbar();
  // A fresh book opens on stop 01, not the last book's offset; a flip from the
  // flow (the stage sets the flag) lands on the reader's stop at once rather
  // than gliding past the stops above it.
  var keep = window.__omnibusMarqueeKeep ? marked() : 0;
  window.__omnibusMarqueeKeep = false;
  snap.scrollTo({ top: keep * snap.clientHeight, behavior: keep ? 'instant' : 'auto' });
  paint();
})();
