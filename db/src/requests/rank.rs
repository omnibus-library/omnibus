//! Picks which of Prowlarr's search results to show for a requested ebook or audiobook, and
//! in what order. Pure: it reads only the results, the book's title and author, and the kind.
//!
//! A result is dropped (kept, flagged `rejected`) when it cannot be the book or cannot be
//! used. The rest are scored as one weighted sum, so the weights are a tuned set: a closer
//! title match outweighs any format, and format outweighs language, retail, seeders and
//! size, in that order. Only a strong top result is badged the best match. What counts as
//! usable (category, size, format, a multi-file pack) is a per-kind [`Profile`].

use omnibus_shared::{ReleaseProtocol, RequestKind};

use crate::audiobook::AUDIOBOOK_EXTENSIONS;
use crate::convert::EPUB_CONVERTIBLE_FORMATS;
use crate::ebook::EBOOK_EXTENSIONS;
use crate::metadata_lookup::{score_title_match, MIN_RELEVANCE_SCORE};
use crate::normalize::{normalize_author, normalize_title};

use super::prowlarr::ProwlarrRelease;

/// Books are Newznab category 7000 and the 7xxx family under it.
const BOOK_CATEGORIES: std::ops::Range<i64> = 7000..8000;
const MIN_SIZE_BYTES: i64 = 50 * 1024;
const MAX_SIZE_BYTES: i64 = 100 * 1024 * 1024;
/// The top result is badged only at or above this score: a prefix title match in a
/// readable format.
const BEST_MATCH_MIN: f64 = 850.0;

const TITLE_WEIGHT: f64 = 100.0;
/// Points per place in [`Profile::formats`]: the first (EPUB, M4B) earns the most.
const FORMAT_STEP: f64 = 20.0;
/// Between EPUB's 60 and PDF's 40 ([`FORMAT_STEP`] places), so a converted version ranks
/// below EPUB and above PDF.
const CONVERTED_FORMAT_POINTS: f64 = 50.0;
const FOREIGN_LANGUAGE_PENALTY: f64 = 30.0;
const RETAIL_BONUS: f64 = 15.0;
const SEEDER_WEIGHT: f64 = 1.5;
const SIZE_CLOSENESS_MAX: f64 = 5.0;
/// Larger than the whole spread of the other terms, so a multi-file pack ranks below
/// every single-file result.
const MULTI_FILE_PENALTY: f64 = 500.0;
const MIN_AUDIO_SIZE_BYTES: i64 = 20 * 1024 * 1024;

/// Formats Omnibus cannot read; a result naming only these is dropped, except the
/// [`EPUB_CONVERTIBLE_FORMATS`] while conversion is available. A result that names no format
/// at all is kept and ranks last.
const UNREADABLE_FORMATS: &[&str] = &[
    "mobi", "azw", "azw3", "azw4", "djvu", "lit", "fb2", "rtf", "doc", "docx", "txt", "chm", "cbr",
    "lrf", "pdb", "htmlz",
];
/// What makes a result usable for one kind of request.
struct Profile {
    /// The one Newznab category a search asks Prowlarr for.
    search_category: &'static str,
    categories: std::ops::Range<i64>,
    sizes: std::ops::RangeInclusive<i64>,
    /// Best first; a format earns [`FORMAT_STEP`] per place from the end.
    formats: &'static [&'static str],
    unreadable: &'static [&'static str],
    /// Formats converted to EPUB on import, ranked as [`CONVERTED_FORMAT_POINTS`].
    convertible: &'static [&'static str],
    multi_file_penalty: f64,
}

static EBOOK: Profile = Profile {
    search_category: "7020",
    categories: BOOK_CATEGORIES,
    sizes: MIN_SIZE_BYTES..=MAX_SIZE_BYTES,
    formats: EBOOK_EXTENSIONS,
    unreadable: UNREADABLE_FORMATS,
    convertible: EPUB_CONVERTIBLE_FORMATS,
    multi_file_penalty: MULTI_FILE_PENALTY,
};

/// Audiobooks are Newznab 3030 alone; 3000's other children are music and video. A folder of
/// MP3s is the normal shape, so many files cost nothing.
static AUDIOBOOK: Profile = Profile {
    search_category: "3030",
    categories: 3030..3031,
    sizes: MIN_AUDIO_SIZE_BYTES..=i64::MAX,
    formats: AUDIOBOOK_EXTENSIONS,
    // A release naming only these ends "no audiobook file to add", so it is dropped here.
    unreadable: &["flac", "ogg", "opus", "wma", "aax"],
    convertible: &[],
    multi_file_penalty: 0.0,
};

fn profile(kind: RequestKind) -> &'static Profile {
    match kind {
        RequestKind::Ebook => &EBOOK,
        RequestKind::Audiobook => &AUDIOBOOK,
    }
}

const FOREIGN_LANGUAGES: &[&str] = &[
    "german",
    "deutsch",
    "french",
    "francais",
    "spanish",
    "espanol",
    "italian",
    "italiano",
    "portuguese",
    "russian",
    "polish",
    "dutch",
    "swedish",
    "chinese",
    "japanese",
];

/// A search result with its place in the order.
pub struct Ranked {
    pub release: ProwlarrRelease,
    /// `EPUB`, `PDF`, `CBZ`, `AZW3` or `MOBI` for an ebook, the last two converted to EPUB
    /// when added; `M4B`, `M4A` or `MP3` for an audiobook. `None` when the title names none.
    pub format: Option<String>,
    pub score: f64,
    pub best_match: bool,
    /// Dropped: stored for the record, never shown.
    pub rejected: bool,
    /// Why it was dropped; `None` for a result that was kept.
    pub cause: Option<Rejection>,
}

/// The first reason a result was dropped, in the order a reader would check them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rejection {
    /// Listed outside the category the request's kind searches.
    Category,
    /// Its title or author is not the book's.
    Book,
    /// Of the protocol the configured download client does not fetch.
    Protocol,
    /// A format, size or seeder count that cannot be used.
    Unusable,
}

/// What a result's title says about its format.
enum Format {
    /// The lowercase extension, and the points it earns.
    Readable(&'static str, f64),
    Unreadable,
    Unnamed,
}

fn tokens(title: &str) -> Vec<String> {
    normalize_title(title)
        .unwrap_or_default()
        .split(' ')
        .map(str::to_string)
        .collect()
}

/// The format a title names: of several, the one worth the most points. The profile's
/// convertible formats count only when `convertible`.
fn format_of(tokens: &[String], profile: &Profile, convertible: bool) -> Format {
    let native = profile
        .formats
        .iter()
        .enumerate()
        .map(|(place, ext)| (*ext, (profile.formats.len() - place) as f64 * FORMAT_STEP));
    let converted = profile
        .convertible
        .iter()
        .filter(|_| convertible)
        .map(|ext| (*ext, CONVERTED_FORMAT_POINTS));
    native
        .chain(converted)
        .filter(|(ext, _)| tokens.iter().any(|t| t == ext))
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(ext, points)| Format::Readable(ext, points))
        .unwrap_or_else(|| {
            if tokens
                .iter()
                .any(|t| profile.unreadable.contains(&t.as_str()))
            {
                Format::Unreadable
            } else {
                Format::Unnamed
            }
        })
}

/// Whether any result's title names a format the server converts to EPUB, so it is worth
/// asking whether the converter runs.
pub fn names_convertible(releases: &[ProwlarrRelease]) -> bool {
    releases.iter().any(|r| {
        let words = tokens(&r.title);
        EPUB_CONVERTIBLE_FORMATS
            .iter()
            .any(|format| words.iter().any(|w| w == format))
    })
}

/// The category Prowlarr is searched in for `kind`.
pub fn search_category(kind: RequestKind) -> &'static str {
    profile(kind).search_category
}

/// Drop what cannot be the book or cannot be used, then order what is left best first.
/// Only releases of the `wanted` protocol are kept: the download client fetches one kind.
/// `convertible` is whether the server can convert AZW3 and MOBI to EPUB on import.
pub fn rank(
    releases: Vec<ProwlarrRelease>,
    title: &str,
    author: &str,
    kind: RequestKind,
    wanted: ReleaseProtocol,
    convertible: bool,
) -> Vec<Ranked> {
    let profile = profile(kind);
    let author_tokens: Vec<String> = normalize_author(author)
        .unwrap_or_default()
        .split(' ')
        .filter(|t| t.len() >= 2)
        .map(str::to_string)
        .collect();
    let (kept, rejected): (Vec<Ranked>, Vec<Ranked>) = releases
        .into_iter()
        .map(|release| assess(release, title, &author_tokens, profile, wanted, convertible))
        .partition(|r| !r.rejected);
    let median = median_size(&kept);
    let mut ranked: Vec<Ranked> = kept
        .into_iter()
        .map(|mut r| {
            r.score += size_closeness(r.release.size_bytes, median);
            r
        })
        .collect();
    ranked.sort_by(|a, b| b.score.total_cmp(&a.score));
    if let Some(top) = ranked.first_mut().filter(|t| t.score >= BEST_MATCH_MIN) {
        top.best_match = true;
    }
    ranked.extend(rejected);
    ranked
}

/// Score one result without the size term, which needs the median of the others; a
/// dropped one scores 0.
fn assess(
    release: ProwlarrRelease,
    title: &str,
    author_tokens: &[String],
    profile: &Profile,
    wanted: ReleaseProtocol,
    convertible: bool,
) -> Ranked {
    let words = tokens(&release.title);
    let format = format_of(&words, profile, convertible);
    let title_score = score_title_match(title, &release.title);
    let wrong_category = !release
        .categories
        .iter()
        .any(|c| profile.categories.contains(c));
    // A release that names no protocol is taken for a torrent, as the indexers mostly are.
    let wrong_protocol = release.protocol.unwrap_or(ReleaseProtocol::Torrent) != wanted;
    let unusable = release.seeders.is_some_and(|s| s < 1)
        || release
            .size_bytes
            .is_some_and(|s| !profile.sizes.contains(&s))
        || matches!(format, Format::Unreadable);
    let wrong_book = title_score < MIN_RELEVANCE_SCORE
        || (!author_tokens.is_empty() && !author_tokens.iter().any(|t| words.contains(t)));
    let cause = if wrong_category {
        Some(Rejection::Category)
    } else if wrong_book {
        Some(Rejection::Book)
    } else if wrong_protocol {
        Some(Rejection::Protocol)
    } else if unusable {
        Some(Rejection::Unusable)
    } else {
        None
    };
    let rejected = cause.is_some();
    let score = if rejected {
        0.0
    } else {
        title_score * TITLE_WEIGHT
            + format_points(&format)
            + language_and_pack_points(&release, &words, profile)
            + SEEDER_WEIGHT * (1.0 + release.seeders.unwrap_or(0) as f64).ln()
    };
    Ranked {
        format: match format {
            Format::Readable(ext, _) => Some(ext.to_uppercase()),
            _ => None,
        },
        release,
        score,
        best_match: false,
        rejected,
        cause,
    }
}

fn format_points(format: &Format) -> f64 {
    match format {
        Format::Readable(_, points) => *points,
        _ => 0.0,
    }
}

/// The bonuses and penalties read off the title and file count: language, retail, pack.
fn language_and_pack_points(release: &ProwlarrRelease, words: &[String], profile: &Profile) -> f64 {
    let has = |list: &[&str]| words.iter().any(|w| list.contains(&w.as_str()));
    let mut points = 0.0;
    if has(FOREIGN_LANGUAGES) && !has(&["english"]) {
        points -= FOREIGN_LANGUAGE_PENALTY;
    }
    if has(&["retail"]) {
        points += RETAIL_BONUS;
    }
    if release.files.is_some_and(|f| f > 1) {
        points -= profile.multi_file_penalty;
    }
    points
}

fn median_size(kept: &[Ranked]) -> Option<f64> {
    let mut sizes: Vec<i64> = kept.iter().filter_map(|k| k.release.size_bytes).collect();
    sizes.sort_unstable();
    sizes.get(sizes.len() / 2).map(|s| *s as f64)
}

/// Up to [`SIZE_CLOSENESS_MAX`], falling to 0 at four times (or a quarter of) the median.
fn size_closeness(size: Option<i64>, median: Option<f64>) -> f64 {
    let (Some(size), Some(median)) = (size, median) else {
        return 0.0;
    };
    let off_by = (size as f64 / median).ln().abs() / 4f64.ln();
    SIZE_CLOSENESS_MAX * (1.0 - off_by.min(1.0))
}

#[cfg(test)]
mod tests;
