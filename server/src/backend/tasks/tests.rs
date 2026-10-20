//! Integration tests for `GET /api/worker/status` (any signed-in user, scoped to what
//! they may see) and `GET /api/admin/background-tasks` (admin only, newest first,
//! capped at `RECENT_TASKS_LIMIT`).

use axum::http::StatusCode;
use omnibus_db::{
    background_tasks::{finish_task, start_task},
    worker::Task,
};
use omnibus_shared::{BackgroundTaskRecord, BackgroundTaskStatus, TaskKind, WorkerStatus};
use tower::ServiceExt;

use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::*;

fn feed_ids(status: &WorkerStatus) -> Vec<u64> {
    status.recent_complete.iter().map(|t| t.task_id).collect()
}

mod get_worker_status {
    use super::*;

    #[tokio::test]
    async fn returns_401_when_anonymous() {
        let (app, _, _) = fixture().await;
        let res = app
            .oneshot(get_anon("/api/worker/status"))
            .await
            .expect("request should succeed");
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn returns_the_feed_to_a_reader() {
        let (app, state, pool) = fixture().await;
        let token = reader_token(&pool).await;
        let scan = state.worker().post(Task::Scan {
            library_path: "/no/such/library".to_string(),
        });
        state.worker().await_completion(scan).await;

        let res = app
            .oneshot(get_with_bearer("/api/worker/status", &token))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::OK);
        let status: WorkerStatus = body_json(res).await;
        let finished: Vec<_> = status
            .recent_complete
            .iter()
            .filter(|t| t.task_id == scan)
            .collect();
        assert_eq!(finished.len(), 1);
        assert_eq!(finished[0].kind, TaskKind::Scan);
    }

    #[tokio::test]
    async fn hides_a_task_another_user_owns() {
        let (app, state, pool) = fixture().await;
        let owner = auth_test_support::create_user(&pool, "owner").await;
        let other = auth_test_support::create_user(&pool, "other").await;
        let other_token = auth_test_support::bearer_token(&pool, other.id).await;
        let owner_token = auth_test_support::bearer_token(&pool, owner.id).await;
        let task_id = state.worker().post(Task::Scan {
            library_path: "/no/such/library".to_string(),
        });
        state.worker().set_task_owner(task_id, owner.id);
        state.worker().await_completion(task_id).await;

        let seen_by = |token: String| {
            let app = app.clone();
            async move {
                let res = app
                    .oneshot(get_with_bearer("/api/worker/status", &token))
                    .await
                    .expect("request should succeed");
                feed_ids(&body_json(res).await)
            }
        };

        assert!(seen_by(owner_token).await.contains(&task_id));
        assert!(!seen_by(other_token).await.contains(&task_id));
    }
}

mod get_background_tasks {
    use super::*;

    async fn record(pool: &sqlx::SqlitePool, kind: &str, started_at: i64) -> i64 {
        start_task(pool, kind, started_at).await.unwrap()
    }

    #[tokio::test]
    async fn returns_401_when_anonymous() {
        let (app, _, _) = fixture().await;
        let res = app
            .oneshot(get_anon("/api/admin/background-tasks"))
            .await
            .expect("request should succeed");
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn returns_403_when_not_admin() {
        let (app, _, pool) = fixture().await;
        let token = reader_token(&pool).await;
        let res = app
            .oneshot(get_with_bearer("/api/admin/background-tasks", &token))
            .await
            .expect("request should succeed");
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn returns_recorded_runs_newest_first() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let first = record(&pool, "scan", 1_000).await;
        finish_task(&pool, first, 1_050, Ok(())).await.unwrap();
        let second = record(&pool, "generate_thumbs", 2_000).await;
        finish_task(&pool, second, 2_010, Err("thumbnail failed"))
            .await
            .unwrap();

        let res = app
            .oneshot(get_with_bearer("/api/admin/background-tasks", &token))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::OK);
        let rows: Vec<BackgroundTaskRecord> = body_json(res).await;
        assert_eq!(
            rows.iter().map(|r| (r.id, r.status)).collect::<Vec<_>>(),
            vec![
                (second, BackgroundTaskStatus::Failed),
                (first, BackgroundTaskStatus::Success)
            ]
        );
        assert_eq!(rows[0].error.as_deref(), Some("thumbnail failed"));
    }

    #[tokio::test]
    async fn returns_at_most_the_recent_task_limit() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let mut newest = 0;
        for n in 0..101 {
            newest = record(&pool, "scan", n).await;
        }

        let res = app
            .oneshot(get_with_bearer("/api/admin/background-tasks", &token))
            .await
            .expect("request should succeed");

        let rows: Vec<BackgroundTaskRecord> = body_json(res).await;
        assert_eq!(rows.len(), 100);
        assert_eq!(rows[0].id, newest);
    }

    #[tokio::test]
    async fn returns_500_when_the_history_cannot_be_read() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        sqlx::query("DROP TABLE background_tasks")
            .execute(&pool)
            .await
            .unwrap();

        let res = app
            .oneshot(get_with_bearer("/api/admin/background-tasks", &token))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body_text(res).await, "internal server error");
    }
}
