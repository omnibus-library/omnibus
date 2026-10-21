//! Integration tests for the `/api/admin/cleanup/*` routes, all admin only:
//! the per-kind counts, one kind's review queue, a decision on one suggestion,
//! a detection pass, and the undo of an applied decision.

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use omnibus_shared::{CleanupDecisionOutcome, CleanupKind, CleanupKindCounts, SuggestionCard};
use tower::ServiceExt;

use crate::backend::test_support::*;

/// A pending suggestion to merge "J. Smith" into "Jane Smith", as a detector writes it.
async fn seed_author_merge(pool: &sqlx::SqlitePool) -> i64 {
    let source = seed_author(pool, "J. Smith").await;
    let canonical = seed_author(pool, "Jane Smith").await;
    let payload = serde_json::json!({
        "type": "merge",
        "source_ids": [source],
        "source_names": ["J. Smith"],
        "canonical_id": canonical,
        "canonical_name": "Jane Smith",
    });
    sqlx::query_scalar(
        "INSERT INTO dedup_suggestions (kind, action, payload_json, decision)
         VALUES ('author', 'merge', ?, 'pending') RETURNING id",
    )
    .bind(payload.to_string())
    .fetch_one(pool)
    .await
    .expect("seed suggestion")
}

/// A pending title rename whose book carries a stored override blob that no longer parses.
async fn seed_rename_over_corrupt_overrides(pool: &sqlx::SqlitePool) -> i64 {
    let (book_id, uuid) = seed_book_with_uuid(pool, "/lib", "Shelley, Mary - Frankenstein").await;
    sqlx::query("INSERT INTO metadata_overrides (book_uuid, overrides) VALUES (?, 'not json')")
        .bind(&uuid)
        .execute(pool)
        .await
        .expect("seed corrupt overrides");
    let payload = serde_json::json!({
        "type": "rename",
        "book_id": book_id,
        "book_uuid": uuid,
        "current_title": "Shelley, Mary - Frankenstein",
        "proposed_title": "Frankenstein",
    });
    sqlx::query_scalar(
        "INSERT INTO dedup_suggestions (kind, action, payload_json, decision)
         VALUES ('book_title', 'rename', ?, 'pending') RETURNING id",
    )
    .bind(payload.to_string())
    .fetch_one(pool)
    .await
    .expect("seed suggestion")
}

fn decision_uri(suggestion: i64) -> String {
    format!("/api/admin/cleanup/suggestions/{suggestion}/decision")
}

fn decide(token: &str, suggestion: i64, body: serde_json::Value) -> Request<Body> {
    request("POST", &decision_uri(suggestion), Some(token), Some(body))
}

async fn drop_suggestions_table(pool: &sqlx::SqlitePool) {
    sqlx::query("DROP TABLE dedup_suggestions")
        .execute(pool)
        .await
        .expect("drop dedup_suggestions");
}

mod get_cleanup_counts {
    use super::*;

    #[tokio::test]
    async fn returns_401_when_anonymous() {
        let (app, _, _) = fixture().await;
        let res = app
            .oneshot(get_anon("/api/admin/cleanup/counts"))
            .await
            .expect("request should succeed");
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn returns_403_when_not_admin() {
        let (app, _, pool) = fixture().await;
        let token = reader_token(&pool).await;
        let res = app
            .oneshot(get_with_bearer("/api/admin/cleanup/counts", &token))
            .await
            .expect("request should succeed");
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn returns_every_kind_in_declaration_order() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let res = app
            .oneshot(get_with_bearer("/api/admin/cleanup/counts", &token))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::OK);
        let counts: Vec<CleanupKindCounts> = body_json(res).await;
        assert_eq!(
            counts.iter().map(|c| c.kind).collect::<Vec<_>>(),
            vec![
                CleanupKind::Author,
                CleanupKind::Series,
                CleanupKind::Tag,
                CleanupKind::BookTitle
            ]
        );
    }

    #[tokio::test]
    async fn counts_a_pending_suggestion_under_its_kind() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        seed_author_merge(&pool).await;

        let res = app
            .oneshot(get_with_bearer("/api/admin/cleanup/counts", &token))
            .await
            .expect("request should succeed");

        let counts: Vec<CleanupKindCounts> = body_json(res).await;
        let pending: Vec<_> = counts.iter().map(|c| c.counts.pending).collect();
        assert_eq!(pending, vec![1, 0, 0, 0]);
    }

    #[tokio::test]
    async fn returns_500_when_the_counts_cannot_be_read() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        drop_suggestions_table(&pool).await;

        let res = app
            .oneshot(get_with_bearer("/api/admin/cleanup/counts", &token))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body_text(res).await, "internal server error");
    }
}

mod get_cleanup_queue {
    use super::*;

    #[tokio::test]
    async fn returns_401_when_anonymous() {
        let (app, _, _) = fixture().await;
        let res = app
            .oneshot(get_anon("/api/admin/cleanup/tag/queue"))
            .await
            .expect("request should succeed");
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn returns_403_when_not_admin() {
        let (app, _, pool) = fixture().await;
        let token = reader_token(&pool).await;
        let res = app
            .oneshot(get_with_bearer("/api/admin/cleanup/tag/queue", &token))
            .await
            .expect("request should succeed");
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn returns_an_empty_array_when_nothing_is_pending() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let res = app
            .oneshot(get_with_bearer("/api/admin/cleanup/tag/queue", &token))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::OK);
        let cards: Vec<SuggestionCard> = body_json(res).await;
        assert!(cards.is_empty());
    }

    #[tokio::test]
    async fn returns_the_pending_suggestions_of_the_kind_as_cards() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let id = seed_author_merge(&pool).await;

        let res = app
            .oneshot(get_with_bearer("/api/admin/cleanup/author/queue", &token))
            .await
            .expect("request should succeed");

        let cards: Vec<SuggestionCard> = body_json(res).await;
        assert_eq!(
            cards
                .iter()
                .map(|c| (c.id, c.primary_name.as_str()))
                .collect::<Vec<_>>(),
            vec![(id, "Jane Smith")]
        );
    }

    #[tokio::test]
    async fn returns_400_for_an_unknown_kind() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let res = app
            .oneshot(get_with_bearer("/api/admin/cleanup/bogus/queue", &token))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn returns_500_when_the_queue_cannot_be_read() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        drop_suggestions_table(&pool).await;

        let res = app
            .oneshot(get_with_bearer("/api/admin/cleanup/tag/queue", &token))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body_text(res).await, "internal server error");
    }
}

mod post_cleanup_decision {
    use super::*;

    #[tokio::test]
    async fn returns_401_when_anonymous() {
        let (app, _, _) = fixture().await;
        let req = request(
            "POST",
            &decision_uri(1),
            None,
            Some(serde_json::json!({ "decision": "rejected" })),
        );
        let res = app.oneshot(req).await.expect("request should succeed");
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn returns_403_when_not_admin() {
        let (app, _, pool) = fixture().await;
        let token = reader_token(&pool).await;
        let res = app
            .oneshot(decide(
                &token,
                1,
                serde_json::json!({ "decision": "rejected" }),
            ))
            .await
            .expect("request should succeed");
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn returns_the_log_id_of_an_accepted_suggestion() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let id = seed_author_merge(&pool).await;

        let res = app
            .oneshot(decide(
                &token,
                id,
                serde_json::json!({ "decision": "accepted" }),
            ))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::OK);
        let outcome: CleanupDecisionOutcome = body_json(res).await;
        assert!(outcome.log_id.is_some());
    }

    #[tokio::test]
    async fn returns_a_null_log_id_for_a_rejected_suggestion() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let id = seed_author_merge(&pool).await;

        let res = app
            .oneshot(decide(
                &token,
                id,
                serde_json::json!({ "decision": "rejected" }),
            ))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::OK);
        let outcome: CleanupDecisionOutcome = body_json(res).await;
        assert_eq!(outcome.log_id, None);
    }

    #[tokio::test]
    async fn returns_409_for_an_unknown_suggestion() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let res = app
            .oneshot(decide(
                &token,
                999,
                serde_json::json!({ "decision": "accepted" }),
            ))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::CONFLICT);
        assert_eq!(body_text(res).await, "suggestion not found");
    }

    #[tokio::test]
    async fn returns_409_when_the_decision_is_pending() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let id = seed_author_merge(&pool).await;

        let res = app
            .oneshot(decide(
                &token,
                id,
                serde_json::json!({ "decision": "pending" }),
            ))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::CONFLICT);
        assert_eq!(
            body_text(res).await,
            "decision must be accepted or rejected"
        );
    }

    #[tokio::test]
    async fn returns_409_when_a_value_is_sent_for_a_merge() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let id = seed_author_merge(&pool).await;

        let res = app
            .oneshot(decide(
                &token,
                id,
                serde_json::json!({ "decision": "accepted", "value": "Somebody" }),
            ))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::CONFLICT);
        assert_eq!(
            body_text(res).await,
            "this suggestion's value cannot be edited yet"
        );
    }

    #[tokio::test]
    async fn returns_409_when_the_suggestion_was_already_reviewed() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let id = seed_author_merge(&pool).await;
        let body = serde_json::json!({ "decision": "rejected" });
        app.clone()
            .oneshot(decide(&token, id, body.clone()))
            .await
            .expect("request should succeed");

        let res = app
            .oneshot(decide(&token, id, body))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::CONFLICT);
        assert_eq!(body_text(res).await, "suggestion has already been reviewed");
    }

    #[tokio::test]
    async fn returns_500_when_the_suggestion_cannot_be_read() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        drop_suggestions_table(&pool).await;

        let res = app
            .oneshot(decide(
                &token,
                1,
                serde_json::json!({ "decision": "accepted" }),
            ))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body_text(res).await, "internal server error");
    }

    #[tokio::test]
    async fn returns_500_when_the_books_stored_overrides_cannot_be_read() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let id = seed_rename_over_corrupt_overrides(&pool).await;

        let res = app
            .oneshot(decide(
                &token,
                id,
                serde_json::json!({ "decision": "accepted" }),
            ))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body_text(res).await, "internal server error");
    }
}

mod post_cleanup_detect {
    use super::*;

    #[tokio::test]
    async fn returns_401_when_anonymous() {
        let (app, _, _) = fixture().await;
        let res = app
            .oneshot(request("POST", "/api/admin/cleanup/detect", None, None))
            .await
            .expect("request should succeed");
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn returns_403_when_not_admin() {
        let (app, _, pool) = fixture().await;
        let token = reader_token(&pool).await;
        let res = app
            .oneshot(request(
                "POST",
                "/api/admin/cleanup/detect",
                Some(&token),
                None,
            ))
            .await
            .expect("request should succeed");
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn returns_202_once_the_detection_is_queued() {
        let (app, state, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let res = app
            .oneshot(request(
                "POST",
                "/api/admin/cleanup/detect",
                Some(&token),
                None,
            ))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::ACCEPTED);
        assert_eq!(body_text(res).await, "");
        let is_cleanup =
            |task: &omnibus_shared::TaskProgress| task.resource_key.as_deref() == Some("cleanup");
        assert!(worker_holds_task(&state, is_cleanup));
    }
}

mod post_cleanup_undo {
    use super::*;

    fn undo(token: Option<&str>, log_id: i64) -> Request<Body> {
        request(
            "POST",
            &format!("/api/admin/cleanup/undo/{log_id}"),
            token,
            None,
        )
    }

    #[tokio::test]
    async fn returns_401_when_anonymous() {
        let (app, _, _) = fixture().await;
        let res = app
            .oneshot(undo(None, 1))
            .await
            .expect("request should succeed");
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn returns_403_when_not_admin() {
        let (app, _, pool) = fixture().await;
        let token = reader_token(&pool).await;
        let res = app
            .oneshot(undo(Some(&token), 1))
            .await
            .expect("request should succeed");
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn returns_409_for_an_unknown_log_id() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let res = app
            .oneshot(undo(Some(&token), 999))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::CONFLICT);
        assert_eq!(body_text(res).await, "cleanup log entry not found: 999");
    }

    #[tokio::test]
    async fn returns_204_for_an_applied_decision() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let id = seed_author_merge(&pool).await;
        let accepted = app
            .clone()
            .oneshot(decide(
                &token,
                id,
                serde_json::json!({ "decision": "accepted" }),
            ))
            .await
            .expect("request should succeed");
        let outcome: CleanupDecisionOutcome = body_json(accepted).await;
        let log_id = outcome.log_id.expect("an accept logs its change");

        let res = app
            .oneshot(undo(Some(&token), log_id))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn returns_409_when_the_decision_was_already_undone() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let id = seed_author_merge(&pool).await;
        let accepted = app
            .clone()
            .oneshot(decide(
                &token,
                id,
                serde_json::json!({ "decision": "accepted" }),
            ))
            .await
            .expect("request should succeed");
        let outcome: CleanupDecisionOutcome = body_json(accepted).await;
        let log_id = outcome.log_id.expect("an accept logs its change");
        app.clone()
            .oneshot(undo(Some(&token), log_id))
            .await
            .expect("request should succeed");

        let res = app
            .oneshot(undo(Some(&token), log_id))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::CONFLICT);
        assert_eq!(body_text(res).await, "cleanup was already undone");
    }

    #[tokio::test]
    async fn returns_500_when_the_log_cannot_be_read() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        sqlx::query("DROP TABLE cleanup_log")
            .execute(&pool)
            .await
            .expect("drop cleanup_log");

        let res = app
            .oneshot(undo(Some(&token), 1))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body_text(res).await, "internal server error");
    }
}
