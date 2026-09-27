use omnibus_shared::{Shelf, ShelfKind, Visibility};

use super::{add_books_state, empty_books_message, AddBooks};
use crate::shelf_selection::ShelfSelection;

fn shelf(id: i64, kind: ShelfKind) -> Shelf {
    Shelf {
        id,
        owner_user_id: 1,
        owner_username: "sloan".into(),
        owner_has_avatar: false,
        kind,
        name: "Cosy Reads".into(),
        description: None,
        visibility: Visibility::Private,
        accent: None,
        match_mode: None,
        rules: Vec::new(),
        book_count: 0,
        sync_to_kobo: false,
    }
}

#[test]
fn empty_books_message_says_a_shelf_is_empty_rather_than_naming_a_format() {
    // A shelf holding only an audiobook must not read as "no ebooks".
    assert_eq!(empty_books_message(true), "No books in this shelf.");
    assert_eq!(empty_books_message(false), "No ebooks found.");
}

#[test]
fn add_books_state_is_ready_for_an_editable_hand_picked_shelf_once_members_load() {
    let manual = shelf(3, ShelfKind::Manual);
    let pick = ShelfSelection::Shelf(3);
    assert_eq!(
        add_books_state(Some(&manual), pick, true, true),
        AddBooks::Ready
    );
    assert_eq!(
        add_books_state(Some(&manual), pick, true, false),
        AddBooks::Waiting
    );
}

#[test]
fn add_books_state_hides_unless_the_viewer_may_hand_pick_into_the_shelf() {
    let pick = ShelfSelection::Shelf(3);
    let manual = shelf(3, ShelfKind::Manual);
    assert_eq!(
        add_books_state(Some(&manual), pick, false, true),
        AddBooks::Hidden
    );
    for kind in [ShelfKind::Smart, ShelfKind::Wishlist] {
        assert_eq!(
            add_books_state(Some(&shelf(3, kind)), pick, true, true),
            AddBooks::Hidden
        );
    }
    assert_eq!(add_books_state(None, pick, true, true), AddBooks::Hidden);
}

#[test]
fn add_books_state_hides_while_the_detail_trails_a_new_pick() {
    // The previous shelf's detail is still loaded after picking shelf 4.
    let previous = shelf(3, ShelfKind::Manual);
    assert_eq!(
        add_books_state(Some(&previous), ShelfSelection::Shelf(4), true, true),
        AddBooks::Hidden
    );
    assert_eq!(
        add_books_state(Some(&previous), ShelfSelection::All, true, true),
        AddBooks::Hidden
    );
}

#[cfg(feature = "server")]
mod render {
    use dioxus::prelude::*;

    use super::super::{add_books_button, LandingHeaderTitleRow};
    use crate::test_support::render_in_vdom;

    fn title_row(book_count: Option<usize>, count_pending: bool) -> Element {
        rsx! {
            LandingHeaderTitleRow {
                section_title: "All Books".to_string(),
                book_count,
                count_pending,
                hidden_count: None,
                can_edit: false,
                on_edit_shelf: EventHandler::new(|_| {}),
            }
        }
    }

    #[test]
    fn landing_header_counts_nothing_before_the_list_has_answered() {
        let html = render_in_vdom(|| title_row(None, true));
        assert!(html.contains("lib-count-pending"), "{html}");
        assert!(!html.contains("0 books"), "{html}");
    }

    #[test]
    fn landing_header_shows_no_count_after_the_list_failed() {
        let html = render_in_vdom(|| title_row(None, false));
        assert!(!html.contains("lib-count-pending"), "{html}");
        assert!(!html.contains("books"), "{html}");
    }

    #[test]
    fn landing_header_states_zero_books_once_the_list_says_so() {
        let html = render_in_vdom(|| title_row(Some(0), false));
        assert!(html.contains("0 books"), "{html}");
        assert!(!html.contains("lib-count-pending"), "{html}");
    }

    #[test]
    fn add_books_button_is_inert_until_the_members_are_known() {
        let waiting = render_in_vdom(|| add_books_button(false, EventHandler::new(|_| {})));
        assert!(waiting.contains(r#"aria-disabled="true""#), "{waiting}");
        assert!(waiting.contains("Still loading"), "{waiting}");
        let ready = render_in_vdom(|| add_books_button(true, EventHandler::new(|_| {})));
        assert!(ready.contains(r#"aria-disabled="false""#), "{ready}");
        assert!(ready.contains("shelf-add-books"), "{ready}");
    }
}
