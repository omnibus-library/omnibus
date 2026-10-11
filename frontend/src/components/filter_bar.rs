//! The library filter chip bar: one chip per clause, an add-filter picker and
//! a single Clear all. Stateless about the filter itself: every edit emits the
//! whole next [`ViewFilters`] through `on_change`.

use std::rc::Rc;

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

/// What the filter bar knows of the viewer's shelves: a shelf chip names its
/// shelf from the list, so it must say when it cannot.
#[derive(Clone, Debug, PartialEq)]
pub enum ShelfList {
    /// The shelves fetch has not answered yet.
    Pending,
    /// The shelves fetch answered with an error, so no id can be named.
    Failed,
    /// The viewer's shelves.
    Loaded(Vec<ShelfSummary>),
}

impl ShelfList {
    /// The list for a landing page whose shelves fetch has `loaded` a list or,
    /// failing that, `answered` with an error.
    pub fn from_fetch(loaded: bool, answered: bool, shelves: Vec<ShelfSummary>) -> Self {
        if loaded {
            Self::Loaded(shelves)
        } else if answered {
            Self::Failed
        } else {
            Self::Pending
        }
    }
}

/// One run of a chip's text: plain text, or a name still being worked out.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChipPart {
    Text(String),
    Pending,
}

/// The chip's text split so each pending name can be drawn as a sheen.
pub fn chip_parts(
    clause: &FilterClause,
    shelves: &ShelfList,
    viewer_id: Option<i64>,
) -> Vec<ChipPart> {
    let mut parts = Vec::new();
    let mut text = format!(
        "{} {} ",
        field_label(clause.field),
        mode_phrase(clause.mode)
    );
    for (i, value) in clause.values.iter().enumerate() {
        if i > 0 {
            text.push_str(", ");
        }
        match value_label(clause.field, value, shelves, viewer_id) {
            Some(name) => text.push_str(&name),
            None => {
                parts.push(ChipPart::Text(std::mem::take(&mut text)));
                parts.push(ChipPart::Pending);
            }
        }
    }
    if !text.is_empty() {
        parts.push(ChipPart::Text(text));
    }
    parts
}

/// The chip text for `clause` as plain text; a pending name reads as an ellipsis.
pub fn chip_label(clause: &FilterClause, shelves: &ShelfList, viewer_id: Option<i64>) -> String {
    chip_parts(clause, shelves, viewer_id)
        .into_iter()
        .map(|part| match part {
            ChipPart::Text(text) => text,
            ChipPart::Pending => "\u{2026}".to_string(),
        })
        .collect()
}

/// A value's name, or `None` while it is still being worked out.
fn value_label(
    field: FilterField,
    value: &str,
    shelves: &ShelfList,
    viewer_id: Option<i64>,
) -> Option<String> {
    match field {
        FilterField::Shelf => shelf_name(value, shelves, viewer_id),
        FilterField::Format => Some(value.to_ascii_uppercase()),
        _ => Some(value.to_string()),
    }
}

fn shelf_name(value: &str, shelves: &ShelfList, viewer_id: Option<i64>) -> Option<String> {
    let unavailable = || Some("unavailable shelf".to_string());
    match shelves {
        ShelfList::Pending => None,
        ShelfList::Failed => unavailable(),
        ShelfList::Loaded(list) => value
            .trim()
            .parse::<i64>()
            .ok()
            .and_then(|id| list.iter().find(|shelf| shelf.id == id))
            .map_or_else(unavailable, |shelf| {
                Some(values::shelf_label(shelf, viewer_id))
            }),
    }
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

/// A pending name draws as a sheen, per the loading vocabulary; text as itself.
fn chip_part(part: ChipPart) -> Element {
    match part {
        ChipPart::Text(text) => rsx! { "{text}" },
        ChipPart::Pending => rsx! {
            span { class: "ld-sheen", "\u{2026}" }
        },
    }
}

/// The chip row for the library toolbar.
#[component]
pub fn FilterBar(
    filters: ViewFilters,
    shelves: ShelfList,
    viewer_id: Option<i64>,
    on_change: EventHandler<ViewFilters>,
) -> Element {
    let mut open = use_signal(|| false);
    let mut add_button = use_signal(|| None::<Rc<MountedData>>);
    // The popover unmounts with focus inside it; hand focus back to the button
    // that opened it, whichever way it closed.
    let mut close = move || {
        if let Some(button) = add_button.peek().clone() {
            spawn(async move {
                let _ = button.set_focus(true).await;
            });
        }
        open.set(false);
    };
    let at_cap = filters.clauses.len() >= MAX_FILTER_CLAUSES;
    let chips: Vec<(usize, Vec<ChipPart>, String, ViewFilters)> = filters
        .clauses
        .iter()
        .enumerate()
        .map(|(i, clause)| {
            let parts = chip_parts(clause, &shelves, viewer_id);
            (
                i,
                parts,
                chip_label(clause, &shelves, viewer_id),
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
            for (i , parts , label , without) in chips {
                span { key: "{i}", class: "fb-chip", "data-testid": "filter-chip-{i}",
                    span { class: "fb-chip-text",
                        for part in parts {
                            {chip_part(part)}
                        }
                    }
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
                    onmounted: move |evt: MountedEvent| add_button.set(Some(evt.data())),
                    disabled: at_cap,
                    title: at_cap.then(|| format!("At most {MAX_FILTER_CLAUSES} filters")),
                    onclick: move |_| open.set(!open()),
                    "+ Add filter"
                }
                if open() {
                    picker::FilterPicker {
                        shelves,
                        viewer_id,
                        on_apply: move |clause| {
                            on_change.call(with_clause(&with_applied, clause));
                            close();
                        },
                        on_close: move |_| close(),
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
