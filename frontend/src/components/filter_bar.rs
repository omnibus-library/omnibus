//! The library filter bar: one facet per field, each opening a menu on its
//! own values, and a single Clear all. Stateless about the filter itself:
//! every edit emits the whole next [`ViewFilters`] through `on_change`.

use std::rc::Rc;

use dioxus::prelude::*;
use omnibus_shared::{FilterClause, FilterField, FilterMode, ShelfSummary, ViewFilters};

use crate::components::glyphs::chevron_down_glyph;
use crate::components::shelf_glyphs::x_icon;

mod picker;
pub mod values;

pub use picker::{
    fetch_options, list_with_picks, needs_fetch, state_for, LoadState, Loaded, PickerBody,
};

#[cfg(all(test, feature = "server"))]
mod tests;

/// The fields a clause can match, in the bar's order.
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

/// What the filter bar knows of the viewer's shelves: a shelf facet names its
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

/// One run of a facet's value: plain text, or a shelf name still being worked out.
#[derive(Clone, Debug, PartialEq, Eq)]
enum ValuePart {
    Text(String),
    Pending,
}

/// What an active facet shows after its field name: "not" ahead of an
/// exclusion, the first value, and "+N" for the rest.
fn facet_value(
    clause: &FilterClause,
    shelves: &ShelfList,
    viewer_id: Option<i64>,
) -> Vec<ValuePart> {
    let mut parts = Vec::new();
    if clause.mode == FilterMode::Exclude {
        parts.push(ValuePart::Text("not ".to_string()));
    }
    if let Some(first) = clause.values.first() {
        parts.push(
            value_label(clause.field, first, shelves, viewer_id)
                .map_or(ValuePart::Pending, ValuePart::Text),
        );
    }
    if clause.values.len() > 1 {
        parts.push(ValuePart::Text(format!(" +{}", clause.values.len() - 1)));
    }
    parts
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

/// A pending name draws as a sheen, per the loading vocabulary; text as itself.
fn value_part(part: ValuePart) -> Element {
    match part {
        ValuePart::Text(text) => rsx! { "{text}" },
        ValuePart::Pending => rsx! {
            span { class: "ld-sheen", "\u{2026}" }
        },
    }
}

/// One field's facet: the button naming the field and, while active, what it
/// keeps; its clear button; and its menu while open. A saved view with two
/// clauses on the field shows the first, and an edit replaces both.
#[component]
fn Facet(
    field: FilterField,
    filters: ViewFilters,
    shelves: ShelfList,
    viewer_id: Option<i64>,
    on_change: EventHandler<ViewFilters>,
) -> Element {
    let mut open = use_signal(|| false);
    let mut button = use_signal(|| None::<Rc<MountedData>>);
    // The menu and the clear button unmount with focus inside them; hand it
    // back to the facet, whichever way they went.
    let refocus = move || {
        if let Some(button) = button.peek().clone() {
            spawn(async move {
                let _ = button.set_focus(true).await;
            });
        }
    };
    let clause = filters.clauses.iter().find(|c| c.field == field).cloned();
    let value = clause.as_ref().map(|c| facet_value(c, &shelves, viewer_id));
    let active = value.is_some();
    let label = field_label(field);
    let token = field_token(field);
    let initial = clause.unwrap_or_else(|| FilterClause::new(field, FilterMode::Include, &[]));
    let applied = filters.clone();
    rsx! {
        div { class: if active { "fb-facet-wrap on" } else { "fb-facet-wrap" },
            button {
                r#type: "button",
                class: "fb-facet",
                "aria-haspopup": "dialog",
                "aria-expanded": "{open()}",
                "data-testid": "filter-facet-{token}",
                onmounted: move |evt: MountedEvent| button.set(Some(evt.data())),
                onclick: move |_| {
                    if !open() {
                        reveal_below(field);
                    }
                    open.set(!open());
                },
                span { "{label}" }
                if let Some(parts) = value {
                    span { class: "fb-facet-v",
                        for part in parts {
                            {value_part(part)}
                        }
                    }
                }
                {chevron_down_glyph(12)}
            }
            if active {
                button {
                    r#type: "button",
                    class: "fb-facet-x",
                    "aria-label": "Clear the {label} filter",
                    "data-testid": "filter-facet-clear-{token}",
                    onclick: move |_| {
                        on_change.call(without_field(&filters, field));
                        refocus();
                    },
                    {x_icon()}
                }
            }
            if open() {
                picker::FilterPicker {
                    shelves,
                    viewer_id,
                    initial,
                    on_apply: move |clause| {
                        on_change.call(with_field_clause(&applied, clause));
                        open.set(false);
                        refocus();
                    },
                    on_close: move |_| {
                        open.set(false);
                        refocus();
                    },
                }
            }
        }
    }
}

/// `filters` with every clause on `field` swapped for `clause`; a clause
/// without values just clears the field.
pub fn with_field_clause(filters: &ViewFilters, clause: FilterClause) -> ViewFilters {
    let mut next = without_field(filters, clause.field);
    if clause.usable_values().next().is_some() {
        next.clauses.push(clause);
    }
    next
}

/// `filters` without any clause on `field`.
pub fn without_field(filters: &ViewFilters, field: FilterField) -> ViewFilters {
    ViewFilters {
        clauses: filters
            .clauses
            .iter()
            .filter(|c| c.field != field)
            .cloned()
            .collect(),
    }
}

/// Menus open below their facet. When the window has too little room under
/// the facet for a menu, scroll the facet up under the top bar first; phones
/// use a bottom sheet and need no room.
fn reveal_below(field: FilterField) {
    let _ = dioxus::document::eval(&format!(
        r#"const el = document.querySelector('[data-testid="filter-facet-{}"]');
if (el && !matchMedia('(max-width: 720px)').matches) {{
  const room = innerHeight - el.getBoundingClientRect().bottom;
  if (room < Math.min(480, innerHeight * 0.6)) el.scrollIntoView({{ block: 'start', behavior: 'instant' }});
}}"#,
        field_token(field)
    ));
}

/// The library's filters as one facet per field: each opens its own value
/// menu, and an active one names what it keeps.
#[component]
pub fn FilterBar(
    filters: ViewFilters,
    shelves: ShelfList,
    viewer_id: Option<i64>,
    on_change: EventHandler<ViewFilters>,
) -> Element {
    rsx! {
        div {
            class: "fb",
            role: "group",
            "aria-label": "Library filters",
            "data-testid": "lib-filter-bar",
            for field in FILTER_FIELDS {
                Facet {
                    key: "{field_token(field)}",
                    field,
                    filters: filters.clone(),
                    shelves: shelves.clone(),
                    viewer_id,
                    on_change,
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
