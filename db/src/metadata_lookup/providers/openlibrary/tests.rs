//! Edition ranking for a work's check-in printing, and the record-key guard
//! that keeps a client-echoed `provider_ref` from addressing anything but a record.

use serde_json::json;

use super::*;

fn entry(isbn: &str, format: Option<&str>, language: &str) -> OlEditionEntry {
    serde_json::from_value(json!({
        "isbn_13": [isbn],
        "physical_format": format,
        "languages": [{ "key": format!("/languages/{language}") }],
    }))
    .unwrap()
}

// Four valid ISBN-13s that differ only in their check digit's data digits.
const TURKISH_PAPERBACK: &str = "9780306406157";
const ENGLISH_PAPERBACK: &str = "9780134685991";
const ENGLISH_AUDIO_CD: &str = "9780441013593";
const FRENCH_HARDCOVER: &str = "9780451524935";

fn picked(entries: Vec<OlEditionEntry>) -> Option<String> {
    best_edition(entries).map(|e| e.isbn13)
}

#[test]
fn best_edition_prefers_an_english_print_edition_to_any_other() {
    let entries = vec![
        entry(TURKISH_PAPERBACK, Some("Paperback"), "tur"),
        entry(ENGLISH_AUDIO_CD, Some("Audio CD"), "eng"),
        entry(ENGLISH_PAPERBACK, Some("Paperback"), "eng"),
    ];
    assert_eq!(picked(entries).as_deref(), Some(ENGLISH_PAPERBACK));
}

#[test]
fn best_edition_prefers_a_print_edition_to_an_english_one_that_is_not() {
    let entries = vec![
        entry(ENGLISH_AUDIO_CD, Some("Audio CD"), "eng"),
        entry(FRENCH_HARDCOVER, Some("Hardcover"), "fre"),
    ];
    assert_eq!(picked(entries).as_deref(), Some(FRENCH_HARDCOVER));
}

#[test]
fn best_edition_prefers_an_english_edition_to_one_of_unknown_format() {
    let entries = vec![
        entry(FRENCH_HARDCOVER, None, "fre"),
        entry(ENGLISH_AUDIO_CD, None, "eng"),
    ];
    assert_eq!(picked(entries).as_deref(), Some(ENGLISH_AUDIO_CD));
}

#[test]
fn best_edition_falls_back_to_the_first_edition_with_an_isbn() {
    let entries = vec![
        entry(FRENCH_HARDCOVER, None, "fre"),
        entry(TURKISH_PAPERBACK, None, "tur"),
    ];
    assert_eq!(picked(entries).as_deref(), Some(FRENCH_HARDCOVER));
}

#[test]
fn best_edition_never_counts_a_non_print_format_as_print() {
    for format in [
        "Audio CD",
        "MP3 CD",
        "MP3CD",
        "Audio Cassette",
        "Playaway",
        "Audio Disc",
        "eBook",
        "EPUB",
        "Mobi",
        "PDF",
        "Large Print",
        "Kindle Edition",
    ] {
        let entries = vec![
            entry(ENGLISH_AUDIO_CD, Some(format), "eng"),
            entry(FRENCH_HARDCOVER, Some("Hardcover"), "fre"),
        ];
        assert_eq!(
            picked(entries).as_deref(),
            Some(FRENCH_HARDCOVER),
            "{format} must lose to a plain print edition"
        );
    }
}

#[test]
fn best_edition_skips_an_edition_with_no_usable_isbn() {
    let bad: OlEditionEntry =
        serde_json::from_value(json!({ "isbn_13": ["not-an-isbn"] })).unwrap();
    assert_eq!(picked(vec![bad]), None);
}

#[test]
fn best_edition_reads_an_isbn_10_as_its_isbn_13() {
    let entry: OlEditionEntry =
        serde_json::from_value(json!({ "isbn_10": ["0134685997"] })).unwrap();
    assert_eq!(picked(vec![entry]).as_deref(), Some(ENGLISH_PAPERBACK));
}

// `base_url` concatenates rather than joining, so what reaches `Url::parse`
// is `{base}{key}.json`. That makes `is_record_key` the only thing standing
// between a client-supplied `provider_ref` and a request of its choosing —
// these cases are the ones that would otherwise get through.

#[test]
fn is_record_key_accepts_the_two_record_paths_open_library_actually_mints() {
    assert!(is_record_key("/works/OL893414W"));
    assert!(is_record_key("/books/OL7353617M"));
    assert!(is_record_key("/works/OL_1-2W"));
}

#[test]
fn is_record_key_rejects_the_isbn_fallback_ref_every_provider_shares() {
    // Not a path at all: concatenated onto the base it addresses
    // `https://openlibrary.orgisbn:978….json`, which is not a record.
    assert!(!is_record_key("isbn:9780134685991"));
}

#[test]
fn is_record_key_rejects_a_traversal_segment() {
    // `/works/../../../some/other/path.json` parses to `/some/other/path.json`
    // — a different endpoint on the same host.
    assert!(!is_record_key("/works/../../../some/other/path"));
    assert!(!is_record_key("/books/OL1M/.."));
}

#[test]
fn is_record_key_rejects_a_ref_that_rewrites_the_host() {
    // The dangerous shape: `{base}@evil.example/x.json` parses with
    // `openlibrary.org…` as *userinfo* and `evil.example` as the host, so a
    // ref carrying `@`, a scheme, or `//` must never reach the URL.
    assert!(!is_record_key("@evil.example/x"));
    assert!(!is_record_key("/works/OL1W@evil.example/x"));
    assert!(!is_record_key("https://evil.example/x"));
    assert!(!is_record_key("//evil.example/x"));
    assert!(!is_record_key("/works/OL1W?x=y"));
    assert!(!is_record_key("/works/OL1W#frag"));
}

#[test]
fn is_record_key_rejects_an_over_long_ref() {
    // `EditionHydrateRequest::validate` caps at 256 bytes, four times this
    // guard's own limit, so the length check has to hold on its own.
    let long = format!("/works/{}", "O".repeat(64));
    assert!(long.len() > 64);
    assert!(!is_record_key(&long));
}

#[test]
fn is_record_key_rejects_a_path_outside_the_two_record_prefixes() {
    assert!(!is_record_key("/search.json"));
    assert!(!is_record_key("/authors/OL1A"));
    assert!(!is_record_key(""));
}
