//! One filter field's section in the mobile sheet: a header that opens it, then
//! the filter bar's own picker body — mode toggle, search, value rows — applied
//! tick by tick. Values load the first time the section opens, from the same
//! reads the web bar uses.

use std::rc::Rc;

use dioxus::prelude::*;
use omnibus_shared::{FilterField, FilterMode, ViewPrefs};

use super::{field_count, picked_values, toggle_value};
use crate::components::filter_bar::values::{self, OptionList};
use crate::components::filter_bar::{field_label, field_token, LoadState, PickerBody};

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

/// The section for `field`. Every tick emits the whole next [`ViewPrefs`].
#[component]
pub(super) fn FieldSection(
    field: FilterField,
    prefs: ViewPrefs,
    server_url: String,
    viewer_id: Option<i64>,
    on_change: EventHandler<ViewPrefs>,
) -> Element {
    let mut open = use_signal(|| false);
    let mut mode = use_signal(|| FilterMode::Include);
    let mut query = use_signal(String::new);
    // `None` until the field's values have answered.
    let mut loaded = use_signal(|| None::<Result<Rc<OptionList>, String>>);
    let mut retry = use_signal(|| 0u32);

    use_effect(move || {
        let wanted = open();
        let _ = retry();
        // An answer is kept for the rest of the sheet; only a failure refetches.
        if !wanted || loaded.peek().as_ref().is_some_and(Result::is_ok) {
            return;
        }
        let url = server_url.clone();
        spawn(async move {
            let result = values::load_options(&url, field, viewer_id)
                .await
                .map(Rc::new)
                .map_err(|e| e.to_string());
            loaded.set(Some(result));
        });
    });

    let token = field_token(field);
    let count = field_count(&prefs.filters, field);
    let picked = picked_values(&prefs.filters, field, mode());
    let state = match loaded() {
        None => LoadState::Loading,
        Some(Ok(list)) => LoadState::Ready(list_with_picks(field, list, &picked)),
        Some(Err(message)) => LoadState::Failed(message),
    };
    let toggle_from = prefs.clone();
    let on_toggle = EventHandler::new(move |value: String| {
        let mut next = toggle_from.clone();
        toggle_value(&mut next.filters, field, mode(), &value);
        on_change.call(next);
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
