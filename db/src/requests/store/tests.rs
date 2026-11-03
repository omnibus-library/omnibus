use sqlx::SqlitePool;

use super::*;

async fn pool() -> SqlitePool {
    crate::pool::init_db("sqlite::memory:").await.unwrap()
}

async fn seed_user(pool: &SqlitePool, username: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO users (username, password_hash) VALUES (?, 'x') RETURNING id")
        .bind(username)
        .fetch_one(pool)
        .await
        .unwrap()
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
