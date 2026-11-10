//! The releases the fake Prowlarr offers, made from the search query itself: any title
//! gets the same few versions (EPUB and AZW3 as ebooks, M4B as audiobooks), each once as a
//! torrent and once as usenet, so no catalogue file has to name the books. Also finds the
//! `test_data/` files a finished download delivers. Used by the Prowlarr and download faces.

use std::fs;
use std::path::{Path, PathBuf};

use omnibus_shared::{ReleaseProtocol, RequestKind};

/// Newznab category an ebook search asks for.
pub const EBOOK_CATEGORY: i64 = 7020;

/// Newznab category an audiobook search asks for.
pub const AUDIOBOOK_CATEGORY: i64 = 3030;

/// A release's file format.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Epub,
    Azw3,
    M4b,
}

impl Format {
    /// The word the title ends in, which the ranker reads the format from.
    pub fn label(self) -> &'static str {
        match self {
            Format::Epub => "EPUB",
            Format::Azw3 => "AZW3",
            Format::M4b => "M4B",
        }
    }

    /// The extension of the file a finished download holds.
    // shortcut: AZW3 delivers the EPUB's bytes, so the import never converts; ship a real AZW3 to exercise conversion.
    pub fn extension(self) -> &'static str {
        match self {
            Format::Epub | Format::Azw3 => "epub",
            Format::M4b => "m4b",
        }
    }

    /// Whether the format is a book to read or to listen to.
    pub fn kind(self) -> RequestKind {
        match self {
            Format::Epub | Format::Azw3 => RequestKind::Ebook,
            Format::M4b => RequestKind::Audiobook,
        }
    }

    /// The size a release in this format reports.
    pub fn size_bytes(self) -> i64 {
        match self {
            Format::Epub => 1_500_000,
            Format::Azw3 => 1_200_000,
            Format::M4b => 350_000_000,
        }
    }
}

/// One search result. Its id is 40 lowercase hex, and doubles as a torrent's info hash.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Release {
    /// Also the torrent's info hash and the NZB's marker.
    pub id: String,
    /// The query and the format's label, such as `Dracula EPUB`.
    pub title: String,
    pub format: Format,
    /// Whether a torrent client or a usenet client takes it.
    pub protocol: ReleaseProtocol,
}

impl Release {
    /// What the client is given to fetch it: a magnet, or the mock's own NZB address.
    pub fn link(&self, origin: &str) -> String {
        match self.protocol {
            ReleaseProtocol::Usenet => format!("{origin}/nzb/{}", self.id),
            ReleaseProtocol::Torrent => format!(
                "magnet:?xt=urn:btih:{}&dn={}",
                self.id,
                percent_encode(&self.title)
            ),
        }
    }

    /// The Newznab category Prowlarr lists it under.
    pub fn category(&self) -> i64 {
        match self.format.kind() {
            RequestKind::Ebook => EBOOK_CATEGORY,
            RequestKind::Audiobook => AUDIOBOOK_CATEGORY,
        }
    }
}

fn percent_encode(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b if b.is_ascii_alphanumeric() => char::from(b).to_string(),
            b => format!("%{b:02X}"),
        })
        .collect()
}

/// The 40-hex info hash a magnet names, lowercased.
pub fn magnet_hash(magnet: &str) -> Option<String> {
    let rest = magnet.split("urn:btih:").nth(1)?;
    let hash = rest.get(..40)?.to_ascii_lowercase();
    is_id(&hash).then_some(hash)
}

/// Whether `text` is a release id: 40 lowercase hex.
pub fn is_id(text: &str) -> bool {
    text.len() == 40 && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// The kind of book a Prowlarr `categories` value searches for.
pub fn kind_for_category(category: &str) -> Option<RequestKind> {
    match category.parse() {
        Ok(EBOOK_CATEGORY) => Some(RequestKind::Ebook),
        Ok(AUDIOBOOK_CATEGORY) => Some(RequestKind::Audiobook),
        _ => None,
    }
}

/// The releases for `query` in `kind`, each given an id from `mint`.
pub fn releases(query: &str, kind: RequestKind, mut mint: impl FnMut() -> String) -> Vec<Release> {
    let formats: &[Format] = match kind {
        RequestKind::Ebook => &[Format::Epub, Format::Azw3],
        RequestKind::Audiobook => &[Format::M4b],
    };
    let mut out = Vec::new();
    for format in formats {
        for protocol in [ReleaseProtocol::Torrent, ReleaseProtocol::Usenet] {
            out.push(Release {
                id: mint(),
                title: format!("{query} {}", format.label()),
                format: *format,
                protocol,
            });
        }
    }
    out
}

/// A `test_data/` file is missing; fetch the fixtures.
#[derive(Debug, thiserror::Error)]
pub enum PayloadError {
    #[error("{0}: run `just fixtures`")]
    Missing(String),
}

/// The files a finished download delivers: an EPUB for either ebook format, an M4B for audiobooks.
#[derive(Clone, Debug)]
pub struct Payloads {
    /// Delivered for an EPUB or AZW3 release.
    pub epub: PathBuf,
    /// Delivered for an audiobook release.
    pub m4b: PathBuf,
}

impl Payloads {
    /// `epubs/generated/alpha.epub` and the first `*.m4b` under `audiobooks/public_domain`.
    pub fn find(test_data: &Path) -> Result<Self, PayloadError> {
        let epub = test_data.join("epubs/generated/alpha.epub");
        if !epub.is_file() {
            return Err(PayloadError::Missing(format!(
                "{} not found",
                epub.display()
            )));
        }
        let root = test_data.join("audiobooks/public_domain");
        let m4b = first_m4b(&root)
            .ok_or_else(|| PayloadError::Missing(format!("no .m4b under {}", root.display())))?;
        Ok(Self { epub, m4b })
    }

    /// The file delivering `format`.
    // shortcut: AZW3 delivers the EPUB's bytes, so the import never converts; ship a real AZW3 to exercise conversion.
    pub fn file(&self, format: Format) -> &Path {
        match format {
            Format::Epub | Format::Azw3 => &self.epub,
            Format::M4b => &self.m4b,
        }
    }
}

/// The first `.m4b` under `dir`, by path order.
fn first_m4b(dir: &Path) -> Option<PathBuf> {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .collect();
    entries.sort();
    entries.into_iter().find_map(|path| {
        if path.is_dir() {
            first_m4b(&path)
        } else {
            path.extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("m4b"))
                .then_some(path)
        }
    })
}

#[cfg(test)]
mod tests;
