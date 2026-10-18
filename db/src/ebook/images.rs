//! The images an EPUB carries: which manifest images each spine document shows
//! (`<img src>` and SVG `<image href>`), and one image's original bytes by
//! archive path. The reference walk is shared with cover resolution
//! (`cover::embedded`); the listing and fetch back the REST and MCP image tools.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

use anyhow::Context;
use epub::doc::EpubDoc;
use omnibus_shared::{BookImage, BookImageReference};
use quick_xml::events::Event;
use zip::read::ZipFile;
use zip::result::{ZipError, ZipResult};

use crate::comic::{read_capped, MAX_PAGE_BYTES};
use crate::ebook::toc::join_href;

#[cfg(test)]
mod tests;

type Package = EpubDoc<BufReader<File>>;
type Archive = zip::ZipArchive<File>;

/// How much of an image's start is read to learn its pixel size. Headers sit
/// at the front, so a listing never decompresses a whole multi-megabyte plate.
const DIMENSION_PREFIX_BYTES: u64 = 1024 * 1024;

/// Decompressed bytes one listing may read across image headers and spine
/// documents, so a book of thousands of items cannot cost thousands of cap-sized
/// inflations per call.
const LISTING_BUDGET: u64 = 4 * MAX_PAGE_BYTES;

/// One image reference in an XHTML page.
pub struct ImageRef {
    pub src: String,
    /// The `<img alt>` text; `None` when blank, and always for an SVG `<image>`.
    pub alt: Option<String>,
}

/// Every distinct `image/*` manifest item of the EPUB at `path`, with its
/// size, pixel dimensions and the spine documents that show it. Ordered by
/// first spine reference, then href; unreferenced images come last.
pub fn list_images(path: &Path) -> anyhow::Result<Vec<BookImage>> {
    let file = File::open(path).with_context(|| format!("open epub {}", path.display()))?;
    let (doc, mut archive) = open(file).with_context(|| format!("read epub {}", path.display()))?;
    let mut budget = LISTING_BUDGET;
    let mut images = manifest_images(&doc, &mut archive, &mut budget);
    attach_references(&doc, &mut archive, &mut images, &mut budget);
    // BTreeMap order is href order, and the sort is stable.
    let mut images: Vec<BookImage> = images.into_values().collect();
    images.sort_by_key(|i| i.references.first().map_or(i64::MAX, |r| r.spine_index));
    Ok(images)
}

/// Read up to `cap` bytes of `entry`, charging `budget` what was inflated: the
/// bytes read, or all of `cap` when the read fails partway.
fn read_budgeted(entry: impl Read, cap: u64, budget: &mut u64) -> anyhow::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    let read = entry.take(cap).read_to_end(&mut bytes);
    *budget = budget.saturating_sub(read.as_ref().map_or(cap, |&n| n as u64));
    read?;
    Ok(bytes)
}

/// The manifest's `image/*` items present in the archive, keyed by archive path.
/// Once `budget` is spent the rest list without pixel dimensions.
fn manifest_images(
    doc: &Package,
    archive: &mut Archive,
    budget: &mut u64,
) -> BTreeMap<String, BookImage> {
    let mut images = BTreeMap::new();
    for item in doc
        .resources
        .values()
        .filter(|i| i.mime.starts_with("image/"))
    {
        let href = archive_path(&item.path);
        if images.contains_key(&href) {
            continue;
        }
        let Ok(entry) = archive_entry(archive, &href) else {
            continue;
        };
        let byte_size = i64::try_from(entry.size()).unwrap_or(i64::MAX);
        let dimensions = (*budget > 0)
            .then(|| read_budgeted(entry, DIMENSION_PREFIX_BYTES, budget).ok())
            .flatten()
            .and_then(|prefix| crate::metadata_lookup::cover::dimensions(&prefix));
        images.insert(href.clone(), BookImage {
            href,
            media_type: item.mime.clone(),
            byte_size,
            width: dimensions.map(|(w, _)| i64::from(w)),
            height: dimensions.map(|(_, h)| i64::from(h)),
            references: Vec::new(),
        });
    }
    images
}

/// Record, per spine document in spine order, each manifest image it shows,
/// until `budget` is spent.
fn attach_references(
    doc: &Package,
    archive: &mut Archive,
    images: &mut BTreeMap<String, BookImage>,
    budget: &mut u64,
) {
    for (index, spine_item) in doc.spine.iter().enumerate() {
        if *budget == 0 {
            tracing::warn!(spine_index = index, "book images: byte budget spent");
            break;
        }
        let spine_index = index as i64;
        let Some(resource) = doc.resources.get(&spine_item.idref) else {
            continue;
        };
        let page_path = archive_path(&resource.path);
        let page = match archive_entry(archive, &page_path)
            .map_err(anyhow::Error::from)
            .and_then(|entry| read_budgeted(entry, MAX_PAGE_BYTES + 1, budget))
            .and_then(|page| {
                // Reading one byte past the cap is how an oversized page shows itself.
                anyhow::ensure!(
                    page.len() as u64 <= MAX_PAGE_BYTES,
                    "entry {page_path} exceeds {MAX_PAGE_BYTES} byte cap"
                );
                Ok(page)
            }) {
            Ok(page) => page,
            Err(e) => {
                // Debug-quoted (the error text embeds the path too) so a newline in a manifest path cannot forge a log line.
                tracing::warn!(page = ?page_path, error = ?e.to_string(), "book images: spine document unreadable");
                continue;
            }
        };
        let dir = page_path.rsplit_once('/').map_or("", |(dir, _)| dir);
        for found in image_refs(&page) {
            // shortcut: hrefs compare as written (no percent-decoding), upgrade if a real book's src and manifest encode differently
            let Some(image) = images.get_mut(&join_href(dir, strip_fragment(&found.src))) else {
                continue;
            };
            if image
                .references
                .last()
                .is_some_and(|r| r.spine_index == spine_index)
            {
                continue;
            }
            image.references.push(BookImageReference {
                spine_index,
                alt: found.alt,
            });
        }
    }
}

/// The original bytes of the `image/*` manifest item at archive path `href`,
/// with its manifest media type. `Ok(None)` when `href` names no such item:
/// it is only ever compared to manifest paths, never joined to one, so it
/// cannot reach another entry or a file outside the archive.
pub fn read_image(file: File, href: &str) -> anyhow::Result<Option<(String, Vec<u8>)>> {
    let (doc, mut archive) = open(file)?;
    let Some(item) = doc
        .resources
        .values()
        .find(|i| i.mime.starts_with("image/") && archive_path(&i.path) == href)
    else {
        return Ok(None);
    };
    let bytes = read_capped(archive_entry(&mut archive, href)?, href)?;
    Ok(Some((item.mime.clone(), bytes)))
}

/// The package and the raw archive over one inode, so a replace-by-rename
/// between the two reads cannot mix two files.
fn open(file: File) -> anyhow::Result<(Package, Archive)> {
    let doc = EpubDoc::from_reader(BufReader::new(file.try_clone()?))?;
    Ok((doc, zip::ZipArchive::new(file)?))
}

/// An entry by manifest href: the epub crate keeps hrefs percent-encoded while
/// entry names are literal, so retry decoded as its own lookup does.
fn archive_entry<'a>(archive: &'a mut Archive, href: &str) -> ZipResult<ZipFile<'a, File>> {
    let index = archive
        .index_for_name(href)
        .or_else(|| archive.index_for_name(&urlencoding::decode(href).ok()?))
        .ok_or(ZipError::FileNotFound)?;
    archive.by_index(index)
}

/// Every image reference in an XHTML page, in document order.
pub fn image_refs(xhtml: &[u8]) -> Vec<ImageRef> {
    let mut reader = quick_xml::Reader::from_reader(xhtml);
    let mut buf = Vec::new();
    let mut refs = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                let local = e.local_name();
                let found = if local.as_ref().eq_ignore_ascii_case(b"img") {
                    attr(e, b"src").map(|src| {
                        let alt = attr(e, b"alt")
                            .map(|a| a.trim().to_string())
                            .filter(|a| !a.is_empty());
                        (src, alt)
                    })
                } else if local.as_ref().eq_ignore_ascii_case(b"image") {
                    attr(e, b"href").map(|src| (src, None))
                } else {
                    None
                };
                refs.extend(
                    found
                        .filter(|(src, _)| !src.is_empty())
                        .map(|(src, alt)| ImageRef { src, alt }),
                );
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    refs
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
