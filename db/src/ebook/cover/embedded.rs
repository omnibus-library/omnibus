//! The EPUB's own cover image, found the way readers find it: the declared
//! cover first, then the conventions EPUB2 exporters such as Calibre rely on
//! without declaring anything — a manifest item named `cover`, the OPF
//! guide's cover reference — and the largest raster image as a last resort.

use std::io::{Read, Seek};

use epub::doc::EpubDoc;
use quick_xml::events::Event;

use crate::ebook::toc::join_href;

/// Manifest ids that name the cover by convention rather than declaration.
const CONVENTIONAL_COVER_IDS: &[&str] = &["cover", "cover-image"];

/// Image types a guessed cover may take: the formats the thumbnailer decodes.
const RASTER_MIMES: &[&str] = &["image/jpeg", "image/png", "image/gif", "image/webp"];

/// The EPUB's cover as `(bytes, mime)`, or `None` when nothing plausible is
/// found.
///
/// `EpubDoc::get_cover` reads only the declaration its package `version`
/// calls for, and returns the named resource whatever its type; neither is
/// how real books are shaped. So every declared or conventional id is
/// followed to an image — through an XHTML cover page when that is what it
/// names — before the guide and the manifest's images are consulted.
pub(super) fn embedded_cover<R: Read + Seek>(doc: &mut EpubDoc<R>) -> Option<(Vec<u8>, String)> {
    let mut ids: Vec<String> = Vec::new();
    let declared = [
        doc.get_cover_id(),
        doc.mdata("cover").map(|m| m.value.clone()),
    ];
    let conventional = doc.resources.keys().filter(|id| {
        CONVENTIONAL_COVER_IDS
            .iter()
            .any(|c| id.eq_ignore_ascii_case(c))
    });
    for id in declared.into_iter().flatten().chain(conventional.cloned()) {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    ids.iter()
        .find_map(|id| item_cover(doc, id))
        .or_else(|| guide_cover(doc))
        .or_else(|| largest_image(doc))
}

/// The image manifest item `id` names, directly or as an XHTML cover page's
/// single image.
fn item_cover<R: Read + Seek>(doc: &mut EpubDoc<R>, id: &str) -> Option<(Vec<u8>, String)> {
    let item = doc.resources.get(id)?;
    let (path, mime) = (archive_path(&item.path), item.mime.clone());
    image_or_page_image(doc, &path, mime)
}

/// Follow the OPF guide's `<reference type="cover">` to its image.
fn guide_cover<R: Read + Seek>(doc: &mut EpubDoc<R>) -> Option<(Vec<u8>, String)> {
    let opf = doc.get_resource_by_path(doc.root_file.clone())?;
    let href = guide_cover_href(&opf)?;
    let path = join_href(&archive_path(&doc.root_base), strip_fragment(&href));
    let mime = mime_at(doc, &path)?;
    image_or_page_image(doc, &path, mime)
}

/// The image at `path`, or the single image of the cover page there.
fn image_or_page_image<R: Read + Seek>(
    doc: &mut EpubDoc<R>,
    path: &str,
    mime: String,
) -> Option<(Vec<u8>, String)> {
    if mime.starts_with("image/") {
        return doc.get_resource_by_path(path).map(|bytes| (bytes, mime));
    }
    is_page(&mime).then(|| page_image(doc, path)).flatten()
}

/// The `href` of the guide's cover reference, if the OPF declares one.
fn guide_cover_href(opf: &[u8]) -> Option<String> {
    let mut reader = quick_xml::Reader::from_reader(opf);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf).ok()? {
            Event::Start(ref e) | Event::Empty(ref e)
                if e.local_name().as_ref().eq_ignore_ascii_case(b"reference")
                    && attr(e, b"type").is_some_and(|t| t.eq_ignore_ascii_case("cover")) =>
            {
                return attr(e, b"href").filter(|h| !h.is_empty());
            }
            Event::Eof => return None,
            _ => {}
        }
        buf.clear();
    }
}

/// The one image a cover page shows — `<img src>` or SVG `<image href>` —
/// read from the archive. A page showing several images is not a cover page
/// this can trust, so it yields nothing.
fn page_image<R: Read + Seek>(doc: &mut EpubDoc<R>, page_path: &str) -> Option<(Vec<u8>, String)> {
    let page = doc.get_resource_by_path(page_path)?;
    let mut srcs = image_srcs(&page);
    srcs.sort();
    srcs.dedup();
    let [src] = srcs.as_slice() else {
        return None;
    };
    let dir = page_path.rsplit_once('/').map_or("", |(dir, _)| dir);
    let path = join_href(dir, strip_fragment(src));
    let mime = mime_at(doc, &path).filter(|m| m.starts_with("image/"))?;
    doc.get_resource_by_path(&path).map(|bytes| (bytes, mime))
}

/// Every image reference in an XHTML page, in document order.
fn image_srcs(xhtml: &[u8]) -> Vec<String> {
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

/// The largest raster image in the manifest; ties go to the earlier path so
/// a rescan picks the same one.
fn largest_image<R: Read + Seek>(doc: &mut EpubDoc<R>) -> Option<(Vec<u8>, String)> {
    let mut images = doc
        .resources
        .values()
        .filter(|item| RASTER_MIMES.contains(&item.mime.as_str()))
        .map(|item| (archive_path(&item.path), item.mime.clone()))
        .collect::<Vec<_>>();
    images.sort();
    let mut best: Option<(Vec<u8>, String)> = None;
    for (path, mime) in images {
        let Some(bytes) = doc.get_resource_by_path(&path) else {
            continue;
        };
        if best.as_ref().is_none_or(|(b, _)| bytes.len() > b.len()) {
            best = Some((bytes, mime));
        }
    }
    best
}

/// The manifest's media type for the entry at `path`, else one inferred from
/// its extension.
fn mime_at<R: Read + Seek>(doc: &EpubDoc<R>, path: &str) -> Option<String> {
    doc.resources
        .values()
        .find(|item| archive_path(&item.path) == path)
        .map(|item| item.mime.clone())
        .or_else(|| mime_for_extension(path).map(str::to_string))
}

fn mime_for_extension(path: &str) -> Option<&'static str> {
    let ext = path.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "xhtml" | "xml" => "application/xhtml+xml",
        "html" | "htm" => "text/html",
        _ => return None,
    })
}

fn is_page(mime: &str) -> bool {
    mime == "application/xhtml+xml" || mime == "text/html"
}

/// A manifest path as the `/`-separated archive entry name, `.`/`..`
/// resolved — the crate joins hrefs onto the OPF directory verbatim.
fn archive_path(path: &std::path::Path) -> String {
    join_href("", &path.to_string_lossy().replace('\\', "/"))
}

fn strip_fragment(href: &str) -> &str {
    href.split('#').next().unwrap_or(href)
}

/// An attribute's value by local name, so `xlink:href` answers to `href`.
fn attr(e: &quick_xml::events::BytesStart, name: &[u8]) -> Option<String> {
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
