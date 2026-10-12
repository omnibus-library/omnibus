//! The book's identifier rows as the detail page's metadata table shows
//! them: a human label for each scheme (an ONIX codelist-5 code is not one),
//! and one row per distinct value. Shared by the marquee and mobile tables.

use omnibus_shared::{EbookMetadata, Identifier};

/// Collision-free list key for an identifier row. Several identifiers can share
/// one `scheme`, so the key folds in `value`; Dioxus panics on duplicate keyed
/// siblings.
pub(super) fn bd_identifier_key(ident: &Identifier) -> String {
    // `Debug`-quote both fields: a plain `scheme|value` join collides when the data
    // holds the delimiter, reintroducing the duplicate-key panic.
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

/// Human label for a scheme this table recognizes: the ONIX codelist-5 numbers
/// an EPUB 3 `identifier-type` refinement carries, and the scheme names Calibre
/// and the retailers write. `uuid` is not labelled "UUID": it is the source
/// file's uuid, not the book's own.
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
/// saved ISBN overrides folded in. Same-value identifiers collapse to one row
/// that keeps the best-named label and the first occurrence's position; an
/// override replaces the row it corrects rather than sitting beside it.
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

/// Fold one saved ISBN override into `rows` under `scheme`: it replaces the row
/// holding the same ISBN (per [`same_identifier`]), else the row with its label,
/// else is appended; other rows of that ISBN are then dropped. A row is never
/// dropped by label alone, since a book can carry two distinct ISBNs.
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
    // A same-ISBN match is a rename (`urn:isbn:`, hyphenated and bare forms
    // collapse); a same-label match corrects a wrong file value.
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

/// The value's derived ISBN: after stripping a `urn:isbn:` / `isbn:` / `isbn `
/// prefix, hyphens and whitespace, exactly 13 digits or 9 digits plus a digit or
/// `X`. No checksum, so a mistyped scanned ISBN still collapses onto its derived
/// digits. `None` for URLs, calibre ids and uuids rather than a false match.
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
/// case-insensitive match, or both reduce to the same [`isbn_value`]. The ISBN
/// comparison is deliberately narrow, so non-ISBN values that merely share
/// punctuation (`foo-123` / `foo123`) stay distinct.
fn same_identifier(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
        || matches!((isbn_value(a), isbn_value(b)), (Some(x), Some(y)) if x == y)
}

/// True when `value`, with hyphens and whitespace stripped, is a valid ISBN —
/// the right length for an ISBN-10 or ISBN-13 **and** passing its check digit.
/// Only used to infer a label when the scheme said nothing, so a false positive
/// mislabels bad file metadata as verified.
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
