//! A request stuck on a download that could not be added: what Try again does, and what a
//! reader is shown.

use super::*;

/// A stuck-on-`couldnt_add` request of `user`'s, with its download kept, and its id.
async fn couldnt_add(pool: &SqlitePool, user: i64) -> i64 {
    let uuid = seed_book(pool, "Dracula").await;
    let id = seed_request(pool, user, &uuid).await;
    let result: i64 = sqlx::query_scalar(
        "INSERT INTO book_request_results (request_id, guid, title, download_url, score)
         VALUES (?, 'g', 'picked', 'magnet:?xt=urn:btih:x', 1.0) RETURNING id",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE book_requests
         SET state = 'stuck', stuck_reason = 'couldnt_add', chosen_result_id = ?,
             stuck_detail = 'filing the download failed: /srv/library is read-only',
             client_hash = 'omnibus-1', progress = 1, import_key = 'bram-stoker/dracula/dracula.epub'
         WHERE id = ?",
    )
    .bind(result)
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
    id
}

mod post_retry_request_when_couldnt_add {
    use super::*;

    #[tokio::test]
    async fn reruns_the_import_only_and_charges_nothing_to_the_start_cap() {
        let (app, state, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let id = couldnt_add(&pool, ada).await;
        // One short of the cap: a recorded start would use up the last.
        for _ in 0..9 {
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
        assert_eq!(body.state, RequestState::OnItsWay);
        assert_eq!(body.stuck_reason, None);
        assert_eq!(body.progress, Some(1.0));
        assert!(state.request_starts().has_room(ada));
        let results: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM book_request_results")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(results, 1);
        let kept = store::get(&pool, id).await.unwrap().unwrap();
        assert_eq!(kept.client_hash.as_deref(), Some("omnibus-1"));
        assert_eq!(
            kept.import_key.as_deref(),
            Some("bram-stoker/dracula/dracula.epub")
        );
    }
}

mod get_request_when_couldnt_add {
    use super::*;

    #[tokio::test]
    async fn shows_a_reader_the_reason_without_the_detail_and_an_admin_both() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let admin = admin_token(&pool).await;
        let id = couldnt_add(&pool, ada).await;
        let uri = format!("/api/requests/{id}");

        let as_reader = send(&app, "GET", &uri, Some(&token), None).await;
        let as_admin = send(&app, "GET", &uri, Some(&admin), None).await;

        let reader_text = body_text(as_reader).await;
        let reader: BookRequest = serde_json::from_str(&reader_text).unwrap();
        assert_eq!(reader.stuck_reason, Some(StuckReason::CouldntAdd));
        assert_eq!(reader.stuck_detail, None);
        assert!(!reader_text.contains("read-only"));
        assert!(!reader_text.contains("import_key"));
        let admin: BookRequest = body_json(as_admin).await;
        assert_eq!(
            admin.stuck_detail.as_deref(),
            Some("filing the download failed: /srv/library is read-only")
        );
    }
}
