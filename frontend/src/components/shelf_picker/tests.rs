//! Tests for the shelf picker: which shelves a viewer may add books to, and
//! what the modal draws while the shelves load, fail, are empty, or are being
//! written, and the read-only automatic section. Needs the `server` feature
//! (`dioxus::ssr`).

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

/// The picker tile for `shelf_id`, from its opening `<button` to `</button>`.
fn tile_html(html: &str, shelf_id: i64) -> &str {
    let marker = format!("data-testid=\"shelf-picker-tile-{shelf_id}\"");
    let at = html
        .find(&marker)
        .unwrap_or_else(|| panic!("no tile for shelf {shelf_id} in {html}"));
    let start = html[..at].rfind("<button").expect("a tile is a button");
    let end = at + html[at..].find("</button>").expect("the tile closes");
    &html[start..end]
}

/// The read-only automatic tile for `shelf_id`: from the element carrying its
/// testid to the next automatic tile, or the end of the section.
fn auto_tile_html(html: &str, shelf_id: i64) -> &str {
    let marker = format!("data-testid=\"shelf-picker-auto-{shelf_id}\"");
    let at = html
        .find(&marker)
        .unwrap_or_else(|| panic!("no automatic tile for shelf {shelf_id} in {html}"));
    let start = html[..at]
        .rfind("<div")
        .expect("an automatic tile is a block");
    let after = at + marker.len();
    let end = ["data-testid=\"shelf-picker-auto-", "</section>"]
        .iter()
        .filter_map(|stop| html[after..].find(stop))
        .min()
        .map_or(html.len(), |stop| after + stop);
    &html[start..end]
}

#[test]
fn shelf_picker_modal_draws_a_loader_and_no_verdict_while_the_shelves_load() {
    let html = picker_html(ShelfPickerList::default());
    assert!(
        html.contains("data-testid=\"shelf-picker-loading\""),
        "{html}"
    );
    assert!(!html.contains("shelf-picker-tile-"), "{html}");
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
    assert!(!html.contains("shelf-picker-tile-"), "{html}");
}

#[test]
fn shelf_picker_modal_draws_checkbox_tiles_that_are_checked_only_for_member_shelves() {
    let html = picker_html(ShelfPickerList {
        checked: Some(vec![2]),
        ..ready(vec![own(1, "Beach"), own(2, "Commute")])
    });
    let on_shelf = tile_html(&html, 2);
    let off_shelf = tile_html(&html, 1);
    assert!(on_shelf.contains("role=\"checkbox\""), "{on_shelf}");
    assert!(on_shelf.contains("aria-checked=\"true\""), "{on_shelf}");
    assert!(off_shelf.contains("role=\"checkbox\""), "{off_shelf}");
    assert!(off_shelf.contains("aria-checked=\"false\""), "{off_shelf}");
}

#[test]
fn shelf_picker_modal_draws_plain_buttons_without_checked_state_when_picking_one_shot() {
    let html = picker_html(ready(vec![own(1, "Beach")]));
    let tile = tile_html(&html, 1);
    assert!(tile.contains("Beach"), "{tile}");
    assert!(!tile.contains("role=\"checkbox\""), "{tile}");
    assert!(!tile.contains("aria-checked"), "{tile}");
    assert!(!tile.contains("shelf-picker-check"), "{tile}");
}

#[test]
fn shelf_picker_modal_attributes_a_shelf_the_viewer_does_not_own() {
    let html = picker_html(ready(vec![
        own(1, "Mine"),
        test_shelf_summary(2, OTHER_READER_ID, ShelfKind::Manual, "Theirs"),
    ]));
    assert!(tile_html(&html, 2).contains("by user-9"), "{html}");
    assert!(!tile_html(&html, 1).contains("by "), "{html}");
}

#[test]
fn shelf_picker_modal_makes_every_tile_inert_and_marks_the_busy_one_while_writing() {
    let html = picker_html(ShelfPickerList {
        busy: Some(2),
        ..ready(vec![own(1, "Beach"), own(2, "Commute")])
    });
    let idle = tile_html(&html, 1);
    let working = tile_html(&html, 2);
    assert!(idle.contains("disabled"), "{idle}");
    assert!(!idle.contains("ld-ring"), "{idle}");
    assert!(working.contains("disabled"), "{working}");
    assert!(working.contains("aria-busy=\"true\""), "{working}");
    assert!(working.contains("ld-ring"), "{working}");
}

#[test]
fn shelf_picker_modal_leaves_tiles_enabled_when_nothing_is_being_written() {
    let html = picker_html(ready(vec![own(1, "Beach")]));
    assert!(!tile_html(&html, 1).contains("disabled"), "{html}");
}

#[test]
fn shelf_picker_modal_announces_the_last_failure_as_an_alert_and_keeps_the_tiles() {
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
    assert!(html.contains("shelf-picker-tile-1"), "{html}");
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

#[test]
fn shelf_picker_modal_tells_the_reader_only_hand_picked_shelves_are_listed() {
    for list in [ShelfPickerList::default(), ready(vec![own(1, "Beach")])] {
        let html = picker_html(list);
        let at = html
            .find("data-testid=\"shelf-picker-hint\"")
            .unwrap_or_else(|| panic!("no hint in {html}"));
        let hint = &html[at..at + html[at..].find("</p>").expect("the hint closes")];
        assert!(
            hint.contains(
                "Only shelves you fill by hand are listed; smart shelves add books by their rules."
            ),
            "{hint}"
        );
    }
}

#[test]
fn shelf_picker_modal_draws_each_shelf_as_a_tile_with_its_covers_count_and_accent() {
    let mut beach = own(1, "Beach");
    beach.accent = Some("oklch(0.7 0.1 40)".to_string());
    beach.book_count = 5;
    beach.cover_uuids = vec!["c1".to_string()];
    let html = picker_html(ready(vec![beach]));
    let tile = tile_html(&html, 1);
    assert!(
        tile.contains("--shelf-accent: oklch(0.7 0.1 40);"),
        "{tile}"
    );
    assert!(tile.contains("/api/thumbs/c1/sm"), "{tile}");
    assert!(tile.contains("5 books"), "{tile}");
    assert!(tile.contains("Hand-picked"), "{tile}");
    assert!(tile.contains(">You<"), "{tile}");
}

#[test]
fn shelf_picker_modal_marks_a_checkbox_tile_with_a_badge_filled_only_when_checked() {
    let html = picker_html(ShelfPickerList {
        checked: Some(vec![2]),
        ..ready(vec![own(1, "Beach"), own(2, "Commute")])
    });
    let on_shelf = tile_html(&html, 2);
    let off_shelf = tile_html(&html, 1);
    assert!(on_shelf.contains("shelf-picker-check"), "{on_shelf}");
    assert!(on_shelf.contains("\u{2713}"), "{on_shelf}");
    assert!(off_shelf.contains("shelf-picker-check"), "{off_shelf}");
    assert!(!off_shelf.contains("\u{2713}"), "{off_shelf}");
}

fn smart(id: i64, name: &str) -> ShelfSummary {
    test_shelf_summary(id, VIEWER_ID, ShelfKind::Smart, name)
}

#[test]
fn shelf_picker_modal_lists_the_smart_shelves_a_book_matches_as_read_only_tiles() {
    let html = picker_html(ShelfPickerList {
        checked: Some(Vec::new()),
        automatic: vec![smart(8, "Austen"), smart(9, "Unread")],
        ..ready(vec![own(1, "Beach")])
    });
    let at = html
        .find("data-testid=\"shelf-picker-automatic\"")
        .unwrap_or_else(|| panic!("no automatic section in {html}"));
    let section = &html[at..];
    assert!(
        section.contains("Automatic \u{b7} follows each shelf&#39;s rules"),
        "{section}"
    );
    for (id, name) in [(8, "Austen"), (9, "Unread")] {
        let tile = auto_tile_html(&html, id);
        assert!(tile.contains(name), "{tile}");
        assert!(tile.contains("Smart"), "{tile}");
        assert!(!tile.contains("<button"), "{tile}");
        assert!(!tile.contains("role="), "{tile}");
        assert!(!tile.contains("tabindex"), "{tile}");
        assert!(!tile.contains("shelf-picker-check"), "{tile}");
        assert!(
            !html.contains(&format!("shelf-picker-tile-{id}")),
            "an automatic shelf must not be toggleable: {html}"
        );
    }
}

#[test]
fn shelf_picker_modal_omits_the_automatic_section_when_no_smart_shelf_matches() {
    let html = picker_html(ready(vec![own(1, "Beach")]));
    assert!(!html.contains("shelf-picker-automatic"), "{html}");
    assert!(!html.contains("Automatic"), "{html}");
}

#[test]
fn shelf_picker_modal_keeps_the_automatic_section_when_the_reader_has_no_hand_picked_shelves() {
    let html = picker_html(ShelfPickerList {
        automatic: vec![smart(8, "Austen")],
        ..ready(Vec::new())
    });
    assert!(
        html.contains("data-testid=\"shelf-picker-empty\""),
        "{html}"
    );
    assert!(html.contains("shelf-picker-auto-8"), "{html}");
}

#[test]
fn shelf_picker_modal_draws_no_automatic_section_while_the_shelves_load_or_fail() {
    for targets in [None, Some(Err(()))] {
        let html = picker_html(ShelfPickerList {
            targets,
            automatic: vec![smart(8, "Austen")],
            ..Default::default()
        });
        assert!(!html.contains("shelf-picker-automatic"), "{html}");
    }
}
