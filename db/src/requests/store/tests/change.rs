//! Cancelling a request, taking that back, and giving up the version that is downloading.

use super::*;

mod cancel {
    use super::*;

    #[tokio::test]
    async fn marks_the_request_cancelled_with_who_when_and_what_undo_restores() {
        let pool = pool().await;
        for state in ["looking", "choose", "chosen", "on_its_way"] {
            let ada = seed_user(&pool, state).await;
            let id = start(&pool, ada, "book-1", RequestKind::Ebook, 5)
                .await
                .unwrap()
                .request
                .id;
            set_state(&pool, id, state).await;

            cancel(&pool, id, ada, NOW).await.unwrap();

            let row = state_of(&pool, id).await;
            assert_eq!(row.state, RequestState::Cancelled, "{state}");
            assert_eq!(row.prior_state, RequestState::from_db(state), "{state}");
            assert_eq!(row.cancelled_by, Some(ada), "{state}");
            assert_eq!(row.cancel_at, Some(NOW + CANCEL_GRACE_SECS), "{state}");
        }
    }

    #[tokio::test]
    async fn refuses_a_request_that_is_stuck_cancelled_fully_downloaded_or_ready() {
        let pool = pool().await;
        let id = start_looking(&pool).await;
        for (state, progress) in [
            ("stuck", "NULL"),
            ("cancelled", "NULL"),
            ("on_its_way", "1"),
            ("ready", "1"),
        ] {
            sqlx::query(&format!(
                "UPDATE book_requests SET state = '{state}', progress = {progress} WHERE id = ?"
            ))
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

            let result = cancel(&pool, id, 1, NOW).await;

            assert!(matches!(result, Err(RequestError::WrongState)), "{state}");
        }
    }

    #[tokio::test]
    async fn cancels_a_request_whose_earlier_download_is_still_being_removed() {
        let pool = pool().await;
        let id = start_looking(&pool).await;
        sqlx::query(
            "UPDATE book_requests SET state = 'choose', remove_tag = 'omnibus-1-1' WHERE id = ?",
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();

        cancel(&pool, id, 1, NOW).await.unwrap();

        let row = state_of(&pool, id).await;
        assert_eq!(row.state, RequestState::Cancelled);
        assert_eq!(row.remove_tag.as_deref(), Some("omnibus-1-1"));
    }

    #[tokio::test]
    async fn cancels_once_when_two_clicks_arrive() {
        let pool = pool().await;
        let id = start_looking(&pool).await;

        let first = cancel(&pool, id, 1, NOW).await;
        let second = cancel(&pool, id, 1, NOW + 1).await;

        assert!(first.is_ok());
        assert!(matches!(second, Err(RequestError::WrongState)));
        assert_eq!(
            state_of(&pool, id).await.cancel_at,
            Some(NOW + CANCEL_GRACE_SECS)
        );
    }
}

mod undo_cancel {
    use super::*;

    #[tokio::test]
    async fn restores_the_state_the_request_was_cancelled_from() {
        let pool = pool().await;
        let id = start_looking(&pool).await;
        set_state(&pool, id, "on_its_way").await;
        cancel(&pool, id, 1, NOW).await.unwrap();

        let restored = undo_cancel(&pool, id, NOW + 7, 5).await.unwrap();

        assert_eq!(restored.state, RequestState::OnItsWay);
        assert_eq!(restored.prior_state, None);
        assert_eq!(restored.cancelled_by, None);
        assert_eq!(restored.cancel_at, None);
    }

    #[tokio::test]
    async fn refuses_from_the_moment_the_grace_ends() {
        let pool = pool().await;
        let id = start_looking(&pool).await;
        cancel(&pool, id, 1, NOW).await.unwrap();

        let at_the_end = undo_cancel(&pool, id, NOW + CANCEL_GRACE_SECS, 5).await;

        assert!(matches!(at_the_end, Err(RequestError::WrongState)));
        assert_eq!(state_of(&pool, id).await.state, RequestState::Cancelled);
    }

    #[tokio::test]
    async fn refuses_a_request_that_was_not_cancelled() {
        let pool = pool().await;
        let id = start_looking(&pool).await;

        let result = undo_cancel(&pool, id, NOW, 5).await;

        assert!(matches!(result, Err(RequestError::WrongState)));
    }

    #[tokio::test]
    async fn refuses_when_the_reader_has_started_another_request_for_the_same_book() {
        let pool = pool().await;
        let id = start_looking(&pool).await;
        cancel(&pool, id, 1, NOW).await.unwrap();
        let ada = state_of(&pool, id).await.user_id;
        let again = start(&pool, ada, "book-1", RequestKind::Ebook, 5)
            .await
            .unwrap();

        let result = undo_cancel(&pool, id, NOW + 1, 5).await;

        assert!(again.created);
        assert!(matches!(result, Err(RequestError::WrongState)));
        assert_eq!(state_of(&pool, id).await.state, RequestState::Cancelled);
    }

    #[tokio::test]
    async fn refuses_when_the_reader_now_holds_the_live_limit() {
        let pool = pool().await;
        let id = start_looking(&pool).await;
        cancel(&pool, id, 1, NOW).await.unwrap();
        let ada = state_of(&pool, id).await.user_id;
        for n in 2..4 {
            start(&pool, ada, &format!("book-{n}"), RequestKind::Ebook, 5)
                .await
                .unwrap();
        }

        let result = undo_cancel(&pool, id, NOW + 1, 2).await;

        assert!(matches!(result, Err(RequestError::TooManyLive)));
    }
}

mod swap {
    use super::*;

    #[tokio::test]
    async fn rejects_the_picked_version_and_goes_back_to_choosing_with_the_others() {
        let pool = pool().await;
        let (id, picked, other) = on_its_way_with_two_versions(&pool).await;

        let swapped = swap(&pool, id, NOW, Some("Swapped for another version"))
            .await
            .unwrap();

        assert_eq!(swapped.state, RequestState::Choose);
        let row = state_of(&pool, id).await;
        assert_eq!(row.state, RequestState::Choose);
        assert_eq!(row.chosen_result_id, None);
        assert_eq!(row.progress, None);
        assert_eq!(row.client_tag, None);
        assert_eq!(row.remove_tag.as_deref(), Some("omnibus-1"));
        assert_eq!(row.remove_since, Some(NOW));
        assert_eq!(row.note.as_deref(), Some("Swapped for another version"));
        let shown: Vec<(i64, bool)> = versions(&pool, id)
            .await
            .unwrap()
            .into_iter()
            .map(|v| (v.id, v.rejected))
            .collect();
        assert_eq!(shown, [(other, false), (picked, true)]);
    }

    #[tokio::test]
    async fn forgets_when_the_given_up_download_was_due_to_finish() {
        let pool = pool().await;
        let (id, _, _) = on_its_way_with_two_versions(&pool).await;
        sqlx::query("UPDATE book_requests SET expected_done_at = ? WHERE id = ?")
            .bind(NOW + 60)
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

        swap(&pool, id, NOW, None).await.unwrap();

        assert_eq!(state_of(&pool, id).await.expected_done_at, None);
    }

    #[tokio::test]
    async fn looks_again_when_no_other_version_is_left() {
        let pool = pool().await;
        let (id, _, other) = on_its_way_with_two_versions(&pool).await;
        sqlx::query("UPDATE book_request_results SET rejected = 1 WHERE id = ?")
            .bind(other)
            .execute(&pool)
            .await
            .unwrap();

        let swapped = swap(&pool, id, NOW, Some("Swapped for another version"))
            .await
            .unwrap();

        assert_eq!(swapped.state, RequestState::Looking);
        assert_eq!(state_of(&pool, id).await.state, RequestState::Looking);
    }

    #[tokio::test]
    async fn takes_a_stopped_download_the_same_way() {
        let pool = pool().await;
        let (id, _, _) = on_its_way_with_two_versions(&pool).await;
        sqlx::query(
            "UPDATE book_requests SET state = 'stuck', stuck_reason = 'stopped_moving',
             stuck_detail = 'd' WHERE id = ?",
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();

        swap(&pool, id, NOW, None).await.unwrap();

        let row = state_of(&pool, id).await;
        assert_eq!(row.state, RequestState::Choose);
        assert_eq!(row.stuck_reason, None);
        assert_eq!(row.stuck_detail, None);
    }

    #[tokio::test]
    async fn refuses_a_request_that_is_not_downloading() {
        let pool = pool().await;
        let (id, _, _) = on_its_way_with_two_versions(&pool).await;
        let cases = [
            ("chosen", "0.4", "NULL"),
            ("cancelled", "0.4", "NULL"),
            ("stuck", "NULL", "'not_found'"),
            ("on_its_way", "1", "NULL"),
            ("ready", "1", "NULL"),
            ("stuck", "1", "'couldnt_add'"),
        ];
        for (state, progress, reason) in cases {
            sqlx::query(&format!(
                "UPDATE book_requests SET state = '{state}', progress = {progress},
                 stuck_reason = {reason} WHERE id = ?"
            ))
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

            let result = swap(&pool, id, NOW, None).await;

            assert!(matches!(result, Err(RequestError::WrongState)), "{state}");
        }
    }

    #[tokio::test]
    async fn clears_the_note_when_the_next_version_is_picked() {
        let pool = pool().await;
        let (id, _, other) = on_its_way_with_two_versions(&pool).await;
        swap(&pool, id, NOW, Some("Swapped for another version"))
            .await
            .unwrap();

        choose(&pool, id, other).await.unwrap();

        assert_eq!(state_of(&pool, id).await.note, None);
    }

    #[tokio::test]
    async fn refuses_while_an_earlier_download_is_still_being_removed() {
        let pool = pool().await;
        let (id, _, _) = on_its_way_with_two_versions(&pool).await;
        sqlx::query("UPDATE book_requests SET remove_tag = 'omnibus-1-0' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

        let result = swap(&pool, id, NOW, None).await;

        assert!(matches!(result, Err(RequestError::WrongState)));
    }
}
