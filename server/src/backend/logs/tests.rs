//! Integration tests for `GET /api/admin/logs` (admin only): the query's
//! filters reach the on-disk reader, a missing log directory is an empty page,
//! and an unreadable one is a generic 500.

use axum::{body::to_bytes, http::StatusCode, response::Response};
use omnibus_db::test_support::EnvVarGuard;
use omnibus_shared::logs::LogPage;
use tower::ServiceExt;

use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::*;

async fn admin_token(pool: &sqlx::SqlitePool) -> String {
    let admin = auth_test_support::create_admin(pool, "admin").await;
    auth_test_support::bearer_token(pool, admin.id).await
}

async fn body_json<T: serde::de::DeserializeOwned>(response: Response) -> T {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

fn record(timestamp: &str, level: &str, message: &str) -> String {
    serde_json::json!({
        "timestamp": timestamp,
        "level": level,
        "target": "omnibus::backend",
        "fields": { "message": message },
    })
    .to_string()
}

mod get_logs {
    use super::*;

    #[tokio::test]
    async fn returns_401_when_anonymous() {
        let (app, _, _) = fixture().await;
        let res = app
            .oneshot(get_anon("/api/admin/logs"))
            .await
            .expect("request should succeed");
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn returns_403_when_not_admin() {
        let (app, _, pool) = fixture().await;
        let reader = auth_test_support::create_user(&pool, "reader").await;
        let token = auth_test_support::bearer_token(&pool, reader.id).await;
        let res = app
            .oneshot(get_with_bearer("/api/admin/logs", &token))
            .await
            .expect("request should succeed");
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn returns_the_records_matching_the_query() {
        let logs = tempfile::tempdir().unwrap();
        std::fs::write(
            logs.path().join("omnibus.log.2026-07-19"),
            format!(
                "{}\n{}\n",
                record("2026-07-19T10:00:00.000000Z", "INFO", "started"),
                record("2026-07-19T10:00:05.000000Z", "ERROR", "scan failed"),
            ),
        )
        .unwrap();
        let _env = EnvVarGuard::set_os("OMNIBUS_LOG_DIR", Some(logs.path().as_os_str()));
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let res = app
            .oneshot(get_with_bearer(
                "/api/admin/logs?level=ERROR&page=0",
                &token,
            ))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::OK);
        let page: LogPage = body_json(res).await;
        assert_eq!(
            page.records
                .iter()
                .map(|r| (r.level.as_str(), r.message.as_str()))
                .collect::<Vec<_>>(),
            vec![("ERROR", "scan failed")]
        );
        assert_eq!(page.page, 0);
        assert!(!page.has_more);
    }

    #[tokio::test]
    async fn returns_400_for_a_page_that_is_not_a_number() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let res = app
            .oneshot(get_with_bearer("/api/admin/logs?page=soon", &token))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn returns_an_empty_page_when_there_is_no_log_directory() {
        let logs = tempfile::tempdir().unwrap();
        let missing = logs.path().join("not-written-yet");
        let _env = EnvVarGuard::set_os("OMNIBUS_LOG_DIR", Some(missing.as_os_str()));
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let res = app
            .oneshot(get_with_bearer("/api/admin/logs", &token))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::OK);
        let page: LogPage = body_json(res).await;
        assert!(page.records.is_empty());
    }

    #[tokio::test]
    async fn returns_500_when_the_log_directory_cannot_be_read() {
        let logs = tempfile::tempdir().unwrap();
        let not_a_directory = logs.path().join("omnibus-logs");
        std::fs::write(&not_a_directory, "").unwrap();
        let _env = EnvVarGuard::set_os("OMNIBUS_LOG_DIR", Some(not_a_directory.as_os_str()));
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let res = app
            .oneshot(get_with_bearer("/api/admin/logs", &token))
            .await
            .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body_text(res).await, "internal server error");
    }
}
