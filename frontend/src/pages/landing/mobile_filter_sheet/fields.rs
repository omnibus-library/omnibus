//! One filter field's section in the mobile sheet: a header that opens it, then
//! the filter bar's own picker body — mode toggle, search, value rows — applied
//! tick by tick. Values load the first time the section opens, from the same
//! reads the web bar uses.

use std::rc::Rc;

use dioxus::prelude::*;
use omnibus_shared::{FilterField, FilterMode, ViewFilters, ViewPrefs};

use crate::components::filter_bar::values::OptionList;
use crate::components::filter_bar::{
    fetch_options, field_label, field_token, needs_fetch, state_for, LoadState, Loaded, PickerBody,
    ShelfList, FILTER_FIELDS,
};

use super::{picked_values, toggle_value};

/// One field's section as the sheet draws it: what is picked under each mode.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct SectionView {
    pub(super) field: FilterField,
    include: Vec<String>,
    exclude: Vec<String>,
}

impl SectionView {
    /// The values held under `mode`.
    pub(super) fn picked(&self, mode: FilterMode) -> &[String] {
        match mode {
            FilterMode::Include => &self.include,
            FilterMode::Exclude => &self.exclude,
        }
    }

    /// How many values the section holds across both modes — its badge.
    pub(super) fn count(&self) -> usize {
        self.include.len() + self.exclude.len()
    }
}

/// The sheet's sections in order: one per filter field, each reading both
/// match modes off `filters`.
pub(super) fn sections(filters: &ViewFilters) -> Vec<SectionView> {
    FILTER_FIELDS
        .into_iter()
        .map(|field| SectionView {
            field,
            include: picked_values(filters, field, FilterMode::Include),
            exclude: picked_values(filters, field, FilterMode::Exclude),
        })
        .collect()
}

/// `prefs` as they stand now, with `value` flipped in or out of the
/// `field`/`mode` clause — never built from what an earlier render saw.
fn ticked(
    prefs: Signal<ViewPrefs>,
    field: FilterField,
    mode: FilterMode,
    value: &str,
) -> ViewPrefs {
    let mut next = prefs.peek().clone();
    toggle_value(&mut next.filters, field, mode, value);
    next
}

/// How a pick the source no longer offers is named while it waits to be unticked.
fn stranded_label(field: FilterField, value: &str) -> String {
    match field {
        FilterField::Shelf => "unavailable shelf".to_string(),
        FilterField::Format => value.to_ascii_uppercase(),
        _ => value.to_string(),
    }
}

/// `list` as the section shows it: with any of `picked` that it no longer
/// offers added in, so the reader can still untick them.
fn list_with_picks(field: FilterField, list: Rc<OptionList>, picked: &[String]) -> Rc<OptionList> {
    match list.with_stranded(picked, |value| stranded_label(field, value)) {
        Some(extended) => Rc::new(extended),
        None => list,
    }
}

/// `field`'s values, fetched the first time `open` turns true and again on each
/// `retry`; `None` until they have answered. An answer is kept for the rest of
/// the sheet — only a failure refetches. `skip_fetch` leaves the shelf field to
/// the landing's own list.
fn use_field_values(
    field: FilterField,
    open: Signal<bool>,
    retry: Signal<u32>,
    (server_url, viewer_id, skip_fetch): (String, Option<i64>, bool),
) -> Signal<Loaded> {
    let mut loaded: Signal<Loaded> = use_signal(|| None);
    let epoch = use_signal(|| 0u32);
    use_effect(move || {
        let wanted = open();
        let _ = retry();
        if !wanted || skip_fetch || matches!(*loaded.peek(), Some((_, Ok(_)))) {
            return;
        }
        fetch_options(server_url.clone(), field, viewer_id, epoch, move |result| {
            loaded.set(Some((field, result)));
        });
    });
    loaded
}

/// The section for `field`. Every tick emits the whole next [`ViewPrefs`],
/// built from the live `prefs`.
#[component]
pub(super) fn FieldSection(
    view: SectionView,
    prefs: Signal<ViewPrefs>,
    shelves: ShelfList,
    server_url: String,
    viewer_id: Option<i64>,
    on_change: EventHandler<ViewPrefs>,
) -> Element {
    let field = view.field;
    let mut open = use_signal(|| false);
    let mut mode = use_signal(|| FilterMode::Include);
    let mut query = use_signal(String::new);
    let mut retry = use_signal(|| 0u32);
    let skip_fetch = !needs_fetch(field, &shelves);
    let mut loaded = use_field_values(field, open, retry, (server_url, viewer_id, skip_fetch));

    let token = field_token(field);
    let count = view.count();
    let picked = view.picked(mode()).to_vec();
    let state = match state_for(field, loaded(), &shelves, viewer_id) {
        LoadState::Ready(list) => LoadState::Ready(list_with_picks(field, list, &picked)),
        other => other,
    };
    let on_toggle = EventHandler::new(move |value: String| {
        on_change.call(ticked(prefs, field, mode(), &value));
    });

    rsx! {
        section { class: "m-fsec", "data-testid": "mobile-filter-field-{token}",
            button {
                r#type: "button",
                class: "m-fsec-head",
                "aria-expanded": "{open()}",
                onclick: move |_| open.set(!open()),
                span { class: "m-fsec-name", "{field_label(field)}" }
                if count > 0 {
                    span { class: "m-fsec-badge mono", "data-testid": "mobile-filter-count-{token}", "{count}" }
                }
                span { class: "m-fsec-chev", aria_hidden: "true",
                    if open() {
                        "\u{2212}"
                    } else {
                        "+"
                    }
                }
            }
            if open() {
                PickerBody {
                    field,
                    mode: mode(),
                    query: query(),
                    picked,
                    state,
                    footer: false,
                    on_mode: move |next| mode.set(next),
                    on_query: move |next| query.set(next),
                    on_toggle,
                    on_retry: move |_| {
                        loaded.set(None);
                        retry.with_mut(|n| *n += 1);
                    },
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
