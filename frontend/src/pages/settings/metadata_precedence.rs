//! Per-library metadata-source precedence editor: two ordered lists (ebook /
//! audiobook) reordered with up/down buttons and saved together by one Save to
//! each scan root's `metadata_precedence` column, apart from the path-saving
//! `Settings` form. The lists wait for the saved order: showing the defaults
//! first would present an order nobody saved as the current one.

use dioxus::prelude::*;
use omnibus_shared::MetadataSource;

use crate::components::{BusyLabel, Loading, LoadingKind};
use crate::data::server_error_message;
use crate::{data, use_server_url};

/// Human-readable label for a metadata source, in the settings UI order
/// (matches [`DEFAULT_METADATA_PRECEDENCE`], lowest to highest priority).
fn source_label(source: MetadataSource) -> &'static str {
    match source {
        MetadataSource::FolderStructure => "Folder structure",
        MetadataSource::EmbeddedTags => "Embedded tags",
        MetadataSource::OpfSidecar => "OPF sidecar",
        MetadataSource::OmnibusOverrides => "Manual edits (overrides)",
        MetadataSource::ProviderMatch => "Provider match (Hardcover)",
    }
}

/// Which way a reorder button moves its item.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Direction {
    Up,
    Down,
}

impl Direction {
    fn slug(self) -> &'static str {
        match self {
            Self::Up => "up",
            Self::Down => "down",
        }
    }
}

/// Move the item at `from` one place, returning where it landed; `None` (and
/// no change) when it is already at that end.
fn move_source(order: &mut [MetadataSource], from: usize, direction: Direction) -> Option<usize> {
    let to = match direction {
        Direction::Up => from.checked_sub(1)?,
        Direction::Down => from + 1,
    };
    if to >= order.len() {
        return None;
    }
    order.swap(from, to);
    Some(to)
}

/// Which of the moved item's buttons takes focus: the one just pressed, unless
/// the item reached the end that disables it.
fn focus_after_move(index: usize, len: usize, pressed: Direction) -> Direction {
    match pressed {
        Direction::Up if index == 0 => Direction::Down,
        Direction::Down if index + 1 == len => Direction::Up,
        other => other,
    }
}

/// What the live region says after a move.
fn position_announcement(source: MetadataSource, index: usize, len: usize) -> String {
    format!(
        "{} moved to position {} of {len}.",
        source_label(source),
        index + 1
    )
}

/// Focus the element carrying `testid` once the re-render has painted.
fn focus_testid(testid: String) {
    dioxus::document::eval(&format!(
        "requestAnimationFrame(() => document.querySelector('[data-testid=\"{testid}\"]')?.focus());"
    ));
}

/// The two libraries' orders, `None` until their saved value arrives.
#[derive(Clone, Copy, PartialEq)]
struct Orders {
    ebook: Signal<Option<Vec<MetadataSource>>>,
    audiobook: Signal<Option<Vec<MetadataSource>>>,
}

/// Card holding both libraries' precedence lists and their one Save.
/// Admin-only — gated by the caller, like the other admin cards.
#[component]
pub fn MetadataPrecedenceField() -> Element {
    let server_url = use_server_url();
    let orders = Orders {
        ebook: use_signal(|| None),
        audiobook: use_signal(|| None),
    };
    let mut failed = use_signal(|| false);
    let mut reload = use_signal(|| 0u32);
    let mut msg = use_signal(|| None::<String>);
    let mut msg_is_error = use_signal(|| false);
    let mut saving = use_signal(|| false);
    let announcement = use_signal(String::new);

    let load_url = server_url.clone();
    use_effect(move || {
        let _ = reload();
        let url = load_url.clone();
        failed.set(false);
        spawn(async move {
            let (mut ebook, mut audiobook) = (orders.ebook, orders.audiobook);
            let loaded = (
                data::get_metadata_precedence(&url, "ebook").await,
                data::get_metadata_precedence(&url, "audiobook").await,
            );
            match loaded {
                (Ok(e), Ok(a)) => {
                    ebook.set(Some(e));
                    audiobook.set(Some(a));
                }
                (Err(e), _) | (_, Err(e)) => {
                    msg.set(Some(format!(
                        "Couldn\u{2019}t load the saved order: {}",
                        server_error_message(&e)
                    )));
                    msg_is_error.set(true);
                    failed.set(true);
                }
            }
        });
    });

    let on_save = move |_| {
        let (Some(ebook), Some(audiobook)) = ((orders.ebook)(), (orders.audiobook)()) else {
            return;
        };
        if saving() {
            return;
        }
        let url = server_url.clone();
        saving.set(true);
        spawn(async move {
            let saved = match data::save_metadata_precedence(&url, "ebook", ebook).await {
                Ok(e) => data::save_metadata_precedence(&url, "audiobook", audiobook)
                    .await
                    .map(|a| (e, a)),
                Err(e) => Err(e),
            };
            match saved {
                Ok((e, a)) => {
                    let (mut ebook, mut audiobook) = (orders.ebook, orders.audiobook);
                    ebook.set(Some(e));
                    audiobook.set(Some(a));
                    msg.set(Some("Metadata order saved.".to_string()));
                    msg_is_error.set(false);
                }
                Err(e) => {
                    msg.set(Some(format!(
                        "Couldn\u{2019}t save the metadata order: {}",
                        server_error_message(&e)
                    )));
                    msg_is_error.set(true);
                }
            }
            saving.set(false);
        });
    };

    let loaded = (orders.ebook)().is_some() && (orders.audiobook)().is_some();
    let busy = saving();

    rsx! {
        section { class: "card", "data-testid": "metadata-precedence-card",
            h3 { "Source order" }
            p { class: "subtitle",
                "Order the sources Omnibus resolves each field from. Lower items win \u{2014} the last "
                "source in the list that has a value for a field is used."
            }
            if loaded {
                PrecedenceList { library: "ebook", label: "Ebook library", order: orders.ebook, announcement }
                PrecedenceList { library: "audiobook", label: "Audiobook library", order: orders.audiobook, announcement }
            } else if !failed() {
                Loading {
                    kind: LoadingKind::Section,
                    class: "start",
                    testid: "metadata-precedence-loading",
                    label: "Reading the saved order\u{2026}",
                }
            }
            p { class: "ld-sr", role: "status", "aria-live": "polite", "{announcement}" }
            div { class: "settings-actions",
                if failed() {
                    button {
                        r#type: "button",
                        class: "btn ghost",
                        "data-testid": "metadata-precedence-retry",
                        onclick: move |_| {
                            msg.set(None);
                            reload += 1;
                        },
                        "Try again"
                    }
                }
                button {
                    r#type: "button",
                    class: "btn primary",
                    disabled: busy || !loaded,
                    "aria-busy": if busy { "true" } else { "false" },
                    "data-testid": "metadata-precedence-save",
                    onclick: on_save,
                    BusyLabel { busy, label: "Save metadata order", busy_label: "Saving\u{2026}" }
                }
            }
            p {
                role: "status",
                "data-testid": "metadata-precedence-status",
                class: if msg_is_error() { "settings-status error" } else { "settings-status success" },
                if let Some(m) = msg() { "{m}" }
            }
        }
    }
}

/// One library's ordered list. Items are keyed by source so a move carries the
/// row (and its focus) rather than relabelling rows in place.
#[component]
fn PrecedenceList(
    library: &'static str,
    label: &'static str,
    order: Signal<Option<Vec<MetadataSource>>>,
    announcement: Signal<String>,
) -> Element {
    let testid = format!("{library}-metadata-precedence");
    let sources = order().unwrap_or_default();
    let len = sources.len();
    let reorder = move |from: usize, direction: Direction| {
        let mut announcement = announcement;
        let mut current = order().unwrap_or_default();
        let Some(to) = move_source(&mut current, from, direction) else {
            return;
        };
        let moved = current[to];
        let mut order = order;
        order.set(Some(current));
        announcement.set(position_announcement(moved, to, len));
        let focus = focus_after_move(to, len, direction);
        focus_testid(format!(
            "{library}-metadata-precedence-{}-{to}",
            focus.slug()
        ));
    };

    rsx! {
        div { class: "settings-field", "data-testid": "{testid}",
            span { class: "settings-label", id: "{testid}-label", "{label}" }
            ol { class: "metadata-precedence-list", "aria-labelledby": "{testid}-label",
                for (i , source) in sources.into_iter().enumerate() {
                    li {
                        key: "{source_label(source)}",
                        class: "metadata-precedence-item",
                        "data-testid": "{testid}-item-{i}",
                        span { "{source_label(source)}" }
                        button {
                            r#type: "button",
                            class: "btn ghost sm",
                            disabled: i == 0,
                            "data-testid": "{testid}-up-{i}",
                            "aria-label": "Move {source_label(source)} up",
                            onclick: move |_| reorder(i, Direction::Up),
                            "Up"
                        }
                        button {
                            r#type: "button",
                            class: "btn ghost sm",
                            disabled: i + 1 == len,
                            "data-testid": "{testid}-down-{i}",
                            "aria-label": "Move {source_label(source)} down",
                            onclick: move |_| reorder(i, Direction::Down),
                            "Down"
                        }
                    }
                }
            }
        }
    }
}

#[cfg(all(test, feature = "server"))]
mod tests;
