//! The remaining smart-shelf rule fields: date-added against the epoch
//! column, author and series matching, membership updating as books
//! appear, the rating and read-status rules resolving against the shelf
//! owner, and `preview_rule`'s matched/total report.

use omnibus_shared::{MatchMode, RuleField, RuleOp, ShelfRule, SortDir, SortKey, ViewFilters};

use super::super::*;
use super::{make_user, smart_req, tag_rule, uuid_by_title};
use crate::pool::init_db;
use crate::test_support::{indexed, seed_discovery_fixture, seed_minimal_books, CoversTempDir};

#[tokio::test]
async fn smart_shelf_date_added_rules_match_epoch_column() {
    // `books.timestamp` is INTEGER unix-seconds (migration 0038); the date-rule
    // SQL must compare it as an epoch (`date(col,'unixepoch')`, numeric
    // `strftime('%s',…)`) rather than as a TEXT date, or every match silently
    // returns nothing.
    let pool = init_db("sqlite::memory:").await.unwrap();
    seed_minimal_books(&pool, 2).await;
    let owner = make_user(&pool, "owner", false).await;
    sqlx::query(
        "UPDATE books SET timestamp = strftime('%s','2024-06-15 00:00:00') \
                 WHERE id = (SELECT MIN(id) FROM books)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE books SET timestamp = strftime('%s','2020-01-01 00:00:00') \
                 WHERE id = (SELECT MAX(id) FROM books)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let date_rule = |op, value: &str| ShelfRule {
        field: RuleField::DateAdded,
        op,
        value: value.into(),
    };

    // `After` an absolute date → only the 2024 book.
    let after = create_shelf(
        &pool,
        owner,
        &smart_req(
            "After",
            MatchMode::Any,
            vec![date_rule(RuleOp::After, "2024-01-01")],
        ),
    )
    .await
    .unwrap();
    assert_eq!(
        after.book_count, 1,
        "only the 2024-added book is after 2024-01-01"
    );

    // `Between` a calendar window → the same single book.
    let between = create_shelf(
        &pool,
        owner,
        &smart_req(
            "June",
            MatchMode::Any,
            vec![date_rule(RuleOp::Between, "2024-06-01..2024-06-30")],
        ),
    )
    .await
    .unwrap();
    assert_eq!(
        between.book_count, 1,
        "only the mid-June book is in the window"
    );

    // `InLast 1d` exercises the numeric epoch comparison — both books are years
    // old, so it must match none (a TEXT/INTEGER mismatch here would misbehave).
    let recent = create_shelf(
        &pool,
        owner,
        &smart_req(
            "Recent",
            MatchMode::Any,
            vec![date_rule(RuleOp::InLast, "1d")],
        ),
    )
    .await
    .unwrap();
    assert_eq!(recent.book_count, 0, "no book was added in the last day");
}

#[tokio::test]
async fn smart_shelf_matches_author_by_name_case_insensitively() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;

    // "Ada Lovelace" authored 3 of the 4 fixture books. A lowercase value must
    // still match — regression: `author is` used to demand a numeric id, so a
    // typed name (any case) matched nothing.
    let rule = ShelfRule {
        field: RuleField::Author,
        op: RuleOp::Is,
        value: "ada lovelace".into(),
    };
    let shelf = create_shelf(
        &pool,
        owner,
        &smart_req("By Ada", MatchMode::Any, vec![rule]),
    )
    .await
    .unwrap();
    assert_eq!(shelf.book_count, 3);
}

#[tokio::test]
async fn smart_shelf_matches_series_starts_with() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;

    // Series "Saga" holds two books; a `starts with` prefix matches both.
    let rule = ShelfRule {
        field: RuleField::Series,
        op: RuleOp::StartsWith,
        value: "Sag".into(),
    };
    let shelf = create_shelf(
        &pool,
        owner,
        &smart_req("Saga-ish", MatchMode::Any, vec![rule]),
    )
    .await
    .unwrap();
    assert_eq!(shelf.book_count, 2);
}

#[tokio::test]
async fn smart_shelf_updates_when_a_qualifying_book_appears() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;
    let shelf = create_shelf(
        &pool,
        owner,
        &smart_req("Essays", MatchMode::Any, vec![tag_rule("essay")]),
    )
    .await
    .unwrap();
    assert_eq!(shelf.book_count, 1);

    // "Standalone" already carries "essay"; tag a second book and re-read.
    let other = sqlx::query_scalar::<_, i64>("SELECT id FROM books WHERE title = 'Other Story'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let tag_id: i64 = sqlx::query_scalar("SELECT id FROM tags WHERE name = 'essay'")
        .fetch_one(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO books_tags_link (book, tag) VALUES (?, ?)")
        .bind(other)
        .bind(tag_id)
        .execute(&pool)
        .await
        .unwrap();

    let reloaded = get_shelf(&pool, shelf.id).await.unwrap().unwrap();
    assert_eq!(reloaded.book_count, 2);
}

#[tokio::test]
async fn rating_rule_resolves_against_shelf_owner() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;
    let other = make_user(&pool, "other", false).await;
    let saga = uuid_by_title(&pool, "Saga: Book One").await;

    // Owner rates it 5★; the other user rates a different book 5★.
    sqlx::query("INSERT INTO user_ratings (user_id, book_uuid, half_stars) VALUES (?, ?, 10)")
        .bind(owner)
        .bind(&saga)
        .execute(&pool)
        .await
        .unwrap();
    let standalone = uuid_by_title(&pool, "Standalone").await;
    sqlx::query("INSERT INTO user_ratings (user_id, book_uuid, half_stars) VALUES (?, ?, 10)")
        .bind(other)
        .bind(&standalone)
        .execute(&pool)
        .await
        .unwrap();

    let rule = ShelfRule {
        field: RuleField::Rating,
        op: RuleOp::Gte,
        value: "4".into(),
    };
    let shelf = create_shelf(
        &pool,
        owner,
        &smart_req("Top rated", MatchMode::Any, vec![rule]),
    )
    .await
    .unwrap();
    // Only the owner's 5★ book qualifies — the other user's rating is invisible.
    assert_eq!(shelf.book_count, 1);
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
    assert_eq!(page.books[0].title.as_deref(), Some("Saga: Book One"));
}

#[tokio::test]
async fn status_rule_resolves_against_shelf_owner() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;
    let other = make_user(&pool, "other", false).await;
    let saga = uuid_by_title(&pool, "Saga: Book One").await;
    let standalone = uuid_by_title(&pool, "Standalone").await;

    // Owner finishes Saga; the other user finishes Standalone.
    let finish = |user: i64, uuid: String| {
        let pool = pool.clone();
        async move {
            sqlx::query(
                "INSERT INTO book_read_status (user_id, book_uuid, status, finished_at)
                 VALUES (?, ?, 'finished', strftime('%s','now'))",
            )
            .bind(user)
            .bind(uuid)
            .execute(&pool)
            .await
            .unwrap();
        }
    };
    finish(owner, saga).await;
    finish(other, standalone).await;

    let rule = ShelfRule {
        field: RuleField::Status,
        op: RuleOp::Is,
        value: "finished".into(),
    };
    let shelf = create_shelf(
        &pool,
        owner,
        &smart_req("Finished", MatchMode::Any, vec![rule]),
    )
    .await
    .unwrap();
    // Only the owner's finished book qualifies — the other user's is invisible.
    assert_eq!(shelf.book_count, 1);
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
    assert_eq!(page.books[0].title.as_deref(), Some("Saga: Book One"));
}

#[tokio::test]
async fn unread_status_rule_matches_books_with_no_row() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;
    let saga = uuid_by_title(&pool, "Saga: Book One").await;

    // Finish exactly one book; every other fixture book is unread (no row).
    sqlx::query(
        "INSERT INTO book_read_status (user_id, book_uuid, status, finished_at)
         VALUES (?, ?, 'finished', strftime('%s','now'))",
    )
    .bind(owner)
    .bind(&saga)
    .execute(&pool)
    .await
    .unwrap();

    let rule = ShelfRule {
        field: RuleField::Status,
        op: RuleOp::Is,
        value: "unread".into(),
    };
    let shelf = create_shelf(
        &pool,
        owner,
        &smart_req("To read", MatchMode::Any, vec![rule]),
    )
    .await
    .unwrap();
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
    // The finished book is excluded; the rest (no row) all count as unread.
    assert!(shelf.book_count >= 1);
    assert!(
        !page
            .books
            .iter()
            .any(|b| b.title.as_deref() == Some("Saga: Book One")),
        "finished book must not appear in the unread shelf"
    );
}

#[tokio::test]
async fn preview_rule_reports_matched_and_total() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;
    let preview = preview_rule(&pool, owner, MatchMode::Any, &[tag_rule("fiction")])
        .await
        .unwrap();
    assert_eq!(preview.matched, 2);
    assert_eq!(preview.total, 4);
    assert_eq!(preview.sample.len(), 2);
}

/// Two books by one author, stored the way a mixed library holds them: one
/// scanned under the display name, one under the file-as form and corrected
/// through a creators override. Returns `(scanned, corrected)` uuids.
async fn seed_one_author_two_spellings(pool: &sqlx::SqlitePool, editor: i64) -> (String, String) {
    crate::sync::replace_books(
        pool,
        "/lib",
        vec![
            indexed(
                "martian.epub",
                Some("The Martian"),
                &["Andy Weir"],
                &[],
                None,
                None,
            ),
            indexed(
                "phm.epub",
                Some("Project Hail Mary"),
                &["Weir, Andy"],
                &[],
                None,
                None,
            ),
        ],
    )
    .await
    .unwrap();
    let corrected = uuid_by_title(pool, "Project Hail Mary").await;
    let overrides = omnibus_shared::MetadataOverrides {
        creators: Some(vec![omnibus_shared::Contributor {
            name: "Andy Weir".into(),
            file_as: Some("Weir, Andy".into()),
            role: Some("aut".into()),
            ..Default::default()
        }]),
        ..Default::default()
    };
    crate::upsert_metadata_overrides(pool, &corrected, &overrides, false, editor)
        .await
        .unwrap();
    (uuid_by_title(pool, "The Martian").await, corrected)
}

fn text_rule(field: RuleField, value: &str) -> ShelfRule {
    ShelfRule {
        field,
        op: RuleOp::Is,
        value: value.into(),
    }
}

#[tokio::test]
async fn smart_shelf_author_rule_holds_every_book_the_authors_index_credits() {
    let _covers = CoversTempDir::new("shelf_author_effective");
    let pool = init_db("sqlite::memory:").await.unwrap();
    let owner = make_user(&pool, "owner", false).await;
    seed_one_author_two_spellings(&pool, owner).await;

    let index = crate::browse::list_authors(&pool, &["/lib"]).await.unwrap();
    let credited = index.iter().find(|a| a.name == "Andy Weir").unwrap();
    assert_eq!(credited.book_count, 2);
    assert!(!index.iter().any(|a| a.name == "Weir, Andy"));

    let shelf = create_shelf(
        &pool,
        owner,
        &smart_req(
            "Weir",
            MatchMode::Any,
            vec![text_rule(RuleField::Author, "Andy Weir")],
        ),
    )
    .await
    .unwrap();
    assert_eq!(shelf.book_count, 2, "the shelf agrees with the index");

    // The override replaced the file-as credit; a rule naming it finds nothing.
    let stale = create_shelf(
        &pool,
        owner,
        &smart_req(
            "Stale",
            MatchMode::Any,
            vec![text_rule(RuleField::Author, "Weir, Andy")],
        ),
    )
    .await
    .unwrap();
    assert_eq!(stale.book_count, 0);
}

#[tokio::test]
async fn smart_shelf_series_rule_matches_the_series_an_override_names() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;
    // Rehome "Other Story" from Pioneers into Saga, and clear Saga's second
    // book out of any series.
    for (title, series) in [("Other Story", "Saga"), ("Saga: Book Two", "")] {
        let uuid = uuid_by_title(&pool, title).await;
        let overrides = omnibus_shared::MetadataOverrides {
            series: Some(series.into()),
            ..Default::default()
        };
        crate::upsert_metadata_overrides(&pool, &uuid, &overrides, false, owner)
            .await
            .unwrap();
    }

    let saga = create_shelf(
        &pool,
        owner,
        &smart_req(
            "Saga",
            MatchMode::Any,
            vec![text_rule(RuleField::Series, "Saga")],
        ),
    )
    .await
    .unwrap();
    let page = shelf_page(
        &pool,
        &saga,
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        Viewer::default(),
    )
    .await
    .unwrap();
    let titles: Vec<_> = page.books.iter().filter_map(|b| b.title.clone()).collect();
    assert_eq!(titles, ["Other Story", "Saga: Book One"]);

    let pioneers = create_shelf(
        &pool,
        owner,
        &smart_req(
            "Pioneers",
            MatchMode::Any,
            vec![text_rule(RuleField::Series, "Pioneers")],
        ),
    )
    .await
    .unwrap();
    assert_eq!(pioneers.book_count, 0, "the scanned series was replaced");
}

#[tokio::test]
async fn shelf_page_orders_the_metadata_axes_like_the_library() {
    let (pool, _covers) = seed_discovery_fixture().await;
    let owner = make_user(&pool, "owner", false).await;
    let retitle = [
        ("Standalone", r#"{"title":"Aardvark","series":"Zed"}"#),
        (
            "Saga: Book Two",
            r#"{"title":"","series":"","series_index":""}"#,
        ),
    ];
    for (title, json) in retitle {
        sqlx::query("INSERT INTO metadata_overrides (book_uuid, overrides) VALUES (?, ?)")
            .bind(uuid_by_title(&pool, title).await)
            .bind(json)
            .execute(&pool)
            .await
            .unwrap();
    }
    let everything = ShelfRule {
        field: RuleField::Format,
        op: RuleOp::Includes,
        value: "EPUB".into(),
    };
    let shelf = create_shelf(
        &pool,
        owner,
        &smart_req("All", MatchMode::Any, vec![everything]),
    )
    .await
    .unwrap();

    for sort in [SortKey::Title, SortKey::Author, SortKey::Series] {
        for dir in [SortDir::Asc, SortDir::Desc] {
            let shelf_ids: Vec<i64> = shelf_page(
                &pool,
                &shelf,
                sort,
                dir,
                &ViewFilters::default(),
                Viewer::default(),
            )
            .await
            .unwrap()
            .books
            .iter()
            .map(|b| b.id)
            .collect();
            let library_ids: Vec<i64> = crate::books::list_books_page(
                &pool,
                &["/lib"],
                sort,
                dir,
                &ViewFilters::default(),
                Viewer::default(),
                &[],
                None,
                50,
            )
            .await
            .unwrap()
            .books
            .iter()
            .map(|b| b.id)
            .collect();
            assert_eq!(shelf_ids, library_ids, "{sort:?} {dir:?}");
        }
    }
}
