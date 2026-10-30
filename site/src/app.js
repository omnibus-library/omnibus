/* Omnibus site: the two things the markup can't do on its own.
 *
 * The live release line in "What only Omnibus does". The page ships with a static sentence, so it reads the same with JS off or
 * when GitHub's unauthenticated rate limit (60 requests an hour) says no. On
 * success it swaps in the latest release tag and the commit count for the last
 * 30 days, and reveals the line that says where the numbers came from.
 *
 * The desktop shelf's orbit. Each book starts where the comp put it and walks
 * round the same ellipse, so with JS off or reduced motion the shelf is the
 * comp's still frame.
 */
(function () {
  'use strict';

  var REPO = 'https://api.github.com/repos/omnibus-library/omnibus';
  var live = document.getElementById('live');
  var src = document.getElementById('live-src');
  if (!live || !window.fetch) return;

  function ok(r) {
    if (!r.ok) throw new Error('GitHub answered ' + r.status);
    return r;
  }

  // per_page=1 makes the rel="last" page number in the Link header the count
  function commitCount(r) {
    var m = /[?&]page=(\d+)>; rel="last"/.exec(r.headers.get('Link') || '');
    if (m) return Number(m[1]);
    return r.json().then(function (list) { return list.length; });
  }

  var since = new Date(Date.now() - 30 * 864e5).toISOString();
  Promise.all([
    fetch(REPO + '/releases/latest').then(ok).then(function (r) { return r.json(); }),
    fetch(REPO + '/commits?per_page=1&since=' + since).then(ok).then(commitCount)
  ]).then(function (got) {
    var tag = got[0] && got[0].tag_name;
    var commits = got[1];
    if (!tag || typeof commits !== 'number') return;
    live.textContent = 'Latest release ' + tag + ', with ' + commits +
      (commits === 1 ? ' commit' : ' commits') + ' in the last 30 days.';
    src.hidden = false;
  }).catch(function () { /* keep the static sentence */ });
})();

(function () {
  'use strict';

  // the ellipse the comp's books sit on, in comp px, and one lap's length
  var CX = 723, CY = 463, RX = 615, RY = 348, LAP_MS = 360000;
  var shelf = document.querySelector('.shelf-d');
  var still = window.matchMedia('(prefers-reduced-motion: reduce)');
  var wide = window.matchMedia('(min-width: 1200px)');
  if (!shelf || !window.IntersectionObserver) return;

  var books = Array.prototype.map.call(shelf.querySelectorAll('.book'), function (el) {
    var nx = (parseFloat(el.style.getPropertyValue('--bx')) - CX) / RX;
    var ny = (parseFloat(el.style.getPropertyValue('--by')) - CY) / RY;
    // each book keeps its own distance from the centre, so the comp's
    // irregular spacing survives the lap
    return { el: el, r: Math.sqrt(nx * nx + ny * ny), a: Math.atan2(ny, nx) };
  });

  var seen = false, frame = 0, last = 0, elapsed = 0;

  function tick(now) {
    if (last) elapsed += now - last;
    last = now;
    var turn = (elapsed / LAP_MS) * 2 * Math.PI;
    books.forEach(function (b) {
      var x = CX + b.r * RX * Math.cos(b.a + turn);
      var y = CY + b.r * RY * Math.sin(b.a + turn);
      b.el.style.setProperty('--bx', x.toFixed(1));
      b.el.style.setProperty('--by', y.toFixed(1));
      b.el.style.zIndex = Math.round(y);
    });
    frame = requestAnimationFrame(tick);
  }

  function update() {
    var run = seen && wide.matches && !still.matches;
    if (run && !frame) { last = 0; frame = requestAnimationFrame(tick); }
    if (!run && frame) { cancelAnimationFrame(frame); frame = 0; }
  }

  new IntersectionObserver(function (entries) {
    seen = entries[0].isIntersecting;
    update();
  }).observe(shelf);
  [still, wide].forEach(function (q) {
    if (q.addEventListener) q.addEventListener('change', update);
  });
})();
