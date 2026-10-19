//! Toolbar (Stack series, view mode, sort key, sort direction and the
//! hidden-formats note) for the landing page.
//!
//! Stateless: emits a new [`ViewPrefs`] through the parent's `on_change`
//! handler so [`super::LandingPage`] owns the canonical signal.

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::{SortDir, SortKey, ViewMode, ViewPrefs};

use crate::components::glyphs::{arrow_down_glyph, arrow_up_glyph};
use crate::pages::settings::sections::{SettingsSection, SettingsTarget};
use crate::routes::link_target;

use super::sorting::{
    default_dir_for, sort_key_from_value, sort_key_label, sort_key_value, toggle_dir, SORT_KEYS,
};
use super::stack_toggle::{StackToggle, StackToggleView};

/// `hidden_formats_apply` is whether this pick is one the reader's
/// hidden-formats preference narrows (All Books, not a shelf).
#[component]
pub(super) fn Toolbar(
    prefs: ViewPrefs,
    sort_lock: Option<&'static str>,
    stack: StackToggleView,
    hidden_formats_apply: bool,
    on_change: EventHandler<ViewPrefs>,
    on_stack_toggle: EventHandler<()>,
) -> Element {
    let view_mode = prefs.view_mode;
    let hidden_formats = crate::use_current_user_summary()()
        .filter(|_| hidden_formats_apply)
        .and_then(|u| hidden_formats_label(&u.hidden_formats));

    rsx! {
        div { class: "lib-toolbar", role: "toolbar", "data-testid": "lib-toolbar",
            if view_mode == ViewMode::Grid {
                StackToggle { view: stack, on_toggle: on_stack_toggle }
            }
            ViewModeToggle { view_mode, prefs: prefs.clone(), on_change }
            if view_mode == ViewMode::Grid {
                SortControls { prefs, locked: sort_lock.is_some(), on_change }
            }
            // Outside the grid-only block on purpose: in table mode the
            // dropdown is gone but the column headers are the inert control,
            // and the reader still has to be told why (#2507).
            if let Some(reason) = sort_lock {
                span {
                    class: "label lib-sort-locked",
                    "data-testid": "lib-sort-locked",
                    "{reason}"
                }
            }
            if let Some(label) = hidden_formats {
                HiddenFormatsLink { label }
            }
        }
    }
}

/// The formats the reader's preference keeps off All Books, worded as
/// "Hidden: M4B, MP3", or `None` when it hides nothing.
fn hidden_formats_label(formats: &[String]) -> Option<String> {
    if formats.is_empty() {
        return None;
    }
    let mut names: Vec<String> = formats.iter().map(|f| f.to_uppercase()).collect();
    names.sort();
    Some(format!("Hidden: {}", names.join(", ")))
}

/// The hidden-formats note, linking to the preference that hides them so a
/// missing book never reads as a missing file.
#[component]
fn HiddenFormatsLink(label: String) -> Element {
    rsx! {
        Link {
            class: "lib-hidden-formats",
            "data-testid": "lib-hidden-formats",
            to: link_target(SettingsTarget::Personal(SettingsSection::Preferences).route()),
            "{label}"
            span { class: "sr-only", ". Change in Settings" }
        }
    }
}

/// Table/Grid pressed-button toggle group. Not an ARIA tablist — there are no
/// associated tab panels and no arrow-key tab navigation, so `aria-pressed`
/// on plain `<button>`s is the right shape.
#[component]
fn ViewModeToggle(
    view_mode: ViewMode,
    prefs: ViewPrefs,
    on_change: EventHandler<ViewPrefs>,
) -> Element {
    let set_view = move |mode: ViewMode| {
        let mut next = prefs.clone();
        next.view_mode = mode;
        on_change.call(next);
    };
    let set_view_table = set_view.clone();
    let set_view_grid = set_view.clone();

    rsx! {
        div { class: "lib-view-toggle", "aria-label": "View mode",
            button {
                class: "lib-toggle-btn",
                "aria-pressed": "{view_mode == ViewMode::Table}",
                "data-testid": "view-toggle-table",
                onclick: move |_| set_view_table(ViewMode::Table),
                "Table"
            }
            button {
                class: "lib-toggle-btn",
                "aria-pressed": "{view_mode == ViewMode::Grid}",
                "data-testid": "view-toggle-grid",
                onclick: move |_| set_view_grid(ViewMode::Grid),
                "Grid"
            }
        }
    }
}

/// Grid-only sort-axis dropdown and direction toggle. `locked` is set for a
/// gallery pick whose member order the server settles itself — the controls
/// stay visible (so the axis still reads back) but cannot be used.
#[component]
fn SortControls(prefs: ViewPrefs, locked: bool, on_change: EventHandler<ViewPrefs>) -> Element {
    let sort_key = prefs.sort_key;
    let sort_dir = prefs.sort_dir;
    let set_sort_key = {
        let prefs = prefs.clone();
        move |key: SortKey| {
            let mut next = prefs.clone();
            // Switching to a different axis from the grid dropdown should
            // adopt that axis's natural direction (descending for time-based
            // axes, ascending for alphabetical) — matches the table-view
            // header behavior so the two views stay consistent.
            if next.sort_key != key {
                next.sort_dir = default_dir_for(key);
            }
            next.sort_key = key;
            on_change.call(next);
        }
    };
    // The arrow is drawn, not text, so the label carries the direction.
    let (dir_label, dir_glyph) = match sort_dir {
        SortDir::Asc => ("Sort direction: ascending", arrow_up_glyph(13)),
        SortDir::Desc => ("Sort direction: descending", arrow_down_glyph(13)),
    };
    let toggle_sort_dir = move |_| {
        let mut next = prefs.clone();
        next.sort_dir = toggle_dir(next.sort_dir);
        on_change.call(next);
    };

    rsx! {
        div { class: "lib-sort-controls",
            label { class: "lib-sort-label",
                "Sort by"
                select {
                    class: "lib-sort-select",
                    "data-testid": "lib-sort-select",
                    disabled: locked,
                    onchange: move |evt: Event<FormData>| {
                        if let Some(key) = sort_key_from_value(&evt.value()) {
                            set_sort_key(key);
                        }
                    },
                    for opt in SORT_KEYS.iter().copied() {
                        option {
                            key: "{sort_key_value(opt)}",
                            value: "{sort_key_value(opt)}",
                            selected: opt == sort_key,
                            "{sort_key_label(opt)}"
                        }
                    }
                }
            }
            button {
                class: "lib-sort-dir",
                "data-testid": "lib-sort-dir",
                aria_label: dir_label,
                disabled: locked,
                onclick: toggle_sort_dir,
                {dir_glyph}
            }
        }
    }
}

// SSR render-smoke coverage — `render_element` supplies a runtime, but the
// `on_change` EventHandler must be built inside a component body, so the tests
// mount the toolbar through a tiny prop-only harness.
#[cfg(all(test, feature = "server"))]
mod tests {
    use super::*;
    use crate::test_support::render;

    use super::super::stack_toggle::StackToggleView;

    #[component]
    fn ToolbarHarness(
        prefs: ViewPrefs,
        sort_lock: Option<&'static str>,
        stack: StackToggleView,
    ) -> Element {
        rsx! {
            Toolbar {
                prefs,
                sort_lock,
                stack,
                hidden_formats_apply: true,
                on_change: move |_| {},
                on_stack_toggle: move |_| {},
            }
        }
    }

    /// A resolved viewer with Stack series off — the default live switch.
    fn live_stack() -> StackToggleView {
        StackToggleView {
            ready: true,
            ..StackToggleView::default()
        }
    }

    fn render_toolbar(prefs: ViewPrefs) -> String {
        render_toolbar_with(prefs, None, live_stack())
    }

    fn render_toolbar_locked(prefs: ViewPrefs, sort_lock: Option<&'static str>) -> String {
        render_toolbar_with(prefs, sort_lock, live_stack())
    }

    fn render_toolbar_with(
        prefs: ViewPrefs,
        sort_lock: Option<&'static str>,
        stack: StackToggleView,
    ) -> String {
        render(rsx! {
            ToolbarHarness { prefs, sort_lock, stack }
        })
    }

    #[test]
    fn toolbar_renders_the_view_toggle_with_grid_pressed_by_default() {
        let html = render_toolbar(ViewPrefs::default());

        assert!(html.contains("data-testid=\"lib-toolbar\""));
        assert!(html.contains("role=\"toolbar\""));
        assert!(html.contains("data-testid=\"view-toggle-table\""));
        assert!(html.contains("data-testid=\"view-toggle-grid\""));
        assert!(html.contains("Table"));
        assert!(html.contains("Grid"));
        // Default view mode is Grid, so its button is the pressed one and the
        // grid-only sort controls are part of the default markup.
        assert!(html.contains("aria-pressed=\"true\""));
        assert!(html.contains("data-testid=\"lib-sort-select\""));
        assert!(html.contains("data-testid=\"lib-sort-dir\""));
        assert!(html.contains("Sort by"));
    }

    #[test]
    fn toolbar_hides_the_sort_controls_in_table_mode() {
        let prefs = ViewPrefs {
            view_mode: ViewMode::Table,
            ..ViewPrefs::default()
        };
        let html = render_toolbar(prefs);

        // Table view sorts via its own column headers, so the grid-only sort
        // dropdown stays out of the markup.
        assert!(!html.contains("data-testid=\"lib-sort-select\""));
        assert!(!html.contains("data-testid=\"lib-sort-dir\""));
    }

    #[test]
    fn toolbar_disables_the_sort_controls_and_says_why_inside_a_locked_shelf() {
        let html = render_toolbar_locked(ViewPrefs::default(), Some("shelf order"));

        assert!(html.contains("data-testid=\"lib-sort-select\""));
        assert!(html.contains("disabled"));
        assert!(html.contains("data-testid=\"lib-sort-locked\""));
        assert!(html.contains("shelf order"));
    }

    #[test]
    fn toolbar_states_the_locked_order_in_table_mode_where_the_controls_are_hidden() {
        // Table mode sorts via its column headers, so the grid dropdown is
        // absent — but the reader still has to be told why the headers are
        // inert (#2507 AC2).
        let prefs = ViewPrefs {
            view_mode: ViewMode::Table,
            ..ViewPrefs::default()
        };
        let html = render_toolbar_locked(prefs, Some("shelf order"));

        assert!(!html.contains("data-testid=\"lib-sort-select\""));
        assert!(html.contains("data-testid=\"lib-sort-locked\""));
    }

    #[test]
    fn toolbar_leaves_the_sort_controls_live_with_no_lock() {
        let html = render_toolbar(ViewPrefs::default());

        assert!(html.contains("data-testid=\"lib-sort-select\""));
        assert!(!html.contains("data-testid=\"lib-sort-locked\""));
        assert!(!html.contains("disabled"));
    }

    #[test]
    fn toolbar_renders_the_stack_toggle_off_and_live_by_default() {
        let html = render_toolbar(ViewPrefs::default());

        assert!(html.contains("data-testid=\"lib-stack-toggle\""));
        assert!(html.contains("Stack series"));
        assert!(html.contains("class=\"ss-tog\""));
        assert!(!html.contains("data-testid=\"lib-stack-error\""));
    }

    #[test]
    fn toolbar_holds_the_stack_toggle_inert_until_the_viewer_resolves() {
        let html = render_toolbar_with(ViewPrefs::default(), None, StackToggleView::default());

        assert!(html.contains("data-testid=\"lib-stack-toggle\""));
        assert!(html.contains("disabled"));
        assert!(html.contains("class=\"ss-tog pending\""));
    }

    #[test]
    fn toolbar_presses_the_stack_toggle_when_the_viewer_saved_it_on() {
        let stack = StackToggleView {
            saved: true,
            ..live_stack()
        };
        let html = render_toolbar_with(ViewPrefs::default(), None, stack);

        assert!(html.contains("class=\"ss-tog on\""));
    }

    #[test]
    fn toolbar_hides_the_stack_toggle_in_table_mode() {
        let prefs = ViewPrefs {
            view_mode: ViewMode::Table,
            ..ViewPrefs::default()
        };
        let stack = StackToggleView {
            saved: true,
            ..live_stack()
        };
        let html = render_toolbar_with(prefs, None, stack);

        assert!(!html.contains("data-testid=\"lib-stack-toggle\""));
    }

    #[test]
    fn toolbar_shows_a_failed_stack_save_as_an_alert() {
        let stack = StackToggleView {
            failed: true,
            ..live_stack()
        };
        let html = render_toolbar_with(ViewPrefs::default(), None, stack);

        assert!(html.contains("data-testid=\"lib-stack-error\""));
        assert!(html.contains("role=\"alert\""));
        // SSR escapes the apostrophe, so match the HTML-entity form.
        assert!(html.contains("Couldn&#39;t save Stack series."));
    }

    #[test]
    fn hidden_formats_label_names_each_hidden_format_in_capitals() {
        let hidden = vec!["mp3".to_string(), "m4b".to_string()];
        assert_eq!(
            hidden_formats_label(&hidden),
            Some("Hidden: M4B, MP3".to_string())
        );
    }

    #[test]
    fn hidden_formats_label_is_none_when_nothing_is_hidden() {
        assert_eq!(hidden_formats_label(&[]), None);
    }

    #[test]
    fn toolbar_shows_no_hidden_formats_note_before_the_viewer_resolves() {
        let html = render_toolbar(ViewPrefs::default());
        assert!(!html.contains("lib-hidden-formats"), "{html}");
    }

    mod hidden_formats_link {
        use dioxus_router::{Routable, Router};

        use super::*;
        use crate::test_support::render_in_vdom;

        #[derive(Clone, Debug, PartialEq, Routable)]
        enum Harness {
            #[route("/")]
            LinkHost {},
        }

        #[component]
        fn LinkHost() -> Element {
            rsx! { HiddenFormatsLink { label: "Hidden: M4B, MP3".to_string() } }
        }

        #[test]
        fn hidden_formats_link_opens_the_preferences_section() {
            let html = render_in_vdom(|| rsx! { Router::<Harness> {} });
            assert!(
                html.contains("data-testid=\"lib-hidden-formats\""),
                "{html}"
            );
            assert!(
                html.contains(r#"href="/settings?section=preferences""#),
                "{html}"
            );
            assert!(html.contains("Hidden: M4B, MP3"), "{html}");
        }
    }
}
