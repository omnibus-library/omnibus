//! The book's identifier rows as the detail page's metadata table shows
//! them: a human label for each scheme (an ONIX codelist-5 code is not one),
//! and one row per distinct value. Shared by the marquee and mobile tables.

use omnibus_shared::{EbookMetadata, Identifier};

/// Collision-free list key for an identifier row. A book can carry several
/// identifiers sharing one `scheme` (the projection keeps every distinct
/// value per scheme), so the key folds in `value` to stay unique among the
/// keyed siblings — Dioxus panics when two keyed siblings share a key.
///
/// Both fields are `Debug`-quoted (not joined with a plain separator): a raw
/// `scheme|value` join collides when the data itself contains the delimiter
/// (`scheme="a|b", value="c"` vs `scheme="a", value="b|c"`), which would
/// reintroduce the very panic this guards against. `Debug` escapes embedded
/// quotes/backslashes, so the `(scheme, value)` pair maps injectively to the
/// key.
pub(super) fn bd_identifier_key(ident: &Identifier) -> String {
    format!("{:?}\u{1f}{:?}", ident.scheme, ident.value)
}

/// How confidently a row's label names what it holds. Two identifiers can
/// carry the same value under different schemes — an EPUB 3 package writes
/// its ISBN once as `<dc:identifier>` and again as an ONIX codelist-5
/// refinement — and [`bd_identifier_rows`] keeps the best-named of them.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum LabelRank {
    /// Inferred from the value's shape; the scheme said nothing usable.
    Inferred,
    /// The source's own scheme, passed through as written.
    RawScheme,
    /// A scheme this table recognizes and can name properly.
    Known,
}

/// Human label for a scheme this table recognizes. Covers the ONIX
/// codelist-5 numbers an EPUB 3 `identifier-type` refinement carries (a
/// reader should never be shown the bare code `15`) and the scheme names
/// Calibre and the retailers write.
///
/// `uuid` is deliberately not "UUID": the value is the *source file's* uuid,
/// which is not the book's own uuid — the one Omnibus keys everything on and
/// shows in the URL.
fn bd_known_scheme_label(scheme: &str) -> Option<&'static str> {
    let label = match scheme.trim().to_ascii_lowercase().as_str() {
        "01" | "proprietary" => "Proprietary ID",
        "02" | "isbn-10" | "isbn10" => "ISBN-10",
        "03" | "gtin-13" | "ean" | "ean-13" => "EAN-13",
        "04" | "upc" => "UPC",
        "05" | "ismn-10" => "ISMN-10",
        "06" | "doi" => "DOI",
        "13" | "lccn" => "LCCN",
        "14" | "gtin-14" => "GTIN-14",
        "15" | "isbn-13" | "isbn13" => "ISBN-13",
        "17" | "isbn-a" => "ISBN-A",
        "22" | "urn" => "URN",
        "23" | "oclc" => "OCLC",
        "24" | "url" | "uri" => "URL",
        "25" | "ismn-13" => "ISMN-13",
        "isbn" => "ISBN",
        "asin" | "amazon" | "mobi-asin" => "ASIN",
        "google" => "Google Books ID",
        "goodreads" => "Goodreads ID",
        "calibre" => "Calibre ID",
        "uuid" => "Source UUID",
        _ => return None,
    };
    Some(label)
}

/// Label for a file-details identifier row, plus how well the source named
/// it. A recognized scheme gets a human label; an unrecognized *named* scheme
/// passes through as written; a missing, `unknown`, or bare-numeric scheme
/// falls back to the value's own shape, so no row is ever labelled with a raw
/// codelist number.
fn bd_identifier_label_ranked(ident: &Identifier) -> (String, LabelRank) {
    if let Some(scheme) = ident.scheme.as_deref().map(str::trim) {
        if let Some(label) = bd_known_scheme_label(scheme) {
            return (label.to_string(), LabelRank::Known);
        }
        // An unrecognized all-digit scheme is a codelist value this table
        // doesn't know, not a name worth showing a reader.
        if !scheme.is_empty()
            && !scheme.eq_ignore_ascii_case("unknown")
            && !scheme.chars().all(|c| c.is_ascii_digit())
        {
            return (scheme.to_string(), LabelRank::RawScheme);
        }
    }
    if bd_looks_like_isbn(&ident.value) {
        ("ISBN".to_string(), LabelRank::Inferred)
    } else {
        ("Identifier".to_string(), LabelRank::Inferred)
    }
}

/// One row of the book-detail identifier table.
pub(super) struct BdIdentifierRow {
    /// Dioxus list key, from the identifier the row's label came from.
    pub key: String,
    pub label: String,
    pub value: String,
}

/// The identifier rows to render, deduplicated by value, with the book's
/// saved ISBN overrides folded in.
///
/// A book routinely carries one identifier under several schemes — an EPUB 3
/// package repeats its ISBN as an ONIX refinement, and a merge folds two
/// editions' identifier sets together — which listed one value on as many
/// rows as it had schemes. Two identifiers with the same value *are* the same
/// identifier, so the rows collapse to one, keeping the best-named label
/// (which also subsumes the `(scheme, value)` dedup the DB's primary key
/// already gives us) and the first occurrence's position.
///
/// `isbn13` / `isbn10` are the fields the metadata editor writes and
/// `apply_overrides` merges; rendering only `identifiers` meant a saved ISBN
/// appeared nowhere and a correction read as silently ignored (#2496). They
/// are folded in last, so an override replaces the row it corrects — by value
/// when the file already holds it, else by label — rather than sitting beside
/// it. With no override the fields are absent (or re-derived from the file),
/// so the scanned row is what renders.
pub(super) fn bd_identifier_rows(book: &EbookMetadata) -> Vec<BdIdentifierRow> {
    let mut rows: Vec<(BdIdentifierRow, LabelRank)> = Vec::new();
    for ident in &book.identifiers {
        let value = ident.value.trim();
        if value.is_empty() {
            continue;
        }
        let (label, rank) = bd_identifier_label_ranked(ident);
        let row = BdIdentifierRow {
            key: bd_identifier_key(ident),
            label,
            value: value.to_string(),
        };
        match rows
            .iter_mut()
            .find(|(existing, _)| same_identifier(&existing.value, value))
        {
            // Strictly better only: ties keep the first occurrence, so the
            // order the projection emits stays the order a reader sees.
            Some(slot) if rank > slot.1 => *slot = (row, rank),
            Some(_) => {}
            None => rows.push((row, rank)),
        }
    }
    apply_isbn_override(&mut rows, "isbn-13", book.isbn13.as_deref());
    apply_isbn_override(&mut rows, "isbn-10", book.isbn10.as_deref());
    rows.into_iter().map(|(row, _)| row).collect()
}

/// Fold one saved ISBN override into `rows` under `scheme`.
///
/// **Never drop a row by label alone** — a book can genuinely carry two
/// distinct ISBNs (a second edition's identifier set copied in by a merge,
/// or a book indexed under both), and `isbn13`/`isbn10` are derived from the
/// scanned rows whenever no override exists, so this runs on every book
/// (#2496). Placement, in order: (a) a row that is the *same ISBN* as the
/// override (per [`same_identifier`]) is relabelled and revalued in place —
/// this is a rename, not a new identifier, and is what lets `urn:isbn:…`,
/// hyphenated, and bare-digit forms of one ISBN collapse onto the override
/// row; (b) failing that, a row sharing the override's label is replaced —
/// the correction case, where the file's value under that label was simply
/// wrong (a derived value's own source row always matches in (a), so it can
/// never reach this branch); (c) failing both, the override is a value the
/// file never carried and is appended. Only *other* rows that are the same
/// ISBN as what was just placed are then dropped — a `urn:isbn:` twin
/// beside its hyphenated twin, never a genuinely different ISBN.
fn apply_isbn_override(
    rows: &mut Vec<(BdIdentifierRow, LabelRank)>,
    scheme: &str,
    value: Option<&str>,
) {
    let Some(value) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return;
    };
    let ident = Identifier {
        scheme: Some(scheme.to_string()),
        value: value.to_string(),
    };
    let (label, rank) = bd_identifier_label_ranked(&ident);
    let row = BdIdentifierRow {
        key: bd_identifier_key(&ident),
        label: label.clone(),
        value: value.to_string(),
    };
    let slot_index = rows
        .iter()
        .position(|(existing, _)| same_identifier(&existing.value, value))
        .or_else(|| {
            rows.iter()
                .position(|(existing, _)| existing.label == label)
        });
    match slot_index {
        Some(i) => rows[i] = (row, rank),
        None => rows.push((row, rank)),
    }
    rows.retain(|(existing, _)| {
        existing.value == value || !same_identifier(&existing.value, value)
    });
}

/// The value's derived ISBN, if — once lowercased, a leading `urn:isbn:` /
/// `isbn:` / `isbn ` prefix stripped, and hyphens and whitespace removed —
/// the remainder is exactly 13 ASCII digits (ISBN-13), or 9 ASCII digits
/// followed by a digit or `X` (ISBN-10). No checksum: a mistyped scanned
/// ISBN must still collapse onto its derived digits. Deliberately narrow —
/// a URL, a calibre id, or a uuid never reduces to this shape, so they
/// return `None` rather than being coerced into a false match on whatever
/// digits they happen to contain.
fn isbn_value(v: &str) -> Option<String> {
    let lower = v.trim().to_ascii_lowercase();
    let rest = lower
        .strip_prefix("urn:isbn:")
        .or_else(|| lower.strip_prefix("isbn:"))
        .or_else(|| lower.strip_prefix("isbn "))
        .unwrap_or(lower.as_str());
    let cleaned: String = rest
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect();
    let chars: Vec<char> = cleaned.chars().collect();
    let is_isbn13 = chars.len() == 13 && chars.iter().all(|c| c.is_ascii_digit());
    let is_isbn10 = chars.len() == 10
        && chars[..9].iter().all(|c| c.is_ascii_digit())
        && (chars[9].is_ascii_digit() || chars[9].eq_ignore_ascii_case(&'x'));
    (is_isbn13 || is_isbn10).then(|| cleaned.to_ascii_uppercase())
}

/// True when two identifier values are the same identifier: an exact,
/// case-insensitive match, or both reduce to the same [`isbn_value`]. The
/// ISBN comparison is deliberately narrower than a plain hyphen/whitespace
/// fold — that fold alone would collapse two distinct non-ISBN values that
/// merely share punctuation (`foo-123` / `foo123`), and stripping every
/// non-digit would let a URL ending in an ISBN's digits be mistaken for the
/// ISBN itself.
fn same_identifier(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
        || matches!((isbn_value(a), isbn_value(b)), (Some(x), Some(y)) if x == y)
}

/// True when `value`, with hyphens and whitespace stripped, is a valid ISBN —
/// the right length for an ISBN-10 or ISBN-13 **and** passing its check digit.
///
/// The check digit is the point: a shape-only test (right length, digits with
/// an optional trailing `X`) labelled a checksum-failing `unknown`-scheme
/// value like `2100906924` as an ISBN, presenting bad file metadata as
/// verified data (#2359). Only used to *infer* a label when the scheme said
/// nothing, so a false positive here is a mislabel.
fn bd_looks_like_isbn(value: &str) -> bool {
    let cleaned: Vec<char> = value
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect();
    match cleaned.len() {
        10 => isbn10_checksum_ok(&cleaned),
        13 => isbn13_checksum_ok(&cleaned),
        _ => false,
    }
}

/// ISBN-10 check: `Σ digitᵢ·(10−i) ≡ 0 (mod 11)`, where only the final digit
/// may be `X` (value 10). Any other non-digit fails.
fn isbn10_checksum_ok(cleaned: &[char]) -> bool {
    let mut sum = 0u32;
    for (i, c) in cleaned.iter().enumerate() {
        let digit = if i == 9 && c.eq_ignore_ascii_case(&'x') {
            10
        } else {
            match c.to_digit(10) {
                Some(d) => d,
                None => return false,
            }
        };
        sum += digit * (10 - i as u32);
    }
    sum.is_multiple_of(11)
}

/// ISBN-13 check: alternating 1/3 weights sum to a multiple of 10.
fn isbn13_checksum_ok(cleaned: &[char]) -> bool {
    let mut sum = 0u32;
    for (i, c) in cleaned.iter().enumerate() {
        let Some(digit) = c.to_digit(10) else {
            return false;
        };
        sum += if i % 2 == 0 { digit } else { digit * 3 };
    }
    sum.is_multiple_of(10)
}

#[cfg(test)]
mod tests;
