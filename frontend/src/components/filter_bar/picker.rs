//! The add-filter popover: field, then mode, then a searchable multi-select of
//! values drawn from the existing reads.

use std::rc::Rc;

use dioxus::prelude::*;
use omnibus_shared::{FilterClause, FilterField, FilterMode, MAX_FILTER_VALUES};

use crate::components::loading::{Loading, LoadingKind};
use crate::focus_after_paint::focus_after_paint;
use crate::focus_trap::trap_tab;

use super::values::{self, FilterOption, Matches, OptionList};
use super::{field_label, field_plural, field_token, ShelfList, FILTER_FIELDS};

/// Most value rows drawn at once; a longer match list is narrowed by search.
pub const MAX_SHOWN_OPTIONS: usize = 200;

/// Where the chosen field's values stand.
#[derive(Clone, Debug, PartialEq)]
pub enum LoadState {
    Loading,
    Ready(Rc<OptionList>),
    Failed(String),
}

/// The field a fetch answered for, and what it answered with.
pub type Loaded = Option<(FilterField, Result<Rc<OptionList>, String>)>;

/// The popover. Emits the finished clause through `on_apply`.
#[component]
pub fn FilterPicker(
    shelves: ShelfList,
    viewer_id: Option<i64>,
    on_apply: EventHandler<FilterClause>,
    on_close: EventHandler<()>,
) -> Element {
    let mut field = use_signal(|| None::<FilterField>);
    let mut mode = use_signal(|| FilterMode::Include);
    let mut query = use_signal(String::new);
    let mut picked = use_signal(Vec::<String>::new);
    let mut retry = use_signal(|| 0u32);
    let skip_shelf_fetch = !needs_fetch(FilterField::Shelf, &shelves);
    let mut loaded = use_loaded_options(field, retry, viewer_id, skip_shelf_fetch);

    let mut choose = move |next: FilterField| {
        if *field.peek() == Some(next) {
            return;
        }
        picked.write().clear();
        query.set(String::new());
        field.set(Some(next));
    };

    rsx! {
        div {
            class: "fb-scrim",
            "data-testid": "filter-picker-scrim",
            onclick: move |_| on_close.call(()),
        }
        div {
            class: "fb-pop",
            role: "dialog",
            "aria-modal": "true",
            "aria-label": "Add filter",
            "data-testid": "filter-picker",
            tabindex: "-1",
            onkeydown: move |evt: Event<KeyboardData>| {
                if evt.key() == Key::Escape {
                    evt.prevent_default();
                    on_close.call(());
                }
                trap_tab(&evt);
            },
            onmounted: move |evt: MountedEvent| focus_after_paint(&evt),
            div { class: "fb-fields", role: "group", "aria-label": "Filter by",
                for option in FILTER_FIELDS {
                    button {
                        key: "{field_token(option)}",
                        r#type: "button",
                        class: "fb-field",
                        "aria-pressed": "{field() == Some(option)}",
                        "data-testid": "filter-field-{field_token(option)}",
                        onclick: move |_| choose(option),
                        "{field_label(option)}"
                    }
                }
            }
            if let Some(current) = field() {
                PickerBody {
                    field: current,
                    mode: mode(),
                    query: query(),
                    picked: picked(),
                    state: state_for(current, loaded(), &shelves, viewer_id),
                    on_mode: move |next| mode.set(next),
                    on_query: move |next| query.set(next),
                    on_toggle: move |value: String| picked.with_mut(|p| toggle_pick(p, &value)),
                    on_retry: move |_| {
                        loaded.set(None);
                        retry.with_mut(|n| *n += 1);
                    },
                    on_apply: move |_| {
                        on_apply
                            .call(FilterClause {
                                field: current,
                                mode: mode(),
                                values: picked(),
                            })
                    },
                    on_cancel: move |_| on_close.call(()),
                }
            }
        }
    }
}

/// Fetch the chosen field's values whenever the field changes or a retry is
/// asked for; a superseded fetch drops its answer.
fn use_loaded_options(
    field: Signal<Option<FilterField>>,
    retry: Signal<u32>,
    viewer_id: Option<i64>,
    skip_shelf_fetch: bool,
) -> Signal<Loaded> {
    let server_url = crate::use_server_url();
    let mut loaded: Signal<Loaded> = use_signal(|| None);
    let mut epoch = use_signal(|| 0u32);
    use_effect(move || {
        let wanted = field();
        let _ = retry();
        let Some(wanted) = wanted else { return };
        if wanted == FilterField::Shelf && skip_shelf_fetch {
            return;
        }
        let mine = {
            epoch.with_mut(|e| *e += 1);
            *epoch.peek()
        };
        let url = server_url.clone();
        spawn(async move {
            let result = values::load_options(&url, wanted, viewer_id)
                .await
                .map(Rc::new)
                .map_err(|e| e.to_string());
            if *epoch.peek() == mine {
                loaded.set(Some((wanted, result)));
            }
        });
    });
    loaded
}

/// Whether choosing `field` must fetch its values: the shelf field reads the
/// bar's own list once that has loaded, so it asks for nothing.
pub fn needs_fetch(field: FilterField, shelves: &ShelfList) -> bool {
    !(field == FilterField::Shelf && matches!(shelves, ShelfList::Loaded(_)))
}

/// The state to draw for `field`: an answer for another field is not one.
pub fn state_for(
    field: FilterField,
    loaded: Loaded,
    shelves: &ShelfList,
    viewer_id: Option<i64>,
) -> LoadState {
    if let (FilterField::Shelf, ShelfList::Loaded(list)) = (field, shelves) {
        let options = values::shelf_options(list, viewer_id);
        return LoadState::Ready(Rc::new(OptionList::new(options)));
    }
    match loaded {
        Some((answered, Ok(options))) if answered == field => LoadState::Ready(options),
        Some((answered, Err(message))) if answered == field => LoadState::Failed(message),
        _ => LoadState::Loading,
    }
}

/// Flip `value` in the pick list; a new pick past the value cap is refused.
pub fn toggle_pick(picked: &mut Vec<String>, value: &str) {
    if let Some(at) = picked.iter().position(|p| p == value) {
        picked.remove(at);
    } else if picked.len() < MAX_FILTER_VALUES {
        picked.push(value.to_string());
    }
}

/// Everything under the field row once a field is chosen.
#[component]
pub fn PickerBody(
    field: FilterField,
    mode: FilterMode,
    query: String,
    picked: Vec<String>,
    state: LoadState,
    on_mode: EventHandler<FilterMode>,
    on_query: EventHandler<String>,
    on_toggle: EventHandler<String>,
    on_retry: EventHandler<()>,
    on_apply: EventHandler<()>,
    on_cancel: EventHandler<()>,
) -> Element {
    let plural = field_plural(field);
    let apply_label = match picked.len() {
        0 => "Apply".to_string(),
        n => format!("Apply ({n})"),
    };
    // Rescanned when the list or the query changes, not when a box is toggled.
    let found = use_memo(use_reactive!(|state, query| match &state {
        LoadState::Ready(list) => list.matching(&query, MAX_SHOWN_OPTIONS),
        _ => Matches::default(),
    }));
    rsx! {
        div { class: "fb-body",
            div { class: "fb-modes", role: "group", "aria-label": "Match mode",
                {mode_button(FilterMode::Include, "include", "Includes any", mode, on_mode)}
                {mode_button(FilterMode::Exclude, "exclude", "Excludes any", mode, on_mode)}
            }
            input {
                class: "fb-search",
                r#type: "search",
                "data-testid": "filter-picker-search",
                "aria-label": "Search {plural}",
                placeholder: "Search {plural}\u{2026}",
                value: "{query}",
                oninput: move |evt: Event<FormData>| on_query.call(evt.value()),
            }
            div { class: "fb-list",
                {option_list(plural, &query, &picked, &state, &found.read(), on_toggle, on_retry)}
            }
            div { class: "fb-foot",
                button {
                    r#type: "button",
                    class: "btn ghost sm",
                    "data-testid": "filter-picker-cancel",
                    onclick: move |_| on_cancel.call(()),
                    "Cancel"
                }
                button {
                    r#type: "button",
                    class: "btn primary sm",
                    "data-testid": "filter-picker-apply",
                    disabled: picked.is_empty(),
                    onclick: move |_| on_apply.call(()),
                    "{apply_label}"
                }
            }
        }
    }
}

fn mode_button(
    this: FilterMode,
    token: &'static str,
    text: &'static str,
    current: FilterMode,
    on_mode: EventHandler<FilterMode>,
) -> Element {
    rsx! {
        button {
            r#type: "button",
            class: "fb-mode",
            "aria-pressed": "{current == this}",
            "data-testid": "filter-mode-{token}",
            onclick: move |_| on_mode.call(this),
            "{text}"
        }
    }
}

/// The loader, the failure, or the value rows — never an empty list in place
/// of an answer that has not arrived.
fn option_list(
    plural: &str,
    query: &str,
    picked: &[String],
    state: &LoadState,
    found: &Matches,
    on_toggle: EventHandler<String>,
    on_retry: EventHandler<()>,
) -> Element {
    match state {
        LoadState::Loading => rsx! {
            Loading {
                kind: LoadingKind::Sheet,
                testid: "filter-picker-loading",
                label: "Loading {plural}\u{2026}",
            }
        },
        LoadState::Failed(message) => rsx! {
            div { class: "fb-error", role: "alert", "data-testid": "filter-picker-error",
                p { "Couldn\u{2019}t load {plural}." }
                p { class: "fb-error-detail", "{message}" }
                button {
                    r#type: "button",
                    class: "btn sm",
                    "data-testid": "filter-picker-retry",
                    onclick: move |_| on_retry.call(()),
                    "Try again"
                }
            }
        },
        LoadState::Ready(list) => ready_rows(plural, query, picked, list, found, on_toggle),
    }
}

/// The line under the rows: how many matched when the row cap cut them, and
/// that a capped source holds only its most-used values — never a bare total
/// that reads as the whole vocabulary.
pub fn status_line(
    plural: &str,
    shown: usize,
    total: usize,
    source_cap: Option<usize>,
) -> Option<String> {
    match source_cap {
        Some(cap) => Some(format!(
            "Showing {shown} of the {cap} most-used {plural} \u{b7} search narrows within them"
        )),
        None if total > shown => Some(format!(
            "Showing {shown} of {total} \u{b7} search to narrow"
        )),
        None => None,
    }
}

/// What an unmatched search says; a capped source may still hold the value.
pub fn no_match_line(plural: &str, query: &str, source_cap: Option<usize>) -> String {
    let query = query.trim();
    match source_cap {
        Some(cap) => {
            format!("No {plural} match \u{201c}{query}\u{201d} among the {cap} most-used.")
        }
        None => format!("No {plural} match \u{201c}{query}\u{201d}."),
    }
}

fn ready_rows(
    plural: &str,
    query: &str,
    picked: &[String],
    list: &OptionList,
    found: &Matches,
    on_toggle: EventHandler<String>,
) -> Element {
    if list.is_empty() {
        return rsx! {
            p { class: "fb-empty", "data-testid": "filter-picker-empty", "No {plural} yet." }
        };
    }
    if found.total == 0 {
        let line = no_match_line(plural, query, list.cap());
        return rsx! {
            p { class: "fb-empty", "data-testid": "filter-picker-empty", "{line}" }
        };
    }
    let at_cap = picked.len() >= MAX_FILTER_VALUES;
    let status = status_line(plural, found.shown.len(), found.total, list.cap());
    rsx! {
        div { class: "fb-options", role: "group", "aria-label": "{plural}",
            for option in found.shown.iter() {
                {option_row(option, picked.contains(&option.value), at_cap, on_toggle)}
            }
        }
        if let Some(line) = status {
            p { class: "fb-status", "data-testid": "filter-picker-status", "{line}" }
        }
        if at_cap {
            p { class: "fb-status", "data-testid": "filter-picker-limit",
                "At most {MAX_FILTER_VALUES} values per filter"
            }
        }
    }
}

fn option_row(
    option: &FilterOption,
    is_picked: bool,
    at_cap: bool,
    on_toggle: EventHandler<String>,
) -> Element {
    let value = option.value.clone();
    rsx! {
        label { key: "{option.value}", class: "fb-opt",
            input {
                r#type: "checkbox",
                "aria-label": "{option.label}",
                checked: is_picked,
                disabled: !is_picked && at_cap,
                onchange: move |_| on_toggle.call(value.clone()),
            }
            span { class: "fb-opt-label", "{option.label}" }
            if let Some(count) = option.count {
                span { class: "fb-opt-count", "aria-hidden": "true", "{count}" }
            }
        }
    }
}
