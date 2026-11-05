//! Picking another version while one downloads, and Try again on a stopped download.

use super::*;

fn swap_uri(id: i64) -> String {
    format!("/api/requests/{id}/swap")
}

/// A request on its way with the version it picked (`picked`) and one other (`other`); returns
/// `(request id, picked id)`.
async fn on_its_way(pool: &SqlitePool, user: i64) -> (i64, i64) {
    let uuid = seed_book(pool, "Dracula").await;
    let id = seed_request(pool, user, &uuid).await;
    let mut ids = Vec::new();
    for title in ["picked", "other"] {
        let result: i64 = sqlx::query_scalar(
            "INSERT INTO book_request_results (request_id, guid, title, download_url, score)
             VALUES (?, ?, ?, 'magnet:?xt=urn:btih:x', 1.0) RETURNING id",
        )
        .bind(id)
        .bind(title)
        .bind(title)
        .fetch_one(pool)
        .await
        .unwrap();
        ids.push(result);
    }
    sqlx::query(
        "UPDATE book_requests SET state = 'on_its_way', chosen_result_id = ?, progress = 0.3,
         client_tag = 'omnibus-1' WHERE id = ?",
    )
    .bind(ids[0])
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
    (id, ids[0])
}

mod post_swap_request {
    use super::*;

    #[tokio::test]
    async fn goes_back_to_choosing_without_the_swapped_version_and_says_why() {
        let (app, state, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let (id, _) = on_its_way(&pool, ada).await;

        let res = send(&app, "POST", &swap_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::OK);
        let body: BookRequest = body_json(res).await;
        assert_eq!(body.state, RequestState::Choose);
        assert_eq!(body.note.as_deref(), Some("Swapped for another version"));
        let seen: Vec<(&str, bool)> = body
            .versions
            .iter()
            .map(|v| (v.title.as_str(), v.rejected))
            .collect();
        assert_eq!(seen, [("other", false), ("picked", true)]);
        let woken = tokio::time::timeout(Duration::from_secs(1), state.request_kick().notified());
        assert!(woken.await.is_ok());
    }

    #[tokio::test]
    async fn answers_409_for_a_request_that_is_not_downloading() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let (id, _) = on_its_way(&pool, ada).await;
        sqlx::query("UPDATE book_requests SET progress = 1 WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

        let res = send(&app, "POST", &swap_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn answers_403_to_another_reader_and_lets_an_admin_swap() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, _) = requester(&pool, "ada").await;
        let (_, grace) = requester(&pool, "grace").await;
        let admin = admin_token(&pool).await;
        let (id, _) = on_its_way(&pool, ada).await;

        let other = send(&app, "POST", &swap_uri(id), Some(&grace), None).await;
        let by_admin = send(&app, "POST", &swap_uri(id), Some(&admin), None).await;

        assert_eq!(other.status(), StatusCode::FORBIDDEN);
        assert_eq!(by_admin.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn answers_429_and_changes_nothing_when_it_needs_a_search_the_reader_may_not_start() {
        let (app, state, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let (id, _) = on_its_way(&pool, ada).await;
        sqlx::query("UPDATE book_request_results SET rejected = 1 WHERE title = 'other'")
            .execute(&pool)
            .await
            .unwrap();
        for _ in 0..10 {
            state.request_starts().record(ada);
        }

        let res = send(&app, "POST", &swap_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
        let row = store::get(&pool, id).await.unwrap().unwrap();
        assert_eq!(row.state, RequestState::OnItsWay);
    }

    #[tokio::test]
    async fn answers_500_when_the_database_fails() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;
        pool.close().await;

        let res = send(&app, "POST", &swap_uri(1), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn answers_404_for_an_unknown_request() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;

        let res = send(&app, "POST", &swap_uri(999), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }
}

mod post_retry_request_when_stopped_moving {
    use super::*;

    #[tokio::test]
    async fn goes_back_to_choosing_and_charges_nothing_to_the_start_cap() {
        let (app, state, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let (id, _) = on_its_way(&pool, ada).await;
        sqlx::query(
            "UPDATE book_requests SET state = 'stuck', stuck_reason = 'stopped_moving' WHERE id = ?",
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
        for _ in 0..10 {
            state.request_starts().record(ada);
        }

        let res = send(
            &app,
            "POST",
            &format!("/api/requests/{id}/retry"),
            Some(&token),
            None,
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let body: BookRequest = body_json(res).await;
        assert_eq!(body.state, RequestState::Choose);
        assert_eq!(body.stuck_reason, None);
    }
}
