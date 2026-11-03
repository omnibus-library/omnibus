//! Picking a version of a request.

use super::*;

mod post_choose_version {
    use super::*;

    fn choose_uri(id: i64) -> String {
        format!("/api/requests/{id}/choose")
    }

    /// Put a request in `choose` with a kept version and a dropped one; returns
    /// `(kept id, dropped id)`.
    async fn offer_versions(pool: &SqlitePool, request: i64) -> (i64, i64) {
        sqlx::query("UPDATE book_requests SET state = 'choose' WHERE id = ?")
            .bind(request)
            .execute(pool)
            .await
            .unwrap();
        let mut ids = Vec::new();
        for (title, rejected) in [("kept", 0), ("dropped", 1)] {
            let id: i64 = sqlx::query_scalar(
                "INSERT INTO book_request_results (request_id, guid, title, download_url, score, rejected)
                 VALUES (?, ?, ?, 'magnet:?xt=urn:btih:x', 1.0, ?) RETURNING id",
            )
            .bind(request)
            .bind(title)
            .bind(title)
            .bind(rejected)
            .fetch_one(pool)
            .await
            .unwrap();
            ids.push(id);
        }
        (ids[0], ids[1])
    }

    #[tokio::test]
    async fn records_the_pick_and_answers_the_chosen_request() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        let (kept, _) = offer_versions(&pool, id).await;

        let res = send(
            &app,
            "POST",
            &choose_uri(id),
            Some(&token),
            Some(json!({"result_id": kept})),
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let body: BookRequest = body_json(res).await;
        assert_eq!(body.state, RequestState::Chosen);
        assert_eq!(body.chosen_result_id, Some(kept));
    }

    #[tokio::test]
    async fn wakes_the_download_poller_after_a_pick() {
        let (app, state, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        let (kept, _) = offer_versions(&pool, id).await;
        let body = Some(json!({"result_id": kept}));

        send(&app, "POST", &choose_uri(id), Some(&token), body).await;

        let woken = tokio::time::timeout(Duration::from_secs(1), state.request_kick().notified());
        assert!(woken.await.is_ok());
    }

    #[tokio::test]
    async fn answers_404_for_a_dropped_version_or_another_requests_version() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let first = seed_book(&pool, "Dracula").await;
        let second = seed_book(&pool, "Carmilla").await;
        let id = seed_request(&pool, ada, &first).await;
        let other = seed_request(&pool, ada, &second).await;
        let (_, dropped) = offer_versions(&pool, id).await;
        let (theirs, _) = offer_versions(&pool, other).await;

        for result_id in [dropped, theirs] {
            let body = Some(json!({"result_id": result_id}));
            let res = send(&app, "POST", &choose_uri(id), Some(&token), body).await;
            assert_eq!(res.status(), StatusCode::NOT_FOUND, "{result_id}");
        }
    }

    #[tokio::test]
    async fn answers_409_for_a_request_that_is_not_waiting_on_a_pick() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        let (kept, _) = offer_versions(&pool, id).await;
        sqlx::query("UPDATE book_requests SET state = 'looking' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

        let res = send(
            &app,
            "POST",
            &choose_uri(id),
            Some(&token),
            Some(json!({"result_id": kept})),
        )
        .await;

        assert_eq!(res.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn rejects_a_body_that_names_a_link_and_changes_nothing() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        let (kept, _) = offer_versions(&pool, id).await;
        let body = json!({"result_id": kept, "url": "http://evil.example/book.epub"});

        let res = send(&app, "POST", &choose_uri(id), Some(&token), Some(body)).await;

        assert!(res.status().is_client_error());
        let row = store::get(&pool, id).await.unwrap().unwrap();
        assert_eq!(row.state, RequestState::Choose);
    }

    #[tokio::test]
    async fn answers_403_to_another_reader_and_lets_an_admin_pick() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, _) = requester(&pool, "ada").await;
        let (_, grace) = requester(&pool, "grace").await;
        let admin = admin_token(&pool).await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        let (kept, _) = offer_versions(&pool, id).await;
        let body = Some(json!({"result_id": kept}));

        let other = send(&app, "POST", &choose_uri(id), Some(&grace), body.clone()).await;
        let admin = send(&app, "POST", &choose_uri(id), Some(&admin), body).await;

        assert_eq!(other.status(), StatusCode::FORBIDDEN);
        assert_eq!(admin.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn answers_404_for_an_unknown_request() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;

        let res = send(
            &app,
            "POST",
            &choose_uri(999),
            Some(&token),
            Some(json!({"result_id": 1})),
        )
        .await;

        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }
}
