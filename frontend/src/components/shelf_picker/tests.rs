//! Tests for the shelf picker: which shelves a viewer may add books to, and
//! what the modal draws while the shelves load, fail, are empty, or are being
//! written. Needs the `server` feature (`dioxus::ssr`).

use omnibus_shared::ShelfKind;

use super::*;
use crate::test_support::{render, test_shelf_summary, test_user};

const VIEWER_ID: i64 = 7;
const OTHER_READER_ID: i64 = 9;

fn reader() -> UserSummary {
    test_user(false, false)
}

fn admin() -> UserSummary {
    test_user(true, false)
}

fn ids(shelves: &[ShelfSummary]) -> Vec<i64> {
    shelves.iter().map(|s| s.id).collect()
}

fn own(id: i64, name: &str) -> ShelfSummary {
    test_shelf_summary(id, VIEWER_ID, ShelfKind::Manual, name)
}

#[test]
fn add_targets_keeps_the_viewers_own_hand_picked_shelves_in_input_order() {
    let shelves = [own(3, "Beach"), own(1, "Commute")];
    assert_eq!(ids(&add_targets(&shelves, &reader())), vec![3, 1]);
}

#[test]
fn add_targets_drops_smart_and_wishlist_shelves_even_when_the_viewer_owns_them() {
    let shelves = [
        test_shelf_summary(1, VIEWER_ID, ShelfKind::Smart, "Unread"),
        test_shelf_summary(2, VIEWER_ID, ShelfKind::Wishlist, "reader's wishlist"),
        own(3, "Beach"),
    ];
    assert_eq!(ids(&add_targets(&shelves, &reader())), vec![3]);
}

#[test]
fn add_targets_drops_another_readers_hand_picked_shelf_for_a_non_admin() {
    let shelves = [
        test_shelf_summary(1, OTHER_READER_ID, ShelfKind::Manual, "Theirs"),
        own(2, "Mine"),
    ];
    assert_eq!(ids(&add_targets(&shelves, &reader())), vec![2]);
}

#[test]
fn add_targets_keeps_another_readers_hand_picked_shelf_for_an_admin() {
    let shelves = [
        own(1, "Mine"),
        test_shelf_summary(2, OTHER_READER_ID, ShelfKind::Manual, "Theirs"),
        test_shelf_summary(3, OTHER_READER_ID, ShelfKind::Smart, "Their rule"),
        test_shelf_summary(4, OTHER_READER_ID, ShelfKind::Wishlist, "Their wishlist"),
    ];
    assert_eq!(ids(&add_targets(&shelves, &admin())), vec![1, 2]);
}

/// `picker_targets` with the shelves as ids, so the answer compares and prints.
fn target_ids(
    read: Option<Result<&[ShelfSummary], ()>>,
    viewer: Option<&UserSummary>,
) -> Option<Result<Vec<i64>, ()>> {
    picker_targets(read, viewer).map(|answer| answer.map(|shelves| ids(&shelves)))
}

#[test]
fn picker_targets_keeps_the_shelves_the_viewer_may_change_when_both_are_known() {
    let shelves = [
        test_shelf_summary(1, OTHER_READER_ID, ShelfKind::Manual, "Theirs"),
        own(2, "Mine"),
    ];
    let viewer = reader();
    assert_eq!(
        target_ids(Some(Ok(&shelves)), Some(&viewer)),
        Some(Ok(vec![2]))
    );
}

#[test]
fn picker_targets_stays_loading_when_the_viewer_is_not_known_yet() {
    let shelves = [own(1, "Mine")];
    assert_eq!(target_ids(Some(Ok(&shelves)), None), None);
}

#[test]
fn picker_targets_reports_a_failed_read_when_the_shelves_did_not_load() {
    let viewer = reader();
    assert_eq!(target_ids(Some(Err(())), Some(&viewer)), Some(Err(())));
}

#[test]
fn picker_targets_reports_a_failed_read_before_the_viewer_is_known() {
    assert_eq!(target_ids(Some(Err(())), None), Some(Err(())));
}

#[component]
fn Harness(list: ShelfPickerList) -> Element {
    rsx! {
        ShelfPickerModal {
            heading: "Add to shelf".to_string(),
            list,
            on_pick: move |_| {},
            on_close: move |_| {},
        }
    }
}

fn picker_html(list: ShelfPickerList) -> String {
    render(rsx! { Harness { list } })
}

fn ready(targets: Vec<ShelfSummary>) -> ShelfPickerList {
    ShelfPickerList {
        targets: Some(Ok(targets)),
        viewer_id: Some(VIEWER_ID),
        ..Default::default()
    }
}

/// The picker row for `shelf_id`, from its opening `<button` to `</button>`.
fn row_html(html: &str, shelf_id: i64) -> &str {
    let marker = format!("data-testid=\"shelf-picker-row-{shelf_id}\"");
    let at = html
        .find(&marker)
        .unwrap_or_else(|| panic!("no row for shelf {shelf_id} in {html}"));
    let start = html[..at].rfind("<button").expect("a row is a button");
    let end = at + html[at..].find("</button>").expect("the row closes");
    &html[start..end]
}

#[test]
fn shelf_picker_modal_draws_a_loader_and_no_verdict_while_the_shelves_load() {
    let html = picker_html(ShelfPickerList::default());
    assert!(
        html.contains("data-testid=\"shelf-picker-loading\""),
        "{html}"
    );
    assert!(!html.contains("shelf-picker-row"), "{html}");
    assert!(!html.contains("shelf-picker-empty"), "{html}");
    assert!(!html.contains("no hand-picked shelves"), "{html}");
}

#[test]
fn shelf_picker_modal_says_the_shelves_did_not_load_instead_of_calling_them_empty() {
    let html = picker_html(ShelfPickerList {
        targets: Some(Err(())),
        ..Default::default()
    });
    assert!(
        html.contains("data-testid=\"shelf-picker-unavailable\""),
        "{html}"
    );
    assert!(html.contains("Your shelves didn\u{2019}t load"), "{html}");
    assert!(!html.contains("shelf-picker-empty"), "{html}");
}

// The empty state links to the library page with a `dioxus_router::Link`, which
// panics without a live `RouterContext`; dioxus catches that per component, so
// only the link's own text is unverifiable here (as in `pages/not_found.rs`).
#[test]
fn shelf_picker_modal_explains_there_are_no_hand_picked_shelves_when_none_qualify() {
    let html = picker_html(ready(Vec::new()));
    assert!(
        html.contains("data-testid=\"shelf-picker-empty\""),
        "{html}"
    );
    assert!(
        html.contains("You have no hand-picked shelves yet."),
        "{html}"
    );
    assert!(!html.contains("shelf-picker-row"), "{html}");
}

#[test]
fn shelf_picker_modal_draws_checkbox_rows_that_are_checked_only_for_member_shelves() {
    let html = picker_html(ShelfPickerList {
        checked: Some(vec![2]),
        ..ready(vec![own(1, "Beach"), own(2, "Commute")])
    });
    let on_shelf = row_html(&html, 2);
    let off_shelf = row_html(&html, 1);
    assert!(on_shelf.contains("role=\"checkbox\""), "{on_shelf}");
    assert!(on_shelf.contains("aria-checked=\"true\""), "{on_shelf}");
    assert!(off_shelf.contains("role=\"checkbox\""), "{off_shelf}");
    assert!(off_shelf.contains("aria-checked=\"false\""), "{off_shelf}");
}

#[test]
fn shelf_picker_modal_draws_plain_buttons_without_checked_state_when_picking_one_shot() {
    let html = picker_html(ready(vec![own(1, "Beach")]));
    let row = row_html(&html, 1);
    assert!(row.contains("Beach"), "{row}");
    assert!(!row.contains("role=\"checkbox\""), "{row}");
    assert!(!row.contains("aria-checked"), "{row}");
}

#[test]
fn shelf_picker_modal_attributes_a_shelf_the_viewer_does_not_own() {
    let html = picker_html(ready(vec![
        own(1, "Mine"),
        test_shelf_summary(2, OTHER_READER_ID, ShelfKind::Manual, "Theirs"),
    ]));
    assert!(row_html(&html, 2).contains("by user-9"), "{html}");
    assert!(!row_html(&html, 1).contains("by "), "{html}");
}

#[test]
fn shelf_picker_modal_makes_every_row_inert_and_marks_the_busy_one_while_writing() {
    let html = picker_html(ShelfPickerList {
        busy: Some(2),
        ..ready(vec![own(1, "Beach"), own(2, "Commute")])
    });
    let idle = row_html(&html, 1);
    let working = row_html(&html, 2);
    assert!(idle.contains("disabled"), "{idle}");
    assert!(!idle.contains("ld-ring"), "{idle}");
    assert!(working.contains("disabled"), "{working}");
    assert!(working.contains("aria-busy=\"true\""), "{working}");
    assert!(working.contains("ld-ring"), "{working}");
}

#[test]
fn shelf_picker_modal_leaves_rows_enabled_when_nothing_is_being_written() {
    let html = picker_html(ready(vec![own(1, "Beach")]));
    assert!(!row_html(&html, 1).contains("disabled"), "{html}");
}

#[test]
fn shelf_picker_modal_announces_the_last_failure_as_an_alert_and_keeps_the_rows() {
    let html = picker_html(ShelfPickerList {
        error: Some("Couldn\u{2019}t update Beach: boom".to_string()),
        ..ready(vec![own(1, "Beach")])
    });
    let at = html
        .find("data-testid=\"shelf-picker-error\"")
        .unwrap_or_else(|| panic!("no error line in {html}"));
    let line = &html[html[..at].rfind("<p").expect("a paragraph")..];
    assert!(line.contains("role=\"alert\""), "{line}");
    assert!(
        line.contains("Couldn\u{2019}t update Beach: boom"),
        "{line}"
    );
    assert!(html.contains("shelf-picker-row-1"), "{html}");
}

#[test]
fn shelf_picker_modal_labels_its_dialog_by_its_heading() {
    let html = picker_html(ready(vec![own(1, "Beach")]));
    assert!(html.contains("data-testid=\"shelf-picker\""), "{html}");
    assert!(html.contains("role=\"dialog\""), "{html}");
    assert!(html.contains("aria-modal=\"true\""), "{html}");
    assert!(
        html.contains("aria-labelledby=\"shelf-picker-title\""),
        "{html}"
    );
    let title_at = html
        .find("id=\"shelf-picker-title\"")
        .unwrap_or_else(|| panic!("no heading id in {html}"));
    assert!(html[title_at..].contains("Add to shelf"), "{html}");
    assert!(
        html.contains("data-testid=\"shelf-picker-close\""),
        "{html}"
    );
}
