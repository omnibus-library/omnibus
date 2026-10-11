//! Tests for the More stop's shelf-membership block: the pure reads and
//! patches behind it, and what it draws for each state of its shelves read.
//! Needs the `server` feature (`dioxus::ssr`).

use std::cell::RefCell;

use dioxus_router::{Routable, Router};
use omnibus_shared::ShelfKind;

use super::*;
use crate::test_support::{render_in_vdom, test_shelf_summary};

const VIEWER_ID: i64 = 7;

#[test]
fn with_membership_appends_a_shelf_once() {
    assert_eq!(with_membership(&[4, 9], 2, true), vec![4, 9, 2]);
    assert_eq!(with_membership(&[4, 9], 9, true), vec![4, 9]);
}

#[test]
fn with_membership_removes_a_shelf_and_keeps_the_rest_in_order() {
    assert_eq!(with_membership(&[4, 9, 2], 9, false), vec![4, 2]);
    assert_eq!(with_membership(&[4, 2], 7, false), vec![4, 2]);
}

fn counted(id: i64, count: i64, covers: &[&str]) -> ShelfSummary {
    let mut shelf = test_shelf_summary(id, 7, ShelfKind::Manual, "Beach");
    shelf.book_count = count;
    shelf.cover_uuids = covers.iter().map(|c| c.to_string()).collect();
    shelf
}

#[test]
fn with_member_summary_counts_the_book_in_and_stands_its_cover_first_when_added() {
    let shelves = [counted(5, 2, &["a", "b"])];
    let next = with_member_summary(&shelves, 5, "new", true, true);
    assert_eq!(next[0].book_count, 3);
    assert_eq!(next[0].cover_uuids, vec!["new", "a", "b"]);
}

#[test]
fn with_member_summary_counts_a_coverless_book_in_without_touching_the_ledge() {
    let shelves = [counted(5, 2, &["a", "b"])];
    let next = with_member_summary(&shelves, 5, "new", false, true);
    assert_eq!(next[0].book_count, 3);
    assert_eq!(next[0].cover_uuids, vec!["a", "b"]);
}

#[test]
fn with_member_summary_keeps_the_ledge_to_its_width_when_a_cover_joins_a_full_one() {
    let shelves = [counted(5, 9, &["a", "b", "c", "d"])];
    let next = with_member_summary(&shelves, 5, "new", true, true);
    assert_eq!(next[0].cover_uuids, vec!["new", "a", "b", "c"]);
}

#[test]
fn with_member_summary_counts_the_book_out_and_drops_its_cover_when_removed() {
    let shelves = [counted(5, 3, &["a", "new", "b"])];
    let next = with_member_summary(&shelves, 5, "new", true, false);
    assert_eq!(next[0].book_count, 2);
    assert_eq!(next[0].cover_uuids, vec!["a", "b"]);
}

#[test]
fn with_member_summary_never_counts_below_zero() {
    let shelves = [counted(5, 0, &[])];
    let next = with_member_summary(&shelves, 5, "new", true, false);
    assert_eq!(next[0].book_count, 0);
}

#[test]
fn with_member_summary_leaves_every_other_shelf_as_it_was() {
    let shelves = [counted(4, 1, &["x"]), counted(5, 2, &["a"])];
    let next = with_member_summary(&shelves, 5, "new", true, true);
    assert_eq!(next[0], shelves[0]);
}

fn shelf(id: i64, owner: i64, kind: ShelfKind, name: &str) -> ShelfSummary {
    test_shelf_summary(id, owner, kind, name)
}

fn facts(all: Vec<ShelfSummary>, manual_ids: &[i64], smart_ids: &[i64]) -> ShelvesFacts {
    ShelvesFacts {
        all,
        manual_ids: manual_ids.to_vec(),
        smart_ids: smart_ids.to_vec(),
    }
}

fn names(shelves: &[ShelfSummary]) -> Vec<&str> {
    shelves.iter().map(|s| s.name.as_str()).collect()
}

#[test]
fn shelves_facts_joins_the_three_reads_when_all_of_them_answer() {
    let all = vec![shelf(1, VIEWER_ID, ShelfKind::Manual, "Beach")];
    let joined = shelves_facts(Ok(all.clone()), Ok::<_, &str>(vec![1]), Ok(vec![2]));
    assert_eq!(joined, Ok(facts(all, &[1], &[2])));
}

#[test]
fn shelves_facts_fails_when_the_shelf_list_read_fails() {
    let joined = shelves_facts(Err("boom"), Ok(vec![1]), Ok(vec![2]));
    assert_eq!(joined, Err(()));
}

#[test]
fn shelves_facts_fails_when_the_hand_picked_read_fails() {
    let joined = shelves_facts(Ok(Vec::new()), Err("boom"), Ok(vec![2]));
    assert_eq!(joined, Err(()));
}

#[test]
fn shelves_facts_fails_when_the_smart_read_fails() {
    let joined = shelves_facts(Ok(Vec::new()), Ok(vec![1]), Err("boom"));
    assert_eq!(joined, Err(()));
}

#[test]
fn held_shelves_lists_the_hand_picked_then_the_smart_then_the_viewers_wishlist() {
    let all = vec![
        shelf(4, VIEWER_ID, ShelfKind::Wishlist, "reader's wishlist"),
        shelf(3, VIEWER_ID, ShelfKind::Smart, "Austen"),
        shelf(2, VIEWER_ID, ShelfKind::Manual, "Commute"),
        shelf(1, VIEWER_ID, ShelfKind::Manual, "Beach"),
    ];
    let held = held_shelves(&facts(all, &[1, 2], &[3]), Some(VIEWER_ID), true);
    assert_eq!(
        names(&held),
        vec!["Commute", "Beach", "Austen", "reader's wishlist"]
    );
}

#[test]
fn held_shelves_leaves_out_the_wishlist_until_the_book_is_wished_for() {
    let all = vec![shelf(
        4,
        VIEWER_ID,
        ShelfKind::Wishlist,
        "reader's wishlist",
    )];
    let held = held_shelves(&facts(all, &[], &[]), Some(VIEWER_ID), false);
    assert!(held.is_empty());
}

#[test]
fn held_shelves_never_names_another_readers_wishlist() {
    let all = vec![shelf(4, 9, ShelfKind::Wishlist, "user-9's wishlist")];
    let held = held_shelves(&facts(all, &[], &[]), Some(VIEWER_ID), true);
    assert!(held.is_empty());
}

#[test]
fn held_shelves_skips_a_member_id_the_shelf_list_does_not_carry() {
    let all = vec![shelf(1, VIEWER_ID, ShelfKind::Manual, "Beach")];
    let held = held_shelves(&facts(all, &[1, 99], &[98]), Some(VIEWER_ID), false);
    assert_eq!(names(&held), vec!["Beach"]);
}

/// What the router host below draws. A `Router` route cannot carry props, and
/// the tiles are router links, so the scene travels in a thread-local.
#[derive(Clone)]
struct Scene {
    held: Option<Result<Vec<ShelfSummary>, ()>>,
    in_series: bool,
}

thread_local! {
    static SCENE: RefCell<Option<Scene>> = const { RefCell::new(None) };
}

#[derive(Clone, Debug, PartialEq, Routable)]
enum BlockRoute {
    #[route("/")]
    BlockHost {},
}

#[component]
fn BlockHost() -> Element {
    let scene = SCENE
        .with(|s| s.borrow().clone())
        .expect("a scene is set before rendering");
    let ctx = BlockCtx {
        in_series: scene.in_series,
        viewer_id: Some(VIEWER_ID),
        server_url: String::new(),
        avatar_bust: 0,
    };
    membership_body(scene.held.as_ref(), &ctx, EventHandler::new(|_| {}))
}

fn render_block(held: Option<Result<Vec<ShelfSummary>, ()>>, in_series: bool) -> String {
    SCENE.with(|s| *s.borrow_mut() = Some(Scene { held, in_series }));
    render_in_vdom(|| rsx! { Router::<BlockRoute> {} })
}

/// The block for a standalone book.
fn block_html(held: Option<Result<Vec<ShelfSummary>, ()>>) -> String {
    render_block(held, false)
}

/// The block for a book that sits in a series.
fn series_block_html(held: Option<Result<Vec<ShelfSummary>, ()>>) -> String {
    render_block(held, true)
}

fn on_shelves(names: &[&str]) -> Option<Result<Vec<ShelfSummary>, ()>> {
    let shelves = names
        .iter()
        .zip(1..)
        .map(|(name, id)| shelf(id, VIEWER_ID, ShelfKind::Manual, name))
        .collect();
    Some(Ok(shelves))
}

/// The tile for `shelf_id`, from its opening tag to its closing `</a>`.
fn tile_html(html: &str, shelf_id: i64) -> &str {
    let marker = format!("data-testid=\"bdmq-shelf-{shelf_id}\"");
    let at = html
        .find(&marker)
        .unwrap_or_else(|| panic!("no tile for shelf {shelf_id} in {html}"));
    let start = html[..at].rfind("<a").expect("a tile is a link");
    let end = at + html[at..].find("</a>").expect("the tile closes");
    &html[start..end]
}

fn position(html: &str, needle: &str) -> usize {
    html.find(needle)
        .unwrap_or_else(|| panic!("no {needle} in {html}"))
}

#[test]
fn membership_body_offers_add_to_shelf_to_a_book_on_no_shelf() {
    let html = block_html(on_shelves(&[]));
    assert!(html.contains("Not on a shelf yet."), "{html}");
    assert!(html.contains("data-testid=\"bdmq-add-to-shelf\""), "{html}");
    assert!(html.contains("Add to shelf"), "{html}");
    assert!(!html.contains("data-testid=\"bdmq-shelves\""), "{html}");
}

#[test]
fn membership_body_draws_each_held_shelf_as_a_tile_linking_to_its_page() {
    let html = block_html(on_shelves(&["Beach", "Commute"]));
    let beach = tile_html(&html, 1);
    assert!(beach.contains("href=\"/shelves/1\""), "{beach}");
    assert!(beach.contains("Beach"), "{beach}");
    assert!(beach.contains("Hand-picked"), "{beach}");
    assert!(beach.contains("shv-card--compact"), "{beach}");
    assert!(tile_html(&html, 2).contains("Commute"), "{html}");
}

#[test]
fn membership_body_ends_the_tiles_with_the_add_to_shelf_tile() {
    let html = block_html(on_shelves(&["Beach", "Commute"]));
    let grid = position(&html, "data-testid=\"bdmq-shelves\"");
    let last_tile = position(&html, "data-testid=\"bdmq-shelf-2\"");
    let add = position(&html, "data-testid=\"bdmq-add-to-shelf\"");
    assert!(grid < last_tile && last_tile < add, "{html}");
}

#[test]
fn membership_body_draws_a_matching_smart_shelf_as_a_tile_and_never_says_not_on_a_shelf() {
    let held = Some(Ok(vec![shelf(5, VIEWER_ID, ShelfKind::Smart, "Austen")]));
    let html = block_html(held);
    let tile = tile_html(&html, 5);
    assert!(tile.contains("Austen"), "{tile}");
    assert!(tile.contains("Smart"), "{tile}");
    assert!(!html.contains("Not on a shelf yet."), "{html}");
    assert!(html.contains("data-testid=\"bdmq-shelves\""), "{html}");
}

#[test]
fn membership_body_names_the_viewers_wishlist_with_its_kind() {
    let held = Some(Ok(vec![shelf(
        6,
        VIEWER_ID,
        ShelfKind::Wishlist,
        "reader's wishlist",
    )]));
    let html = block_html(held);
    let tile = tile_html(&html, 6);
    assert!(tile.contains("Wishlist"), "{tile}");
    assert!(tile.contains(">You<"), "{tile}");
}

#[test]
fn membership_body_replaces_the_library_page_hints_with_the_button() {
    for held in [on_shelves(&[]), on_shelves(&["Beach"])] {
        let html = block_html(held);
        assert!(!html.contains("shelves are made on the"), "{html}");
        assert!(!html.contains("open a shelf from the"), "{html}");
    }
}

#[test]
fn membership_body_draws_a_loader_and_no_button_while_the_read_is_in_flight() {
    let html = block_html(None);
    assert!(
        html.contains("data-testid=\"bdmq-shelves-loading\""),
        "{html}"
    );
    assert!(!html.contains("bdmq-add-to-shelf"), "{html}");
    assert!(!html.contains("Not on a shelf yet."), "{html}");
}

#[test]
fn membership_body_says_the_read_failed_and_offers_no_button() {
    let html = block_html(Some(Err(())));
    assert!(
        html.contains("data-testid=\"bdmq-shelves-unavailable\""),
        "{html}"
    );
    assert!(html.contains("library page"), "{html}");
    assert!(!html.contains("bdmq-add-to-shelf"), "{html}");
    assert!(!html.contains("Not on a shelf yet."), "{html}");
}

#[test]
fn membership_body_titles_a_standalone_books_block_standalone_on_your_shelves() {
    let html = block_html(on_shelves(&[]));
    assert!(html.contains("Standalone \u{b7} on your shelves"), "{html}");
}

#[test]
fn membership_body_titles_a_series_books_block_on_your_shelves() {
    let html = series_block_html(on_shelves(&[]));
    assert!(html.contains("On your shelves"), "{html}");
    assert!(!html.contains("Standalone"), "{html}");
}

#[test]
fn membership_body_offers_only_the_button_to_a_series_book_on_no_shelf() {
    let html = series_block_html(on_shelves(&[]));
    assert!(html.contains("data-testid=\"bdmq-add-to-shelf\""), "{html}");
    assert!(!html.contains("Not on a shelf yet."), "{html}");
    assert!(!html.contains("bdmq-bigquiet"), "{html}");
}

#[test]
fn membership_body_shows_a_series_books_tiles_beside_the_add_tile() {
    let html = series_block_html(on_shelves(&["Beach"]));
    assert!(html.contains("data-testid=\"bdmq-shelves\""), "{html}");
    assert!(tile_html(&html, 1).contains("Beach"), "{html}");
    assert!(html.contains("data-testid=\"bdmq-add-to-shelf\""), "{html}");
}
