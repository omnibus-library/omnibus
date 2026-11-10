//! The releases the fake Prowlarr offers, made from the search query itself: any title
//! gets the same few versions (EPUB and AZW3 as ebooks, M4B as audiobooks), each once as a
//! torrent and once as usenet, so no catalogue file has to name the books. Also finds the
//! `test_data/` files a finished download delivers. Used by the Prowlarr and download faces.

use std::fs;
use std::path::{Path, PathBuf};

use omnibus_shared::{ReleaseProtocol, RequestKind};

/// Newznab category an ebook search asks for.
pub const EBOOK_CATEGORY: &str = "7020";

/// Newznab category an audiobook search asks for.
pub const AUDIOBOOK_CATEGORY: &str = "3030";

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
    pub fn extension(self) -> &'static str {
        match self {
            Format::Epub | Format::Azw3 => "epub",
            Format::M4b => "m4b",
        }
    }

    fn size_bytes(self) -> i64 {
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
    pub id: String,
    pub title: String,
    pub kind: RequestKind,
    pub format: Format,
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

    pub fn size_bytes(&self) -> i64 {
        self.format.size_bytes()
    }

    /// The Newznab category Prowlarr lists it under.
    pub fn category(&self) -> i64 {
        match self.kind {
            RequestKind::Ebook => 7020,
            RequestKind::Audiobook => 3030,
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
    let hash = rest.get(..40)?;
    hash.bytes()
        .all(|b| b.is_ascii_hexdigit())
        .then(|| hash.to_ascii_lowercase())
}

/// The kind of book a Prowlarr `categories` value searches for.
pub fn kind_for_category(category: &str) -> Option<RequestKind> {
    match category {
        EBOOK_CATEGORY => Some(RequestKind::Ebook),
        AUDIOBOOK_CATEGORY => Some(RequestKind::Audiobook),
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
                kind,
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
    pub epub: PathBuf,
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
