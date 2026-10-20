//! The library configuration an admin edits besides the paths: the Calibre
//! `ebook-convert` command and each library's metadata-source order. Every
//! route gates on auth and admin and answers the plain-text refusals the
//! Administration screens show.

use axum::{
    body::{to_bytes, Body},
    http::{header::AUTHORIZATION, Request, StatusCode},
};
use omnibus_db::test_support::EnvVarGuard;
use omnibus_shared::{EbookConvertStatus, MetadataSource, DEFAULT_METADATA_PRECEDENCE};
use tower::ServiceExt;

use super::super::*;
use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::*;

fn json_request(
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: serde_json::Value,
) -> Request<Body> {
    let builder = Request::builder()
        .uri(uri)
        .method(method)
        .header("content-type", "application/json");
    match token {
        Some(token) => builder.header(AUTHORIZATION, format!("Bearer {token}")),
        None => builder,
    }
    .body(Body::from(body.to_string()))
    .unwrap()
}

async fn admin_token(pool: &sqlx::SqlitePool) -> String {
    let admin = auth_test_support::create_admin(pool, "admin").await;
    auth_test_support::bearer_token(pool, admin.id).await
}

async fn reader_token(pool: &sqlx::SqlitePool) -> String {
    let reader = auth_test_support::create_user(pool, "reader").await;
    auth_test_support::bearer_token(pool, reader.id).await
}

async fn body_json<T: serde::de::DeserializeOwned>(response: Response) -> T {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn drop_settings_table(pool: &sqlx::SqlitePool) {
    sqlx::query("DROP TABLE settings")
        .execute(pool)
        .await
        .expect("drop settings");
}

mod get_ebook_convert {
    use super::*;

    #[tokio::test]
    async fn returns_401_when_anonymous() {
        let (app, _, _) = fixture().await;
        let response = app
            .oneshot(get_anon("/api/settings/ebook-convert"))
            .await
            .expect("request should succeed");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn returns_403_when_not_admin() {
        let (app, _, pool) = fixture().await;
        let token = reader_token(&pool).await;
        let response = app
            .oneshot(get_with_bearer("/api/settings/ebook-convert", &token))
            .await
            .expect("request should succeed");
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn returns_the_command_found_on_the_path_when_nothing_is_saved() {
        let _env = EnvVarGuard::set("OMNIBUS_EBOOK_CONVERT_PATH", None);
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let response = app
            .oneshot(get_with_bearer("/api/settings/ebook-convert", &token))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let status: EbookConvertStatus = body_json(response).await;
        assert_eq!(status.path, "ebook-convert");
        assert_eq!(status.source, "path");
    }

    #[tokio::test]
    async fn returns_500_when_the_settings_cannot_be_read() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        drop_settings_table(&pool).await;

        let response = app
            .oneshot(get_with_bearer("/api/settings/ebook-convert", &token))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}

mod post_ebook_convert {
    use super::*;

    fn save(token: Option<&str>, path: serde_json::Value) -> Request<Body> {
        json_request(
            "POST",
            "/api/settings/ebook-convert",
            token,
            serde_json::json!({ "path": path }),
        )
    }

    #[tokio::test]
    async fn returns_401_when_anonymous() {
        let (app, _, _) = fixture().await;
        let response = app
            .oneshot(save(None, "/opt/calibre/ebook-convert".into()))
            .await
            .expect("request should succeed");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn returns_403_when_not_admin() {
        let (app, _, pool) = fixture().await;
        let token = reader_token(&pool).await;
        let response = app
            .oneshot(save(Some(&token), "/opt/calibre/ebook-convert".into()))
            .await
            .expect("request should succeed");
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn saves_the_path_and_answers_the_command_now_in_effect() {
        let _env = EnvVarGuard::set("OMNIBUS_EBOOK_CONVERT_PATH", None);
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let response = app
            .clone()
            .oneshot(save(Some(&token), "/opt/calibre/ebook-convert".into()))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let saved: EbookConvertStatus = body_json(response).await;
        assert_eq!(saved.source, "settings");
        assert_eq!(saved.path, "/opt/calibre/ebook-convert");
        let read = app
            .oneshot(get_with_bearer("/api/settings/ebook-convert", &token))
            .await
            .expect("request should succeed");
        assert_eq!(body_json::<EbookConvertStatus>(read).await, saved);
    }

    #[tokio::test]
    async fn clears_the_saved_path_when_it_is_null() {
        let _env = EnvVarGuard::set("OMNIBUS_EBOOK_CONVERT_PATH", None);
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        app.clone()
            .oneshot(save(Some(&token), "/opt/calibre/ebook-convert".into()))
            .await
            .expect("request should succeed");

        let response = app
            .oneshot(save(Some(&token), serde_json::Value::Null))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let cleared: EbookConvertStatus = body_json(response).await;
        assert_eq!(cleared.source, "path");
        assert_eq!(cleared.path, "ebook-convert");
    }

    #[tokio::test]
    async fn returns_422_with_the_reason_when_the_path_is_too_long() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let response = app
            .oneshot(save(Some(&token), "a".repeat(4097).into()))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            body_text(response).await,
            "ebook convert path exceeds 4096 bytes"
        );
    }

    #[tokio::test]
    async fn returns_500_when_the_path_cannot_be_saved() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        drop_settings_table(&pool).await;

        let response = app
            .oneshot(save(Some(&token), "/opt/calibre/ebook-convert".into()))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}

async fn set_library_paths(pool: &sqlx::SqlitePool, ebook: Option<&str>, audiobook: Option<&str>) {
    let settings = omnibus_shared::Settings {
        ebook_library_path: ebook.map(str::to_string),
        audiobook_library_path: audiobook.map(str::to_string),
        scan_interval_hours: None,
    };
    db::set_settings(pool, &settings)
        .await
        .expect("set_settings should persist the paths");
}

fn flipped_order() -> Vec<MetadataSource> {
    DEFAULT_METADATA_PRECEDENCE.into_iter().rev().collect()
}

mod get_metadata_precedence {
    use super::*;

    #[tokio::test]
    async fn returns_401_when_anonymous() {
        let (app, _, _) = fixture().await;
        let response = app
            .oneshot(get_anon("/api/settings/metadata-precedence/ebook"))
            .await
            .expect("request should succeed");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn returns_403_when_not_admin() {
        let (app, _, pool) = fixture().await;
        let token = reader_token(&pool).await;
        let response = app
            .oneshot(get_with_bearer(
                "/api/settings/metadata-precedence/ebook",
                &token,
            ))
            .await
            .expect("request should succeed");
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn returns_the_default_order_when_the_library_path_is_unset() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let response = app
            .oneshot(get_with_bearer(
                "/api/settings/metadata-precedence/ebook",
                &token,
            ))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            body_json::<Vec<MetadataSource>>(response).await,
            DEFAULT_METADATA_PRECEDENCE
        );
    }

    #[tokio::test]
    async fn returns_400_naming_the_choices_when_the_library_is_unknown() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let response = app
            .oneshot(get_with_bearer(
                "/api/settings/metadata-precedence/bogus",
                &token,
            ))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            body_text(response).await,
            "library must be \"ebook\" or \"audiobook\""
        );
    }

    #[tokio::test]
    async fn returns_500_when_the_settings_cannot_be_read() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        drop_settings_table(&pool).await;

        let response = app
            .oneshot(get_with_bearer(
                "/api/settings/metadata-precedence/ebook",
                &token,
            ))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}

mod post_metadata_precedence {
    use super::*;

    fn save(library: &str, token: Option<&str>, order: &[MetadataSource]) -> Request<Body> {
        json_request(
            "POST",
            &format!("/api/settings/metadata-precedence/{library}"),
            token,
            serde_json::json!(order),
        )
    }

    #[tokio::test]
    async fn returns_401_when_anonymous() {
        let (app, _, _) = fixture().await;
        let response = app
            .oneshot(save("ebook", None, &DEFAULT_METADATA_PRECEDENCE))
            .await
            .expect("request should succeed");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn returns_403_when_not_admin() {
        let (app, _, pool) = fixture().await;
        let token = reader_token(&pool).await;
        let response = app
            .oneshot(save("ebook", Some(&token), &DEFAULT_METADATA_PRECEDENCE))
            .await
            .expect("request should succeed");
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn saves_the_order_and_a_following_read_returns_it() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        set_library_paths(&pool, Some("/lib/ebooks"), None).await;

        let response = app
            .clone()
            .oneshot(save("ebook", Some(&token), &flipped_order()))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            body_json::<Vec<MetadataSource>>(response).await,
            flipped_order()
        );
        let read = app
            .oneshot(get_with_bearer(
                "/api/settings/metadata-precedence/ebook",
                &token,
            ))
            .await
            .expect("request should succeed");
        assert_eq!(
            body_json::<Vec<MetadataSource>>(read).await,
            flipped_order()
        );
    }

    #[tokio::test]
    async fn keeps_each_librarys_order_apart() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        set_library_paths(&pool, Some("/lib/ebooks"), Some("/lib/audiobooks")).await;
        app.clone()
            .oneshot(save("audiobook", Some(&token), &flipped_order()))
            .await
            .expect("request should succeed");

        let ebook = app
            .oneshot(get_with_bearer(
                "/api/settings/metadata-precedence/ebook",
                &token,
            ))
            .await
            .expect("request should succeed");

        assert_eq!(
            body_json::<Vec<MetadataSource>>(ebook).await,
            DEFAULT_METADATA_PRECEDENCE
        );
    }

    #[tokio::test]
    async fn returns_400_when_a_source_is_listed_twice() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        set_library_paths(&pool, Some("/lib/ebooks"), None).await;
        let mut duplicated = DEFAULT_METADATA_PRECEDENCE.to_vec();
        duplicated[4] = duplicated[0];

        let response = app
            .oneshot(save("ebook", Some(&token), &duplicated))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            body_text(response).await,
            "metadata precedence must list each source exactly once"
        );
    }

    #[tokio::test]
    async fn returns_400_when_a_source_is_missing() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        set_library_paths(&pool, Some("/lib/ebooks"), None).await;

        let response = app
            .oneshot(save(
                "ebook",
                Some(&token),
                &DEFAULT_METADATA_PRECEDENCE[..4],
            ))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn returns_400_when_the_library_is_unknown() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let response = app
            .oneshot(save("bogus", Some(&token), &DEFAULT_METADATA_PRECEDENCE))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            body_text(response).await,
            "library must be \"ebook\" or \"audiobook\""
        );
    }

    #[tokio::test]
    async fn returns_409_when_the_librarys_path_is_unset() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        // The ebook folder is set; the audiobook one, which this save targets, isn't.
        set_library_paths(&pool, Some("/lib/ebooks"), None).await;

        let response = app
            .oneshot(save("audiobook", Some(&token), &flipped_order()))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(
            body_text(response).await,
            "configure the library path before setting its metadata precedence"
        );
    }

    #[tokio::test]
    async fn returns_500_when_the_settings_cannot_be_read() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        drop_settings_table(&pool).await;

        let response = app
            .oneshot(save("ebook", Some(&token), &DEFAULT_METADATA_PRECEDENCE))
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
