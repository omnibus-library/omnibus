//! Unit tests for the `helpers` module.

use omnibus_shared::EbookMetadata;

use super::*;

fn with_series(series: Option<&str>, series_index: Option<&str>) -> EbookMetadata {
    EbookMetadata {
        series: series.map(Into::into),
        series_index: series_index.map(Into::into),
        ..Default::default()
    }
}

#[test]
fn parse_series_index_parses_finite_decimals() {
    assert_eq!(parse_series_index(" 1.5 "), Some(1.5));
    assert_eq!(parse_series_index("3"), Some(3.0));
}

#[test]
fn parse_series_index_rejects_non_finite_and_garbage() {
    // `"nan"`/`"inf"` parse to non-finite floats SQLite would store, which
    // corrupt the Series keyset cursor — they must be dropped at the source.
    assert_eq!(parse_series_index("nan"), None);
    assert_eq!(parse_series_index("inf"), None);
    assert_eq!(parse_series_index("-inf"), None);
    assert_eq!(parse_series_index("not a number"), None);
}

#[test]
fn cleaned_series_name_strips_a_trailing_hash_index() {
    // AC1: "Name #1"/"Name #2"/"Name #3" all clean to the same "Name".
    for raw in [
        "Crowns of Nyaxia #1",
        "Crowns of Nyaxia #2",
        "Crowns of Nyaxia #3",
    ] {
        assert_eq!(
            cleaned_series_name(&with_series(Some(raw), None)).as_deref(),
            Some("Crowns of Nyaxia"),
            "input {raw:?}"
        );
    }
}

#[test]
fn cleaned_series_name_strips_a_trailing_comma_book_index() {
    assert_eq!(
        cleaned_series_name(&with_series(Some("Mistborn, Book 2"), None)).as_deref(),
        Some("Mistborn")
    );
}

#[test]
fn cleaned_series_name_leaves_a_plain_name_untouched() {
    assert_eq!(
        cleaned_series_name(&with_series(Some("  Foundation  "), None)).as_deref(),
        Some("Foundation")
    );
    assert_eq!(cleaned_series_name(&with_series(None, None)), None);
    assert_eq!(cleaned_series_name(&with_series(Some("   "), None)), None);
}

#[test]
fn resolved_series_index_parses_the_embedded_hash_suffix_when_no_explicit_index() {
    assert_eq!(
        resolved_series_index(&with_series(Some("The Bloodsword Saga #2"), None)),
        Some(2.0)
    );
    assert_eq!(
        resolved_series_index(&with_series(Some("Mistborn, Book 2"), None)),
        Some(2.0)
    );
}

#[test]
fn resolved_series_index_prefers_the_explicit_index_over_an_embedded_one() {
    // AC2: an explicit index always wins, even when it disagrees with the
    // number embedded in the name.
    assert_eq!(
        resolved_series_index(&with_series(Some("Mistborn #2"), Some("5"))),
        Some(5.0)
    );
}

#[test]
fn resolved_series_index_is_none_without_an_explicit_or_embedded_index() {
    assert_eq!(
        resolved_series_index(&with_series(Some("Foundation"), None)),
        None
    );
    assert_eq!(resolved_series_index(&with_series(None, None)), None);
}

#[test]
fn sanitize_accent_color_accepts_indexer_shape() {
    assert_eq!(
        sanitize_accent_color(Some("oklch(0.660 0.130 245.0)")).as_deref(),
        Some("oklch(0.660 0.130 245.0)")
    );
    assert_eq!(
        sanitize_accent_color(Some("oklch(0.780 0.060 12.5)")).as_deref(),
        Some("oklch(0.780 0.060 12.5)")
    );
}

#[test]
fn sanitize_accent_color_rejects_bad_shapes() {
    for bad in [
        "",
        "red",
        "#aabbcc",
        "rgb(1,2,3)",
        "oklch(0.66, 0.13, 245)",                   // commas, not spaces
        "oklch(0.66 0.13)",                         // wrong arity
        "oklch(0.66 0.13 245 extra)",               // wrong arity
        "oklch(0.66 0.13 245",                      // missing close paren
        "0.66 0.13 245",                            // missing wrapper
        "oklch(0.66 0.13 abc)",                     // non-numeric
        "oklch(0.66 0.13 24.5.0)",                  // multiple dots
        "oklch(0.66 0.13 245); background: url(x)", // injection
        "oklch(0.66 0.13 245)\" onload=\"alert(1)", // attribute breakout
        "oklch(. . .)",                             // dot-only parts (no digits)
        "oklch(0.66 . 245.0)",                      // one part has no digits
    ] {
        assert!(
            sanitize_accent_color(Some(bad)).is_none(),
            "expected None for {bad:?}"
        );
    }
    assert_eq!(sanitize_accent_color(None), None);
}

#[test]
fn cap_query_len_passes_short_input_through_trimmed() {
    // Under the cap: only surrounding whitespace is stripped.
    assert_eq!(cap_query_len("  harry potter  "), "harry potter");
}

#[test]
fn cap_query_len_truncates_oversized_input_to_the_cap() {
    let oversized = "a".repeat(MAX_QUERY_LEN * 10);
    let capped = cap_query_len(&oversized);
    // Observable effect: the tail is dropped, leaving exactly the cap.
    assert_eq!(capped.chars().count(), MAX_QUERY_LEN);
    assert!(capped.chars().all(|c| c == 'a'));
    assert!(capped.len() < oversized.len());
}

#[test]
fn cap_query_len_truncates_on_a_char_boundary() {
    // A multibyte char repeated past the cap must slice cleanly — never
    // panic and never split a codepoint.
    let multibyte = "é".repeat(MAX_QUERY_LEN * 2);
    let capped = cap_query_len(&multibyte);
    assert_eq!(capped.chars().count(), MAX_QUERY_LEN);
    assert!(capped.chars().all(|c| c == 'é'));
}

#[test]
fn sanitize_fts_query_quotes_tokens_and_prefixes_last() {
    assert_eq!(
        sanitize_fts_query("harry pott").as_deref(),
        Some("\"harry\" \"pott\"*")
    );
}

#[test]
fn sanitize_fts_query_escapes_embedded_double_quotes() {
    assert_eq!(
        sanitize_fts_query("say \"hi").as_deref(),
        Some("\"say\" \"\"\"hi\"*")
    );
}

#[test]
fn sanitize_fts_query_returns_none_for_empty_and_whitespace() {
    assert!(sanitize_fts_query("").is_none());
    assert!(sanitize_fts_query("   \t  ").is_none());
}

#[test]
fn sanitize_fts_query_treats_operators_as_literals() {
    // Bare `AND` / `NOT` would otherwise be parsed as FTS5 operators and
    // could throw. Quoting makes them into literal tokens.
    let out = sanitize_fts_query("AND NOT OR").expect("non-empty");
    assert!(out.contains("\"AND\""));
    assert!(out.contains("\"NOT\""));
    assert!(out.contains("\"OR\"*"));
}

#[test]
fn sanitize_fts_query_keeps_hyphenated_isbn_as_single_token() {
    let out = sanitize_fts_query("978-0-123456-78-9").expect("non-empty");
    assert_eq!(out, "\"978-0-123456-78-9\"*");
}

#[test]
fn build_search_query_is_empty_for_blank_input() {
    assert!(build_search_query("").is_empty());
    assert!(build_search_query("   \t  ").is_empty());
}

#[test]
fn build_search_query_is_empty_when_only_empty_facets() {
    // `author:` / `series:` / `tag:` / `genre:` with no value are dropped
    // silently.
    assert!(build_search_query("author:").is_empty());
    assert!(build_search_query("series:   tag:").is_empty());
    assert!(build_search_query("genre:").is_empty());
}

// Regression for #2504: a multi-word facet value must survive as one facet.
// Split on whitespace, `tag:"Science Fiction"` became `tag:Science` plus a
// free-text `Fiction"`, which matched books merely *titled* something with
// "Fiction" in them.
#[test]
fn build_search_query_keeps_a_quoted_facet_value_whole() {
    // The value travels as one name and is matched against membership, so
    // "Science Fiction" can no longer reach a book tagged "Science Fiction &
    // Fantasy" the way a prefix-starred index term did.
    assert_eq!(
        build_search_query("tag:\"Science Fiction\"").tag_facets,
        vec!["Science Fiction".to_string()]
    );
    // Punctuation inside the value is part of the value, not its own facet.
    assert_eq!(
        build_search_query("genre:\"Science Fiction & Fantasy\"").genre_facets,
        vec!["Science Fiction & Fantasy".to_string()]
    );
}

// The prefix star is type-ahead, and an unquoted query is someone typing.
#[test]
fn build_search_query_keeps_the_prefix_star_on_unquoted_free_text_only() {
    // Type-ahead still applies to what FTS answers. A facet names a value, so
    // it is carried verbatim and compared whole.
    assert_eq!(
        build_search_query("tag:sci").tag_facets,
        vec!["sci".to_string()]
    );
    assert_eq!(
        build_search_query("harry pott").fts_match.as_deref(),
        Some("{title authors series} : (\"harry\" \"pott\"*)")
    );
}

#[test]
fn build_search_query_still_splits_an_unquoted_multi_word_run() {
    // Unquoted input is unchanged: two bare words after a facet are one
    // facet value plus free text, exactly as before.
    let q = build_search_query("tag:Science Fiction");
    assert_eq!(q.tag_facets, vec!["Science".to_string()]);
    assert_eq!(
        q.fts_match.as_deref(),
        Some("{title authors series} : (\"Fiction\"*)")
    );
}

#[test]
fn build_search_query_treats_an_unclosed_quote_as_running_to_the_end() {
    // A reader mid-type has an unbalanced quote; searching what they have so
    // far beats refusing to search.
    assert_eq!(
        build_search_query("tag:\"Dark academia").tag_facets,
        vec!["Dark academia".to_string()]
    );
}

// Regression for the #2504 review: `facet_query` escapes an embedded quote
// as `""`, so the tokenizer has to fold that pair back into one literal
// quote. Toggling on every `"` swallowed it and searched a different value
// from the one the heading names.
#[test]
fn build_search_query_folds_a_doubled_quote_back_into_the_value() {
    assert_eq!(
        build_search_query(r#"tag:"the ""good"" parts""#).tag_facets,
        vec![r#"the "good" parts"#.to_string()]
    );
}

#[test]
fn build_search_query_drops_an_empty_quoted_facet_value() {
    assert!(build_search_query("tag:\"\"").is_empty());
}

#[test]
fn build_search_query_reads_a_bare_quoted_phrase_as_one_free_text_phrase() {
    // Not a facet, but the same tokenizer: quoting is how a reader asks for a
    // phrase, and splitting it stranded the quote characters in the terms.
    assert_eq!(
        build_search_query("\"the long way\"").fts_match.as_deref(),
        Some("{title authors series} : (\"the long way\")")
    );
}

#[test]
fn build_search_query_emits_default_scope_for_free_text() {
    // Free-text falls into the same `{title authors series}` filter
    // that the F0.4 hardcoded filter used to apply directly.
    assert_eq!(
        build_search_query("harry pott").fts_match.as_deref(),
        Some("{title authors series} : (\"harry\" \"pott\"*)")
    );
}

#[test]
fn build_search_query_emits_author_facet() {
    assert_eq!(
        build_search_query("author:austen").fts_match.as_deref(),
        Some("{authors} : (\"austen\"*)")
    );
}

#[test]
fn build_search_query_combines_facet_and_free_text() {
    // Two clauses joined by an explicit `AND` — FTS5's grammar only
    // implicit-ANDs *inside* a column-filter body, not between two
    // top-level column filters.
    let out = build_search_query("author:austen pride")
        .fts_match
        .expect("non-empty");
    assert_eq!(
        out,
        "{authors} : (\"austen\"*) AND {title authors series} : (\"pride\"*)"
    );
}

#[test]
fn build_search_query_routes_series_to_fts_and_tag_to_a_facet() {
    assert_eq!(
        build_search_query("series:dune").fts_match.as_deref(),
        Some("{series} : (\"dune\"*)")
    );
    let q = build_search_query("tag:fiction");
    assert_eq!(q.tag_facets, vec!["fiction".to_string()]);
    assert!(q.fts_match.is_none());
}

#[test]
fn build_search_query_routes_a_genre_to_a_facet() {
    let q = build_search_query("genre:horror");
    assert_eq!(q.genre_facets, vec!["horror".to_string()]);
    assert!(q.fts_match.is_none());
}

#[test]
fn build_search_query_keeps_genre_and_tag_facets_separate() {
    // The two vocabularies are distinct, so a query naming both must require
    // both — a book tagged "classic" but not genred "horror" has to fall out.
    let q = build_search_query("genre:horror tag:classic");
    assert_eq!(q.tag_facets, vec!["classic".to_string()]);
    assert_eq!(q.genre_facets, vec!["horror".to_string()]);
}

#[test]
fn build_search_query_facet_prefix_is_case_insensitive() {
    assert_eq!(
        build_search_query("Author:Austen").fts_match.as_deref(),
        Some("{authors} : (\"Austen\"*)")
    );
}

#[test]
fn build_search_query_unknown_prefix_falls_through_to_free_text() {
    // `isbn:` is not a recognised facet — treat the whole token as
    // free-text rather than erroring.
    assert_eq!(
        build_search_query("isbn:foo").fts_match.as_deref(),
        Some("{title authors series} : (\"isbn:foo\"*)")
    );
}

// The one mixed shape: a facet leaves the MATCH while free text stays in it,
// so both halves of the split have to survive the same parse.
#[test]
fn build_search_query_combines_a_tag_facet_with_free_text() {
    let query = build_search_query("tag:Classic pride prejudice");

    assert_eq!(query.tag_facets, ["Classic"]);
    assert_eq!(
        query.fts_match.as_deref(),
        Some("{title authors series} : (\"pride\" \"prejudice\"*)")
    );
}

// Two facets of the *same* kind stay separate values rather than merging,
// because they AND against membership — see
// `search_books_two_tag_facets_require_both_memberships`.
#[test]
fn build_search_query_collects_two_tag_facets_separately() {
    let query = build_search_query("tag:A tag:B");

    assert_eq!(query.tag_facets, ["A", "B"]);
}

#[test]
fn stable_uuid_is_deterministic() {
    // Same inputs → same UUID, both within a single run and across calls.
    let a = stable_uuid("/var/lib/omnibus", "Author/Title.epub");
    let b = stable_uuid("/var/lib/omnibus", "Author/Title.epub");
    assert_eq!(a, b, "stable_uuid must be deterministic");
}

#[test]
fn stable_uuid_differs_for_distinct_inputs() {
    // Differing library_path or filename must yield different ids; this
    // is the property that makes per-book cover URLs stable but unique.
    let base = stable_uuid("/lib", "a.epub");
    assert_ne!(base, stable_uuid("/lib", "b.epub"));
    assert_ne!(base, stable_uuid("/other", "a.epub"));
    // And the NUL separator must actually separate — splitting the key
    // at a different boundary should still produce a distinct UUID.
    assert_ne!(
        stable_uuid("/lib/a", ".epub"),
        stable_uuid("/lib", "a.epub")
    );
}

#[test]
fn stable_uuid_matches_namespace_url_v5() {
    // Cross-check against the uuid crate computing the exact same input
    // we document. Locks the namespace + key shape so a future refactor
    // can't quietly change the derivation and rotate every cover id.
    let library_path = "/var/lib/omnibus";
    let filename = "Author/Title.epub";
    let expected = uuid::Uuid::new_v5(
        &uuid::Uuid::NAMESPACE_URL,
        format!("{library_path}\0{filename}").as_bytes(),
    )
    .hyphenated()
    .to_string();
    assert_eq!(stable_uuid(library_path, filename), expected);
}

#[test]
fn stable_uuid_is_version_5() {
    // The hyphenated output must parse as a UUID with version=5 and the
    // RFC 4122 variant bits set. The pre-issue-#94 implementation set
    // neither, so this guards against regressing to a bare hex string.
    let s = stable_uuid("/lib", "x.epub");
    let parsed = uuid::Uuid::parse_str(&s).expect("stable_uuid must produce a valid UUID");
    assert_eq!(parsed.get_version_num(), 5, "must be UUIDv5");
    assert_eq!(
        parsed.get_variant(),
        uuid::Variant::RFC4122,
        "must use RFC 4122 variant bits"
    );
}

#[test]
fn format_series_index_strips_trailing_zeros_for_integer_values() {
    assert_eq!(format_series_index(1.0), "1");
    assert_eq!(format_series_index(7.0), "7");
}

#[test]
fn format_series_index_keeps_decimal_for_fractional_values() {
    assert_eq!(format_series_index(1.5), "1.5");
}

#[test]
fn format_series_index_passes_through_non_finite_values_verbatim() {
    // The guarded cast would otherwise saturate `NaN`/`inf` to
    // `i64::MIN`/`i64::MAX` and surface as a garbled integer.
    assert_eq!(format_series_index(f64::NAN), "NaN");
    assert_eq!(format_series_index(f64::INFINITY), "inf");
    assert_eq!(format_series_index(f64::NEG_INFINITY), "-inf");
}

#[test]
fn is_skipped_scan_dir_skips_dot_directories_and_eadir() {
    assert!(is_skipped_scan_dir(".shelfarr-staging"));
    assert!(is_skipped_scan_dir(".git"));
    assert!(is_skipped_scan_dir("."));
    assert!(is_skipped_scan_dir(".."));
    assert!(is_skipped_scan_dir("@eaDir"));
    // Synology has shipped both casings over the years.
    assert!(is_skipped_scan_dir("@eadir"));
}

#[test]
fn is_skipped_scan_dir_keeps_ordinary_author_directories() {
    assert!(!is_skipped_scan_dir("Becky Jenkinson"));
    assert!(!is_skipped_scan_dir("Pierce Brown"));
    // A leading `@` alone is not the Synology marker — an author or
    // publisher directory may legitimately start with one.
    assert!(!is_skipped_scan_dir("@midnight Press"));
    assert!(!is_skipped_scan_dir("eaDir"));
}
