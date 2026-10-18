//! One settings row, with the setting's name and what it does on the left and
//! its control on the right. Shared by Preferences and the in-context toggles
//! elsewhere, so a switch reads the same wherever a reader meets it.

use dioxus::prelude::*;

/// A labelled row around `children` (the control). The label targets
/// `control_id`, and the description carries `id="{control_id}-desc"` for the
/// control to name in its `aria-describedby`. `pending` draws the description
/// as a value still loading.
#[component]
pub fn SettingRow(
    label: String,
    description: String,
    control_id: String,
    #[props(default)] testid: Option<String>,
    #[props(default)] pending: bool,
    children: Element,
) -> Element {
    rsx! {
        div { class: "setting-row", "data-testid": testid,
            div { class: "setting-row-text",
                label { class: "setting-row-label", r#for: "{control_id}", "{label}" }
                p {
                    class: if pending { "setting-row-desc ld-sheen" } else { "setting-row-desc" },
                    id: "{control_id}-desc",
                    "{description}"
                }
            }
            div { class: "setting-row-control", {children} }
        }
    }
}

#[cfg(all(test, feature = "server"))]
mod tests;
