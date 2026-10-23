//! A downloaded KEPUB's own text: unzip, walk the OPF spine, and extract
//! each chapter's `koboSpan` segments with their decoded text and per-span
//! UTF-16 word offsets. Deliberately not `db::kobo_position` — a second,
//! independent reading of the same markup, so the two disagree when one of
//! them is wrong, rather than one bug hiding behind the other.

use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::Path;

use quick_xml::events::{BytesRef, BytesStart, Event};
use quick_xml::reader::Reader;
use quick_xml::XmlVersion;

use crate::reading::{KoboSpan, Percent};

/// Why a KEPUB's text could not be read.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum KepubError {
    #[error("cannot read the book's file: {0}")]
    Unreadable(String),
    #[error(
        "the book's file has no koboSpan: the server sent a plain EPUB (is kepubify on its PATH?)"
    )]
    NoSpans,
}

/// A downloaded book's koboSpans, chapter by chapter in spine order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Kepub {
    pub chapters: Vec<Chapter>,
}

/// One spine chapter's koboSpans and the words extracted from them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Chapter {
    /// The manifest's href for this chapter, OPF-relative (e.g. `ch1.xhtml`).
    pub href: String,
    pub spans: Vec<Span>,
    pub words: Vec<Word>,
}

/// One `kobo.N.M` element's id and decoded text; nested elements' text
/// (anything but a second koboSpan) counts toward the same span.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Span {
    pub id: String,
    pub text: String,
}

/// One maximal run of non-whitespace characters inside a chapter's `span`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Word {
    /// Index into the owning [`Chapter`]'s `spans`.
    pub span: usize,
    pub text: String,
    /// UTF-16 code units into `spans[span].text`; `end` is exclusive.
    pub start: u32,
    pub end: u32,
}

impl Kepub {
    /// Parse `bytes` as a KEPUB: unzip, read the OPF spine, and extract each
    /// chapter's koboSpans. A chapter with no words is dropped; a book left
    /// with none is [`KepubError::NoSpans`] — the mark of a plain EPUB,
    /// which carries no koboSpan markup at all.
    pub fn parse(bytes: &[u8]) -> Result<Self, KepubError> {
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
            .map_err(|error| KepubError::Unreadable(error.to_string()))?;
        let opf_path = container_opf_path(&mut archive)?;
        let opf_dir = opf_path.rsplit_once('/').map_or("", |(dir, _)| dir);
        let opf = read_entry(&mut archive, &opf_path)?;
        let (manifest, spine) = parse_opf(&opf)?;
        let mut chapters = Vec::new();
        for idref in spine {
            let Some(href) = manifest.get(&idref) else {
                continue;
            };
            let entry_path = if opf_dir.is_empty() {
                href.clone()
            } else {
                format!("{opf_dir}/{href}")
            };
            let xhtml = read_entry(&mut archive, &entry_path)?;
            let spans = parse_spans(&xhtml)?;
            let words = words_in(&spans);
            if words.is_empty() {
                continue;
            }
            chapters.push(Chapter {
                href: href.clone(),
                spans,
                words,
            });
        }
        if chapters.is_empty() {
            return Err(KepubError::NoSpans);
        }
        Ok(Self { chapters })
    }

    /// [`Kepub::parse`] of the file at `path`.
    pub fn open(path: &Path) -> Result<Self, KepubError> {
        let bytes = std::fs::read(path)
            .map_err(|error| KepubError::Unreadable(format!("{}: {error}", path.display())))?;
        Self::parse(&bytes)
    }

    /// `(chapter, span)` for the koboSpan `source`/`span_id` names, by exact
    /// href and id match. `None` for a span the book doesn't hold — a web
    /// position derived against a different edition of the file, say.
    pub fn locate_span(&self, source: &str, span_id: &str) -> Option<(usize, usize)> {
        for (chapter, text) in self.chapters.iter().enumerate() {
            if text.href != source {
                continue;
            }
            if let Some(span) = text.spans.iter().position(|s| s.id == span_id) {
                return Some((chapter, span));
            }
        }
        None
    }

    /// The bookmark naming `chapter`'s `span`: the percent of the book's
    /// words that come before it (every word of earlier chapters, and of
    /// earlier spans in this one), and its `KoboSpan`.
    pub fn bookmark(&self, chapter: usize, span: usize) -> (Percent, KoboSpan) {
        let total: usize = self.chapters.iter().map(|c| c.words.len()).sum();
        let mut before = 0;
        for (index, chapter_at) in self.chapters.iter().enumerate() {
            if index < chapter {
                before += chapter_at.words.len();
            } else if index == chapter {
                before += chapter_at.words.iter().filter(|w| w.span < span).count();
                break;
            }
        }
        let holder = &self.chapters[chapter];
        (
            Percent::of(before, total),
            KoboSpan {
                source: holder.href.clone(),
                value: holder.spans[span].id.clone(),
            },
        )
    }
}

type Archive<'a> = zip::ZipArchive<Cursor<&'a [u8]>>;

/// Read `name` fully into memory from `archive`.
fn read_entry(archive: &mut Archive<'_>, name: &str) -> Result<Vec<u8>, KepubError> {
    let mut entry = archive
        .by_name(name)
        .map_err(|error| KepubError::Unreadable(format!("{name}: {error}")))?;
    let mut bytes = Vec::new();
    entry
        .read_to_end(&mut bytes)
        .map_err(|error| KepubError::Unreadable(format!("{name}: {error}")))?;
    Ok(bytes)
}

/// `META-INF/container.xml`'s rootfile `full-path` — the OPF's path.
fn container_opf_path(archive: &mut Archive<'_>) -> Result<String, KepubError> {
    let xml = read_entry(archive, "META-INF/container.xml")?;
    let mut reader = Reader::from_reader(xml.as_slice());
    let mut buf = Vec::new();
    loop {
        let event = reader
            .read_event_into(&mut buf)
            .map_err(|error| KepubError::Unreadable(error.to_string()))?;
        match event {
            Event::Start(ref e) | Event::Empty(ref e) if e.local_name().as_ref() == b"rootfile" => {
                if let Some(path) = attr(e, "full-path") {
                    return Ok(path);
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    Err(KepubError::Unreadable(
        "META-INF/container.xml names no rootfile".to_owned(),
    ))
}

/// The OPF's manifest (id → href) and its spine, as an ordered list of idrefs.
fn parse_opf(xml: &[u8]) -> Result<(HashMap<String, String>, Vec<String>), KepubError> {
    let mut reader = Reader::from_reader(xml);
    let mut buf = Vec::new();
    let mut manifest = HashMap::new();
    let mut spine = Vec::new();
    loop {
        let event = reader
            .read_event_into(&mut buf)
            .map_err(|error| KepubError::Unreadable(error.to_string()))?;
        match event {
            Event::Start(ref e) | Event::Empty(ref e) => match e.local_name().as_ref() {
                b"item" => {
                    if let (Some(id), Some(href)) = (attr(e, "id"), attr(e, "href")) {
                        manifest.insert(id, href);
                    }
                }
                b"itemref" => {
                    if let Some(idref) = attr(e, "idref") {
                        spine.push(idref);
                    }
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    Ok((manifest, spine))
}

/// `e`'s `name` attribute, decoded.
fn attr(e: &BytesStart<'_>, name: &str) -> Option<String> {
    e.try_get_attribute(name)
        .ok()
        .flatten()
        .and_then(|a| a.normalized_value(XmlVersion::Implicit1_0).ok())
        .map(|v| v.into_owned())
}

/// Every `koboSpan` in one chapter's XHTML, in document order.
fn parse_spans(xhtml: &[u8]) -> Result<Vec<Span>, KepubError> {
    let mut reader = Reader::from_reader(xhtml);
    let mut buf = Vec::new();
    let mut spans = Vec::new();
    // The currently-open span's id, its text so far, and how many
    // unmatched `Start` events have occurred since it opened (nested
    // elements inside it, which contribute their own text but don't close it).
    let mut open: Option<(String, String, u32)> = None;
    loop {
        let event = reader
            .read_event_into(&mut buf)
            .map_err(|error| KepubError::Unreadable(error.to_string()))?;
        match event {
            Event::Start(ref e) => {
                if let Some((_, _, depth)) = open.as_mut() {
                    *depth += 1;
                } else if let Some(id) = attr(e, "id") {
                    if is_kobo_span_id(&id) {
                        open = Some((id, String::new(), 0));
                    }
                }
            }
            Event::End(_) => {
                if let Some((id, text, depth)) = open.take() {
                    if depth == 0 {
                        spans.push(Span { id, text });
                    } else {
                        open = Some((id, text, depth - 1));
                    }
                }
            }
            Event::Text(ref t) => {
                if let Some((_, text, _)) = open.as_mut() {
                    let decoded = t
                        .decode()
                        .map_err(|error| KepubError::Unreadable(error.to_string()))?;
                    text.push_str(&decoded);
                }
            }
            Event::CData(ref t) => {
                if let Some((_, text, _)) = open.as_mut() {
                    let decoded = t
                        .decode()
                        .map_err(|error| KepubError::Unreadable(error.to_string()))?;
                    text.push_str(&decoded);
                }
            }
            Event::GeneralRef(ref r) => {
                let resolved = resolve_entity(r)?;
                if let Some((_, text, _)) = open.as_mut() {
                    text.push(resolved);
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    Ok(spans)
}

/// Whether `id` has the shape `kobo.<digits>.<digits>`.
fn is_kobo_span_id(id: &str) -> bool {
    let Some(("kobo", rest)) = id.split_once('.') else {
        return false;
    };
    let Some((n, m)) = rest.split_once('.') else {
        return false;
    };
    is_digits(n) && is_digits(m)
}

fn is_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// Resolve one entity or character reference to its character. A numeric
/// reference (`&#NN;`/`&#xHH;`) always resolves; of the named references,
/// only the XML five do — any other named entity is [`KepubError::Unreadable`]
/// so a span's text, and therefore its word offsets, is never silently wrong.
fn resolve_entity(r: &BytesRef<'_>) -> Result<char, KepubError> {
    if let Ok(Some(c)) = r.resolve_char_ref() {
        return Ok(c);
    }
    let name: &[u8] = r.as_ref();
    match name {
        b"amp" => Ok('&'),
        b"lt" => Ok('<'),
        b"gt" => Ok('>'),
        b"apos" => Ok('\''),
        b"quot" => Ok('"'),
        other => Err(KepubError::Unreadable(format!(
            "unknown entity &{};",
            String::from_utf8_lossy(other)
        ))),
    }
}

/// Every maximal run of non-whitespace characters across `spans`, with its
/// UTF-16 start/end into its own span's text.
fn words_in(spans: &[Span]) -> Vec<Word> {
    let mut words = Vec::new();
    for (index, span) in spans.iter().enumerate() {
        let mut utf16 = 0u32;
        let mut open: Option<(u32, usize)> = None;
        let mut last_byte_end = 0usize;
        for (byte_index, ch) in span.text.char_indices() {
            let width = u32::try_from(ch.len_utf16()).unwrap_or(2);
            if ch.is_whitespace() {
                if let Some((start, start_byte)) = open.take() {
                    words.push(Word {
                        span: index,
                        text: span.text[start_byte..byte_index].to_owned(),
                        start,
                        end: utf16,
                    });
                }
            } else if open.is_none() {
                open = Some((utf16, byte_index));
            }
            utf16 += width;
            last_byte_end = byte_index + ch.len_utf8();
        }
        if let Some((start, start_byte)) = open {
            words.push(Word {
                span: index,
                text: span.text[start_byte..last_byte_end].to_owned(),
                start,
                end: utf16,
            });
        }
    }
    words
}

#[cfg(test)]
mod tests;
