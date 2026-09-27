//! Reader bootstrap: the two JS builders that mount the web reader — one
//! loads the vendored runtime in order at mount, the other calls
//! `OmnibusReader.init(...)` with the chosen CFI and typography once the
//! progress fetch has decided where the book opens.

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
}

/// Build the JS that loads JSZip → epub.js → glue **in order**, each only
/// after the last has loaded, as `window.__omnibusReaderLoad()`, and starts
/// it. Not `document::Script`: on a client-side navigation those tags run in
/// download order, and an epub.js that runs before JSZip binds
/// `window.JSZip` as undefined for the page's life. Serial rather than
/// parallel so a failed JSZip can never let epub.js run at all. Once the glue
/// exists it drains `window.__omnibusReaderQueue` — the glue calls made before
/// it loaded (see `reader_call`) — so they reach it ahead of `init`, as they
/// did when SSR put the scripts in `<head>`. Each script times out at 10 s.
#[cfg_attr(not(feature = "web"), allow(dead_code))]
pub(crate) fn reader_runtime_load_js(jszip_lit: &str, epub_lit: &str, glue_lit: &str) -> String {
    format!(
        r#"(function(){{
  function load(src){{return new Promise(function(res,rej){{
    var s=document.createElement("script");s.src=src;
    var t=setTimeout(function(){{s.remove();rej();}},10000);
    s.onload=function(){{clearTimeout(t);res();}};
    s.onerror=function(){{clearTimeout(t);s.remove();rej();}};
    document.head.appendChild(s);
  }});}}
  function ensure(has,src){{return has()?Promise.resolve():load(src);}}
  window.__omnibusReaderQueue=[];
  window.__omnibusReaderLoad=function(){{
    window.__omnibusReaderLoaded=ensure(function(){{return !!window.JSZip;}},{jszip_lit})
      .then(function(){{return ensure(function(){{return !!window.ePub;}},{epub_lit});}})
      .then(function(){{return ensure(function(){{return !!window.OmnibusReader;}},{glue_lit});}})
      .then(function(){{
        var q=window.__omnibusReaderQueue;window.__omnibusReaderQueue=[];
        for(var i=0;i<q.length;i++){{try{{q[i]();}}catch(e){{}}}}
      }});
    return window.__omnibusReaderLoaded;
  }};
  window.__omnibusReaderLoad().catch(function(){{}});
}})();"#
    )
}

/// Build the JS that calls `OmnibusReader.init` once the runtime load started
/// by [`reader_runtime_load_js`] resolves, signalling `error` via
/// `window.__omnibusOnStatus` if it fails. Kept as `window.__omnibusReaderBoot`
/// so Retry re-runs it with `true`: reload whatever failed, then re-init.
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
    } = *args;
    format!(
        r#"(function(){{
  window.__omnibusReaderBoot=function(reload){{
    (reload ? window.__omnibusReaderLoad() : window.__omnibusReaderLoaded).then(function(){{
      window.OmnibusReader.init("omnibus-viewer", {url_lit}, {{ cfi: {cfi_arg}, fontSize: {font_size}, theme: {theme_lit}, fontFamily: {font_family_lit}, fontsHref: {fonts_href_lit}, lineHeight: {line_height_lit}, maxWidth: {max_width_lit}, justify: {justify_val}, spread: {spread_lit}, locationsKey: {locations_key_lit} }});
    }}).catch(function(){{
      if (typeof window.__omnibusOnStatus === "function") window.__omnibusOnStatus("error");
    }});
  }};
  window.__omnibusReaderBoot(false);
}})();"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reader_runtime_load_js_loads_jszip_then_epub_then_glue_then_drains_the_queue() {
        let js = reader_runtime_load_js("\"/a/jszip.js\"", "\"/a/epub.js\"", "\"/a/glue.js\"");
        let jszip = js.find("/a/jszip.js").unwrap();
        let epub = js.find("/a/epub.js").unwrap();
        let glue = js.find("/a/glue.js").unwrap();
        let drain = js.find("var q=window.__omnibusReaderQueue").unwrap();
        assert!(jszip < epub && epub < glue && glue < drain);
        assert!(js.contains("window.__omnibusReaderLoad=function"));
    }

    #[test]
    fn reader_bootstrap_js_inits_after_the_load_and_reports_a_failed_one() {
        let js = reader_bootstrap_js(&BootstrapArgs {
            url_lit: "\"/api/ebooks/x/file\"",
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
        });
        let loaded = js.find("window.__omnibusReaderLoaded").unwrap();
        let init = js.find("window.OmnibusReader.init").unwrap();
        assert!(loaded < init);
        assert!(js.contains("__omnibusOnStatus(\"error\")"));
        assert!(js.contains("window.__omnibusReaderBoot=function"));
        for lit in [
            "cfi: \"epubcfi(/6/2)\"",
            "fontSize: 22",
            "theme: \"sepia\"",
            "fontFamily: \"Georgia, serif\"",
            "fontsHref: \"/assets/reader-fonts/reader-fonts.css\"",
            "lineHeight: \"1.5\"",
            "maxWidth: \"42rem\"",
            "justify: true",
            "spread: \"none\"",
            "locationsKey: \"book-uuid\"",
        ] {
            assert!(js.contains(lit), "missing {lit}");
        }
    }
}
