//! Picks which of Prowlarr's search results to show for a requested ebook, and in what
//! order. Pure: it reads only the results and the book's title and author.
//!
//! A result is dropped (kept, flagged `rejected`) when it cannot be the book or cannot be
//! used. The rest are scored as one weighted sum, so the weights are a tuned set: a closer
//! title match outweighs any format, and format outweighs language, retail, seeders and
//! size, in that order. Only a strong top result is badged the best match.

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
/// Points per place in [`EBOOK_EXTENSIONS`]: the first (EPUB) earns the most.
const FORMAT_STEP: f64 = 20.0;
const FOREIGN_LANGUAGE_PENALTY: f64 = 30.0;
const RETAIL_BONUS: f64 = 15.0;
const SEEDER_WEIGHT: f64 = 1.5;
const SIZE_CLOSENESS_MAX: f64 = 5.0;
/// Larger than the whole spread of the other terms, so a multi-file pack ranks below
/// every single-file result.
const MULTI_FILE_PENALTY: f64 = 500.0;

/// Formats Omnibus cannot read; a result naming only these is dropped. A result that names
/// no format at all is kept and ranks last.
const UNREADABLE_FORMATS: &[&str] = &[
    "mobi", "azw", "azw3", "azw4", "djvu", "lit", "fb2", "rtf", "doc", "docx", "txt", "chm", "cbr",
    "lrf", "pdb", "htmlz",
];
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
    /// `EPUB`, `PDF` or `CBZ`; `None` when the title names none.
    pub format: Option<String>,
    pub score: f64,
    pub best_match: bool,
    /// Dropped: stored for the record, never shown.
    pub rejected: bool,
}

/// What a result's title says about its format.
enum Format {
    /// Place in [`EBOOK_EXTENSIONS`].
    Readable(usize),
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

fn format_of(tokens: &[String]) -> Format {
    let readable = EBOOK_EXTENSIONS
        .iter()
        .position(|ext| tokens.iter().any(|t| t == ext));
    match readable {
        Some(place) => Format::Readable(place),
        None if tokens
            .iter()
            .any(|t| UNREADABLE_FORMATS.contains(&t.as_str())) =>
        {
            Format::Unreadable
        }
        None => Format::Unnamed,
    }
}

/// A result that passed every drop rule, short only of the size term, which needs the
/// median of the others.
struct Kept {
    release: ProwlarrRelease,
    format: Option<String>,
    fixed_score: f64,
}

/// Drop what cannot be the book or cannot be used, then order what is left best first.
pub fn rank(releases: Vec<ProwlarrRelease>, title: &str, author: &str) -> Vec<Ranked> {
    let author_tokens: Vec<String> = normalize_author(author)
        .unwrap_or_default()
        .split(' ')
        .filter(|t| t.len() >= 2)
        .map(str::to_string)
        .collect();
    let (mut kept, mut rejected) = (Vec::new(), Vec::new());
    for release in releases {
        match assess(release, title, &author_tokens) {
            Ok(k) => kept.push(k),
            Err(r) => rejected.push(r),
        }
    }
    let median = median_size(&kept);
    let mut ranked: Vec<Ranked> = kept
        .into_iter()
        .map(|k| Ranked {
            score: k.fixed_score + size_closeness(k.release.size_bytes, median),
            release: k.release,
            format: k.format,
            best_match: false,
            rejected: false,
        })
        .collect();
    ranked.sort_by(|a, b| b.score.total_cmp(&a.score));
    if let Some(top) = ranked.first_mut().filter(|t| t.score >= BEST_MATCH_MIN) {
        top.best_match = true;
    }
    ranked.extend(rejected);
    ranked
}

/// Score one result, or flag it dropped as the `Err`.
fn assess(release: ProwlarrRelease, title: &str, author_tokens: &[String]) -> Result<Kept, Ranked> {
    let words = tokens(&release.title);
    let format = format_of(&words);
    let title_score = score_title_match(title, &release.title);
    let format_name = match format {
        Format::Readable(place) => Some(EBOOK_EXTENSIONS[place].to_uppercase()),
        _ => None,
    };
    let unusable = !release
        .categories
        .iter()
        .any(|c| BOOK_CATEGORIES.contains(c))
        || release.seeders == Some(0)
        || release
            .size_bytes
            .is_some_and(|s| !(MIN_SIZE_BYTES..=MAX_SIZE_BYTES).contains(&s))
        || matches!(format, Format::Unreadable);
    let wrong_book = title_score < MIN_RELEVANCE_SCORE
        || (!author_tokens.is_empty() && !author_tokens.iter().any(|t| words.contains(t)));
    if unusable || wrong_book {
        return Err(Ranked {
            release,
            format: format_name,
            score: 0.0,
            best_match: false,
            rejected: true,
        });
    }
    let fixed_score = title_score * TITLE_WEIGHT
        + format_points(&format)
        + language_and_pack_points(&release, &words)
        + SEEDER_WEIGHT * (1.0 + release.seeders.unwrap_or(0) as f64).ln();
    Ok(Kept {
        release,
        format: format_name,
        fixed_score,
    })
}

fn format_points(format: &Format) -> f64 {
    match format {
        Format::Readable(place) => (EBOOK_EXTENSIONS.len() - place) as f64 * FORMAT_STEP,
        _ => 0.0,
    }
}

/// The bonuses and penalties read off the title and file count: language, retail, pack.
fn language_and_pack_points(release: &ProwlarrRelease, words: &[String]) -> f64 {
    let has = |list: &[&str]| words.iter().any(|w| list.contains(&w.as_str()));
    let mut points = 0.0;
    if has(FOREIGN_LANGUAGES) && !has(&["english"]) {
        points -= FOREIGN_LANGUAGE_PENALTY;
    }
    if has(&["retail"]) {
        points += RETAIL_BONUS;
    }
    if release.files.is_some_and(|f| f > 1) {
        points -= MULTI_FILE_PENALTY;
    }
    points
}

fn median_size(kept: &[Kept]) -> Option<f64> {
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
