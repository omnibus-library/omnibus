//! A facet's menu: include or exclude, then a searchable multi-select of the
//! facet's values drawn from the existing reads.

use std::rc::Rc;

use dioxus::prelude::*;
use omnibus_shared::{FilterClause, FilterField, FilterMode, MAX_FILTER_VALUES};

use crate::components::loading::{Loading, LoadingKind};
use crate::focus_after_paint::focus_after_paint;
use crate::focus_trap::trap_tab;

use super::values::{self, FilterOption, Matches, OptionList};
use super::{field_label, field_plural, ShelfList};

/// Most value rows drawn at once; a longer match list is narrowed by search.
pub const MAX_SHOWN_OPTIONS: usize = 200;

/// Where a field's values stand.
#[derive(Clone, Debug, PartialEq)]
pub enum LoadState {
    Loading,
    Ready(Rc<OptionList>),
    Failed(String),
}

/// The field a fetch answered for, and what it answered with.
pub type Loaded = Option<(FilterField, Result<Rc<OptionList>, String>)>;

/// The menu, opened on `initial`'s field, mode and values. Emits the finished
/// clause through `on_apply`.
#[component]
pub fn FilterPicker(
    shelves: ShelfList,
    viewer_id: Option<i64>,
    initial: FilterClause,
    on_apply: EventHandler<FilterClause>,
    on_close: EventHandler<()>,
) -> Element {
    let current = initial.field;
    let mut mode = use_signal(|| initial.mode);
    let mut query = use_signal(String::new);
    let mut picked = use_signal(|| initial.values.clone());
    let mut retry = use_signal(|| 0u32);
    let skip_fetch = !needs_fetch(current, &shelves);
    let mut loaded = use_loaded_options(current, retry, viewer_id, skip_fetch);
    let state = match state_for(current, loaded(), &shelves, viewer_id) {
        LoadState::Ready(list) => LoadState::Ready(list_with_picks(current, list, &picked.read())),
        other => other,
    };
    let by = field_label(current).to_lowercase();

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
            "aria-label": "Filter by {by}",
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
            PickerBody {
                field: current,
                mode: mode(),
                query: query(),
                picked: picked(),
                state,
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
                can_clear: !initial.values.is_empty(),
            }
        }
    }
}

/// Fetch `field`'s values, and again on each retry; a superseded fetch drops
/// its answer. `skip_fetch` leaves the shelf field to the bar's own list.
fn use_loaded_options(
    field: FilterField,
    retry: Signal<u32>,
    viewer_id: Option<i64>,
    skip_fetch: bool,
) -> Signal<Loaded> {
    let server_url = crate::use_server_url();
    let mut loaded: Signal<Loaded> = use_signal(|| None);
    let epoch = use_signal(|| 0u32);
    use_effect(move || {
        let _ = retry();
        if skip_fetch {
            return;
        }
        fetch_options(server_url.clone(), field, viewer_id, epoch, move |result| {
            loaded.set(Some((field, result)));
        });
    });
    loaded
}

/// Start fetching `field`'s values and hand the answer to `commit`, unless a
/// later fetch on the same `epoch` has started since.
pub fn fetch_options(
    server_url: String,
    field: FilterField,
    viewer_id: Option<i64>,
    mut epoch: Signal<u32>,
    commit: impl FnOnce(Result<Rc<OptionList>, String>) + 'static,
) {
    let mine = {
        epoch.with_mut(|e| *e += 1);
        *epoch.peek()
    };
    spawn(async move {
        let result = values::load_options(&server_url, field, viewer_id)
            .await
            .map(Rc::new)
            .map_err(|e| e.to_string());
        commit_if_current(epoch, mine, result, commit);
    });
}

/// Run `commit` on `answer` only while fetch `mine` is still the latest on
/// `epoch`; reports whether it ran.
pub fn commit_if_current<T>(
    epoch: Signal<u32>,
    mine: u32,
    answer: T,
    commit: impl FnOnce(T),
) -> bool {
    if *epoch.peek() != mine {
        return false;
    }
    commit(answer);
    true
}

/// Whether opening `field` must fetch its values: the shelf field reads the
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

/// How a pick the source no longer offers is named while it waits to be unticked.
pub(super) fn stranded_label(field: FilterField, value: &str) -> String {
    match field {
        FilterField::Shelf => "unavailable shelf".to_string(),
        FilterField::Format => value.to_ascii_uppercase(),
        _ => value.to_string(),
    }
}

/// `list` with any of `picked` it no longer offers added in, so the reader can
/// still see and untick them.
pub fn list_with_picks(
    field: FilterField,
    list: Rc<OptionList>,
    picked: &[String],
) -> Rc<OptionList> {
    match list.with_stranded(picked, |value| stranded_label(field, value)) {
        Some(extended) => Rc::new(extended),
        None => list,
    }
}

/// Flip `value` in the pick list, ignoring ASCII case as the server does; a
/// new pick past the value cap is refused.
pub fn toggle_pick(picked: &mut Vec<String>, value: &str) {
    if let Some(at) = picked.iter().position(|p| p.eq_ignore_ascii_case(value)) {
        picked.remove(at);
    } else if picked.len() < MAX_FILTER_VALUES {
        picked.push(value.to_string());
    }
}

/// A field's mode, search and values, then Cancel / Apply. With `footer` off the
/// Cancel / Apply row is left out, for a caller that applies each tick as it
/// happens (the mobile sheet) and so has nothing to confirm. With `can_clear`
/// Apply stays live with nothing picked, so unticking every value clears.
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
    #[props(default)] on_apply: EventHandler<()>,
    #[props(default)] on_cancel: EventHandler<()>,
    #[props(default = true)] footer: bool,
    #[props(default)] can_clear: bool,
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
            if footer {
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
                        disabled: picked.is_empty() && !can_clear,
                        onclick: move |_| on_apply.call(()),
                        "{apply_label}"
                    }
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
                {option_row(option, is_picked(picked, &option.value), at_cap, on_toggle)}
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

/// Whether `value` is among `picked`, compared ignoring ASCII case as the
/// engine does, so a stored pick still marks its differently-cased row.
fn is_picked(picked: &[String], value: &str) -> bool {
    picked.iter().any(|p| p.eq_ignore_ascii_case(value))
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
