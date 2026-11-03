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
    async fn answers_403_to_another_reader_and_lets_an_admin_cancel() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, _) = requester(&pool, "ada").await;
        let (_, grace) = requester(&pool, "grace").await;
        let admin = admin_token(&pool).await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;

        let other = send(&app, "POST", &cancel_uri(id), Some(&grace), None).await;
        let by_admin = send(&app, "POST", &cancel_uri(id), Some(&admin), None).await;

        assert_eq!(other.status(), StatusCode::FORBIDDEN);
        assert_eq!(by_admin.status(), StatusCode::OK);
        let row = store::get(&pool, id).await.unwrap().unwrap();
        assert_ne!(row.cancelled_by, Some(ada));
    }

    #[tokio::test]
    async fn answers_404_for_an_unknown_request() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;

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
    async fn answers_403_to_another_reader() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let (_, grace) = requester(&pool, "grace").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        send(&app, "POST", &cancel_uri(id), Some(&token), None).await;

        let res = send(&app, "DELETE", &cancel_uri(id), Some(&grace), None).await;

        assert_eq!(res.status(), StatusCode::FORBIDDEN);
    }
}
