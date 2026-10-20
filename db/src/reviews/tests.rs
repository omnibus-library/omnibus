//! Unit tests for `reviews`: field-level patching (absent vs cleared), the
//! `rated_at` rule, the empty-review delete, notes staying with their author,
//! the others ordering, the two-rating summary threshold, image sweeping, and
//! the `BookNotFound` / pool-closed failures.

use omnibus_shared::ReviewPatch;

use super::*;
use crate::init_db;
use crate::journal_images::{self, journal_images_dir};
use crate::test_support::{count_rows, seed_synced_ebook, seed_user, EnvVarGuard};

async fn setup() -> (SqlitePool, i64, String) {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "alice").await;
    let uuid = seed_synced_ebook(&pool, "a.epub", "Book A", "Author").await;
    (pool, user, uuid)
}

fn stars(value: f32) -> ReviewPatch {
    ReviewPatch {
        stars: Some(Some(value)),
        ..Default::default()
    }
}

fn text(body: &str) -> ReviewPatch {
    ReviewPatch {
        body_md: Some(Some(body.to_string())),
        ..Default::default()
    }
}

fn notes(body: &str) -> ReviewPatch {
    ReviewPatch {
        notes_md: Some(Some(body.to_string())),
        ..Default::default()
    }
}

async fn set_rated_at(pool: &SqlitePool, user: i64, ts: i64) {
    sqlx::query("UPDATE reviews SET rated_at = ?1, updated_at = ?1 WHERE user_id = ?2")
        .bind(ts)
        .bind(user)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn update_review_creates_a_review_with_rendered_text_and_notes() {
    let (pool, user, uuid) = setup().await;
    let patch = ReviewPatch {
        stars: Some(Some(4.5)),
        body_md: Some(Some("**Loved** it, ||Gandalf lives||".into())),
        notes_md: Some(Some("lend to *Sam*".into())),
        spoiler: Some(true),
    };

    let review = update_review(&pool, user, &uuid, &patch)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(review.book_uuid, uuid);
    assert_eq!(review.stars, Some(4.5));
    assert!(review.spoiler);
    let body_html = review.body_html.unwrap();
    assert!(body_html.contains("<strong>Loved</strong>"), "{body_html}");
    assert!(
        !body_html.contains("||"),
        "spoiler markup renders: {body_html}"
    );
    assert!(review.notes_html.unwrap().contains("<em>Sam</em>"));
    assert!(review.rated_at.is_some());
    assert!(review.created_at_iso.is_some() && review.rated_at_iso.is_some());
}

#[tokio::test]
async fn update_review_leaves_fields_the_patch_omits_untouched() {
    let (pool, user, uuid) = setup().await;
    update_review(&pool, user, &uuid, &stars(3.0))
        .await
        .unwrap();

    let review = update_review(&pool, user, &uuid, &text("Solid"))
        .await
        .unwrap()
        .unwrap();

    assert_eq!(review.stars, Some(3.0));
    assert_eq!(review.body_md.as_deref(), Some("Solid"));
}

#[tokio::test]
async fn update_review_moves_rated_at_only_when_the_stars_change() {
    let (pool, user, uuid) = setup().await;
    update_review(&pool, user, &uuid, &stars(3.0))
        .await
        .unwrap();
    set_rated_at(&pool, user, 100).await;

    let after_text = update_review(&pool, user, &uuid, &text("Edited"))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(after_text.rated_at, Some(100), "a text edit keeps rated_at");
    assert!(after_text.updated_at > 100, "but moves updated_at");

    let same = update_review(&pool, user, &uuid, &stars(3.0))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        same.rated_at,
        Some(100),
        "re-sending the same stars keeps it"
    );

    let changed = update_review(&pool, user, &uuid, &stars(4.0))
        .await
        .unwrap()
        .unwrap();
    assert!(changed.rated_at.unwrap() > 100, "new stars move rated_at");
}

#[tokio::test]
async fn update_review_clearing_the_stars_keeps_text_and_notes() {
    let (pool, user, uuid) = setup().await;
    let patch = ReviewPatch {
        stars: Some(Some(2.0)),
        body_md: Some(Some("Meh".into())),
        notes_md: Some(Some("private".into())),
        ..Default::default()
    };
    update_review(&pool, user, &uuid, &patch).await.unwrap();

    let cleared = ReviewPatch {
        stars: Some(None),
        ..Default::default()
    };
    let review = update_review(&pool, user, &uuid, &cleared)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(review.stars, None);
    assert_eq!(review.rated_at, None);
    assert_eq!(review.body_md.as_deref(), Some("Meh"));
    assert_eq!(review.notes_md.as_deref(), Some("private"));
}

#[tokio::test]
async fn update_review_deletes_the_row_when_the_patch_empties_it() {
    let (pool, user, uuid) = setup().await;
    update_review(&pool, user, &uuid, &stars(5.0))
        .await
        .unwrap();

    let cleared = ReviewPatch {
        stars: Some(None),
        ..Default::default()
    };
    let review = update_review(&pool, user, &uuid, &cleared).await.unwrap();

    assert_eq!(review, None);
    assert_eq!(count_rows(&pool, "SELECT COUNT(*) FROM reviews").await, 0);
}

#[tokio::test]
async fn update_review_treats_blank_text_as_cleared() {
    let (pool, user, uuid) = setup().await;
    update_review(&pool, user, &uuid, &text("Draft thoughts"))
        .await
        .unwrap();

    let review = update_review(&pool, user, &uuid, &text("   \n"))
        .await
        .unwrap();

    assert_eq!(review, None, "text was all the review held");
}

#[tokio::test]
async fn update_review_writes_nothing_for_an_empty_patch_on_an_unreviewed_book() {
    let (pool, user, uuid) = setup().await;

    let review = update_review(&pool, user, &uuid, &ReviewPatch::default())
        .await
        .unwrap();

    assert_eq!(review, None);
    assert_eq!(count_rows(&pool, "SELECT COUNT(*) FROM reviews").await, 0);
}

#[tokio::test]
async fn update_review_resolves_a_merged_uuid_to_the_surviving_book() {
    let (pool, user, uuid) = setup().await;
    let book_id: i64 = sqlx::query_scalar("SELECT id FROM books WHERE uuid = ?")
        .bind(&uuid)
        .fetch_one(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO merged_uuids (uuid, book_id, format, library_path)
         VALUES ('merged-away', ?, 'M4B', '/audio')",
    )
    .bind(book_id)
    .execute(&pool)
    .await
    .unwrap();

    let review = update_review(&pool, user, "merged-away", &stars(4.0))
        .await
        .unwrap()
        .unwrap();

    assert_eq!(review.book_uuid, uuid);
}

#[tokio::test]
async fn update_review_returns_book_not_found_for_an_unknown_uuid() {
    let (pool, user, _) = setup().await;

    let err = update_review(&pool, user, "nope", &stars(4.0))
        .await
        .unwrap_err();

    assert!(matches!(err, ReviewError::BookNotFound));
}

#[tokio::test]
async fn update_review_propagates_db_error_when_pool_is_closed() {
    let (pool, user, uuid) = setup().await;
    pool.close().await;

    let err = update_review(&pool, user, &uuid, &stars(4.0))
        .await
        .unwrap_err();

    assert!(matches!(err, ReviewError::Sqlx(_)));
}

#[tokio::test]
async fn update_review_sweeps_an_image_dropped_from_the_notes() {
    let tmp = tempfile::tempdir().unwrap();
    let _env = EnvVarGuard::set_os("OMNIBUS_JOURNAL_IMAGES_DIR", Some(tmp.path().as_os_str()));
    let (pool, user, uuid) = setup().await;
    let name = journal_images::write_journal_image("image/png", b"bytes").unwrap();
    let embed = format!("![img]({}{name})", markdown::IMAGE_URL_PREFIX);
    update_review(&pool, user, &uuid, &notes(&embed))
        .await
        .unwrap();

    update_review(&pool, user, &uuid, &notes("no picture now"))
        .await
        .unwrap();

    assert!(!journal_images_dir().join(&name).exists());
}

#[tokio::test]
async fn get_book_reviews_shows_notes_to_their_author_and_never_lists_a_notes_only_review() {
    let (pool, alice, uuid) = setup().await;
    let bob = seed_user(&pool, "bob").await;
    update_review(&pool, alice, &uuid, &notes("mine alone"))
        .await
        .unwrap();
    update_review(&pool, bob, &uuid, &notes("bob's secret"))
        .await
        .unwrap();

    let reviews = get_book_reviews(&pool, alice, &uuid).await.unwrap();

    assert_eq!(
        reviews.mine.unwrap().notes_md.as_deref(),
        Some("mine alone")
    );
    assert!(reviews.others.is_empty(), "bob's review holds only notes");
}

#[tokio::test]
async fn get_book_reviews_lists_text_reviews_newest_first_then_bare_ratings() {
    let (pool, viewer, uuid) = setup().await;
    let mut readers = Vec::new();
    for name in ["old_text", "new_text", "bare"] {
        readers.push(seed_user(&pool, name).await);
    }
    update_review(&pool, readers[0], &uuid, &text("first"))
        .await
        .unwrap();
    update_review(&pool, readers[1], &uuid, &text("second"))
        .await
        .unwrap();
    update_review(&pool, readers[2], &uuid, &stars(4.0))
        .await
        .unwrap();
    for (reader, created) in readers.iter().zip([100, 200, 300]) {
        sqlx::query("UPDATE reviews SET created_at = ? WHERE user_id = ?")
            .bind(created)
            .bind(reader)
            .execute(&pool)
            .await
            .unwrap();
    }

    let reviews = get_book_reviews(&pool, viewer, &uuid).await.unwrap();

    let order: Vec<i64> = reviews.others.iter().map(|r| r.user_id).collect();
    assert_eq!(order, vec![readers[1], readers[0], readers[2]]);
}

#[tokio::test]
async fn get_book_reviews_summarizes_only_from_two_ratings_including_the_viewers() {
    let (pool, alice, uuid) = setup().await;
    let bob = seed_user(&pool, "bob").await;
    update_review(&pool, alice, &uuid, &stars(4.0))
        .await
        .unwrap();
    update_review(&pool, bob, &uuid, &text("no stars from me"))
        .await
        .unwrap();
    assert_eq!(
        get_book_reviews(&pool, alice, &uuid).await.unwrap().summary,
        None
    );

    update_review(&pool, bob, &uuid, &stars(3.0)).await.unwrap();
    let summary = get_book_reviews(&pool, alice, &uuid)
        .await
        .unwrap()
        .summary
        .unwrap();

    assert_eq!(summary.ratings, 2);
    assert_eq!(summary.average_stars, 3.5);
    assert_eq!(summary.buckets.len(), 10);
    let filled: Vec<(i64, i64)> = summary
        .buckets
        .iter()
        .filter(|b| b.readers > 0)
        .map(|b| (b.half_stars, b.readers))
        .collect();
    assert_eq!(filled, vec![(6, 1), (8, 1)]);
}

#[tokio::test]
async fn get_book_reviews_returns_book_not_found_for_an_unknown_uuid() {
    let (pool, user, _) = setup().await;

    let err = get_book_reviews(&pool, user, "nope").await.unwrap_err();

    assert!(matches!(err, ReviewError::BookNotFound));
}

#[tokio::test]
async fn get_book_reviews_propagates_db_error_when_pool_is_closed() {
    let (pool, user, uuid) = setup().await;
    pool.close().await;

    let err = get_book_reviews(&pool, user, &uuid).await.unwrap_err();

    assert!(matches!(err, ReviewError::Sqlx(_)));
}

#[tokio::test]
async fn get_review_returns_none_for_an_unknown_or_unreviewed_book() {
    let (pool, user, uuid) = setup().await;

    assert_eq!(get_review(&pool, user, &uuid).await.unwrap(), None);
    assert_eq!(get_review(&pool, user, "nope").await.unwrap(), None);
}

#[tokio::test]
async fn delete_review_removes_stars_text_and_notes_together() {
    let (pool, user, uuid) = setup().await;
    let patch = ReviewPatch {
        stars: Some(Some(2.0)),
        body_md: Some(Some("text".into())),
        notes_md: Some(Some("notes".into())),
        ..Default::default()
    };
    update_review(&pool, user, &uuid, &patch).await.unwrap();

    delete_review(&pool, user, &uuid).await.unwrap();

    assert_eq!(get_review(&pool, user, &uuid).await.unwrap(), None);
}

#[tokio::test]
async fn delete_review_is_a_noop_when_absent_or_the_book_is_unknown() {
    let (pool, user, uuid) = setup().await;

    delete_review(&pool, user, &uuid).await.unwrap();
    delete_review(&pool, user, "nope").await.unwrap();
}

#[tokio::test]
async fn delete_review_propagates_db_error_when_pool_is_closed() {
    let (pool, user, uuid) = setup().await;
    pool.close().await;

    let err = delete_review(&pool, user, &uuid).await.unwrap_err();

    assert!(matches!(err, ReviewError::Sqlx(_)));
}

#[tokio::test]
async fn migration_0104_carries_a_rating_over_as_a_stars_only_review() {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");
    for m in MIGRATOR.iter().filter(|m| m.version < 104) {
        sqlx::raw_sql(&m.sql).execute(&pool).await.unwrap();
    }
    sqlx::raw_sql(
        "INSERT INTO users (id, username, password_hash, is_admin) VALUES (1, 'u', 'x', 1);
         INSERT INTO user_ratings (user_id, book_uuid, half_stars, updated_at)
              VALUES (1, 'book', 7, 1234);",
    )
    .execute(&pool)
    .await
    .unwrap();

    let m = MIGRATOR.iter().find(|m| m.version == 104).unwrap();
    sqlx::raw_sql(&m.sql).execute(&pool).await.unwrap();

    let row: (i64, Option<String>, i64, i64, i64, i64) = sqlx::query_as(
        "SELECT half_stars, body_md, spoiler, rated_at, created_at, updated_at FROM reviews",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row, (7, None, 0, 1234, 1234, 1234));
}

#[tokio::test]
async fn update_review_editing_only_the_notes_moves_no_timestamp_others_see() {
    let (pool, user, uuid) = setup().await;
    update_review(&pool, user, &uuid, &stars(4.0))
        .await
        .unwrap();
    sqlx::query("UPDATE reviews SET rated_at = 100, created_at = 100, updated_at = 100")
        .execute(&pool)
        .await
        .unwrap();

    let review = update_review(&pool, user, &uuid, &notes("just for me"))
        .await
        .unwrap()
        .unwrap();

    assert_eq!(
        (review.rated_at, review.created_at, review.updated_at),
        (Some(100), 100, 100)
    );
}

#[tokio::test]
async fn update_review_restarts_created_at_when_a_notes_only_review_gains_text() {
    let (pool, user, uuid) = setup().await;
    update_review(&pool, user, &uuid, &notes("private first"))
        .await
        .unwrap();
    sqlx::query("UPDATE reviews SET created_at = 100, updated_at = 100")
        .execute(&pool)
        .await
        .unwrap();

    let review = update_review(&pool, user, &uuid, &text("now public"))
        .await
        .unwrap()
        .unwrap();

    assert!(review.created_at > 100, "the public review starts now");
    assert!(review.updated_at > 100);
}
