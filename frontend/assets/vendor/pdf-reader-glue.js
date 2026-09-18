/*
 * pdf-reader-glue.js — Omnibus PDF.js bridge.
 *
 * Loads the vendored PDF.js ES module (`./pdf.min.mjs`, with the worker at
 * `./pdf.worker.min.mjs`) through a dynamic `import()` — the classic-script
 * loader every Omnibus surface uses can't `<script type="module">`, so the
 * URLs of both files arrive in `init()`'s options bag (hashed by the asset
 * bundler) rather than being resolved relative to this file. So does
 * `wasmUrl`, the directory of the worker's WASM image decoders
 * (`./pdfjs-wasm/`: OpenJPEG for JPXDecode, JBIG2 + CCITTFax, qcms for ICC
 * colour spaces). PDF.js fetches `${wasmUrl}openjpeg.wasm` itself; left
 * unset it silently drops every image those filters encode, which is how an
 * illustrated or scanned PDF opens as blank pages.
 *
 * Renders ONE page at a time onto a canvas bounded by `maxCanvasPixels`
 * (the Android WebView OOM mitigation — spreads and continuous scroll are out
 * of scope), lays PDF.js's text layer over it for native text selection, and
 * paints stored highlights as positioned divs under the text layer.
 *
 * Public surface: window.OmnibusPdfReader
 *   init(hostId, opts)   opts = { url, pdfjs, worker, wasmUrl, startPage?,
 *                                 fit?, maxCanvasPixels? }
 *                        `url` is range-fetched (`/api/ebooks/{uuid}/file`,
 *                        which answers `Range`), `startPage` is 0-based and
 *                        clamped, `fit` is "width" | "height".
 *   goTo(n)              render 0-based page `n` (clamped); emits onPdfPage
 *   next() / prev()
 *   setFit(mode)         re-render the current page in the new fit mode
 *   paintHighlights(list) list = [{ anchor, color }] — the whole set for the
 *                        book; the glue keeps it and repaints the ones on the
 *                        current page after every render
 *   clearSelection()     collapse the native selection (popover dismissed)
 *   copyText(text) / shareText(text)
 *   retry()              re-run the most recent init() verbatim
 *   destroy()
 *
 * Callbacks the Rust side sets on `window` (each takes one string):
 *   __omnibusOnPdfReady(json)     { page, pageCount } once the first page
 *                                 painted
 *   __omnibusOnPdfPage(json)      { page, pageCount } after every later render
 *   __omnibusOnPdfError(message)  open/render failure
 *   __omnibusOnPdfSelection(json) { page, quads, text, rect } — `quads` are
 *                                 [x1,y1,x2,y2,x3,y3,x4,y4] arrays in PDF
 *                                 user-space points on the unrotated page
 *                                 (upper-left, upper-right, lower-left,
 *                                 lower-right — the `QuadPoints` order the
 *                                 `pdf:{page}:{quads}` anchor stores), `rect`
 *                                 is the selection's bounding box in host
 *                                 coordinates for the popover
 *   __omnibusOnPdfSelectionCleared(_)
 *   __omnibusOnPdfHighlightTap(anchor)  a tap/click on a painted highlight
 */
(function () {
  "use strict";

  var DEFAULT_MAX_CANVAS_PIXELS = 16777216; // 4096 × 4096, PDF.js's own default
  // Solid fills; alpha is applied once via `opacity` on the div so it never
  // multiplies with the color's own alpha (the epub glue's lesson).
  var HIGHLIGHT_COLORS = {
    amber: "rgb(245, 158, 11)",
    green: "rgb(34, 197, 94)",
    blue: "rgb(59, 130, 246)",
    rose: "rgb(244, 63, 94)",
    violet: "rgb(139, 92, 246)",
  };

  var pdfjs = null; // the imported module namespace
  var host = null; // the element `init()` mounts into
  var doc = null; // PDFDocumentProxy
  var loadingTask = null;
  var currentPage = 0; // 0-based
  var pageCount = 0;
  var fit = "height";
  var maxCanvasPixels = DEFAULT_MAX_CANVAS_PIXELS;
  var lastInit = null; // { hostId, opts } for retry()
  var renderSeq = 0; // monotonic; a stale render never paints over a newer one
  var renderTask = null;
  var textLayer = null;
  var viewport = null; // the viewport the current canvas was drawn with
  var highlights = []; // [{ anchor, color }] for the whole book
  var painted = []; // [{ anchor, rect: {left, top, width, height} }] on this page
  var resizeObserver = null;
  var resizeTimer = null;
  var selectionTimer = null;
  var lastSelectionKey = null;
  var ready = false;

  function emit(name, arg) {
    var fn = window[name];
    if (typeof fn !== "function") return;
    try {
      fn(arg);
    } catch (e) {
      /* ignore handler errors */
    }
  }

  function emitError(message) {
    emit("__omnibusOnPdfError", String(message || "error"));
  }

  function positionJson() {
    return JSON.stringify({ page: currentPage, pageCount: pageCount });
  }

  // ---- mounting ---------------------------------------------------------

  function ensurePdfjs(url) {
    if (pdfjs) return Promise.resolve(pdfjs);
    // A dynamic `import()` from a classic script; `script-src 'self'` covers
    // the same-origin module and the worker it spawns.
    return import(/* webpackIgnore: true */ url).then(function (mod) {
      pdfjs = mod;
      return mod;
    });
  }

  function clearHost() {
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);
  }

  function teardown() {
    ready = false;
    if (renderTask) {
      try {
        renderTask.cancel();
      } catch (e) {
        /* already settled */
      }
      renderTask = null;
    }
    if (textLayer) {
      try {
        textLayer.cancel();
      } catch (e) {
        /* already settled */
      }
      textLayer = null;
    }
    if (loadingTask) {
      try {
        loadingTask.destroy();
      } catch (e) {
        /* already settled */
      }
      loadingTask = null;
    }
    doc = null;
    viewport = null;
    painted = [];
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (resizeTimer) {
      clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    clearHost();
  }

  function init(hostId, opts) {
    opts = opts || {};
    lastInit = { hostId: hostId, opts: opts };
    teardown();
    host = document.getElementById(hostId);
    if (!host) {
      emitError("no host element");
      return;
    }
    fit = opts.fit === "width" ? "width" : "height";
    maxCanvasPixels =
      typeof opts.maxCanvasPixels === "number" && opts.maxCanvasPixels > 0
        ? opts.maxCanvasPixels
        : DEFAULT_MAX_CANVAS_PIXELS;
    var startPage = typeof opts.startPage === "number" ? opts.startPage : 0;

    ensurePdfjs(opts.pdfjs)
      .then(function (mod) {
        if (opts.worker) {
          mod.GlobalWorkerOptions.workerSrc = opts.worker;
        }
        loadingTask = mod.getDocument({
          url: opts.url,
          // Where the worker fetches its image decoders from; a prefix, so
          // it must end in "/".
          wasmUrl: opts.wasmUrl || undefined,
          // Same-origin session cookie — the file route is authenticated.
          withCredentials: true,
          // Range-fetch pages on demand rather than pulling the whole file
          // up front; the server answers `Range` on `/file`.
          rangeChunkSize: 65536,
          disableAutoFetch: true,
          disableStream: false,
        });
        return loadingTask.promise;
      })
      .then(function (pdf) {
        doc = pdf;
        pageCount = pdf.numPages;
        currentPage = clampPage(startPage);
        installResizeWatch();
        installSelectionWatch();
        return renderCurrent();
      })
      .then(function (drawn) {
        if (!drawn) return;
        ready = true;
        emit("__omnibusOnPdfReady", positionJson());
      })
      .catch(function (err) {
        emitError(err && err.message ? err.message : err);
      });
  }

  function retry() {
    if (!lastInit) return;
    init(lastInit.hostId, lastInit.opts);
  }

  function destroy() {
    teardown();
    lastInit = null;
  }

  function clampPage(n) {
    if (!pageCount) return 0;
    n = Math.floor(Number(n) || 0);
    if (n < 0) return 0;
    if (n > pageCount - 1) return pageCount - 1;
    return n;
  }

  // ---- rendering --------------------------------------------------------

  function stageSize() {
    // The stage is the scrolling parent; the host itself grows with the
    // page, so measure the parent for the fit computation.
    var el = host && host.parentElement ? host.parentElement : host;
    var r = el.getBoundingClientRect();
    return { width: Math.max(1, r.width), height: Math.max(1, r.height) };
  }

  function scaleFor(page) {
    var base = page.getViewport({ scale: 1 });
    var stage = stageSize();
    var pad = 0;
    var byWidth = (stage.width - pad) / base.width;
    var byHeight = (stage.height - pad) / base.height;
    var s = fit === "width" ? byWidth : Math.min(byWidth, byHeight);
    if (!isFinite(s) || s <= 0) s = 1;
    return s;
  }

  // Device-pixel ratio the canvas is drawn at, reduced so the backing store
  // stays under `maxCanvasPixels` — a full-width page on a high-DPR phone
  // otherwise allocates a canvas the Android WebView refuses.
  function outputScaleFor(vp) {
    var dpr = window.devicePixelRatio || 1;
    var pixels = vp.width * vp.height * dpr * dpr;
    if (pixels > maxCanvasPixels) {
      dpr = Math.sqrt(maxCanvasPixels / (vp.width * vp.height));
    }
    return Math.max(0.5, dpr);
  }

  function renderCurrent() {
    if (!doc) return Promise.resolve(false);
    var seq = ++renderSeq;
    if (renderTask) {
      try {
        renderTask.cancel();
      } catch (e) {
        /* already settled */
      }
      renderTask = null;
    }
    if (textLayer) {
      try {
        textLayer.cancel();
      } catch (e) {
        /* already settled */
      }
      textLayer = null;
    }
    var pageNo = currentPage;
    return doc.getPage(pageNo + 1).then(function (page) {
      if (seq !== renderSeq) return false;
      var scale = scaleFor(page);
      var vp = page.getViewport({ scale: scale });
      var out = outputScaleFor(vp);

      var canvas = document.createElement("canvas");
      canvas.className = "pr-canvas";
      canvas.width = Math.floor(vp.width * out);
      canvas.height = Math.floor(vp.height * out);
      canvas.style.width = Math.floor(vp.width) + "px";
      canvas.style.height = Math.floor(vp.height) + "px";

      var hlLayer = document.createElement("div");
      hlLayer.className = "pr-hl-layer";

      var tl = document.createElement("div");
      tl.className = "pr-textlayer textLayer";
      // PDF.js's text layer sizes its spans from these variables (the
      // viewer's own stylesheet sets them; this host is not the viewer).
      tl.style.setProperty("--total-scale-factor", String(vp.scale));
      tl.style.setProperty("--scale-round-x", "1px");
      tl.style.setProperty("--scale-round-y", "1px");

      var ctx = canvas.getContext("2d", { alpha: false });
      var task = page.render({
        canvasContext: ctx,
        viewport: vp,
        transform: out !== 1 ? [out, 0, 0, out, 0, 0] : null,
      });
      renderTask = task;
      return task.promise
        .then(function () {
          if (seq !== renderSeq) return false;
          renderTask = null;
          clearHost();
          host.style.width = Math.floor(vp.width) + "px";
          host.style.height = Math.floor(vp.height) + "px";
          host.appendChild(canvas);
          host.appendChild(hlLayer);
          host.appendChild(tl);
          viewport = vp;
          repaintHighlights();
          // Text layer after the raster: selection works a beat after the
          // page shows rather than the page waiting on the text.
          var layer = new pdfjs.TextLayer({
            textContentSource: page.streamTextContent({
              includeMarkedContent: false,
            }),
            container: tl,
            viewport: vp,
          });
          textLayer = layer;
          return layer
            .render()
            .then(function () {
              if (seq !== renderSeq) return false;
              var end = document.createElement("div");
              end.className = "endOfContent";
              tl.appendChild(end);
              return true;
            })
            .catch(function (err) {
              // A cancelled or failed text layer leaves the raster usable —
              // selection just isn't offered on this page.
              if (seq === renderSeq && err && err.name !== "AbortException") {
                console.warn("omnibus pdf: text layer failed", err);
              }
              return seq === renderSeq;
            });
        })
        .catch(function (err) {
          if (seq !== renderSeq) return false;
          if (err && err.name === "RenderingCancelledException") return false;
          throw err;
        });
    });
  }

  function afterRender(drawn) {
    if (!drawn) return;
    if (ready) emit("__omnibusOnPdfPage", positionJson());
  }

  function goTo(n) {
    if (!doc) return;
    var target = clampPage(n);
    if (target === currentPage && viewport) {
      // Already here: still report, so a caller's slider/label settles.
      emit("__omnibusOnPdfPage", positionJson());
      return;
    }
    currentPage = target;
    clearSelectionState();
    renderCurrent().then(afterRender).catch(function (err) {
      emitError(err && err.message ? err.message : err);
    });
  }

  function next() {
    goTo(currentPage + 1);
  }

  function prev() {
    goTo(currentPage - 1);
  }

  function setFit(mode) {
    var m = mode === "width" ? "width" : "height";
    if (m === fit && viewport) return;
    fit = m;
    if (!doc) return;
    renderCurrent()
      .then(function (drawn) {
        // A fit change is not a page change: repaint only, no page event.
        void drawn;
      })
      .catch(function (err) {
        emitError(err && err.message ? err.message : err);
      });
  }

  function installResizeWatch() {
    if (typeof ResizeObserver !== "function" || !host || !host.parentElement) {
      return;
    }
    var stage = host.parentElement;
    var last = null;
    resizeObserver = new ResizeObserver(function () {
      var r = stage.getBoundingClientRect();
      var key = Math.round(r.width) + "x" + Math.round(r.height);
      if (key === last) return;
      last = key;
      if (!viewport) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        resizeTimer = null;
        renderCurrent().catch(function () {});
      }, 150);
    });
    resizeObserver.observe(stage);
  }

  // ---- highlights -------------------------------------------------------

  // `pdf:{page}:{x1,y1,…};{…}` → { page, quads: [[8 numbers], …] } or null.
  function parseAnchor(anchor) {
    if (typeof anchor !== "string" || anchor.indexOf("pdf:") !== 0) return null;
    var rest = anchor.slice(4);
    var colon = rest.indexOf(":");
    var pageStr = colon === -1 ? rest : rest.slice(0, colon);
    var page = parseInt(pageStr, 10);
    if (!isFinite(page) || page < 0) return null;
    var quads = [];
    if (colon !== -1 && rest.length > colon + 1) {
      var parts = rest.slice(colon + 1).split(";");
      for (var i = 0; i < parts.length; i++) {
        var nums = parts[i].split(",").map(function (n) {
          return parseFloat(n);
        });
        if (nums.length !== 8) return null;
        for (var j = 0; j < 8; j++) if (!isFinite(nums[j])) return null;
        quads.push(nums);
      }
    }
    return { page: page, quads: quads };
  }

  // A quad in PDF user space → its bounding box in host (CSS px) coords.
  function quadToRect(q) {
    var xs = [];
    var ys = [];
    for (var i = 0; i < 4; i++) {
      var p = viewport.convertToViewportPoint(q[i * 2], q[i * 2 + 1]);
      xs.push(p[0]);
      ys.push(p[1]);
    }
    var left = Math.min.apply(null, xs);
    var top = Math.min.apply(null, ys);
    return {
      left: left,
      top: top,
      width: Math.max.apply(null, xs) - left,
      height: Math.max.apply(null, ys) - top,
    };
  }

  function repaintHighlights() {
    painted = [];
    if (!host || !viewport) return;
    var layer = host.querySelector(".pr-hl-layer");
    if (!layer) return;
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    for (var i = 0; i < highlights.length; i++) {
      var h = highlights[i];
      var parsed = parseAnchor(h.anchor);
      if (!parsed || parsed.page !== currentPage) continue;
      var fill = HIGHLIGHT_COLORS[h.color] || HIGHLIGHT_COLORS.amber;
      for (var q = 0; q < parsed.quads.length; q++) {
        var rect = quadToRect(parsed.quads[q]);
        if (rect.width <= 0 || rect.height <= 0) continue;
        var div = document.createElement("div");
        div.className = "pr-hl";
        div.setAttribute("data-color", h.color || "amber");
        div.setAttribute("data-anchor", h.anchor);
        div.style.left = rect.left + "px";
        div.style.top = rect.top + "px";
        div.style.width = rect.width + "px";
        div.style.height = rect.height + "px";
        div.style.background = fill;
        layer.appendChild(div);
        painted.push({ anchor: h.anchor, rect: rect });
      }
    }
  }

  function paintHighlights(list) {
    highlights = Array.isArray(list) ? list.slice() : [];
    repaintHighlights();
  }

  // Hit-test a click against the painted rects (the highlight layer sits
  // under the text layer so it can't take pointer events itself).
  function highlightAt(clientX, clientY) {
    if (!host || !painted.length) return null;
    var hr = host.getBoundingClientRect();
    var x = clientX - hr.left;
    var y = clientY - hr.top;
    for (var i = 0; i < painted.length; i++) {
      var r = painted[i].rect;
      if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) {
        return painted[i].anchor;
      }
    }
    return null;
  }

  // ---- selection --------------------------------------------------------

  function selectionInHost() {
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    if (!String(sel).trim()) return null;
    var tl = host && host.querySelector(".pr-textlayer");
    if (!tl) return null;
    var range = sel.getRangeAt(0);
    var common = range.commonAncestorContainer;
    if (!tl.contains(common) && common !== tl) return null;
    return { sel: sel, range: range, tl: tl };
  }

  function emitSelection(found) {
    var hr = host.getBoundingClientRect();
    var rects = found.range.getClientRects();
    var quads = [];
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (r.width < 1 || r.height < 1) continue;
      var left = r.left - hr.left;
      var top = r.top - hr.top;
      var right = r.right - hr.left;
      var bottom = r.bottom - hr.top;
      // The render viewport carries the page's /Rotate, so its inverse lands
      // every corner in the unrotated user space the anchor stores — the
      // same frame PDFKit's `bounds(for:)` reports.
      var ul = viewport.convertToPdfPoint(left, top);
      var ur = viewport.convertToPdfPoint(right, top);
      var ll = viewport.convertToPdfPoint(left, bottom);
      var lr = viewport.convertToPdfPoint(right, bottom);
      quads.push([
        round1(ul[0]), round1(ul[1]), round1(ur[0]), round1(ur[1]),
        round1(ll[0]), round1(ll[1]), round1(lr[0]), round1(lr[1]),
      ]);
      if (left < minX) minX = left;
      if (top < minY) minY = top;
      if (right > maxX) maxX = right;
    }
    if (!quads.length) return;
    var text = String(found.sel);
    var key = currentPage + ":" + text + ":" + quads.length;
    if (key === lastSelectionKey) return;
    lastSelectionKey = key;
    // The popover positions inside the reader root (the host's offset
    // parent chain), so report the rect relative to that root.
    var root = host.closest(".pr-root") || host.parentElement;
    var rr = root.getBoundingClientRect();
    emit(
      "__omnibusOnPdfSelection",
      JSON.stringify({
        page: currentPage,
        quads: quads,
        text: text,
        rect: {
          x: minX + hr.left - rr.left,
          y: minY + hr.top - rr.top,
          width: maxX - minX,
        },
      })
    );
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function clearSelectionState() {
    if (lastSelectionKey !== null) {
      lastSelectionKey = null;
      emit("__omnibusOnPdfSelectionCleared", "");
    }
  }

  function checkSelection() {
    if (!viewport) return;
    var found = selectionInHost();
    if (found) {
      emitSelection(found);
    } else {
      clearSelectionState();
    }
  }

  function installSelectionWatch() {
    if (!host || host.__omnibusPdfWatched) return;
    host.__omnibusPdfWatched = true;
    // Settled selections only: `selectionchange` fires on every drag step
    // and transiently collapses mid-drag, so debounce past that.
    document.addEventListener("selectionchange", function () {
      if (selectionTimer) clearTimeout(selectionTimer);
      selectionTimer = setTimeout(function () {
        selectionTimer = null;
        checkSelection();
      }, 250);
    });
    host.addEventListener("pointerup", function () {
      // A settled mouse-up reports straight away (the debounce above is the
      // backstop for keyboard/handle adjustments).
      setTimeout(checkSelection, 0);
    });
    host.addEventListener("click", function (evt) {
      var found = selectionInHost();
      if (found) return; // a drag that ended here, not a tap
      var anchor = highlightAt(evt.clientX, evt.clientY);
      if (anchor) emit("__omnibusOnPdfHighlightTap", anchor);
    });
  }

  function clearSelection() {
    try {
      var sel = window.getSelection && window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
    } catch (e) {
      /* ignore */
    }
    lastSelectionKey = null;
  }

  // ---- clipboard / share ------------------------------------------------

  function copyText(text) {
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      }
    } catch (e) {
      /* clipboard unavailable */
    }
  }

  function shareText(text) {
    if (!text) return;
    if (typeof window.__omnibusOnShareText === "function") {
      try {
        window.__omnibusOnShareText(text);
      } catch (e) {
        /* ignore handler errors */
      }
      return;
    }
    try {
      if (navigator.share) {
        navigator.share({ text: text }).catch(function () {});
      } else {
        copyText(text);
      }
    } catch (e) {
      copyText(text);
    }
  }

  window.OmnibusPdfReader = {
    init: init,
    retry: retry,
    destroy: destroy,
    goTo: goTo,
    next: next,
    prev: prev,
    setFit: setFit,
    paintHighlights: paintHighlights,
    clearSelection: clearSelection,
    copyText: copyText,
    shareText: shareText,
  };
})();
