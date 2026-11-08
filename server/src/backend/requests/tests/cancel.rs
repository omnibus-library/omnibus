//! Cancelling a request and taking the cancel back: who may, the states that allow it, and
//! the grace that keeps the download going.

use super::*;

fn cancel_uri(id: i64) -> String {
    format!("/api/requests/{id}/cancel")
}

async fn set_state(pool: &SqlitePool, id: i64, state: &str) {
    sqlx::query("UPDATE book_requests SET state = ? WHERE id = ?")
        .bind(state)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

mod post_cancel_request {
    use super::*;

    #[tokio::test]
    async fn marks_the_request_cancelled_with_an_undo_deadline_and_wakes_the_poller() {
        let (app, state, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        set_state(&pool, id, "on_its_way").await;
        let before = store::unix_now();

        let res = send(&app, "POST", &cancel_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::OK);
        let body: BookRequest = body_json(res).await;
        assert_eq!(body.state, RequestState::Cancelled);
        assert_eq!(body.cancelled_by, Some(ada));
        assert!(body.cancel_at.unwrap() >= before + store::CANCEL_GRACE_SECS);
        let woken = tokio::time::timeout(Duration::from_secs(1), state.request_kick().notified());
        assert!(woken.await.is_ok());
    }

    #[tokio::test]
    async fn answers_409_for_a_request_that_is_stuck() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        set_state(&pool, id, "stuck").await;

        let res = send(&app, "POST", &cancel_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn lets_a_reader_who_can_neither_ask_nor_pick_cancel_their_own_request() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (plain, token) = reader(&pool, "plain").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, plain, &uuid).await;

        let res = send(&app, "POST", &cancel_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::OK);
        let row = store::get(&pool, id).await.unwrap().unwrap();
        assert_eq!(row.cancelled_by, Some(plain));
    }

    #[tokio::test]
    async fn answers_403_to_another_reader_who_cannot_pick_versions() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, _) = requester(&pool, "ada").await;
        let (_, grace) = asker(&pool, "grace").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;

        let res = send(&app, "POST", &cancel_uri(id), Some(&grace), None).await;

        assert_eq!(res.status(), StatusCode::FORBIDDEN);
        let row = store::get(&pool, id).await.unwrap().unwrap();
        assert_eq!(row.state, RequestState::Looking);
    }

    #[tokio::test]
    async fn lets_a_chooser_cancel_another_readers_request() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, _) = requester(&pool, "ada").await;
        let (picker, token) = chooser(&pool, "picker").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;

        let res = send(&app, "POST", &cancel_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::OK);
        let row = store::get(&pool, id).await.unwrap().unwrap();
        assert_eq!(row.cancelled_by, Some(picker));
    }

    #[tokio::test]
    async fn lets_an_admin_cancel_another_readers_request() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, _) = requester(&pool, "ada").await;
        let admin = admin_token(&pool).await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;

        let res = send(&app, "POST", &cancel_uri(id), Some(&admin), None).await;

        assert_eq!(res.status(), StatusCode::OK);
        let row = store::get(&pool, id).await.unwrap().unwrap();
        assert_ne!(row.cancelled_by, Some(ada));
    }

    #[tokio::test]
    async fn answers_500_when_the_database_fails() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;
        pool.close().await;

        let res = send(&app, "POST", &cancel_uri(1), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn answers_404_for_an_unknown_request_to_a_reader_who_cannot_pick_versions() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = reader(&pool, "plain").await;

        let res = send(&app, "POST", &cancel_uri(999), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }
}

mod delete_cancel_request {
    use super::*;

    #[tokio::test]
    async fn restores_the_request_while_the_grace_lasts() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        set_state(&pool, id, "on_its_way").await;
        send(&app, "POST", &cancel_uri(id), Some(&token), None).await;

        let res = send(&app, "DELETE", &cancel_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::OK);
        let body: BookRequest = body_json(res).await;
        assert_eq!(body.state, RequestState::OnItsWay);
        assert_eq!(body.cancel_at, None);
    }

    #[tokio::test]
    async fn answers_409_once_the_grace_has_ended() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        send(&app, "POST", &cancel_uri(id), Some(&token), None).await;
        sqlx::query("UPDATE book_requests SET cancel_at = ? WHERE id = ?")
            .bind(store::unix_now() - 1)
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

        let res = send(&app, "DELETE", &cancel_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn searches_again_for_a_request_cancelled_while_looking() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        send(&app, "POST", &cancel_uri(id), Some(&token), None).await;

        let res = send(&app, "DELETE", &cancel_uri(id), Some(&token), None).await;

        let body: BookRequest = body_json(res).await;
        assert_eq!(body.state, RequestState::Looking);
        // No Prowlarr is set up, so the new search ends stuck.
        wait_for_request_state(&pool, id, RequestState::Stuck).await;
    }

    #[tokio::test]
    async fn lets_a_reader_who_can_neither_ask_nor_pick_undo_their_own_cancel() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (plain, token) = reader(&pool, "plain").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, plain, &uuid).await;
        send(&app, "POST", &cancel_uri(id), Some(&token), None).await;

        let res = send(&app, "DELETE", &cancel_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn answers_403_to_another_reader_who_cannot_pick_versions() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let (_, grace) = asker(&pool, "grace").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        send(&app, "POST", &cancel_uri(id), Some(&token), None).await;

        let res = send(&app, "DELETE", &cancel_uri(id), Some(&grace), None).await;

        assert_eq!(res.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn lets_a_chooser_undo_another_readers_cancel() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let (_, picker) = chooser(&pool, "picker").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        send(&app, "POST", &cancel_uri(id), Some(&token), None).await;

        let res = send(&app, "DELETE", &cancel_uri(id), Some(&picker), None).await;

        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn charges_the_new_search_to_the_start_cap() {
        let (app, state, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        send(&app, "POST", &cancel_uri(id), Some(&token), None).await;
        for _ in 0..9 {
            state.request_starts().record(ada);
        }

        send(&app, "DELETE", &cancel_uri(id), Some(&token), None).await;

        assert!(!state.request_starts().has_room(ada));
    }

    #[tokio::test]
    async fn answers_409_once_the_reader_started_another_request_for_the_book() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        send(&app, "POST", &cancel_uri(id), Some(&token), None).await;
        seed_request(&pool, ada, &uuid).await;

        let res = send(&app, "DELETE", &cancel_uri(id), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn answers_500_when_the_database_fails() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;
        pool.close().await;

        let res = send(&app, "DELETE", &cancel_uri(1), Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
