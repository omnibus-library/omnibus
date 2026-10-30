/* Omnibus site: the live release line in "What only Omnibus does".
 *
 * The page ships with a static sentence, so it reads the same with JS off or
 * when GitHub's unauthenticated rate limit (60 requests an hour) says no. On
 * success it swaps in the latest release tag and the commit count for the last
 * 30 days, and reveals the line that says where the numbers came from.
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
