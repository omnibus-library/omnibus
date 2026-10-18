//! The images an EPUB's XHTML shows: finding the `<img src>` and SVG
//! `<image href>` references in a page and resolving them to archive paths.
//! Shared by cover resolution (`cover::embedded`) and the book-image listing
//! the REST and MCP layers serve.

use quick_xml::events::Event;

use crate::ebook::toc::join_href;

/// Every image reference in an XHTML page, in document order.
pub fn image_srcs(xhtml: &[u8]) -> Vec<String> {
    let mut reader = quick_xml::Reader::from_reader(xhtml);
    let mut buf = Vec::new();
    let mut srcs = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                let local = e.local_name();
                let src = if local.as_ref().eq_ignore_ascii_case(b"img") {
                    attr(e, b"src")
                } else if local.as_ref().eq_ignore_ascii_case(b"image") {
                    attr(e, b"href")
                } else {
                    None
                };
                srcs.extend(src.filter(|s| !s.is_empty()));
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    srcs
}

/// A manifest path as the `/`-separated archive entry name, `.`/`..`
/// resolved — the crate joins hrefs onto the OPF directory verbatim.
pub fn archive_path(path: &std::path::Path) -> String {
    join_href("", &path.to_string_lossy().replace('\\', "/"))
}

/// `href` without its `#fragment`.
pub fn strip_fragment(href: &str) -> &str {
    href.split('#').next().unwrap_or(href)
}

/// An attribute's value by local name, so `xlink:href` answers to `href`.
pub fn attr(e: &quick_xml::events::BytesStart, name: &[u8]) -> Option<String> {
    e.attributes().flatten().find_map(|a| {
        let key = a.key.as_ref();
        let local = key.rsplit(|b| *b == b':').next().unwrap_or(key);
        local
            .eq_ignore_ascii_case(name)
            .then(|| a.normalized_value(quick_xml::XmlVersion::Implicit1_0).ok())
            .flatten()
            .map(|v| v.into_owned())
    })
}
