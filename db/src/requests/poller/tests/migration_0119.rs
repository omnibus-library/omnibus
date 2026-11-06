//! Migration 0119 on a database that holds downloads tagged by an earlier version: the tag
//! survives as `legacy_tag`, only unfinished downloads are handed over again, and the poller
//! finds each tagged download by hash once. Also what it does to an install's category.

use crate::requests::test_support::tag;

use super::*;

/// Version of `0119_book_requests_client_hash.sql`.
const VERSION: i64 = 119;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// A pool migrated to just below 0119, with reader 1.
async fn pool_before() -> SqlitePool {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    for m in MIGRATOR.iter().filter(|m| m.version < VERSION) {
        sqlx::raw_sql(&m.sql).execute(&pool).await.unwrap();
    }
    sqlx::raw_sql("INSERT INTO users (id, username, password_hash) VALUES (1, 'ada', '!x')")
        .execute(&pool)
        .await
        .unwrap();
    pool
}

async fn apply_migration(pool: &SqlitePool) {
    let m = MIGRATOR.iter().find(|m| m.version == VERSION).unwrap();
    sqlx::raw_sql(&m.sql).execute(pool).await.unwrap();
}

/// A request 1 in `state`, tagged as an earlier version tagged it, with `extra` set.
async fn tagged_request(pool: &SqlitePool, state: &str, extra: &str) {
    sqlx::raw_sql(&format!(
        "INSERT INTO book_requests (id, book_uuid, user_id, kind, state, client_tag)
         VALUES (1, 'b1', 1, 'ebook', '{state}', '{}');
         UPDATE book_requests SET {extra} WHERE id = 1;",
        tag(1)
    ))
    .execute(pool)
    .await
    .unwrap();
}

/// A client that carries request 1's old tag on the download with hash `hash(1)`.
fn client_with_the_tagged_download(progress: f64) -> StubClient {
    StubClient::new()
        .with_status(&hash(1), progress, "downloading")
        .with_tag(&hash(1), &tag(1))
}

mod the_rows {
    use super::*;

    #[tokio::test]
    async fn keep_every_tag_as_legacy_and_hand_only_unfinished_downloads_over_again() {
        let pool = pool_before().await;
        tagged_request(&pool, "on_its_way", "progress = 0.5, moved_at = 10").await;
        sqlx::raw_sql(
            "INSERT INTO book_requests (id, book_uuid, user_id, kind, state, client_tag, progress)
             VALUES (2, 'b2', 1, 'ebook', 'on_its_way', 'omnibus-2-2', 1.0),
                    (3, 'b3', 1, 'ebook', 'stuck', 'omnibus-3-3', 1.0);
             INSERT INTO book_requests (id, book_uuid, user_id, kind, state, remove_tag, remove_since)
             VALUES (4, 'b4', 1, 'ebook', 'cancelled', 'omnibus-4-4', 20);",
        )
        .execute(&pool)
        .await
        .unwrap();

        apply_migration(&pool).await;

        type Row = (i64, String, Option<String>, Option<String>, Option<String>);
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT id, state, client_hash, legacy_tag, remove_hash FROM book_requests ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let legacy = |n: i64| Some(format!("omnibus-{n}-{n}"));
        assert_eq!(
            rows,
            [
                (1, "chosen".to_string(), None, legacy(1), None),
                (2, "on_its_way".to_string(), None, legacy(2), None),
                (3, "stuck".to_string(), None, legacy(3), None),
                (4, "cancelled".to_string(), None, None, None),
            ]
        );
    }
}

mod the_category {
    use super::*;

    async fn category_after(settings: &str) -> Option<String> {
        let pool = pool_before().await;
        sqlx::raw_sql(settings).execute(&pool).await.unwrap();
        apply_migration(&pool).await;
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'download_client_category'")
            .fetch_optional(&pool)
            .await
            .unwrap()
    }

    const URL: &str =
        "INSERT INTO settings (key, value) VALUES ('download_client_url', 'http://q:8080');";

    #[tokio::test]
    async fn becomes_omnibus_for_an_install_with_a_client_and_no_category() {
        assert_eq!(category_after(URL).await.as_deref(), Some("omnibus"));
    }

    #[tokio::test]
    async fn becomes_omnibus_for_an_install_whose_saved_category_was_blank() {
        let blank = format!(
            "{URL} INSERT INTO settings (key, value) VALUES ('download_client_category', '');"
        );

        assert_eq!(category_after(&blank).await.as_deref(), Some("omnibus"));
    }

    #[tokio::test]
    async fn keeps_a_category_the_admin_chose() {
        let chosen = format!(
            "{URL} INSERT INTO settings (key, value) VALUES ('download_client_category', 'books');"
        );

        assert_eq!(category_after(&chosen).await.as_deref(), Some("books"));
    }

    #[tokio::test]
    async fn stays_unset_for_an_install_with_no_client() {
        assert_eq!(category_after("SELECT 1;").await, None);
    }
}

mod a_tagged_download {
    use super::*;

    #[tokio::test]
    async fn of_a_request_stuck_on_couldnt_add_is_found_by_hash_so_try_again_imports_it() {
        let pool = pool_before().await;
        tagged_request(
            &pool,
            "stuck",
            "stuck_reason = 'couldnt_add', progress = 1.0, chosen_result_id = 1",
        )
        .await;
        apply_migration(&pool).await;
        let client = client_with_the_tagged_download(1.0);

        tick(&pool, &client, NOW).await;
        store::restart(&pool, 1, NOW + 1, 5).await.unwrap();

        let after = row(&pool, 1).await;
        assert_eq!(after.state, RequestState::OnItsWay);
        assert_eq!(
            (after.client_hash.clone(), after.legacy_tag.clone()),
            (Some(hash(1)), None)
        );
        assert!(!after.client_adopted);
        assert_eq!(store::awaiting_import(&pool).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn of_a_cancel_still_in_its_grace_is_followed_after_an_undo() {
        let pool = pool_before().await;
        tagged_request(
            &pool,
            "cancelled",
            &format!(
                "prior_state = 'on_its_way', cancel_at = {}, cancelled_by = 1, progress = 0.4, moved_at = {}, chosen_result_id = 1",
                NOW + 100,
                NOW - 60
            ),
        )
        .await;
        apply_migration(&pool).await;
        let client = client_with_the_tagged_download(0.6);

        tick(&pool, &client, NOW).await;
        store::undo_cancel(&pool, 1, NOW + 1, 5).await.unwrap();
        tick(&pool, &client, NOW + 2).await;

        let after = row(&pool, 1).await;
        assert_eq!(after.state, RequestState::OnItsWay);
        assert_eq!(after.client_hash, Some(hash(1)));
        assert_eq!(after.progress, Some(0.6));
    }

    #[tokio::test]
    async fn of_a_finished_request_waits_for_its_import_without_being_handed_over_again() {
        let pool = pool_before().await;
        tagged_request(&pool, "on_its_way", "progress = 1.0, moved_at = 10").await;
        apply_migration(&pool).await;
        let client = client_with_the_tagged_download(1.0);

        tick(&pool, &client, NOW).await;

        assert!(!client.calls().iter().any(|c| matches!(c, Call::Add { .. })));
        let waiting = store::awaiting_import(&pool).await.unwrap();
        assert_eq!(waiting.len(), 1);
        assert_eq!(waiting[0].client_hash, Some(hash(1)));
    }

    #[tokio::test]
    async fn the_client_has_lost_stops_a_request_on_its_way() {
        let pool = pool_before().await;
        tagged_request(&pool, "on_its_way", "progress = 1.0, chosen_result_id = 1").await;
        apply_migration(&pool).await;

        tick(&pool, &StubClient::new(), NOW).await;

        let after = row(&pool, 1).await;
        assert_eq!(after.state, RequestState::Stuck);
        assert_eq!((after.client_hash, after.legacy_tag), (None, None));
    }
}
