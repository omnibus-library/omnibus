//! Contract tests for the KOReader device routes, driving `koreader_router` via
//! `oneshot` against an in-memory DB.

use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
    Router,
};
use omnibus_db as db;
use omnibus_shared::DeviceKind;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::{
    body_json, get_anon, get_with_bearer, get_with_bearer_and_if_none_match, opt_in,
    revoke_can_download, seed_downloadable_book, seed_downloadable_book_with,
};

use super::*;

/// A KOReader router on a fresh in-memory DB, with the owning user's id and the
/// device's token.
async fn fixture() -> (Router, SqlitePool, String, i64) {
    let pool = db::init_db("sqlite::memory:").await.unwrap();
    let app = koreader_router(AppState::new(pool.clone()));
    let user = auth_test_support::create_user(&pool, "ko-reader").await;
    let device =
        db::kobo_devices::create_device(&pool, user.id, "Test KOReader", DeviceKind::Koreader)
            .await
            .unwrap();
    (app, pool, device.token, user.id)
}

mod auth {
    use super::*;

    const ROUTES: [&str; 2] = [
        "/koreader/v1/library",
        "/koreader/v1/books/0123abcd-0000-0000-0000-000000000000/file",
    ];

    fn with_authorization(uri: &str, value: &str) -> Request<Body> {
        Request::builder()
            .uri(uri)
            .header(header::AUTHORIZATION, value)
            .body(Body::empty())
            .unwrap()
    }

    #[tokio::test]
    async fn rejects_a_request_without_a_valid_koreader_bearer_token() {
        let (app, pool, token, uid) = fixture().await;
        let kobo = db::kobo_devices::create_device(&pool, uid, "Kobo", DeviceKind::Kobo)
            .await
            .unwrap();
        let revoked = db::kobo_devices::create_device(&pool, uid, "Gone", DeviceKind::Koreader)
            .await
            .unwrap();
        db::kobo_devices::revoke_device(&pool, uid, revoked.id)
            .await
            .unwrap();

        for uri in ROUTES {
            let cases = [
                ("missing header", get_anon(uri)),
                (
                    "non-Bearer scheme",
                    with_authorization(uri, &format!("Basic {token}")),
                ),
                ("unknown token", get_with_bearer(uri, "not-a-token")),
                ("a Kobo-kind token", get_with_bearer(uri, &kobo.token)),
                (
                    "a revoked device's token",
                    get_with_bearer(uri, &revoked.token),
                ),
            ];
            for (case, req) in cases {
                let res = app.clone().oneshot(req).await.unwrap();
                assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{case} on {uri}");
            }
        }
    }
}

mod library {
    use super::*;

    #[tokio::test]
    async fn lists_every_book_on_the_readers_synced_shelves_and_no_other() {
        let (app, pool, token, uid) = fixture().await;
        let synced = db::test_support::seed_synced_ebook(&pool, "alpha.epub", "Alpha", "Ada").await;
        db::test_support::seed_synced_ebook(&pool, "beta.epub", "Beta", "Bo").await;
        let stranger = auth_test_support::create_user(&pool, "stranger").await;
        let theirs = db::test_support::seed_synced_ebook(&pool, "gamma.epub", "Gamma", "Cy").await;
        opt_in(&pool, uid, std::slice::from_ref(&synced)).await;
        opt_in(&pool, stranger.id, &[theirs]).await;

        let res = app
            .oneshot(get_with_bearer("/koreader/v1/library", &token))
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::OK);
        let books = body_json::<Value>(res).await["books"].clone();
        let titles: Vec<&str> = books
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b["title"].as_str().unwrap())
            .collect();
        assert_eq!(titles, ["Alpha"]);
    }

    #[tokio::test]
    async fn describes_each_book_with_its_format_size_and_host_relative_download_url() {
        let (app, pool, token, uid) = fixture().await;
        let epub = db::test_support::seed_synced_ebook(&pool, "alpha.epub", "Alpha", "Ada").await;
        let cbz =
            db::test_support::seed_synced_ebook(&pool, "berserk.cbz", "Berserk", "Miura").await;
        sqlx::query(
            "UPDATE book_files SET size_bytes = 777 \
             WHERE book_id = (SELECT id FROM books WHERE uuid = ?)",
        )
        .bind(&cbz)
        .execute(&pool)
        .await
        .unwrap();
        opt_in(&pool, uid, &[epub.clone(), cbz.clone()]).await;

        let res = app
            .oneshot(get_with_bearer("/koreader/v1/library", &token))
            .await
            .unwrap();

        let body = body_json::<Value>(res).await;
        let entry = |uuid: &str| {
            body["books"]
                .as_array()
                .unwrap()
                .iter()
                .find(|b| b["uuid"] == uuid)
                .unwrap_or_else(|| panic!("{uuid} missing from {body}"))
                .clone()
        };
        let berserk = entry(&cbz);
        assert_eq!(berserk["format"], "cbz");
        assert_eq!(berserk["size"], 777);
        assert_eq!(berserk["authors"], json!(["Miura"]));
        assert_eq!(
            berserk["download_url"],
            format!("/koreader/v1/books/{cbz}/file")
        );
        assert_eq!(entry(&epub)["format"], "epub");
        assert!(berserk["last_modified"].is_i64());
    }

    #[tokio::test]
    async fn returns_an_empty_list_when_no_shelf_is_opted_in() {
        let (app, pool, token, _uid) = fixture().await;
        db::test_support::seed_synced_ebook(&pool, "alpha.epub", "Alpha", "Ada").await;

        let res = app
            .oneshot(get_with_bearer("/koreader/v1/library", &token))
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(body_json::<Value>(res).await, json!({ "books": [] }));
    }
}

mod file {
    use super::*;

    const UUID: &str = "11111111-1111-1111-1111-111111111111";

    fn file_uri(uuid: &str) -> String {
        format!("/koreader/v1/books/{uuid}/file")
    }

    #[tokio::test]
    async fn serves_an_epub_with_a_strong_etag_and_answers_304_to_a_matching_validator() {
        let (app, pool, token, _uid) = fixture().await;
        seed_downloadable_book(&pool, UUID, "Alpha", "Ada").await;

        let res = app
            .clone()
            .oneshot(get_with_bearer(&file_uri(UUID), &token))
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.headers()[header::CONTENT_TYPE], "application/epub+zip");
        let etag = res.headers()[header::ETAG].to_str().unwrap().to_owned();
        assert!(!etag.starts_with("W/"), "a strong validator, got {etag}");
        let again = app
            .oneshot(get_with_bearer_and_if_none_match(
                &file_uri(UUID),
                &token,
                &etag,
            ))
            .await
            .unwrap();
        assert_eq!(again.status(), StatusCode::NOT_MODIFIED);
    }

    #[tokio::test]
    async fn serves_the_cbz_archive_for_a_cbz_only_book() {
        let (app, pool, token, _uid) = fixture().await;
        seed_downloadable_book_with(&pool, UUID, "Aurora", "Ada", "CBZ", "aurora", b"archive")
            .await;

        let res = app
            .oneshot(get_with_bearer(&file_uri(UUID), &token))
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            res.headers()[header::CONTENT_TYPE],
            "application/vnd.comicbook+zip"
        );
        let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        assert_eq!(&bytes[..], b"archive");
    }

    #[tokio::test]
    async fn answers_404_for_an_unknown_uuid() {
        let (app, _pool, token, _uid) = fixture().await;

        let res = app
            .oneshot(get_with_bearer(&file_uri(UUID), &token))
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn answers_400_for_a_uuid_over_the_length_cap() {
        let (app, _pool, token, _uid) = fixture().await;
        let long = "a".repeat(omnibus_shared::BOOK_UUID_MAX_LEN + 1);

        let res = app
            .oneshot(get_with_bearer(&file_uri(&long), &token))
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn answers_403_when_the_reader_may_not_download() {
        let (app, pool, token, uid) = fixture().await;
        seed_downloadable_book(&pool, UUID, "Alpha", "Ada").await;
        revoke_can_download(&pool, uid).await;

        let res = app
            .oneshot(get_with_bearer(&file_uri(UUID), &token))
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::FORBIDDEN);
    }
}

mod sync_report {
    use super::*;

    fn post_report(token: &str, body: Value) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri("/koreader/v1/sync-report")
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }

    /// The owner's view of their devices, as Settings reads it.
    async fn owner_view(pool: &SqlitePool, uid: i64) -> omnibus_shared::KoboDeviceView {
        let owner = auth_test_support::bearer_token(pool, uid).await;
        let res = crate::backend::rest_router(AppState::new(pool.clone()))
            .oneshot(get_with_bearer("/api/account/kobo-devices", &owner))
            .await
            .unwrap();
        let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let mut devices: Vec<omnibus_shared::KoboDeviceView> =
            serde_json::from_slice(&bytes).unwrap();
        devices.remove(0)
    }

    #[tokio::test]
    async fn shows_the_reported_error_and_time_in_the_owners_device_list() {
        let (app, pool, token, uid) = fixture().await;

        let res = app
            .oneshot(post_report(
                &token,
                json!({ "error": "Couldn't download Alpha: 404" }),
            ))
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::NO_CONTENT);
        let device = owner_view(&pool, uid).await;
        assert_eq!(
            device.last_sync_error.as_deref(),
            Some("Couldn't download Alpha: 404")
        );
        assert!(device.last_sync_at.is_some());
    }

    #[tokio::test]
    async fn clears_the_error_when_the_report_has_none() {
        let (app, pool, token, uid) = fixture().await;
        app.clone()
            .oneshot(post_report(&token, json!({ "error": "boom" })))
            .await
            .unwrap();

        let res = app
            .oneshot(post_report(&token, json!({ "error": null })))
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::NO_CONTENT);
        assert_eq!(owner_view(&pool, uid).await.last_sync_error, None);
    }

    #[tokio::test]
    async fn stores_an_overlong_error_cut_to_500_characters() {
        let (app, pool, token, uid) = fixture().await;

        app.oneshot(post_report(&token, json!({ "error": "é".repeat(600) })))
            .await
            .unwrap();

        let stored = owner_view(&pool, uid).await.last_sync_error.unwrap();
        assert_eq!(stored, "é".repeat(500));
    }

    #[tokio::test]
    async fn rejects_a_report_without_an_authorization_header() {
        let (app, _pool, _token, _uid) = fixture().await;
        let req = Request::builder()
            .method("POST")
            .uri("/koreader/v1/sync-report")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({ "error": null }).to_string()))
            .unwrap();

        let res = app.oneshot(req).await.unwrap();

        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn rejects_a_kobo_kind_token() {
        let (app, pool, _token, uid) = fixture().await;
        let kobo = db::kobo_devices::create_device(&pool, uid, "Kobo", DeviceKind::Kobo)
            .await
            .unwrap();

        let res = app
            .oneshot(post_report(&kobo.token, json!({ "error": null })))
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }
}

mod plugin_zip {
    use std::io::Read;

    use super::*;

    fn entries(bytes: Vec<u8>) -> std::collections::BTreeMap<String, Vec<u8>> {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        (0..archive.len())
            .map(|i| {
                let mut entry = archive.by_index(i).unwrap();
                let mut content = Vec::new();
                entry.read_to_end(&mut content).unwrap();
                (entry.name().unwrap().into_owned(), content)
            })
            .collect()
    }

    fn plugin_dir() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../koreader/omnibus.koplugin")
    }

    #[test]
    fn holds_the_plugin_files_and_a_config_for_the_given_server_and_token() {
        let files = entries(plugin::plugin_zip("https://omni.test", "tok-1").unwrap());

        let names: Vec<&str> = files.keys().map(String::as_str).collect();
        assert_eq!(
            names,
            [
                "omnibus.koplugin/_meta.lua",
                "omnibus.koplugin/main.lua",
                "omnibus.koplugin/omnibus.json",
                "omnibus.koplugin/omnibussync.lua",
            ]
        );
        assert_eq!(
            files["omnibus.koplugin/main.lua"],
            std::fs::read(plugin_dir().join("main.lua")).unwrap()
        );
        let config: Value =
            serde_json::from_slice(&files["omnibus.koplugin/omnibus.json"]).unwrap();
        assert_eq!(
            config,
            json!({ "server_url": "https://omni.test", "token": "tok-1" })
        );
    }

    #[test]
    fn round_trips_a_server_url_holding_quotes_and_backslashes() {
        let url = r#"https://omni.test/a"b\c"#;

        let files = entries(plugin::plugin_zip(url, "tok").unwrap());

        let config: Value =
            serde_json::from_slice(&files["omnibus.koplugin/omnibus.json"]).unwrap();
        assert_eq!(config["server_url"], url);
    }

    #[test]
    fn embeds_every_lua_file_in_the_plugin_directory() {
        let mut on_disk: Vec<String> = std::fs::read_dir(plugin_dir())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .filter(|name| name.ends_with(".lua"))
            .collect();
        on_disk.sort();

        let mut embedded: Vec<&str> = plugin::PLUGIN_FILES.iter().map(|(name, _)| *name).collect();
        embedded.sort();

        assert_eq!(embedded, on_disk);
    }
}
