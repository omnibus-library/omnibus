//! The library filter chip bar: one chip per clause, an add-filter picker and
//! a single Clear all. Stateless about the filter itself: every edit emits the
//! whole next [`ViewFilters`] through `on_change`.

use dioxus::prelude::*;
use omnibus_shared::{
    FilterClause, FilterField, FilterMode, ShelfSummary, ViewFilters, MAX_FILTER_CLAUSES,
};

mod picker;
pub mod values;

#[cfg(all(test, feature = "server"))]
mod tests;

/// The fields a clause can match, in picker order.
pub const FILTER_FIELDS: [FilterField; 6] = [
    FilterField::Shelf,
    FilterField::Tag,
    FilterField::Genre,
    FilterField::Author,
    FilterField::Series,
    FilterField::Format,
];

/// The field's display name.
pub fn field_label(field: FilterField) -> &'static str {
    match field {
        FilterField::Shelf => "Shelf",
        FilterField::Tag => "Tag",
        FilterField::Genre => "Genre",
        FilterField::Author => "Author",
        FilterField::Series => "Series",
        FilterField::Format => "Format",
    }
}

/// The field's name for several values, lowercase: "shelves", "series".
pub fn field_plural(field: FilterField) -> &'static str {
    match field {
        FilterField::Shelf => "shelves",
        FilterField::Tag => "tags",
        FilterField::Genre => "genres",
        FilterField::Author => "authors",
        FilterField::Series => "series",
        FilterField::Format => "formats",
    }
}

/// The field's serde token, used in test ids.
pub fn field_token(field: FilterField) -> &'static str {
    match field {
        FilterField::Shelf => "shelf",
        FilterField::Tag => "tag",
        FilterField::Genre => "genre",
        FilterField::Author => "author",
        FilterField::Series => "series",
        FilterField::Format => "format",
    }
}

/// The mode as it reads in a chip: "includes any of" or "excludes any of".
pub fn mode_phrase(mode: FilterMode) -> &'static str {
    match mode {
        FilterMode::Include => "includes any of",
        FilterMode::Exclude => "excludes any of",
    }
}

/// The chip text for `clause`. `shelves` is `None` until the shelves list has
/// loaded, so a shelf id is never shown as a name it does not have.
pub fn chip_label(clause: &FilterClause, shelves: Option<&[ShelfSummary]>) -> String {
    let values: Vec<String> = clause
        .values
        .iter()
        .map(|value| value_label(clause.field, value, shelves))
        .collect();
    format!(
        "{} {} {}",
        field_label(clause.field),
        mode_phrase(clause.mode),
        values.join(", ")
    )
}

fn value_label(field: FilterField, value: &str, shelves: Option<&[ShelfSummary]>) -> String {
    match field {
        FilterField::Shelf => shelf_name(value, shelves),
        FilterField::Format => value.to_ascii_uppercase(),
        _ => value.to_string(),
    }
}

fn shelf_name(value: &str, shelves: Option<&[ShelfSummary]>) -> String {
    let Some(shelves) = shelves else {
        return "\u{2026}".to_string();
    };
    value
        .trim()
        .parse::<i64>()
        .ok()
        .and_then(|id| shelves.iter().find(|shelf| shelf.id == id))
        .map_or_else(
            || "unavailable shelf".to_string(),
            |shelf| shelf.name.clone(),
        )
}

/// `filters` with `clause` appended.
pub fn with_clause(filters: &ViewFilters, clause: FilterClause) -> ViewFilters {
    let mut clauses = filters.clauses.clone();
    clauses.push(clause);
    ViewFilters { clauses }
}

/// `filters` without the clause at `index`; unchanged when out of range.
pub fn without_clause(filters: &ViewFilters, index: usize) -> ViewFilters {
    let mut clauses = filters.clauses.clone();
    if index < clauses.len() {
        clauses.remove(index);
    }
    ViewFilters { clauses }
}

/// The chip row for the library toolbar.
#[component]
pub fn FilterBar(
    filters: ViewFilters,
    shelves: Option<Vec<ShelfSummary>>,
    on_change: EventHandler<ViewFilters>,
) -> Element {
    let mut open = use_signal(|| false);
    let at_cap = filters.clauses.len() >= MAX_FILTER_CLAUSES;
    let chips: Vec<(usize, String, ViewFilters)> = filters
        .clauses
        .iter()
        .enumerate()
        .map(|(i, clause)| {
            (
                i,
                chip_label(clause, shelves.as_deref()),
                without_clause(&filters, i),
            )
        })
        .collect();
    let with_applied = filters.clone();

    rsx! {
        div {
            class: "fb",
            role: "group",
            "aria-label": "Library filters",
            "data-testid": "lib-filter-bar",
            for (i , label , without) in chips {
                span { key: "{i}", class: "fb-chip", "data-testid": "filter-chip-{i}",
                    span { class: "fb-chip-text", "{label}" }
                    button {
                        r#type: "button",
                        class: "fb-chip-x",
                        "aria-label": "Remove filter: {label}",
                        "data-testid": "filter-chip-remove-{i}",
                        onclick: move |_| on_change.call(without.clone()),
                        "\u{d7}"
                    }
                }
            }
            div { class: "fb-add-wrap",
                button {
                    r#type: "button",
                    class: "fb-add",
                    "aria-haspopup": "dialog",
                    "aria-expanded": "{open()}",
                    "data-testid": "filter-add",
                    disabled: at_cap,
                    title: at_cap.then(|| format!("At most {MAX_FILTER_CLAUSES} filters")),
                    onclick: move |_| open.set(!open()),
                    "+ Add filter"
                }
                if open() {
                    picker::FilterPicker {
                        on_apply: move |clause| {
                            on_change.call(with_clause(&with_applied, clause));
                            open.set(false);
                        },
                        on_close: move |_| open.set(false),
                    }
                }
            }
            if !filters.is_empty() {
                button {
                    r#type: "button",
                    class: "fb-clear",
                    "data-testid": "filter-clear-all",
                    onclick: move |_| on_change.call(ViewFilters::default()),
                    "Clear all"
                }
            }
        }
    }
}
