//! Unit tests for the library filter clauses: their wire tokens, the
//! `ViewFilters` predicates, and the legacy-facet fallback into clauses.

use crate::ebook::Contributor;
use crate::{SortDir, SortKey, ViewMode, ViewPrefs};

use super::*;

const ALL_FIELDS: [FilterField; 6] = [
    FilterField::Tag,
    FilterField::Genre,
    FilterField::Author,
    FilterField::Series,
    FilterField::Format,
    FilterField::Shelf,
];

const ALL_MODES: [FilterMode; 2] = [FilterMode::Include, FilterMode::Exclude];

#[test]
fn filter_clause_serializes_to_the_snake_case_wire_tokens() {
    let wire = serde_json::to_string(&FilterClause::new(
        FilterField::Genre,
        FilterMode::Exclude,
        &["Fantasy"],
    ))
    .expect("serialize");
    assert_eq!(
        wire,
        r#"{"field":"genre","mode":"exclude","values":["Fantasy"]}"#
    );
}

#[test]
fn filter_field_shelf_serializes_to_its_snake_case_token() {
    let wire = serde_json::to_string(&FilterField::Shelf).expect("serialize");
    assert_eq!(wire, r#""shelf""#);
}

#[test]
fn filter_clause_round_trips_every_field_and_mode() {
    for field in ALL_FIELDS {
        for mode in ALL_MODES {
            let original = FilterClause::new(field, mode, &["a", "b"]);
            let wire = serde_json::to_string(&original).expect("serialize");
            let parsed: FilterClause = serde_json::from_str(&wire).expect("deserialize");
            assert_eq!(parsed, original, "{field:?}/{mode:?} must round-trip");
        }
    }
}

#[test]
fn view_filters_is_empty_true_for_default() {
    assert!(ViewFilters::default().is_empty());
}

#[test]
fn view_filters_is_empty_false_when_a_clause_is_present() {
    let filters = filters_with(vec![FilterClause::new(
        FilterField::Tag,
        FilterMode::Exclude,
        &["horror"],
    )]);
    assert!(!filters.is_empty());
}

const LEGACY_BLOB: &str = r#"{
    "authors": ["Tolkien"],
    "series": [],
    "formats": ["epub"],
    "tags": ["horror"],
    "genres": ["Fantasy"]
}"#;

#[test]
fn view_filters_deserializes_a_legacy_facet_blob_into_include_clauses() {
    let filters: ViewFilters = serde_json::from_str(LEGACY_BLOB).expect("legacy blob parses");

    assert_eq!(
        filters,
        filters_with(vec![
            FilterClause::new(FilterField::Author, FilterMode::Include, &["Tolkien"]),
            FilterClause::new(FilterField::Format, FilterMode::Include, &["epub"]),
            FilterClause::new(FilterField::Tag, FilterMode::Include, &["horror"]),
            FilterClause::new(FilterField::Genre, FilterMode::Include, &["Fantasy"]),
        ])
    );
}

#[test]
fn view_filters_deserializes_a_mixed_era_blob_keeping_legacy_facets_and_clauses() {
    let mixed = r#"{
        "clauses": [{"field":"tag","mode":"exclude","values":["horror"]}],
        "tags": ["sci-fi", "space"],
        "series": ["Poppy War"]
    }"#;

    let filters: ViewFilters = serde_json::from_str(mixed).expect("mixed blob parses");

    assert_eq!(
        filters,
        filters_with(vec![
            FilterClause::new(FilterField::Series, FilterMode::Include, &["Poppy War"]),
            FilterClause::new(FilterField::Tag, FilterMode::Include, &["sci-fi", "space"]),
            FilterClause::new(FilterField::Tag, FilterMode::Exclude, &["horror"]),
        ])
    );
}

#[test]
fn view_filters_deserializes_a_legacy_facet_with_bad_values_into_a_valid_filter() {
    let authors: Vec<String> = (0..65).map(|i| format!("author-{i}")).collect();
    let longest_allowed = "y".repeat(SHELF_RULE_VALUE_MAX_LEN);
    let blob = serde_json::json!({
        "tags": ["   ", "x".repeat(SHELF_RULE_VALUE_MAX_LEN + 1), longest_allowed, "ok"],
        "authors": authors,
    });

    let filters: ViewFilters = serde_json::from_value(blob).expect("legacy blob parses");

    let kept_authors = FilterClause {
        field: FilterField::Author,
        mode: FilterMode::Include,
        values: (0..MAX_FILTER_VALUES)
            .map(|i| format!("author-{i}"))
            .collect(),
    };
    assert_eq!(
        filters,
        filters_with(vec![
            kept_authors,
            FilterClause::new(
                FilterField::Tag,
                FilterMode::Include,
                &[&longest_allowed, "ok"],
            ),
        ])
    );
    assert_eq!(filters.validate(), Ok(()));
}

#[test]
fn view_filters_deserializes_a_legacy_facet_of_only_bad_values_into_no_clause() {
    let filters: ViewFilters =
        serde_json::from_str(r#"{"formats":["  "]}"#).expect("legacy blob parses");

    assert_eq!(filters, ViewFilters::default());
}

#[test]
fn view_filters_deserializes_an_empty_object_into_no_filters() {
    let filters: ViewFilters = serde_json::from_str("{}").expect("empty object parses");

    assert_eq!(filters, ViewFilters::default());
}

#[test]
fn view_filters_serializes_only_clauses() {
    let legacy: ViewFilters = serde_json::from_str(LEGACY_BLOB).expect("legacy blob parses");

    let wire = serde_json::to_value(&legacy).expect("serialize");

    let keys: Vec<&str> = wire
        .as_object()
        .expect("an object")
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(keys, vec!["clauses"]);
}

#[test]
fn view_prefs_deserializes_a_legacy_record_keeping_sort_and_view_mode() {
    let legacy = format!(
        r#"{{
            "view_mode": "table",
            "sort_key": "newest_added",
            "sort_dir": "desc",
            "filters": {LEGACY_BLOB},
            "filters_open": true
        }}"#
    );

    let prefs: ViewPrefs = serde_json::from_str(&legacy).expect("legacy record parses");

    assert_eq!(prefs.view_mode, ViewMode::Table);
    assert_eq!(prefs.sort_key, SortKey::NewestAdded);
    assert_eq!(prefs.sort_dir, SortDir::Desc);
    assert!(prefs.filters_open);
    assert_eq!(
        prefs.filters,
        serde_json::from_str::<ViewFilters>(LEGACY_BLOB).expect("legacy blob parses")
    );
    assert_eq!(prefs.filters.clauses.len(), 4);
}

fn clause_with_values(count: usize) -> FilterClause {
    FilterClause {
        field: FilterField::Tag,
        mode: FilterMode::Include,
        values: (0..count).map(|i| format!("tag-{i}")).collect(),
    }
}

fn filters_with(clauses: Vec<FilterClause>) -> ViewFilters {
    ViewFilters { clauses }
}

fn error_of(filters: &ViewFilters) -> String {
    filters.validate().expect_err("filters must be rejected")
}

#[test]
fn view_filters_validate_accepts_the_default() {
    assert_eq!(ViewFilters::default().validate(), Ok(()));
}

#[test]
fn view_filters_validate_accepts_a_filter_at_every_cap() {
    let widest = "é".repeat(SHELF_RULE_VALUE_MAX_LEN);
    let mut clauses = vec![clause_with_values(MAX_FILTER_VALUES); MAX_FILTER_CLAUSES - 1];
    clauses.push(FilterClause::new(
        FilterField::Author,
        FilterMode::Exclude,
        &[&widest],
    ));

    assert_eq!(filters_with(clauses).validate(), Ok(()));
}

#[test]
fn view_filters_validate_rejects_more_than_the_max_clauses() {
    let clauses = vec![clause_with_values(1); MAX_FILTER_CLAUSES + 1];

    assert_eq!(
        error_of(&filters_with(clauses)),
        "a filter may have at most 16 clauses"
    );
}

#[test]
fn view_filters_validate_rejects_a_clause_with_no_values() {
    let filters = filters_with(vec![clause_with_values(0)]);

    assert_eq!(
        error_of(&filters),
        "a filter clause needs at least one value"
    );
}

#[test]
fn view_filters_validate_rejects_a_clause_with_too_many_values() {
    let filters = filters_with(vec![clause_with_values(MAX_FILTER_VALUES + 1)]);

    assert_eq!(
        error_of(&filters),
        "a filter clause may have at most 64 values"
    );
}

#[test]
fn view_filters_validate_rejects_a_blank_value() {
    let filters = filters_with(vec![FilterClause::new(
        FilterField::Genre,
        FilterMode::Include,
        &["Fantasy", "   "],
    )]);

    assert_eq!(error_of(&filters), "a filter value must not be blank");
}

#[test]
fn view_filters_validate_rejects_a_value_over_the_rule_value_limit() {
    let too_long = "a".repeat(SHELF_RULE_VALUE_MAX_LEN + 1);
    let filters = filters_with(vec![FilterClause::new(
        FilterField::Series,
        FilterMode::Exclude,
        &[&too_long],
    )]);

    assert_eq!(
        error_of(&filters),
        "a filter value must be ≤ 512 characters"
    );
}

#[test]
fn view_filters_validate_rejects_a_non_numeric_shelf_value() {
    let filters = filters_with(vec![FilterClause::new(
        FilterField::Shelf,
        FilterMode::Include,
        &["12", "favourites"],
    )]);

    assert_eq!(
        error_of(&filters),
        "a shelf filter value must be a shelf id"
    );
}

#[test]
fn view_filters_to_query_param_is_none_for_empty_filters() {
    assert_eq!(ViewFilters::default().to_query_param(), None);
}

#[test]
fn view_filters_to_query_param_emits_the_clauses_as_a_json_array() {
    let filters = filters_with(vec![
        FilterClause::new(
            FilterField::Genre,
            FilterMode::Include,
            &["Fantasy", "Sci-Fi"],
        ),
        FilterClause::new(FilterField::Shelf, FilterMode::Exclude, &["12"]),
    ]);

    assert_eq!(
        filters.to_query_param().as_deref(),
        Some(
            r#"[{"field":"genre","mode":"include","values":["Fantasy","Sci-Fi"]},{"field":"shelf","mode":"exclude","values":["12"]}]"#
        )
    );
}

#[test]
fn view_filters_to_query_param_carries_a_legacy_blob_as_include_clauses() {
    let filters: ViewFilters =
        serde_json::from_str(r#"{"formats":["epub"]}"#).expect("legacy blob parses");

    assert_eq!(
        filters.to_query_param().as_deref(),
        Some(r#"[{"field":"format","mode":"include","values":["epub"]}]"#)
    );
}

#[test]
fn view_filters_from_query_param_round_trips_the_clauses() {
    let filters = filters_with(vec![
        FilterClause::new(FilterField::Author, FilterMode::Include, &["Tolkien"]),
        FilterClause::new(FilterField::Tag, FilterMode::Exclude, &["a,b", "c"]),
    ]);
    let wire = filters.to_query_param().expect("non-empty filters encode");

    let parsed = ViewFilters::from_query_param(&wire).expect("round trip parses");

    assert_eq!(parsed, filters);
}

#[test]
fn view_filters_from_query_param_rejects_malformed_json() {
    let error = ViewFilters::from_query_param("[{").expect_err("truncated JSON");

    assert!(!error.is_empty());
}

#[test]
fn view_filters_from_query_param_rejects_an_unknown_field_token() {
    let error = ViewFilters::from_query_param(
        r#"[{"field":"publisher","mode":"include","values":["Tor"]}]"#,
    )
    .expect_err("unknown field");

    assert!(error.contains("publisher"), "{error}");
}

#[test]
fn view_filters_from_query_param_validates_the_parsed_clauses() {
    let error = ViewFilters::from_query_param(r#"[{"field":"tag","mode":"include","values":[]}]"#)
        .expect_err("empty clause");

    assert_eq!(error, "a filter clause needs at least one value");
}

fn novel() -> EbookMetadata {
    EbookMetadata {
        subjects: vec!["Horror".into(), "gothic".into()],
        genres: vec!["Fantasy".into()],
        creators: vec![Contributor {
            name: "Mary Shelley".into(),
            ..Default::default()
        }],
        series: Some("Frankenstein Cycle".into()),
        formats: vec!["EPUB".into()],
        ..Default::default()
    }
}

/// A physical-only book: no value for any filterable field.
fn bare() -> EbookMetadata {
    EbookMetadata::default()
}

fn verdict(
    field: FilterField,
    mode: FilterMode,
    values: &[&str],
    book: &EbookMetadata,
) -> Option<bool> {
    filters_with(vec![FilterClause::new(field, mode, values)]).matches(book)
}

#[test]
fn view_filters_matches_include_tag_keeps_books_with_any_listed_value() {
    let values = ["horror", "romance"];
    let second_only = EbookMetadata {
        subjects: vec!["romance".into()],
        ..Default::default()
    };
    assert_eq!(
        verdict(FilterField::Tag, FilterMode::Include, &values, &novel()),
        Some(true)
    );
    assert_eq!(
        verdict(FilterField::Tag, FilterMode::Include, &values, &second_only),
        Some(true)
    );
    assert_eq!(
        verdict(FilterField::Tag, FilterMode::Include, &values, &bare()),
        Some(false)
    );
}

#[test]
fn view_filters_matches_exclude_tag_keeps_only_books_without_a_listed_value() {
    let values = ["horror", "romance"];
    let second_only = EbookMetadata {
        subjects: vec!["romance".into()],
        ..Default::default()
    };
    assert_eq!(
        verdict(FilterField::Tag, FilterMode::Exclude, &values, &novel()),
        Some(false)
    );
    assert_eq!(
        verdict(FilterField::Tag, FilterMode::Exclude, &values, &second_only),
        Some(false)
    );
    assert_eq!(
        verdict(FilterField::Tag, FilterMode::Exclude, &values, &bare()),
        Some(true)
    );
}

#[test]
fn view_filters_matches_include_genre_keeps_books_with_any_listed_value() {
    let values = ["Fantasy", "Sci-Fi"];
    let second_only = EbookMetadata {
        genres: vec!["Sci-Fi".into()],
        ..Default::default()
    };
    assert_eq!(
        verdict(FilterField::Genre, FilterMode::Include, &values, &novel()),
        Some(true)
    );
    assert_eq!(
        verdict(
            FilterField::Genre,
            FilterMode::Include,
            &values,
            &second_only
        ),
        Some(true)
    );
    assert_eq!(
        verdict(FilterField::Genre, FilterMode::Include, &values, &bare()),
        Some(false)
    );
}

#[test]
fn view_filters_matches_exclude_genre_keeps_only_books_without_a_listed_value() {
    let values = ["Fantasy", "Sci-Fi"];
    let second_only = EbookMetadata {
        genres: vec!["Sci-Fi".into()],
        ..Default::default()
    };
    assert_eq!(
        verdict(FilterField::Genre, FilterMode::Exclude, &values, &novel()),
        Some(false)
    );
    assert_eq!(
        verdict(
            FilterField::Genre,
            FilterMode::Exclude,
            &values,
            &second_only
        ),
        Some(false)
    );
    assert_eq!(
        verdict(FilterField::Genre, FilterMode::Exclude, &values, &bare()),
        Some(true)
    );
}

#[test]
fn view_filters_matches_include_author_keeps_books_with_any_listed_creator() {
    let values = ["Mary Shelley", "Bram Stoker"];
    let second_only = EbookMetadata {
        creators: vec![Contributor {
            name: "Bram Stoker".into(),
            ..Default::default()
        }],
        ..Default::default()
    };
    assert_eq!(
        verdict(FilterField::Author, FilterMode::Include, &values, &novel()),
        Some(true)
    );
    assert_eq!(
        verdict(
            FilterField::Author,
            FilterMode::Include,
            &values,
            &second_only
        ),
        Some(true)
    );
    assert_eq!(
        verdict(FilterField::Author, FilterMode::Include, &values, &bare()),
        Some(false)
    );
}

#[test]
fn view_filters_matches_exclude_author_keeps_only_books_without_a_listed_creator() {
    let values = ["Mary Shelley", "Bram Stoker"];
    let second_only = EbookMetadata {
        creators: vec![Contributor {
            name: "Bram Stoker".into(),
            ..Default::default()
        }],
        ..Default::default()
    };
    assert_eq!(
        verdict(FilterField::Author, FilterMode::Exclude, &values, &novel()),
        Some(false)
    );
    assert_eq!(
        verdict(
            FilterField::Author,
            FilterMode::Exclude,
            &values,
            &second_only
        ),
        Some(false)
    );
    assert_eq!(
        verdict(FilterField::Author, FilterMode::Exclude, &values, &bare()),
        Some(true)
    );
}

#[test]
fn view_filters_matches_include_series_keeps_books_in_any_listed_series() {
    let values = ["Frankenstein Cycle", "Foundation"];
    let second_only = EbookMetadata {
        series: Some("Foundation".into()),
        ..Default::default()
    };
    assert_eq!(
        verdict(FilterField::Series, FilterMode::Include, &values, &novel()),
        Some(true)
    );
    assert_eq!(
        verdict(
            FilterField::Series,
            FilterMode::Include,
            &values,
            &second_only
        ),
        Some(true)
    );
    assert_eq!(
        verdict(FilterField::Series, FilterMode::Include, &values, &bare()),
        Some(false)
    );
}

#[test]
fn view_filters_matches_exclude_series_keeps_only_books_outside_every_listed_series() {
    let values = ["Frankenstein Cycle", "Foundation"];
    let second_only = EbookMetadata {
        series: Some("Foundation".into()),
        ..Default::default()
    };
    assert_eq!(
        verdict(FilterField::Series, FilterMode::Exclude, &values, &novel()),
        Some(false)
    );
    assert_eq!(
        verdict(
            FilterField::Series,
            FilterMode::Exclude,
            &values,
            &second_only
        ),
        Some(false)
    );
    assert_eq!(
        verdict(FilterField::Series, FilterMode::Exclude, &values, &bare()),
        Some(true)
    );
}

#[test]
fn view_filters_matches_include_format_keeps_books_with_any_listed_format() {
    let values = ["epub", "m4b"];
    let second_only = EbookMetadata {
        formats: vec!["M4B".into()],
        ..Default::default()
    };
    assert_eq!(
        verdict(FilterField::Format, FilterMode::Include, &values, &novel()),
        Some(true)
    );
    assert_eq!(
        verdict(
            FilterField::Format,
            FilterMode::Include,
            &values,
            &second_only
        ),
        Some(true)
    );
    assert_eq!(
        verdict(FilterField::Format, FilterMode::Include, &values, &bare()),
        Some(false)
    );
}

#[test]
fn view_filters_matches_exclude_format_keeps_only_books_without_a_listed_format() {
    let values = ["epub", "m4b"];
    let second_only = EbookMetadata {
        formats: vec!["M4B".into()],
        ..Default::default()
    };
    assert_eq!(
        verdict(FilterField::Format, FilterMode::Exclude, &values, &novel()),
        Some(false)
    );
    assert_eq!(
        verdict(
            FilterField::Format,
            FilterMode::Exclude,
            &values,
            &second_only
        ),
        Some(false)
    );
    assert_eq!(
        verdict(FilterField::Format, FilterMode::Exclude, &values, &bare()),
        Some(true)
    );
}

#[test]
fn view_filters_matches_compares_values_ascii_case_insensitively() {
    assert_eq!(
        verdict(FilterField::Tag, FilterMode::Include, &["HORROR"], &novel()),
        Some(true)
    );
    assert_eq!(
        verdict(
            FilterField::Format,
            FilterMode::Include,
            &["epub"],
            &novel()
        ),
        Some(true)
    );
}

#[test]
fn view_filters_matches_trims_clause_values() {
    assert_eq!(
        verdict(
            FilterField::Tag,
            FilterMode::Include,
            &["  horror "],
            &novel()
        ),
        Some(true)
    );
}

#[test]
fn view_filters_matches_skips_a_clause_with_no_usable_value() {
    assert_eq!(
        verdict(FilterField::Tag, FilterMode::Include, &["  "], &novel()),
        Some(true)
    );
}

#[test]
fn view_filters_matches_everything_when_there_are_no_clauses() {
    assert_eq!(ViewFilters::default().matches(&bare()), Some(true));
}

#[test]
fn view_filters_matches_intersects_clauses_across_fields() {
    let tagged_and_by_shelley = filters_with(vec![
        FilterClause::new(FilterField::Tag, FilterMode::Include, &["horror"]),
        FilterClause::new(FilterField::Author, FilterMode::Include, &["Mary Shelley"]),
    ]);
    assert_eq!(tagged_and_by_shelley.matches(&novel()), Some(true));

    let tagged_but_not_epub = filters_with(vec![
        FilterClause::new(FilterField::Tag, FilterMode::Include, &["horror"]),
        FilterClause::new(FilterField::Format, FilterMode::Exclude, &["epub"]),
    ]);
    assert_eq!(tagged_but_not_epub.matches(&novel()), Some(false));
}

#[test]
fn view_filters_matches_rules_a_book_out_when_a_decidable_clause_fails_beside_a_shelf_clause() {
    let tag_then_shelf = filters_with(vec![
        FilterClause::new(FilterField::Tag, FilterMode::Include, &["romance"]),
        FilterClause::new(FilterField::Shelf, FilterMode::Include, &["7"]),
    ]);
    let shelf_then_tag = filters_with(vec![
        FilterClause::new(FilterField::Shelf, FilterMode::Include, &["7"]),
        FilterClause::new(FilterField::Tag, FilterMode::Include, &["romance"]),
    ]);

    assert_eq!(tag_then_shelf.matches(&novel()), Some(false));
    assert_eq!(shelf_then_tag.matches(&novel()), Some(false));
}

#[test]
fn view_filters_matches_is_undecided_when_every_decidable_clause_passes_beside_a_shelf_clause() {
    let filters = filters_with(vec![
        FilterClause::new(FilterField::Tag, FilterMode::Include, &["horror"]),
        FilterClause::new(FilterField::Shelf, FilterMode::Include, &["7"]),
    ]);

    assert_eq!(filters.matches(&novel()), None);
}
