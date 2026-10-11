//! Unit tests for the library filter clauses: their wire tokens, the
//! `ViewFilters` predicates, and the legacy-facet bridge into clauses.

use super::*;
use crate::{SortDir, SortKey, ViewMode, ViewPrefs};

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
fn view_filters_is_empty_false_when_any_facet_has_a_value() {
    // One case per facet: any single populated group flips the predicate.
    let with_author = ViewFilters {
        authors: vec!["Tolkien".into()],
        ..Default::default()
    };
    assert!(!with_author.is_empty());

    let with_series = ViewFilters {
        series: vec!["Poppy War".into()],
        ..Default::default()
    };
    assert!(!with_series.is_empty());

    let with_format = ViewFilters {
        formats: vec!["epub".into()],
        ..Default::default()
    };
    assert!(!with_format.is_empty());

    let with_tag = ViewFilters {
        tags: vec!["horror".into()],
        ..Default::default()
    };
    assert!(!with_tag.is_empty());
}

#[test]
fn view_filters_is_empty_false_when_only_clauses_is_non_empty() {
    let filters = ViewFilters {
        clauses: vec![FilterClause::new(
            FilterField::Tag,
            FilterMode::Exclude,
            &["horror"],
        )],
        ..Default::default()
    };
    assert!(!filters.is_empty());
}

#[test]
fn effective_clauses_is_empty_for_default_filters() {
    assert_eq!(ViewFilters::default().effective_clauses(), vec![]);
}

#[test]
fn effective_clauses_lists_legacy_facets_as_include_clauses_before_the_clauses() {
    let filters = ViewFilters {
        clauses: vec![FilterClause::new(
            FilterField::Tag,
            FilterMode::Exclude,
            &["horror"],
        )],
        genres: vec!["Fantasy".into()],
        tags: vec!["sci-fi".into(), "space".into()],
        formats: vec!["epub".into()],
        series: vec!["Poppy War".into()],
        authors: vec!["Tolkien".into()],
    };
    assert_eq!(
        filters.effective_clauses(),
        vec![
            FilterClause::new(FilterField::Author, FilterMode::Include, &["Tolkien"]),
            FilterClause::new(FilterField::Series, FilterMode::Include, &["Poppy War"]),
            FilterClause::new(FilterField::Format, FilterMode::Include, &["epub"]),
            FilterClause::new(FilterField::Tag, FilterMode::Include, &["sci-fi", "space"]),
            FilterClause::new(FilterField::Genre, FilterMode::Include, &["Fantasy"]),
            FilterClause::new(FilterField::Tag, FilterMode::Exclude, &["horror"]),
        ]
    );
}

#[test]
fn effective_clauses_skips_legacy_facets_with_no_values() {
    let filters = ViewFilters {
        series: vec!["Poppy War".into()],
        ..Default::default()
    };
    assert_eq!(
        filters.effective_clauses(),
        vec![FilterClause::new(
            FilterField::Series,
            FilterMode::Include,
            &["Poppy War"]
        )]
    );
}

#[test]
fn view_prefs_deserializes_a_record_written_before_clauses_existed() {
    let legacy = r#"{
        "view_mode": "table",
        "sort_key": "newest_added",
        "sort_dir": "desc",
        "filters": {
            "authors": ["Tolkien"],
            "series": [],
            "formats": ["epub"],
            "tags": ["horror"],
            "genres": ["Fantasy"]
        },
        "filters_open": true
    }"#;

    let prefs: ViewPrefs = serde_json::from_str(legacy).expect("legacy record parses");

    assert_eq!(prefs.view_mode, ViewMode::Table);
    assert_eq!(prefs.sort_key, SortKey::NewestAdded);
    assert_eq!(prefs.sort_dir, SortDir::Desc);
    assert!(prefs.filters_open);
    assert_eq!(
        prefs.filters,
        ViewFilters {
            clauses: vec![],
            authors: vec!["Tolkien".into()],
            series: vec![],
            formats: vec!["epub".into()],
            tags: vec!["horror".into()],
            genres: vec!["Fantasy".into()],
        }
    );
}

fn clause_with_values(count: usize) -> FilterClause {
    FilterClause {
        field: FilterField::Tag,
        mode: FilterMode::Include,
        values: (0..count).map(|i| format!("tag-{i}")).collect(),
    }
}

fn filters_with(clauses: Vec<FilterClause>) -> ViewFilters {
    ViewFilters {
        clauses,
        ..Default::default()
    }
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
fn view_filters_validate_counts_legacy_facets_toward_the_clause_cap() {
    let mut filters = filters_with(vec![clause_with_values(1); MAX_FILTER_CLAUSES]);
    filters.formats = vec!["epub".into()];

    assert_eq!(error_of(&filters), "a filter may have at most 16 clauses");
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
fn view_filters_to_query_param_carries_legacy_facets_as_include_clauses() {
    let filters = ViewFilters {
        formats: vec!["epub".into()],
        ..Default::default()
    };

    assert_eq!(
        filters.to_query_param().as_deref(),
        Some(r#"[{"field":"format","mode":"include","values":["epub"]}]"#)
    );
}

#[test]
fn view_filters_from_query_param_round_trips_to_the_clause_only_form() {
    let filters = ViewFilters {
        clauses: vec![FilterClause::new(
            FilterField::Tag,
            FilterMode::Exclude,
            &["a,b", "c"],
        )],
        authors: vec!["Tolkien".into()],
        ..Default::default()
    };
    let wire = filters.to_query_param().expect("non-empty filters encode");

    let parsed = ViewFilters::from_query_param(&wire).expect("round trip parses");

    assert_eq!(
        parsed,
        filters_with(vec![
            FilterClause::new(FilterField::Author, FilterMode::Include, &["Tolkien"]),
            FilterClause::new(FilterField::Tag, FilterMode::Exclude, &["a,b", "c"]),
        ])
    );
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
