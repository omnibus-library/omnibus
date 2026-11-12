//! The public server URL routes: an admin reads, saves, changes and clears it,
//! a refused URL answers 422 with the reason and keeps the saved one, and both
//! routes gate on auth and admin.

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use omnibus_db::test_support::EnvVarGuard;
use omnibus_shared::{PublicUrlSource, PublicUrlStatus};
use tower::ServiceExt;

use crate::backend::test_support::*;

const PATH: &str = "/api/settings/public-url";
const ENV: &str = "OMNIBUS_PUBLIC_URL";

fn save(token: Option<&str>, url: serde_json::Value) -> Request<Body> {
    request("POST", PATH, token, Some(serde_json::json!({ "url": url })))
}

async fn drop_settings_table(pool: &sqlx::SqlitePool) {
    sqlx::query("DROP TABLE settings")
        .execute(pool)
        .await
        .expect("drop settings");
}

mod get_public_url {
    use super::*;

    #[tokio::test]
    async fn returns_401_when_anonymous() {
        let (app, _, _) = fixture().await;
        let response = app
            .oneshot(get_anon(PATH))
            .await
            .expect("request should succeed");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn returns_403_when_not_admin() {
        let (app, _, pool) = fixture().await;
        let token = reader_token(&pool).await;
        let response = app
            .oneshot(get_with_bearer(PATH, &token))
            .await
            .expect("request should succeed");
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn returns_no_url_when_nothing_is_configured() {
        let _env = EnvVarGuard::set(ENV, None);
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let response = app
            .oneshot(get_with_bearer(PATH, &token))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let status: PublicUrlStatus = body_json(response).await;
        assert_eq!(status.url, None);
        assert_eq!(status.source, PublicUrlSource::None);
    }

    #[tokio::test]
    async fn returns_the_env_url_when_nothing_is_saved() {
        let _env = EnvVarGuard::set(ENV, Some("https://env.example.com/"));
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let response = app
            .oneshot(get_with_bearer(PATH, &token))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let status: PublicUrlStatus = body_json(response).await;
        assert_eq!(status.url.as_deref(), Some("https://env.example.com"));
        assert_eq!(status.source, PublicUrlSource::Env);
    }

    #[tokio::test]
    async fn returns_500_when_the_settings_cannot_be_read() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        drop_settings_table(&pool).await;

        let response = app
            .oneshot(get_with_bearer(PATH, &token))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}

mod post_public_url {
    use super::*;

    /// Save `url` as the admin and return the status the route answered.
    async fn saved(app: &axum::Router, token: &str, url: serde_json::Value) -> PublicUrlStatus {
        let response = app
            .clone()
            .oneshot(save(Some(token), url))
            .await
            .expect("request should succeed");
        assert_eq!(response.status(), StatusCode::OK);
        body_json(response).await
    }

    /// Post `url`, expect a 422 carrying `reason`, and check the saved URL is unchanged.
    async fn assert_refused_and_unchanged(url: &str, reason: &str) {
        let _env = EnvVarGuard::set(ENV, None);
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        saved(&app, &token, "https://books.example.com".into()).await;

        let response = app
            .clone()
            .oneshot(save(Some(&token), url.into()))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body_text(response).await, reason);
        let read = app
            .oneshot(get_with_bearer(PATH, &token))
            .await
            .expect("request should succeed");
        let status: PublicUrlStatus = body_json(read).await;
        assert_eq!(status.url.as_deref(), Some("https://books.example.com"));
        assert_eq!(status.source, PublicUrlSource::Settings);
    }

    #[tokio::test]
    async fn returns_401_when_anonymous() {
        let (app, _, _) = fixture().await;
        let response = app
            .oneshot(save(None, "https://books.example.com".into()))
            .await
            .expect("request should succeed");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn returns_403_when_not_admin() {
        let (app, _, pool) = fixture().await;
        let token = reader_token(&pool).await;
        let response = app
            .oneshot(save(Some(&token), "https://books.example.com".into()))
            .await
            .expect("request should succeed");
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn saves_the_normalised_url_and_answers_the_url_now_in_effect() {
        let _env = EnvVarGuard::set(ENV, None);
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let status = saved(&app, &token, "https://example.org/omnibus/".into()).await;

        assert_eq!(status.url.as_deref(), Some("https://example.org/omnibus"));
        assert_eq!(status.source, PublicUrlSource::Settings);
        let read = app
            .oneshot(get_with_bearer(PATH, &token))
            .await
            .expect("request should succeed");
        assert_eq!(body_json::<PublicUrlStatus>(read).await, status);
    }

    #[tokio::test]
    async fn replaces_a_saved_url_when_changed() {
        let _env = EnvVarGuard::set(ENV, None);
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        saved(&app, &token, "https://old.example.com".into()).await;

        let status = saved(&app, &token, "https://new.example.com".into()).await;

        assert_eq!(status.url.as_deref(), Some("https://new.example.com"));
        assert_eq!(status.source, PublicUrlSource::Settings);
    }

    #[tokio::test]
    async fn clears_the_saved_url_when_it_is_null() {
        let _env = EnvVarGuard::set(ENV, None);
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        saved(&app, &token, "https://books.example.com".into()).await;

        let status = saved(&app, &token, serde_json::Value::Null).await;

        assert_eq!(status.url, None);
        assert_eq!(status.source, PublicUrlSource::None);
    }

    #[tokio::test]
    async fn clears_the_saved_url_when_it_is_blank() {
        let _env = EnvVarGuard::set(ENV, None);
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        saved(&app, &token, "https://books.example.com".into()).await;

        let status = saved(&app, &token, "   ".into()).await;

        assert_eq!(status.url, None);
        assert_eq!(status.source, PublicUrlSource::None);
    }

    #[tokio::test]
    async fn falls_back_to_the_env_url_when_the_saved_one_is_cleared() {
        let _env = EnvVarGuard::set(ENV, Some("https://env.example.com"));
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        saved(&app, &token, "https://books.example.com".into()).await;

        let status = saved(&app, &token, serde_json::Value::Null).await;

        assert_eq!(status.url.as_deref(), Some("https://env.example.com"));
        assert_eq!(status.source, PublicUrlSource::Env);
    }

    #[tokio::test]
    async fn returns_422_and_keeps_the_saved_url_when_the_url_is_relative() {
        assert_refused_and_unchanged(
            "books.example.com",
            "public url must be an absolute URL, such as https://books.example.com",
        )
        .await;
    }

    #[tokio::test]
    async fn returns_422_and_keeps_the_saved_url_when_the_scheme_is_not_http() {
        assert_refused_and_unchanged(
            "ftp://books.example.com",
            "public url must start with http:// or https://",
        )
        .await;
    }

    #[tokio::test]
    async fn returns_422_and_keeps_the_saved_url_when_the_url_has_a_query() {
        assert_refused_and_unchanged(
            "https://books.example.com/?ref=mail",
            "public url must not include a query string",
        )
        .await;
    }

    #[tokio::test]
    async fn returns_422_and_keeps_the_saved_url_when_the_url_has_a_fragment() {
        assert_refused_and_unchanged(
            "https://books.example.com/#top",
            "public url must not include a fragment",
        )
        .await;
    }

    #[tokio::test]
    async fn returns_500_when_the_url_cannot_be_saved() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        drop_settings_table(&pool).await;

        let response = app
            .oneshot(save(Some(&token), "https://books.example.com".into()))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
