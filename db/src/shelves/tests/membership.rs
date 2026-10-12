//! Manual membership: insertion order, the unknown-book rejection,
//! add/remove, survival of a ghosted file, the chunked batch inserts for
//! books and rules, `manual_shelves_containing` and
//! `smart_shelves_containing`.

use omnibus_shared::{
    CreateShelfRequest, MatchMode, RuleField, RuleOp, ShelfRule, SortDir, SortKey, ViewFilters,
    Visibility,
};

use super::super::*;
use super::{make_user, manual_req, smart_req, tag_rule, uuid_by_title};
use crate::pool::init_db;
use crate::test_support::{seed_discovery_fixture, seed_minimal_books};

async fn finish_book(pool: &sqlx::SqlitePool, user: i64, uuid: &str) {
    sqlx::query(
        "INSERT INTO book_read_status (user_id, book_uuid, status, finished_at)
         VALUES (?, ?, 'finished', strftime('%s','now'))",
    )
    .bind(user)
    .bind(uuid)
    .execute(pool)
    .await
    .unwrap();
}

/// Bulk-insert `count` rule-less smart shelves owned by `owner_id` (they hold
/// no book) at positions `1..=count`, without `create_shelf` — too slow at
/// over-cap row counts.
async fn seed_smart_shelves_raw(pool: &sqlx::SqlitePool, owner_id: i64, count: i64) {
    sqlx::query(
        r"
        WITH RECURSIVE n(i) AS (
            SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?
        )
        INSERT INTO shelves (owner_user_id, kind, name, match_mode, position)
        SELECT ?, 'smart', 'Smart ' || i, 'any', i FROM n
        ",
    )
    .bind(count)
    .bind(owner_id)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn create_manual_shelf_keeps_added_order() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    seed_minimal_books(&pool, 3).await;
    let owner = make_user(&pool, "owner", false).await;

    let shelf = create_shelf(
        &pool,
        owner,
        &manual_req("Picks", vec!["uuid-3".into(), "uuid-1".into()]),
    )
    .await
    .unwrap();
    assert_eq!(shelf.book_count, 2);

    let page = shelf_page(
        &pool,
        &shelf,
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        Viewer::default(),
    )
    .await
    .unwrap();
    let titles: Vec<_> = page.books.iter().filter_map(|b| b.title.clone()).collect();
    assert_eq!(titles, vec!["Title 3", "Title 1"]); // position order, not sort
}

#[tokio::test]
async fn create_manual_shelf_rejects_unknown_book_before_inserting() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    seed_minimal_books(&pool, 1).await;
    let owner = make_user(&pool, "owner", false).await;

    let err = create_shelf(&pool, owner, &manual_req("Bad", vec!["nope".into()]))
        .await
        .unwrap_err();
    assert!(matches!(err, ShelfError::BookNotFound));
    // The shelf row must not have been created.
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM shelves")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn add_and_remove_book_updates_membership() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    seed_minimal_books(&pool, 3).await;
    let owner = make_user(&pool, "owner", false).await;
    let shelf = create_shelf(&pool, owner, &manual_req("Picks", vec![]))
        .await
        .unwrap();

    add_books(&pool, shelf.id, &["uuid-1".into(), "uuid-2".into()], owner)
        .await
        .unwrap();
    assert_eq!(
        get_shelf(&pool, shelf.id)
            .await
            .unwrap()
            .unwrap()
            .book_count,
        2
    );

    remove_book(&pool, shelf.id, "uuid-1").await.unwrap();
    assert_eq!(
        get_shelf(&pool, shelf.id)
            .await
            .unwrap()
            .unwrap()
            .book_count,
        1
    );
}

#[tokio::test]
async fn manual_membership_survives_a_ghosted_file() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    seed_minimal_books(&pool, 1).await;
    let owner = make_user(&pool, "owner", false).await;
    let shelf = create_shelf(&pool, owner, &manual_req("Picks", vec!["uuid-1".into()]))
        .await
        .unwrap();

    // Ghost the book: drop its file row, keep the `books` row (uuid preserved).
    sqlx::query(
        "DELETE FROM book_files WHERE book_id = (SELECT id FROM books WHERE uuid = 'uuid-1')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let reloaded = get_shelf(&pool, shelf.id).await.unwrap().unwrap();
    assert_eq!(reloaded.book_count, 1, "ghosted book stays on the shelf");
    let page = shelf_page(
        &pool,
        &reloaded,
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        Viewer::default(),
    )
    .await
    .unwrap();
    assert_eq!(page.books.len(), 1);
}

#[tokio::test]
async fn create_manual_shelf_batches_book_inserts_across_the_chunk_boundary() {
    // 250 uuids forces `insert_books` through two chunks (200 + 50); this
    // must not lose, duplicate, or misorder any row at the boundary.
    const N: i64 = 250;
    let pool = init_db("sqlite::memory:").await.unwrap();
    seed_minimal_books(&pool, N).await;
    let owner = make_user(&pool, "owner", false).await;

    let uuids: Vec<String> = (1..=N).map(|i| format!("uuid-{i}")).collect();
    let shelf = create_shelf(&pool, owner, &manual_req("Big", uuids.clone()))
        .await
        .unwrap();
    assert_eq!(shelf.book_count, N);

    let page = shelf_page(
        &pool,
        &shelf,
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        Viewer::default(),
    )
    .await
    .unwrap();
    let titles: Vec<_> = page.books.iter().filter_map(|b| b.title.clone()).collect();
    let expected: Vec<_> = (1..=N).map(|i| format!("Title {i}")).collect();
    assert_eq!(
        titles, expected,
        "insertion order (== position) survives the 200-row chunk boundary"
    );
}

#[tokio::test]
async fn create_smart_shelf_batches_rule_inserts_across_the_chunk_boundary() {
    // 250 rules forces `insert_rules` through two chunks (199 + 51); this
    // must not lose, duplicate, or misorder any rule at the boundary.
    const N: usize = 250;
    let pool = init_db("sqlite::memory:").await.unwrap();
    let owner = make_user(&pool, "owner", false).await;

    let rules: Vec<ShelfRule> = (0..N).map(|i| tag_rule(&format!("tag-{i}"))).collect();
    let shelf = create_shelf(
        &pool,
        owner,
        &smart_req("Many rules", MatchMode::Any, rules),
    )
    .await
    .unwrap();

    let values: Vec<String> =
        sqlx::query_scalar("SELECT value FROM shelf_rules WHERE shelf_id = ? ORDER BY position")
            .bind(shelf.id)
            .fetch_all(&pool)
            .await
            .unwrap();
    let expected: Vec<_> = (0..N).map(|i| format!("tag-{i}")).collect();
    assert_eq!(
        values, expected,
        "rule order (== position) survives the 199-row chunk boundary"
    );
}

#[tokio::test]
async fn manual_shelves_containing_names_every_hand_picked_shelf_holding_the_book() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;
    let uuid = uuid_by_title(&pool, "Saga: Book One").await;

    let holding = create_shelf(&pool, owner, &manual_req("Picks", vec![uuid.clone()]))
        .await
        .unwrap();
    let empty = create_shelf(&pool, owner, &manual_req("Later", vec![]))
        .await
        .unwrap();

    let ids = manual_shelves_containing(&pool, owner, false, &uuid)
        .await
        .unwrap();
    assert_eq!(ids, vec![holding.id]);
    assert!(!ids.contains(&empty.id));
}

#[tokio::test]
async fn manual_shelves_containing_skips_smart_shelves() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;
    let uuid = uuid_by_title(&pool, "Saga: Book One").await;

    // A smart shelf can hold the book, but its membership is derived from a
    // rule — there is nothing for a checklist to toggle.
    create_shelf(
        &pool,
        owner,
        &smart_req("Fiction", MatchMode::Any, vec![tag_rule("fiction")]),
    )
    .await
    .unwrap();

    let ids = manual_shelves_containing(&pool, owner, false, &uuid)
        .await
        .unwrap();
    assert!(ids.is_empty());
}

#[tokio::test]
async fn manual_shelves_containing_hides_another_users_private_shelf() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;
    let stranger = make_user(&pool, "stranger", false).await;
    let uuid = uuid_by_title(&pool, "Saga: Book One").await;

    create_shelf(&pool, owner, &manual_req("Picks", vec![uuid.clone()]))
        .await
        .unwrap();

    let ids = manual_shelves_containing(&pool, stranger, false, &uuid)
        .await
        .unwrap();
    assert!(ids.is_empty());
}

#[tokio::test]
async fn manual_shelves_containing_returns_nothing_for_an_unknown_uuid() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;

    let ids = manual_shelves_containing(&pool, owner, false, "not-a-book")
        .await
        .unwrap();
    assert!(ids.is_empty());
}

#[tokio::test]
async fn smart_shelves_containing_names_every_smart_shelf_matching_the_book() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;
    let uuid = uuid_by_title(&pool, "Saga: Book One").await;

    let by_tag = create_shelf(
        &pool,
        owner,
        &smart_req("Fiction", MatchMode::Any, vec![tag_rule("fiction")]),
    )
    .await
    .unwrap();
    let by_other_tag = create_shelf(
        &pool,
        owner,
        &smart_req("Classics", MatchMode::Any, vec![tag_rule("classic")]),
    )
    .await
    .unwrap();

    let ids = smart_shelves_containing(&pool, owner, false, &uuid)
        .await
        .unwrap();
    assert_eq!(ids, vec![by_tag.id, by_other_tag.id]);
}

#[tokio::test]
async fn smart_shelves_containing_skips_a_smart_shelf_the_book_does_not_match() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;
    let uuid = uuid_by_title(&pool, "Other Story").await;

    create_shelf(
        &pool,
        owner,
        &smart_req("Fiction", MatchMode::Any, vec![tag_rule("fiction")]),
    )
    .await
    .unwrap();

    let ids = smart_shelves_containing(&pool, owner, false, &uuid)
        .await
        .unwrap();
    assert!(ids.is_empty());
}

#[tokio::test]
async fn smart_shelves_containing_never_returns_a_hand_picked_shelf() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;
    let uuid = uuid_by_title(&pool, "Saga: Book One").await;

    create_shelf(&pool, owner, &manual_req("Picks", vec![uuid.clone()]))
        .await
        .unwrap();

    let ids = smart_shelves_containing(&pool, owner, false, &uuid)
        .await
        .unwrap();
    assert!(ids.is_empty());
}

#[tokio::test]
async fn smart_shelves_containing_hides_another_users_private_smart_shelf_from_a_non_admin() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;
    let stranger = make_user(&pool, "stranger", false).await;
    let uuid = uuid_by_title(&pool, "Saga: Book One").await;

    create_shelf(
        &pool,
        owner,
        &smart_req("Fiction", MatchMode::Any, vec![tag_rule("fiction")]),
    )
    .await
    .unwrap();

    let ids = smart_shelves_containing(&pool, stranger, false, &uuid)
        .await
        .unwrap();
    assert!(ids.is_empty());
}

#[tokio::test]
async fn smart_shelves_containing_shows_another_users_private_smart_shelf_to_an_admin() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;
    let admin = make_user(&pool, "admin", true).await;
    let uuid = uuid_by_title(&pool, "Saga: Book One").await;

    let shelf = create_shelf(
        &pool,
        owner,
        &smart_req("Fiction", MatchMode::Any, vec![tag_rule("fiction")]),
    )
    .await
    .unwrap();

    let ids = smart_shelves_containing(&pool, admin, true, &uuid)
        .await
        .unwrap();
    assert_eq!(ids, vec![shelf.id]);
}

#[tokio::test]
async fn smart_shelves_containing_shows_another_users_public_smart_shelf_to_a_reader() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;
    let reader = make_user(&pool, "reader", false).await;
    let uuid = uuid_by_title(&pool, "Saga: Book One").await;

    let shelf = create_shelf(
        &pool,
        owner,
        &CreateShelfRequest {
            visibility: Visibility::Public,
            ..smart_req("Fiction", MatchMode::Any, vec![tag_rule("fiction")])
        },
    )
    .await
    .unwrap();

    let ids = smart_shelves_containing(&pool, reader, false, &uuid)
        .await
        .unwrap();
    assert_eq!(ids, vec![shelf.id]);
}

#[tokio::test]
async fn smart_shelves_containing_returns_nothing_for_an_unknown_uuid() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;
    create_shelf(
        &pool,
        owner,
        &smart_req("Fiction", MatchMode::Any, vec![tag_rule("fiction")]),
    )
    .await
    .unwrap();

    let ids = smart_shelves_containing(&pool, owner, false, "not-a-book")
        .await
        .unwrap();
    assert!(ids.is_empty());
}

#[tokio::test]
async fn smart_shelves_containing_evaluates_a_rule_for_the_shelf_owner_not_the_viewer() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;
    let reader = make_user(&pool, "reader", false).await;
    let saga = uuid_by_title(&pool, "Saga: Book One").await;
    let standalone = uuid_by_title(&pool, "Standalone").await;
    finish_book(&pool, owner, &saga).await;
    finish_book(&pool, reader, &standalone).await;
    let finished = ShelfRule {
        field: RuleField::Status,
        op: RuleOp::Is,
        value: "finished".into(),
    };
    let shelf = create_shelf(
        &pool,
        owner,
        &CreateShelfRequest {
            visibility: Visibility::Public,
            ..smart_req("Finished", MatchMode::Any, vec![finished])
        },
    )
    .await
    .unwrap();

    let owners_book = smart_shelves_containing(&pool, reader, false, &saga)
        .await
        .unwrap();
    let readers_book = smart_shelves_containing(&pool, reader, false, &standalone)
        .await
        .unwrap();

    assert_eq!(owners_book, vec![shelf.id]);
    assert!(readers_book.is_empty());
}

#[tokio::test]
async fn smart_shelves_containing_names_the_viewers_own_shelf_past_a_full_window_of_others() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let admin = make_user(&pool, "admin", true).await;
    let other = make_user(&pool, "other", false).await;
    let uuid = uuid_by_title(&pool, "Saga: Book One").await;
    seed_smart_shelves_raw(&pool, other, LIST_SHELVES_LIMIT + 1).await;
    let mine = create_shelf(
        &pool,
        admin,
        &smart_req("Fiction", MatchMode::Any, vec![tag_rule("fiction")]),
    )
    .await
    .unwrap();
    sqlx::query("UPDATE shelves SET position = ? WHERE id = ?")
        .bind(LIST_SHELVES_LIMIT + 10)
        .bind(mine.id)
        .execute(&pool)
        .await
        .unwrap();

    let ids = smart_shelves_containing(&pool, admin, true, &uuid)
        .await
        .unwrap();

    assert_eq!(ids, vec![mine.id]);
}

#[tokio::test]
async fn smart_shelves_containing_propagates_db_error_when_pool_is_closed() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    pool.close().await;
    let err = smart_shelves_containing(&pool, 1, false, "any-uuid")
        .await
        .unwrap_err();
    assert!(matches!(err, ShelfError::Sqlx(_)));
}

#[tokio::test]
async fn smart_shelves_containing_rejects_a_stored_rule_its_field_cannot_take() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;
    let uuid = uuid_by_title(&pool, "Saga: Book One").await;
    create_shelf(
        &pool,
        owner,
        &smart_req("Fiction", MatchMode::Any, vec![tag_rule("fiction")]),
    )
    .await
    .unwrap();
    sqlx::query("UPDATE shelf_rules SET op = 'gte'")
        .execute(&pool)
        .await
        .unwrap();

    let err = smart_shelves_containing(&pool, owner, false, &uuid)
        .await
        .unwrap_err();
    assert!(matches!(err, ShelfError::InvalidRule(_)));
}
