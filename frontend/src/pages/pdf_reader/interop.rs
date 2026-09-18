//! PDF reader interop: pure JS-string builders plus the `dioxus::document::eval`
//! seam that mounts the vendored PDF.js glue (`window.OmnibusPdfReader`, see
//! `frontend/assets/vendor/pdf-reader-glue.js`). One implementation serves both
//! interactive targets — the `window.__omnibusOnPdf*` shims forward into
//! `dioxus.send(...)` (drained via `Eval::recv`), which web and mobile both
//! support — the barcode scanner's pattern rather than the EPUB reader's
//! web-only `wasm_bindgen` window callbacks.

// SSR never evals: it compiles the builders only so their tests run under the
// `server` feature (the matrix `cargo test -p omnibus-frontend` uses).
#![cfg_attr(not(any(feature = "web", feature = "mobile")), allow(dead_code))]

#[cfg(any(feature = "web", feature = "mobile"))]
use dioxus::document::Eval;

use crate::js_interop::json_literal;

/// Absolute URLs of the vendored PDF runtime, resolved from the `asset!`
/// bundle: the glue (a classic script), the two ES modules it imports on
/// demand — the library and its worker — and the directory holding the
/// worker's WASM image decoders (JPEG 2000, JBIG2/CCITT, ICC). Without that
/// directory PDF.js silently drops every image those codecs encode, and a
/// scanned or illustrated book opens as blank pages.
pub(super) struct PdfScripts {
    pub glue: String,
    pub pdfjs: String,
    pub worker: String,
    pub wasm_dir: String,
}

/// PDF.js's `wasmUrl` is a prefix it concatenates a filename onto, so the
/// bundled directory URL needs its trailing slash back.
fn wasm_url(dir: &str) -> String {
    if dir.ends_with('/') {
        dir.to_string()
    } else {
        format!("{dir}/")
    }
}

/// What `init()` needs to open a document: the file URL PDF.js range-fetches,
/// the 0-based page to land on (clamped by the glue), and the fit mode.
pub(super) struct MountOptions {
    pub url: String,
    pub start_page: usize,
    pub fit: &'static str,
}

/// JS→Rust reader events, forwarded by the shims the install script defines.
#[derive(Debug, serde::Deserialize)]
#[serde(tag = "kind")]
pub(super) enum PdfEvent {
    /// First page painted; `json` is a [`PdfPosition`].
    Ready { json: String },
    /// A later page painted; `json` is a [`PdfPosition`].
    Page { json: String },
    /// Open or render failure.
    Error { message: String },
    /// A settled text selection on the text layer; `json` is a
    /// [`super::highlights::PdfSelection`].
    Selection { json: String },
    /// The selection collapsed (tap-away, page turn).
    SelectionCleared,
    /// A tap on a painted highlight, by its stored anchor.
    HighlightTap { anchor: String },
}

/// The glue's position report: the 0-based page showing and the document's
/// page count (PDF.js's `numPages`, authoritative over the indexed count).
#[derive(Debug, Clone, Copy, serde::Deserialize)]
pub(super) struct PdfPosition {
    pub page: usize,
    #[serde(rename = "pageCount")]
    pub page_count: usize,
}

/// Build the install IIFE: define the `__omnibusOnPdf*` → `dioxus.send`
/// shims, load the glue if it isn't resident, then `init()` it into the
/// element with id `host_id`. Any load failure surfaces as an `Error` event
/// so the page shows its retry overlay instead of hanging on "Loading…".
pub(super) fn install_pdf_js(host_id: &str, opts: &MountOptions, scripts: &PdfScripts) -> String {
    let host_lit = json_literal(host_id);
    let glue_lit = json_literal(&scripts.glue);
    let opts_lit = json_literal(&serde_json::json!({
        "url": opts.url,
        "pdfjs": scripts.pdfjs,
        "worker": scripts.worker,
        "wasmUrl": wasm_url(&scripts.wasm_dir),
        "startPage": opts.start_page,
        "fit": opts.fit,
    }));
    format!(
        r#"(function(){{
  window.__omnibusOnPdfReady=function(j){{dioxus.send({{kind:"Ready",json:j}});}};
  window.__omnibusOnPdfPage=function(j){{dioxus.send({{kind:"Page",json:j}});}};
  window.__omnibusOnPdfError=function(m){{dioxus.send({{kind:"Error",message:String(m)}});}};
  window.__omnibusOnPdfSelection=function(j){{dioxus.send({{kind:"Selection",json:j}});}};
  window.__omnibusOnPdfSelectionCleared=function(){{dioxus.send({{kind:"SelectionCleared"}});}};
  window.__omnibusOnPdfHighlightTap=function(a){{dioxus.send({{kind:"HighlightTap",anchor:String(a)}});}};
  function load(src){{return new Promise(function(res,rej){{
    var s=document.createElement("script");s.src=src;s.async=false;
    var t=setTimeout(function(){{rej();}},10000);
    s.onload=function(){{clearTimeout(t);res();}};
    s.onerror=function(){{clearTimeout(t);rej();}};
    document.head.appendChild(s);
  }});}}
  function ensure(has,src){{return has()?Promise.resolve():load(src);}}
  ensure(function(){{return !!window.OmnibusPdfReader;}},{glue_lit})
    .then(function(){{window.OmnibusPdfReader.init({host_lit},{opts_lit});}})
    .catch(function(){{dioxus.send({{kind:"Error",message:"glue failed to load"}});}});
}})();"#
    )
}

/// One `window.OmnibusPdfReader.<method>(<args>)` call, guarded so a page
/// that never finished loading the glue is a no-op rather than a throw.
pub(super) fn call_js(method: &str, args_js: &str) -> String {
    format!("window.OmnibusPdfReader && window.OmnibusPdfReader.{method}({args_js});")
}

/// Eval the install script and return the persistent [`Eval`] the caller
/// drains for reader events.
#[cfg(any(feature = "web", feature = "mobile"))]
pub(super) fn install_pdf_surface(
    host_id: &str,
    opts: &MountOptions,
    scripts: &PdfScripts,
) -> Eval {
    dioxus::document::eval(&install_pdf_js(host_id, opts, scripts))
}

/// Fire-and-forget glue call with pre-encoded JS arguments. No-op where
/// there's no WebView to talk to (SSR, tests).
#[cfg_attr(not(any(feature = "web", feature = "mobile")), allow(unused_variables))]
pub(super) fn pdf_call(method: &str, args_js: &str) {
    #[cfg(any(feature = "web", feature = "mobile"))]
    {
        let _ = dioxus::document::eval(&call_js(method, args_js));
    }
}

/// [`pdf_call`] with one JSON-encoded argument.
pub(super) fn pdf_call_json<T: serde::Serialize + ?Sized>(method: &str, value: &T) {
    pdf_call(method, &json_literal(value));
}

/// Show 0-based page `n`.
pub(super) fn go_to(n: usize) {
    pdf_call_json("goTo", &n);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scripts() -> PdfScripts {
        PdfScripts {
            glue: "/assets/pdf-reader-glue.js".into(),
            pdfjs: "/assets/pdf.min.mjs".into(),
            worker: "/assets/pdf.worker.min.mjs".into(),
            wasm_dir: "/assets/pdfjs-wasm-a1b2c3".into(),
        }
    }

    #[test]
    fn install_pdf_js_defines_every_shim_and_inits_the_named_host() {
        let js = install_pdf_js(
            "omnibus-pdf-page",
            &MountOptions {
                url: "/api/ebooks/book-a/file".into(),
                start_page: 4,
                fit: "height",
            },
            &scripts(),
        );
        for shim in [
            "__omnibusOnPdfReady",
            "__omnibusOnPdfPage",
            "__omnibusOnPdfError",
            "__omnibusOnPdfSelection",
            "__omnibusOnPdfSelectionCleared",
            "__omnibusOnPdfHighlightTap",
        ] {
            assert!(js.contains(&format!("window.{shim}=")), "{shim}");
        }
        assert!(js.contains(r#"OmnibusPdfReader.init("omnibus-pdf-page","#));
        assert!(js.contains(r#""startPage":4"#));
        assert!(js.contains(r#""fit":"height""#));
        assert!(js.contains(r#""url":"/api/ebooks/book-a/file""#));
        // The module URLs ride the options bag: the glue can't resolve them
        // relative to itself once the bundler hashes the filenames.
        assert!(js.contains(r#""pdfjs":"/assets/pdf.min.mjs""#));
        assert!(js.contains(r#""worker":"/assets/pdf.worker.min.mjs""#));
        assert!(js.contains(r#"glue failed to load"#));
    }

    #[test]
    fn install_pdf_js_passes_the_wasm_directory_as_a_slash_terminated_prefix() {
        let js = install_pdf_js(
            "omnibus-pdf-page",
            &MountOptions {
                url: "/api/ebooks/book-a/file".into(),
                start_page: 0,
                fit: "height",
            },
            &scripts(),
        );
        // The worker appends `openjpeg.wasm` etc. to this verbatim.
        assert!(js.contains(r#""wasmUrl":"/assets/pdfjs-wasm-a1b2c3/""#));
    }

    #[test]
    fn wasm_url_adds_exactly_one_trailing_slash() {
        assert_eq!(
            wasm_url("/assets/pdfjs-wasm-a1b2c3"),
            "/assets/pdfjs-wasm-a1b2c3/"
        );
        assert_eq!(
            wasm_url("/assets/pdfjs-wasm-a1b2c3/"),
            "/assets/pdfjs-wasm-a1b2c3/"
        );
    }

    #[test]
    fn call_js_guards_on_the_glue_being_resident() {
        assert_eq!(
            call_js("goTo", "3"),
            "window.OmnibusPdfReader && window.OmnibusPdfReader.goTo(3);"
        );
    }

    #[test]
    fn pdf_event_decodes_the_tagged_shapes() {
        let ready: PdfEvent =
            serde_json::from_str(r#"{"kind":"Ready","json":"{\"page\":2,\"pageCount\":9}"}"#)
                .unwrap();
        let PdfEvent::Ready { json } = ready else {
            panic!("wrong variant");
        };
        let pos: PdfPosition = serde_json::from_str(&json).unwrap();
        assert_eq!((pos.page, pos.page_count), (2, 9));

        let cleared: PdfEvent = serde_json::from_str(r#"{"kind":"SelectionCleared"}"#).unwrap();
        assert!(matches!(cleared, PdfEvent::SelectionCleared));

        let tap: PdfEvent =
            serde_json::from_str(r#"{"kind":"HighlightTap","anchor":"pdf:3"}"#).unwrap();
        assert!(matches!(tap, PdfEvent::HighlightTap { anchor } if anchor == "pdf:3"));
    }
}
