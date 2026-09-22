//! Tests for [`super`]: `bd_identifier_key`'s rendered-list key must stay
//! unique across same-scheme, schemeless, and delimiter-containing values so
//! Dioxus keying never collides; the label maps a scheme to something a
//! reader can read; and `bd_identifier_rows` collapses one identifier listed
//! under several schemes into a single row.

use super::*;
use omnibus_shared::EbookMetadata;

fn ident(scheme: Option<&str>, value: &str) -> Identifier {
    Identifier {
        scheme: scheme.map(str::to_string),
        value: value.to_string(),
    }
}

/// `bd_identifier_rows` over a book carrying only scanned identifiers — the
/// shape every pre-override test asserts.
fn rows(identifiers: &[Identifier]) -> Vec<BdIdentifierRow> {
    bd_identifier_rows(&EbookMetadata {
        identifiers: identifiers.to_vec(),
        ..Default::default()
    })
}

/// `bd_identifier_rows` over a book with scanned identifiers *and* saved ISBN
/// overrides.
fn rows_with_isbns(
    identifiers: &[Identifier],
    isbn13: Option<&str>,
    isbn10: Option<&str>,
) -> Vec<BdIdentifierRow> {
    bd_identifier_rows(&EbookMetadata {
        identifiers: identifiers.to_vec(),
        isbn13: isbn13.map(str::to_string),
        isbn10: isbn10.map(str::to_string),
        ..Default::default()
    })
}

/// The label half of [`bd_identifier_label_ranked`] — the rank is asserted
/// through `bd_identifier_rows`, which is the only thing that reads it.
fn label(ident: &Identifier) -> String {
    bd_identifier_label_ranked(ident).0
}

#[test]
fn bd_identifier_key_distinguishes_same_scheme_different_values() {
    // The book-detail crash repro: two `unknown`-scheme identifiers on one
    // book must not collide on the rendered list key.
    assert_ne!(
        bd_identifier_key(&ident(Some("unknown"), "978-1-938570-40-7")),
        bd_identifier_key(&ident(
            Some("unknown"),
            "urn:uuid:c0e51a66-085f-4805-b116-a0d451d281bd"
        ))
    );
    assert_ne!(
        bd_identifier_key(&ident(Some("ISBN"), "111")),
        bd_identifier_key(&ident(Some("ISBN"), "222"))
    );
}

#[test]
fn bd_identifier_key_distinguishes_schemeless_values_from_each_other_and_from_a_scheme() {
    assert_ne!(
        bd_identifier_key(&ident(None, "a")),
        bd_identifier_key(&ident(None, "b"))
    );
    assert_ne!(
        bd_identifier_key(&ident(None, "111")),
        bd_identifier_key(&ident(Some("ISBN"), "111"))
    );
}

#[test]
fn bd_identifier_key_survives_delimiter_shuffle_between_fields() {
    // A naive `scheme|value` join would map both of these to "a|b|c"; the
    // `Debug`-quoted encoding keeps them distinct.
    let a = bd_identifier_key(&ident(Some("a\u{1f}b"), "c"));
    let b = bd_identifier_key(&ident(Some("a"), "b\u{1f}c"));
    assert_ne!(a, b);
}

#[test]
fn bd_identifier_label_prefers_a_real_scheme() {
    assert_eq!(label(&ident(Some("ASIN"), "B000")), "ASIN");
}

#[test]
fn bd_identifier_label_infers_isbn_from_a_valid_value_when_scheme_unknown() {
    // A valid ISBN-13, and a valid ISBN-10 whose check digit is `X`, are
    // inferred as ISBN; a non-ISBN string is not.
    assert_eq!(label(&ident(Some("unknown"), "978-0-7564-0407-9")), "ISBN");
    assert_eq!(label(&ident(None, "080442957X")), "ISBN");
    assert_eq!(label(&ident(None, "not-an-isbn")), "Identifier");
}

#[test]
fn bd_identifier_label_does_not_infer_isbn_for_a_checksum_failure() {
    // #2359: ten digits but a failing ISBN-10 check digit, under an `unknown`
    // scheme — presenting it as an ISBN made bad file metadata look verified.
    assert_eq!(label(&ident(Some("unknown"), "2100906924")), "Identifier");
    // A single wrong digit in an otherwise-valid ISBN-13 is caught too.
    assert_eq!(label(&ident(None, "9780756404078")), "Identifier");
}

#[test]
fn bd_looks_like_isbn_validates_the_check_digit() {
    // Valid ISBN-13, valid ISBN-10, valid ISBN-10 ending in X.
    assert!(bd_looks_like_isbn("978-0-7564-0407-9"));
    assert!(bd_looks_like_isbn("0-316-76948-7"));
    assert!(bd_looks_like_isbn("080442957X"));
    // Right length, wrong checksum.
    assert!(!bd_looks_like_isbn("2100906924"));
    assert!(!bd_looks_like_isbn("9780756404078"));
    // `X` is only a check digit in the final position, and length must match.
    assert!(!bd_looks_like_isbn("X123456789"));
    assert!(!bd_looks_like_isbn("12345"));
}

#[test]
fn bd_identifier_label_names_an_onix_codelist_value() {
    // The reported row labelled "15" — the ONIX codelist-5 code an EPUB 3
    // `identifier-type` refinement carries for an ISBN-13.
    assert_eq!(label(&ident(Some("15"), "9780316769488")), "ISBN-13");
    assert_eq!(label(&ident(Some("02"), "0316769487")), "ISBN-10");
    assert_eq!(label(&ident(Some("06"), "10.1000/182")), "DOI");
}

#[test]
fn bd_identifier_label_never_shows_a_bare_numeric_scheme() {
    // A codelist value this table doesn't know is still not a label — fall
    // back to the value's own shape rather than printing the code.
    assert_eq!(label(&ident(Some("99"), "9780316769488")), "ISBN");
    assert_eq!(label(&ident(Some("99"), "xyz")), "Identifier");
}

#[test]
fn bd_identifier_label_names_the_source_uuid_for_what_it_holds() {
    // Calibre writes its own book uuid under the `uuid` scheme; it is not
    // the book's Omnibus uuid, so the row must not claim to be one.
    assert_eq!(
        label(&ident(Some("uuid"), "c0e51a66-085f-4805-b116-a0d451d281bd")),
        "Source UUID"
    );
    assert_eq!(label(&ident(Some("calibre"), "412")), "Calibre ID");
}

#[test]
fn bd_identifier_label_passes_an_unrecognized_named_scheme_through() {
    assert_eq!(label(&ident(Some("BNB"), "GB1234")), "BNB");
}

#[test]
fn bd_identifier_rows_collapse_one_value_listed_under_several_schemes() {
    // An EPUB 3 package writes its ISBN as a `<dc:identifier>` and again as
    // an ONIX refinement; both reached the table as separate rows.
    let rows = rows(&[
        ident(Some("15"), "9780316769488"),
        ident(Some("ISBN"), "9780316769488"),
    ]);
    assert_eq!(rows.len(), 1);
    // Both schemes are ones the table knows, so the first wins — and either
    // way the surviving label is a name, never the code.
    assert_eq!(rows[0].label, "ISBN-13");
    assert_eq!(rows[0].value, "9780316769488");
}

#[test]
fn bd_identifier_rows_prefer_a_known_label_over_an_inferred_one() {
    let rows = rows(&[
        ident(Some("unknown"), "9780316769488"),
        ident(Some("15"), "9780316769488"),
    ]);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].label, "ISBN-13");
}

#[test]
fn bd_identifier_rows_keep_the_first_occurrence_on_a_tie() {
    let rows = rows(&[
        ident(Some("ISBN"), "9780316769488"),
        ident(Some("isbn"), "9780316769488"),
    ]);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].label, "ISBN");
}

#[test]
fn bd_identifier_rows_keep_distinct_values_in_source_order() {
    let rows = rows(&[
        ident(Some("15"), "9780316769488"),
        ident(Some("calibre"), "412"),
        ident(Some("uuid"), "c0e51a66-085f-4805-b116-a0d451d281bd"),
    ]);
    assert_eq!(rows.len(), 3);
    assert_eq!(
        rows.iter().map(|r| r.label.as_str()).collect::<Vec<_>>(),
        ["ISBN-13", "Calibre ID", "Source UUID"]
    );
}

#[test]
fn bd_identifier_rows_drop_a_blank_value() {
    let rows = rows(&[ident(Some("ISBN"), "   "), ident(None, "")]);
    assert!(rows.is_empty());
}

#[test]
fn bd_identifier_rows_give_every_row_a_distinct_key() {
    let rows = rows(&[
        ident(Some("ISBN"), "111"),
        ident(Some("ISBN"), "222"),
        ident(None, "333"),
    ]);
    let mut keys: Vec<&str> = rows.iter().map(|r| r.key.as_str()).collect();
    keys.sort_unstable();
    let before = keys.len();
    keys.dedup();
    assert_eq!(keys.len(), before);
}

#[test]
fn bd_identifier_rows_render_an_isbn13_override_the_file_never_carried() {
    // #2496 AC1: the editor saved it, the API returns it, the table dropped it.
    let out = rows_with_isbns(&[], Some("9780316769488"), None);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].label, "ISBN-13");
    assert_eq!(out[0].value, "9780316769488");
}

#[test]
fn bd_identifier_rows_replace_a_scanned_row_the_isbn10_override_corrects() {
    // The reported book: the file files a 13-digit value under OPF scheme
    // `02`, so the table labelled it ISBN-10. The overrides name the real
    // ISBN-13 (same value) and the real ISBN-10 (a different one). AC2: the
    // correction replaces the row rather than sitting beside it.
    let out = rows_with_isbns(
        &[ident(Some("02"), "9780316259088")],
        Some("9780316259088"),
        Some("031625908X"),
    );
    assert_eq!(out.len(), 2);
    assert_eq!(out[0].label, "ISBN-13");
    assert_eq!(out[0].value, "9780316259088");
    assert_eq!(out[1].label, "ISBN-10");
    assert_eq!(out[1].value, "031625908X");
}

#[test]
fn bd_identifier_rows_do_not_duplicate_an_override_the_file_already_carries() {
    let out = rows_with_isbns(
        &[ident(Some("ISBN-13"), "9780316769488")],
        Some("9780316769488"),
        None,
    );
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].value, "9780316769488");
}

#[test]
fn bd_identifier_rows_restore_the_scanned_value_once_the_override_is_cleared() {
    // AC3: with no override the fields are `None` (or re-derived from the
    // file), so the scanned row is what renders — unchanged.
    let out = rows_with_isbns(&[ident(Some("15"), "9780316769488")], None, None);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].label, "ISBN-13");
    assert_eq!(out[0].value, "9780316769488");
}

#[test]
fn bd_identifier_rows_do_not_duplicate_a_hyphenated_scanned_isbn_with_its_derived_isbn13() {
    let out = rows_with_isbns(
        &[ident(Some("ISBN"), "978-0-13-468599-1")],
        Some("9780134685991"),
        None,
    );
    assert_eq!(out.len(), 1);
}

#[test]
fn bd_identifier_rows_keep_two_distinct_scanned_isbns_when_one_is_the_derived_isbn13() {
    let out = rows_with_isbns(
        &[
            ident(Some("ISBN"), "9780000000000"),
            ident(Some("15"), "9781111111112"),
        ],
        Some("9780000000000"),
        None,
    );
    assert_eq!(out.len(), 2);
    assert!(out.iter().any(|r| r.value == "9781111111112"));
}

#[test]
fn bd_identifier_rows_collapse_a_urn_isbn_twin_onto_the_override_row() {
    let out = rows_with_isbns(
        &[
            ident(Some("ISBN"), "urn:isbn:9780134685991"),
            ident(Some("15"), "978-0-13-468599-1"),
        ],
        Some("9780134685991"),
        None,
    );
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].label, "ISBN-13");
    assert_eq!(out[0].value, "9780134685991");
}

#[test]
fn bd_identifier_rows_relabel_the_matching_row_and_keep_every_other_scanned_row() {
    // The override's value is in the file under a worse label; the file's own
    // (wrong) ISBN-13 stays visible rather than being silently dropped.
    let out = rows_with_isbns(
        &[
            ident(Some("15"), "9780000000000"),
            ident(Some("02"), "9780316259088"),
        ],
        Some("9780316259088"),
        None,
    );
    assert_eq!(out.len(), 2);
    assert!(out
        .iter()
        .any(|r| r.label == "ISBN-13" && r.value == "9780316259088"));
    assert!(out.iter().any(|r| r.value == "9780000000000"));
}

#[test]
fn bd_identifier_rows_keep_two_non_isbn_values_that_differ_only_by_a_hyphen() {
    let out = rows(&[
        ident(Some("calibre"), "foo-123"),
        ident(Some("calibre"), "foo123"),
    ]);
    assert_eq!(out.len(), 2);
}

#[test]
fn bd_identifier_rows_never_treat_a_url_carrying_the_isbn_digits_as_the_isbn() {
    let out = rows_with_isbns(
        &[ident(Some("url"), "https://example.com/book/9780134685991")],
        Some("9780134685991"),
        None,
    );
    assert_eq!(out.len(), 2);
    assert!(out
        .iter()
        .any(|r| r.value == "https://example.com/book/9780134685991"));
    assert!(out
        .iter()
        .any(|r| r.label == "ISBN-13" && r.value == "9780134685991"));
}

#[test]
fn an_isbn13_override_replaces_a_scanned_isbn13_row_with_a_different_value() {
    // The label-match branch on its own: the file's ISBN-13 is wrong, the
    // override corrects it.
    let out = rows_with_isbns(
        &[ident(Some("15"), "9780000000000")],
        Some("9780316259088"),
        None,
    );
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].label, "ISBN-13");
    assert_eq!(out[0].value, "9780316259088");
}
