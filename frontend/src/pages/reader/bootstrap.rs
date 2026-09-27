//! Reader bootstrap: builds the IIFE that loads the vendored reader runtime in
//! order, then calls `OmnibusReader.init(...)` with the chosen CFI and
//! typography. Extracted from `BookReadPage` so the parent reads as plain Rust
//! glue rather than JS template literals.

/// Inputs to [`reader_bootstrap_js`]; all string values are JSON-quoted
/// literals already (e.g. `"\"dark\""`, `"null"`), not raw values, so
/// the caller can feed any string through `serde_json::to_string`.
#[cfg_attr(not(feature = "web"), allow(dead_code))]
pub(crate) struct BootstrapArgs<'a> {
    pub url_lit: &'a str,
    pub cfi_arg: &'a str,
    pub font_size: i32,
    pub theme_lit: &'a str,
    pub font_family_lit: &'a str,
    /// The reader's self-hosted `@font-face` sheet, linked inside every section.
    pub fonts_href_lit: &'a str,
    pub line_height_lit: &'a str,
    pub max_width_lit: &'a str,
    pub justify_val: bool,
    pub spread_lit: &'a str,
    /// Book uuid, the glue's per-book locations-cache key.
    pub locations_key_lit: &'a str,
    /// Script URLs of JSZip, epub.js and the glue, in load order.
    pub jszip_lit: &'a str,
    pub epub_lit: &'a str,
    pub glue_lit: &'a str,
}

/// Build the JS IIFE that loads JSZip → epub.js → glue **in order** and mounts
/// the reader. Not `document::Script`: on a client-side navigation those tags
/// are inserted dynamically, so they run in download order, and an epub.js
/// that runs before JSZip binds `window.JSZip` as undefined for the page's
/// life. The load + init is kept as `window.__omnibusReaderBoot` so Retry
/// re-runs it, and the load alone as `window.__omnibusReaderLoaded` so calls
/// made before the glue exists can wait for it ([`after_reader_loaded_js`]).
/// A script that fails or stalls 10 s signals `error`.
#[cfg_attr(not(feature = "web"), allow(dead_code))]
pub(crate) fn reader_bootstrap_js(args: &BootstrapArgs<'_>) -> String {
    let BootstrapArgs {
        url_lit,
        cfi_arg,
        font_size,
        theme_lit,
        font_family_lit,
        fonts_href_lit,
        line_height_lit,
        max_width_lit,
        justify_val,
        spread_lit,
        locations_key_lit,
        jszip_lit,
        epub_lit,
        glue_lit,
    } = *args;
    format!(
        r#"(function(){{
  function load(src){{return new Promise(function(res,rej){{
    var s=document.createElement("script");s.src=src;s.async=false;
    var t=setTimeout(function(){{s.remove();rej();}},10000);
    s.onload=function(){{clearTimeout(t);res();}};
    s.onerror=function(){{clearTimeout(t);s.remove();rej();}};
    document.head.appendChild(s);
  }});}}
  function ensure(has,src){{return has()?Promise.resolve():load(src);}}
  function fail(){{if(typeof window.__omnibusOnStatus==="function")window.__omnibusOnStatus("error");}}
  window.__omnibusReaderBoot=function(){{
    window.__omnibusReaderLoaded=ensure(function(){{return !!window.JSZip;}},{jszip_lit})
      .then(function(){{return ensure(function(){{return !!window.ePub;}},{epub_lit});}})
      .then(function(){{return ensure(function(){{return !!window.OmnibusReader;}},{glue_lit});}});
    window.__omnibusReaderLoaded.then(function(){{
        window.OmnibusReader.init("omnibus-viewer", {url_lit}, {{ cfi: {cfi_arg}, fontSize: {font_size}, theme: {theme_lit}, fontFamily: {font_family_lit}, fontsHref: {fonts_href_lit}, lineHeight: {line_height_lit}, maxWidth: {max_width_lit}, justify: {justify_val}, spread: {spread_lit}, locationsKey: {locations_key_lit} }});
      }})
      .catch(fail);
  }};
  window.__omnibusReaderBoot();
}})();"#
    )
}

/// Wrap a glue call so it runs once the bootstrap has loaded the glue rather
/// than being dropped because `window.OmnibusReader` does not exist yet.
#[cfg_attr(not(feature = "web"), allow(dead_code))]
pub(crate) fn after_reader_loaded_js(call_js: &str) -> String {
    format!(
        "(window.__omnibusReaderLoaded || Promise.resolve()).then(function(){{ if (window.OmnibusReader) window.OmnibusReader.{call_js}; }});"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reader_bootstrap_js_contains_init_call_and_loads_the_runtime() {
        let js = reader_bootstrap_js(&BootstrapArgs {
            url_lit: "\"/api/ebooks/x/file\"",
            cfi_arg: "null",
            font_size: 18,
            theme_lit: "\"dark\"",
            font_family_lit: "null",
            fonts_href_lit: "\"/assets/reader-fonts/reader-fonts.css\"",
            line_height_lit: "null",
            max_width_lit: "null",
            justify_val: false,
            spread_lit: "\"auto\"",
            locations_key_lit: "\"x\"",
            jszip_lit: "\"/a/jszip.js\"",
            epub_lit: "\"/a/epub.js\"",
            glue_lit: "\"/a/glue.js\"",
        });
        assert!(js.contains("window.OmnibusReader.init"));
        assert!(js.contains("window.ePub"));
        assert!(js.contains("fontSize: 18"));
        assert!(js.contains("theme: \"dark\""));
        assert!(js.contains("justify: false"));
        assert!(js.contains("spread: \"auto\""));
        assert!(js.contains("locationsKey: \"x\""));
        assert!(js.contains("__omnibusOnStatus"));
        assert!(js.contains("window.__omnibusReaderBoot="));
    }

    #[test]
    fn reader_bootstrap_js_loads_jszip_before_epub_before_glue_without_async() {
        let js = reader_bootstrap_js(&BootstrapArgs {
            url_lit: "\"u\"",
            cfi_arg: "null",
            font_size: 18,
            theme_lit: "\"dark\"",
            font_family_lit: "null",
            fonts_href_lit: "\"f\"",
            line_height_lit: "null",
            max_width_lit: "null",
            justify_val: false,
            spread_lit: "\"auto\"",
            locations_key_lit: "\"x\"",
            jszip_lit: "\"/a/jszip.js\"",
            epub_lit: "\"/a/epub.js\"",
            glue_lit: "\"/a/glue.js\"",
        });
        let jszip = js.find("/a/jszip.js").unwrap();
        let epub = js.find("/a/epub.js").unwrap();
        let glue = js.find("/a/glue.js").unwrap();
        let init = js.find("OmnibusReader.init").unwrap();
        assert!(jszip < epub && epub < glue && glue < init);
        assert!(js.contains("s.async=false"));
    }

    #[test]
    fn after_reader_loaded_js_waits_on_the_load_before_calling_the_glue() {
        let js = after_reader_loaded_js("addAnnotation(\"c\", \"yellow\")");
        let wait = js.find("__omnibusReaderLoaded").unwrap();
        let call = js
            .find("window.OmnibusReader.addAnnotation(\"c\", \"yellow\")")
            .unwrap();
        assert!(wait < call);
    }

    #[test]
    fn reader_bootstrap_js_threads_typography_literals_through() {
        let js = reader_bootstrap_js(&BootstrapArgs {
            url_lit: "\"u\"",
            cfi_arg: "\"epubcfi(/6/2)\"",
            font_size: 22,
            theme_lit: "\"sepia\"",
            font_family_lit: "\"Georgia, serif\"",
            fonts_href_lit: "\"/assets/reader-fonts/reader-fonts.css\"",
            line_height_lit: "\"1.5\"",
            max_width_lit: "\"42rem\"",
            justify_val: true,
            spread_lit: "\"none\"",
            locations_key_lit: "\"book-uuid\"",
            jszip_lit: "\"j\"",
            epub_lit: "\"e\"",
            glue_lit: "\"g\"",
        });
        assert!(js.contains("spread: \"none\""));
        assert!(js.contains("cfi: \"epubcfi(/6/2)\""));
        assert!(js.contains("fontFamily: \"Georgia, serif\""));
        assert!(js.contains("fontsHref: \"/assets/reader-fonts/reader-fonts.css\""));
        assert!(js.contains("lineHeight: \"1.5\""));
        assert!(js.contains("maxWidth: \"42rem\""));
        assert!(js.contains("justify: true"));
    }
}
