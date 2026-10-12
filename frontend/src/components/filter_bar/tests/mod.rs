//! Coverage for the filter bar: option mappers, chip text, clause edits, and
//! the markup the bar and its picker render.

use std::rc::Rc;

use omnibus_shared::{
    AuthorSummary, FilterClause, FilterField, FilterMode, GenreWeight, SeriesSummary, ShelfKind,
    ShelfSummary, TagWeight, ViewFilters, Visibility, MAX_FILTER_CLAUSES, MAX_FILTER_VALUES,
};

use crate::test_support::render;

use super::values::*;
use super::*;

fn option(value: &str, label: &str, count: Option<usize>) -> FilterOption {
    FilterOption {
        value: value.to_string(),
        label: label.to_string(),
        count,
    }
}

fn list(options: Vec<FilterOption>) -> Rc<OptionList> {
    Rc::new(OptionList::new(options))
}

fn tag(name: &str, count: usize) -> TagWeight {
    TagWeight {
        name: name.to_string(),
        count,
    }
}

fn author(name: &str, book_count: usize) -> AuthorSummary {
    AuthorSummary {
        id: 1,
        name: name.to_string(),
        book_count,
        ..Default::default()
    }
}

fn shelf(id: i64, name: &str, kind: ShelfKind, book_count: i64) -> ShelfSummary {
    ShelfSummary {
        id,
        owner_user_id: 1,
        owner_username: "reader".to_string(),
        owner_has_avatar: false,
        kind,
        name: name.to_string(),
        visibility: Visibility::Private,
        accent: None,
        book_count,
        cover_uuids: Vec::new(),
    }
}

/// The opening `<tag …>` whose attributes include `needle`.
fn opening_tag<'a>(html: &'a str, tag: &str, needle: &str) -> &'a str {
    let at = html
        .find(needle)
        .unwrap_or_else(|| panic!("no {needle} in {html}"));
    let start = html[..at]
        .rfind(&format!("<{tag}"))
        .unwrap_or_else(|| panic!("no <{tag} before {needle} in {html}"));
    let end = at + html[at..].find('>').expect("the tag closes");
    &html[start..=end]
}

fn button_tag<'a>(html: &'a str, testid: &str) -> &'a str {
    opening_tag(html, "button", &format!("data-testid=\"{testid}\""))
}

fn checkbox_tag<'a>(html: &'a str, label: &str) -> &'a str {
    opening_tag(html, "input", &format!("aria-label=\"{label}\""))
}

fn disabled_inputs(html: &str) -> usize {
    html.split("<input")
        .skip(1)
        .filter(|tag| tag.split('>').next().unwrap().contains("disabled"))
        .count()
}

fn clause(field: FilterField, mode: FilterMode, values: &[&str]) -> FilterClause {
    FilterClause::new(field, mode, values)
}

mod chips;
mod mappers;
mod popover;
