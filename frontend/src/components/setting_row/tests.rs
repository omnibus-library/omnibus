//! Tests for the settings row: its label, description and control wiring.

use super::*;
use crate::test_support::render;

#[test]
fn setting_row_labels_its_control_so_the_name_is_clickable() {
    let html = render(rsx! {
        SettingRow {
            label: "Stack series",
            description: "Fold a series into one stack in the grid.",
            control_id: "stack-series-toggle",
            input { id: "stack-series-toggle", r#type: "checkbox" }
        }
    });
    assert!(
        html.contains(
            r#"<label class="setting-row-label" for="stack-series-toggle">Stack series</label>"#
        ),
        "{html}"
    );
    assert!(
        html.contains("Fold a series into one stack in the grid."),
        "{html}"
    );
    assert!(html.contains(r#"id="stack-series-toggle""#), "{html}");
}

#[test]
fn setting_row_describes_its_control_for_assistive_tech() {
    let html = render(rsx! {
        SettingRow {
            label: "Stack series",
            description: "Fold a series into one stack in the grid.",
            control_id: "stack-series-toggle",
            input { id: "stack-series-toggle", r#type: "checkbox" }
        }
    });
    assert!(html.contains(r#"id="stack-series-toggle-desc""#), "{html}");
}
