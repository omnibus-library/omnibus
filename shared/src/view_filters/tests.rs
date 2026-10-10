//! Unit tests for the library filter clauses: their wire tokens, the
//! `ViewFilters` predicates, and the legacy-facet bridge into clauses.

use super::*;
use crate::{SortDir, SortKey, ViewMode, ViewPrefs};

const ALL_FIELDS: [FilterField; 5] = [
    FilterField::Tag,
    FilterField::Genre,
    FilterField::Author,
    FilterField::Series,
    FilterField::Format,
];

const ALL_MODES: [FilterMode; 2] = [FilterMode::Include, FilterMode::Exclude];

fn clause(field: FilterField, mode: FilterMode, values: &[&str]) -> FilterClause {
    FilterClause {
        field,
        mode,
        values: values.iter().map(|v| v.to_string()).collect(),
    }
}

#[test]
fn filter_clause_serializes_to_the_snake_case_wire_tokens() {
    let wire = serde_json::to_string(&clause(
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
fn filter_clause_round_trips_every_field_and_mode() {
    for field in ALL_FIELDS {
        for mode in ALL_MODES {
            let original = clause(field, mode, &["a", "b"]);
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
        clauses: vec![clause(FilterField::Tag, FilterMode::Exclude, &["horror"])],
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
        clauses: vec![clause(FilterField::Tag, FilterMode::Exclude, &["horror"])],
        genres: vec!["Fantasy".into()],
        tags: vec!["sci-fi".into(), "space".into()],
        formats: vec!["epub".into()],
        series: vec!["Poppy War".into()],
        authors: vec!["Tolkien".into()],
    };
    assert_eq!(
        filters.effective_clauses(),
        vec![
            clause(FilterField::Author, FilterMode::Include, &["Tolkien"]),
            clause(FilterField::Series, FilterMode::Include, &["Poppy War"]),
            clause(FilterField::Format, FilterMode::Include, &["epub"]),
            clause(FilterField::Tag, FilterMode::Include, &["sci-fi", "space"]),
            clause(FilterField::Genre, FilterMode::Include, &["Fantasy"]),
            clause(FilterField::Tag, FilterMode::Exclude, &["horror"]),
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
        vec![clause(
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
