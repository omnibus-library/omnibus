//! Searching a request again, and Try again on a stopped download.

use super::*;

mod post_retry_request {
    use super::*;

    async fn set_state(pool: &SqlitePool, id: i64, state: &str) {
        sqlx::query("UPDATE book_requests SET state = ? WHERE id = ?")
            .bind(state)
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }

    fn retry_uri(id: i64) -> String {
        format!("/api/requests/{id}/retry")
    }

    #[tokio::test]
    async fn searches_again_from_stuck_and_offers_the_versions() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let prowlarr = prowlarr_with_dracula().await;
        use_prowlarr(&pool, &prowlarr.uri()).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book_by(&pool, "Dracula", "Bram Stoker").await;
        let id = seed_request(&pool, ada, &uuid).await;
        set_state(&pool, id, "stuck").await;

        let res = send(&app, "POST", &retry_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::OK);
        let body: BookRequest = body_json(res).await;
        assert_eq!(body.state, RequestState::Looking);
        wait_for_request_state(&pool, id, RequestState::Choose).await;
    }

    #[tokio::test]
    async fn searches_again_from_looking() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let prowlarr = prowlarr_with_dracula().await;
        use_prowlarr(&pool, &prowlarr.uri()).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book_by(&pool, "Dracula", "Bram Stoker").await;
        let id = seed_request(&pool, ada, &uuid).await;

        let res = send(&app, "POST", &retry_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::OK);
        wait_for_request_state(&pool, id, RequestState::Choose).await;
    }

    #[tokio::test]
    async fn answers_409_for_a_request_waiting_on_a_pick() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        set_state(&pool, id, "choose").await;

        let res = send(&app, "POST", &retry_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn answers_403_to_a_reader_who_cannot_pick_even_on_their_own_request() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = asker(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        set_state(&pool, id, "stuck").await;

        let res = send(&app, "POST", &retry_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::FORBIDDEN);
        let row = store::get(&pool, id).await.unwrap().unwrap();
        assert_eq!(row.state, RequestState::Stuck);
    }

    #[tokio::test]
    async fn lets_a_chooser_and_an_admin_retry_another_readers_request() {
        let _env = EnvVarGuard::set("OMNIBUS_PROWLARR_API_KEY", None);
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, _) = asker(&pool, "ada").await;
        let (_, picker) = chooser(&pool, "picker").await;
        let admin = admin_token(&pool).await;

        for (n, token) in [picker, admin].iter().enumerate() {
            let uuid = seed_book(&pool, &format!("Dracula {n}")).await;
            let id = seed_request(&pool, ada, &uuid).await;
            set_state(&pool, id, "stuck").await;

            let res = send(&app, "POST", &retry_uri(id), Some(token), None).await;

            assert_eq!(res.status(), StatusCode::OK, "token {n}");
        }
    }

    #[tokio::test]
    async fn charges_nothing_to_the_start_cap_when_the_request_cannot_be_retried() {
        let (app, state, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        set_state(&pool, id, "choose").await;
        for _ in 0..12 {
            let res = send(&app, "POST", &retry_uri(id), Some(&token), None).await;
            assert_eq!(res.status(), StatusCode::CONFLICT);
        }

        assert!(state.request_starts().has_room(ada));
    }

    #[tokio::test]
    async fn answers_404_for_an_unknown_request() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;

        let res = send(&app, "POST", &retry_uri(999), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn counts_against_the_start_cap() {
        let (app, state, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        set_state(&pool, id, "stuck").await;
        for _ in 0..10 {
            state.request_starts().record(ada);
        }

        let res = send(&app, "POST", &retry_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
    }
}
