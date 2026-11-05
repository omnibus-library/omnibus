use sqlx::SqlitePool;

use crate::test_support::seed_user;

use super::super::prowlarr::ProwlarrRelease;
use super::*;

async fn pool() -> SqlitePool {
    crate::pool::init_db("sqlite::memory:").await.unwrap()
}

async fn request_count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM book_requests")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn seed_result(pool: &SqlitePool, request_id: i64, title: &str, score: f64, rejected: i64) {
    sqlx::query(
        "INSERT INTO book_request_results (request_id, guid, title, download_url, score, rejected)
         VALUES (?, ?, ?, 'magnet:?xt=urn:btih:x', ?, ?)",
    )
    .bind(request_id)
    .bind(title)
    .bind(title)
    .bind(score)
    .bind(rejected)
    .execute(pool)
    .await
    .unwrap();
}

mod start {
    use super::*;

    #[tokio::test]
    async fn records_a_looking_request_for_the_reader_and_book() {
        let pool = pool().await;
        let ada = seed_user(&pool, "ada").await;

        let started = start(&pool, ada, "book-1", RequestKind::Ebook, 5)
            .await
            .unwrap();

        assert!(started.created);
        assert_eq!(started.request.user_id, ada);
        assert_eq!(started.request.book_uuid, "book-1");
        assert_eq!(started.request.state, RequestState::Looking);
        assert_eq!(request_count(&pool).await, 1);
    }

    #[tokio::test]
    async fn returns_the_live_request_without_a_new_row_when_one_exists() {
        let pool = pool().await;
        let ada = seed_user(&pool, "ada").await;
        let first = start(&pool, ada, "book-1", RequestKind::Ebook, 5)
            .await
            .unwrap();

        let again = start(&pool, ada, "book-1", RequestKind::Ebook, 5)
            .await
            .unwrap();

        assert!(!again.created);
        assert_eq!(again.request.id, first.request.id);
        assert_eq!(request_count(&pool).await, 1);
    }

    #[tokio::test]
    async fn starts_a_new_request_when_the_earlier_one_is_stuck() {
        let pool = pool().await;
        let ada = seed_user(&pool, "ada").await;
        let first = start(&pool, ada, "book-1", RequestKind::Ebook, 5)
            .await
            .unwrap();
        sqlx::query("UPDATE book_requests SET state = 'stuck' WHERE id = ?")
            .bind(first.request.id)
            .execute(&pool)
            .await
            .unwrap();

        let second = start(&pool, ada, "book-1", RequestKind::Ebook, 5)
            .await
            .unwrap();

        assert!(second.created);
        assert_ne!(second.request.id, first.request.id);
    }

    #[tokio::test]
    async fn refuses_a_new_request_once_the_reader_holds_the_live_limit() {
        let pool = pool().await;
        let ada = seed_user(&pool, "ada").await;
        let grace = seed_user(&pool, "grace").await;
        for n in 0..2 {
            start(&pool, ada, &format!("book-{n}"), RequestKind::Ebook, 2)
                .await
                .unwrap();
        }

        let over = start(&pool, ada, "book-9", RequestKind::Ebook, 2).await;
        let other_reader = start(&pool, grace, "book-9", RequestKind::Ebook, 2).await;

        assert!(matches!(over, Err(RequestError::TooManyLive)));
        assert!(other_reader.is_ok());
    }
}

mod versions {
    use super::*;

    #[tokio::test]
    async fn lists_best_score_first_and_hides_rejected_versions() {
        let pool = pool().await;
        let ada = seed_user(&pool, "ada").await;
        let id = start(&pool, ada, "book-1", RequestKind::Ebook, 5)
            .await
            .unwrap()
            .request
            .id;
        seed_result(&pool, id, "low", 1.0, 0).await;
        seed_result(&pool, id, "high", 9.0, 0).await;
        seed_result(&pool, id, "rejected", 99.0, 1).await;

        let titles: Vec<String> = versions(&pool, id)
            .await
            .unwrap()
            .into_iter()
            .map(|v| v.title)
            .collect();

        assert_eq!(titles, ["high", "low"]);
    }
}

fn ranked(title: &str, score: f64, best_match: bool, rejected: bool) -> Ranked {
    Ranked {
        release: ProwlarrRelease {
            guid: title.to_string(),
            title: title.to_string(),
            size_bytes: Some(1_000_000),
            seeders: Some(3),
            indexer: Some("books".to_string()),
            link: format!("magnet:?xt=urn:btih:{title}"),
            categories: vec![7020],
            files: None,
        },
        format: Some("EPUB".to_string()),
        score,
        best_match,
        rejected,
    }
}

async fn start_looking(pool: &SqlitePool) -> i64 {
    let ada = seed_user(pool, "ada").await;
    start(pool, ada, "book-1", RequestKind::Ebook, 5)
        .await
        .unwrap()
        .request
        .id
}

async fn state_of(pool: &SqlitePool, id: i64) -> RequestRow {
    get(pool, id).await.unwrap().unwrap()
}

mod finish_search {
    use super::*;

    #[tokio::test]
    async fn moves_a_looking_request_to_choose_with_its_versions_best_first() {
        let pool = pool().await;
        let id = start_looking(&pool).await;
        let found = SearchOutcome::Found(vec![
            ranked("best", 900.0, true, false),
            ranked("second", 800.0, false, false),
            ranked("dropped", 0.0, false, true),
        ]);

        finish_search(&pool, id, found).await.unwrap();

        assert_eq!(state_of(&pool, id).await.state, RequestState::Choose);
        let shown = versions(&pool, id).await.unwrap();
        let titles: Vec<&str> = shown.iter().map(|v| v.title.as_str()).collect();
        assert_eq!(titles, ["best", "second"]);
        assert!(shown[0].best_match);
        assert!(!shown[1].best_match);
        let stored: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM book_request_results")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(stored, 3);
    }

    #[tokio::test]
    async fn moves_a_looking_request_to_stuck_with_the_reason_and_detail() {
        let pool = pool().await;
        let id = start_looking(&pool).await;
        let stuck = SearchOutcome::Stuck {
            reason: StuckReason::NotFound,
            detail: Some("indexer 3 disabled until later".to_string()),
        };

        finish_search(&pool, id, stuck).await.unwrap();

        let row = state_of(&pool, id).await;
        assert_eq!(row.state, RequestState::Stuck);
        assert_eq!(row.stuck_reason, Some(StuckReason::NotFound));
        assert_eq!(
            row.stuck_detail.as_deref(),
            Some("indexer 3 disabled until later")
        );
    }

    #[tokio::test]
    async fn changes_nothing_for_a_request_that_is_no_longer_looking() {
        let pool = pool().await;
        let id = start_looking(&pool).await;
        sqlx::query("UPDATE book_requests SET state = 'chosen' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

        finish_search(
            &pool,
            id,
            SearchOutcome::Found(vec![ranked("late", 900.0, true, false)]),
        )
        .await
        .unwrap();

        assert_eq!(state_of(&pool, id).await.state, RequestState::Chosen);
        assert!(versions(&pool, id).await.unwrap().is_empty());
    }
}

mod restart {
    use super::*;

    #[tokio::test]
    async fn returns_a_stuck_request_to_looking_and_clears_what_it_found() {
        let pool = pool().await;
        let id = start_looking(&pool).await;
        let stuck = SearchOutcome::Stuck {
            reason: StuckReason::SearchFailed,
            detail: Some("not set up yet".to_string()),
        };
        finish_search(&pool, id, stuck).await.unwrap();
        seed_result(&pool, id, "old", 1.0, 0).await;

        restart(&pool, id).await.unwrap();

        let row = state_of(&pool, id).await;
        assert_eq!(row.state, RequestState::Looking);
        assert_eq!(row.stuck_reason, None);
        assert_eq!(row.stuck_detail, None);
        assert!(versions(&pool, id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn restarts_a_request_still_looking() {
        let pool = pool().await;
        let id = start_looking(&pool).await;

        restart(&pool, id).await.unwrap();

        assert_eq!(state_of(&pool, id).await.state, RequestState::Looking);
    }

    #[tokio::test]
    async fn refuses_a_request_waiting_on_a_pick_or_already_picked() {
        let pool = pool().await;
        let id = start_looking(&pool).await;
        for state in ["choose", "chosen"] {
            sqlx::query("UPDATE book_requests SET state = ? WHERE id = ?")
                .bind(state)
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();

            let result = restart(&pool, id).await;

            assert!(matches!(result, Err(RequestError::WrongState)), "{state}");
        }
    }
}

mod choose {
    use super::*;

    /// A request waiting on a pick with a kept version and a dropped one; returns
    /// `(request, kept version, dropped version)`.
    async fn waiting_on_a_pick(pool: &SqlitePool) -> (i64, i64, i64) {
        let id = start_looking(pool).await;
        let found = SearchOutcome::Found(vec![
            ranked("kept", 900.0, true, false),
            ranked("dropped", 0.0, false, true),
        ]);
        finish_search(pool, id, found).await.unwrap();
        let ids: Vec<i64> = sqlx::query_scalar(
            "SELECT id FROM book_request_results WHERE request_id = ? ORDER BY id",
        )
        .bind(id)
        .fetch_all(pool)
        .await
        .unwrap();
        (id, ids[0], ids[1])
    }

    #[tokio::test]
    async fn marks_the_request_chosen_with_the_picked_version() {
        let pool = pool().await;
        let (id, kept, _) = waiting_on_a_pick(&pool).await;

        choose(&pool, id, kept).await.unwrap();

        let row = state_of(&pool, id).await;
        assert_eq!(row.state, RequestState::Chosen);
        assert_eq!(row.chosen_result_id, Some(kept));
    }

    #[tokio::test]
    async fn refuses_a_dropped_version_and_leaves_the_request_waiting() {
        let pool = pool().await;
        let (id, _, dropped) = waiting_on_a_pick(&pool).await;

        let result = choose(&pool, id, dropped).await;

        assert!(matches!(result, Err(RequestError::NotFound)));
        assert_eq!(state_of(&pool, id).await.state, RequestState::Choose);
    }

    #[tokio::test]
    async fn refuses_a_version_of_another_request() {
        let pool = pool().await;
        let (_, kept, _) = waiting_on_a_pick(&pool).await;
        let other = seed_user(&pool, "grace").await;
        let other_id = start(&pool, other, "book-2", RequestKind::Ebook, 5)
            .await
            .unwrap()
            .request
            .id;
        let found = SearchOutcome::Found(vec![ranked("theirs", 900.0, true, false)]);
        finish_search(&pool, other_id, found).await.unwrap();

        let result = choose(&pool, other_id, kept).await;

        assert!(matches!(result, Err(RequestError::NotFound)));
        assert_eq!(state_of(&pool, other_id).await.state, RequestState::Choose);
    }

    #[tokio::test]
    async fn refuses_a_request_that_is_not_waiting_on_a_pick() {
        let pool = pool().await;
        let (id, kept, _) = waiting_on_a_pick(&pool).await;
        choose(&pool, id, kept).await.unwrap();

        let again = choose(&pool, id, kept).await;

        assert!(matches!(again, Err(RequestError::WrongState)));
    }
}

mod database_failure {
    use super::*;

    #[tokio::test]
    async fn start_propagates_a_db_error_when_the_pool_is_closed() {
        let pool = pool().await;
        let ada = seed_user(&pool, "ada").await;
        pool.close().await;

        let result = start(&pool, ada, "book-1", RequestKind::Ebook, 5).await;

        assert!(matches!(result, Err(RequestError::Db(_))));
    }
}
