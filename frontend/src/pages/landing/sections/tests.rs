use omnibus_shared::{Shelf, ShelfKind, Visibility};

use super::{add_books_state, empty_books_message, AddBooks};
use crate::pages::landing::view::Members;
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
        add_books_state(Some(&manual), pick, true, Members::Ready),
        AddBooks::Ready
    );
    assert_eq!(
        add_books_state(Some(&manual), pick, true, Members::Pending),
        AddBooks::Waiting
    );
}

#[test]
fn add_books_state_says_the_members_are_unavailable_when_their_fetch_failed() {
    let manual = shelf(3, ShelfKind::Manual);
    assert_eq!(
        add_books_state(
            Some(&manual),
            ShelfSelection::Shelf(3),
            true,
            Members::Unavailable
        ),
        AddBooks::Unavailable
    );
}

#[test]
fn add_books_state_hides_unless_the_viewer_may_hand_pick_into_the_shelf() {
    let pick = ShelfSelection::Shelf(3);
    let manual = shelf(3, ShelfKind::Manual);
    assert_eq!(
        add_books_state(Some(&manual), pick, false, Members::Ready),
        AddBooks::Hidden
    );
    for kind in [ShelfKind::Smart, ShelfKind::Wishlist] {
        assert_eq!(
            add_books_state(Some(&shelf(3, kind)), pick, true, Members::Ready),
            AddBooks::Hidden
        );
    }
    assert_eq!(
        add_books_state(None, pick, true, Members::Ready),
        AddBooks::Hidden
    );
}

#[test]
fn add_books_state_hides_while_the_detail_trails_a_new_pick() {
    // The previous shelf's detail is still loaded after picking shelf 4.
    let previous = shelf(3, ShelfKind::Manual);
    assert_eq!(
        add_books_state(
            Some(&previous),
            ShelfSelection::Shelf(4),
            true,
            Members::Ready
        ),
        AddBooks::Hidden
    );
    assert_eq!(
        add_books_state(Some(&previous), ShelfSelection::All, true, Members::Ready),
        AddBooks::Hidden
    );
}

#[cfg(feature = "server")]
mod render {
    use dioxus::prelude::*;

    use super::super::{add_books_button, AddBooks, LandingHeaderReceipt};
    use crate::test_support::render_in_vdom;

    fn receipt(
        book_count: Option<usize>,
        count_pending: bool,
        hidden_count: Option<i64>,
        editable_shelf: Option<String>,
    ) -> Element {
        rsx! {
            LandingHeaderReceipt {
                book_count,
                count_pending,
                hidden_count,
                editable_shelf,
                on_edit_shelf: EventHandler::new(|_| {}),
            }
        }
    }

    #[test]
    fn landing_header_receipt_draws_nothing_with_nothing_to_say() {
        let html = render_in_vdom(|| receipt(None, false, None, None));
        assert!(!html.contains("lib-header-receipt"), "{html}");
    }

    #[test]
    fn landing_header_counts_nothing_before_the_list_has_answered() {
        let html = render_in_vdom(|| receipt(None, true, None, None));
        assert!(html.contains("lib-count-pending"), "{html}");
        assert!(!html.contains("0 books"), "{html}");
    }

    #[test]
    fn landing_header_states_zero_books_once_the_list_says_so() {
        let html = render_in_vdom(|| receipt(Some(0), false, None, None));
        assert!(html.contains("0 books"), "{html}");
        assert!(!html.contains("lib-count-pending"), "{html}");
    }

    #[test]
    fn landing_header_shows_the_hidden_receipt_without_a_count() {
        let html = render_in_vdom(|| receipt(None, false, Some(3), None));
        assert!(html.contains(">3 hidden<"), "{html}");
        assert!(!html.contains("lib-filtered-count"), "{html}");
    }

    #[test]
    fn landing_header_offers_only_the_pencil_on_an_editable_shelf() {
        let html = render_in_vdom(|| receipt(None, false, None, Some("Cosmere".into())));
        assert!(html.contains("aria-label=\"Edit Cosmere\""), "{html}");
        assert!(!html.contains("lib-header-receipt-text"), "{html}");
    }

    #[test]
    fn add_books_button_is_inert_until_the_members_are_known() {
        let waiting =
            render_in_vdom(|| add_books_button(AddBooks::Waiting, EventHandler::new(|_| {})));
        assert!(waiting.contains(r#"aria-disabled="true""#), "{waiting}");
        assert!(waiting.contains("Still loading"), "{waiting}");
        let ready = render_in_vdom(|| add_books_button(AddBooks::Ready, EventHandler::new(|_| {})));
        assert!(ready.contains(r#"aria-disabled="false""#), "{ready}");
        assert!(ready.contains("shelf-add-books"), "{ready}");
    }

    #[test]
    fn add_books_button_says_the_members_failed_to_load_rather_than_that_they_are_loading() {
        let html =
            render_in_vdom(|| add_books_button(AddBooks::Unavailable, EventHandler::new(|_| {})));
        assert!(html.contains(r#"aria-disabled="true""#), "{html}");
        assert!(html.contains("couldn\u{2019}t be loaded"), "{html}");
        assert!(!html.contains("Still loading"), "{html}");
    }
}
