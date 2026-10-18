//! The theme control, Dark / Black / Light / Sepia as one segmented group,
//! shared by the user menu and Settings › Preferences. It reads the app-wide
//! theme signal, which starts at Dark on every target and takes the persisted
//! choice after mount, so SSR and the first paint agree (rule 07).

use dioxus::prelude::*;

use crate::components::atrium::{apply_theme, Theme, ThemeSnap};

/// One button per theme, the current one `aria-pressed`. `id` and
/// `described_by` let a settings row label and describe the group.
#[component]
pub fn ThemePicker(
    #[props(into, default)] id: Option<String>,
    #[props(into, default)] described_by: Option<String>,
) -> Element {
    let theme = use_context::<Signal<Theme>>();
    let snap = use_context::<ThemeSnap>();
    let current = *theme.read();
    rsx! {
        div {
            class: "theme-seg",
            id,
            role: "group",
            "aria-label": "Theme",
            "aria-describedby": described_by,
            for t in Theme::ALL {
                button {
                    key: "{t.as_attr()}",
                    r#type: "button",
                    class: if t == current { "theme-seg-btn on" } else { "theme-seg-btn" },
                    "data-testid": "theme-{t.as_attr()}",
                    "aria-pressed": "{t == current}",
                    onclick: move |_| apply_theme(theme, snap, t),
                    "{theme_label(t)}"
                }
            }
        }
    }
}

/// A theme's button text.
fn theme_label(theme: Theme) -> &'static str {
    match theme {
        Theme::Dark => "Dark",
        Theme::Black => "Black",
        Theme::Light => "Light",
        Theme::Sepia => "Sepia",
    }
}

#[cfg(all(test, feature = "server"))]
mod tests;
