//! Contract tests for `/kosync/*`: what stock KOReader's Progress sync sends and expects, and
//! what its pushes leave for (and read from) the web reader.

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
    response::Response,
    Router,
};
use md5::{Digest, Md5};
use omnibus_db::{self as db, test_support::EnvVarGuard};
use omnibus_shared::{BookProgress, MetadataOverrides, ProgressFormat, ProgressRecord};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

use crate::auth::test_support as auth_test_support;
use crate::backend::koreader::test_support::seed_epub_book;
use crate::backend::test_support::{body_json, get_with_bearer, request};
use crate::backend::{rest_router, AppState};

use super::kosync_router;

const ACCEPT: &str = "application/vnd.koreader.v1+json";
const USERNAME: &str = "ada";

/// Two chapters: `DocFragment[2]`'s paragraphs are 16 and 17 characters long.
const CHAPTER_ONE: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body><p>Opening chapter text.</p></body></html>"#;
const CHAPTER_TWO: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Two</title></head><body><p>First paragraph.</p><p>Second paragraph.</p></body></html>"#;

const SECOND_PARAGRAPH_XPOINTER: &str = "/body/DocFragment[2]/body/p[2]/text().6";
const SECOND_PARAGRAPH_CFI: &str = "epubcfi(/6/4!/4/4/1:6)";
const FIRST_PARAGRAPH_CFI: &str = "epubcfi(/6/4!/4/2/1:3)";
const FIRST_PARAGRAPH_XPOINTER: &str = "/body/DocFragment[2]/body/p[1]/text().3";

fn md5_hex(text: &str) -> String {
    format!("{:x}", Md5::digest(text.as_bytes()))
}

/// A reader who has generated a kosync password, with the router and pool they sync against.
struct Reader {
    app: Router,
    pool: SqlitePool,
    user_id: i64,
    key: String,
    token: String,
}

async fn reader() -> Reader {
    let pool = db::init_db("sqlite::memory:").await.unwrap();
    let user = auth_test_support::create_user(&pool, USERNAME).await;
    let password = db::kosync::generate_kosync_password(&pool, user.id)
        .await
        .unwrap();
    Reader {
        app: kosync_router(AppState::new(pool.clone())),
        token: auth_test_support::bearer_token(&pool, user.id).await,
        key: md5_hex(&password),
        user_id: user.id,
        pool,
    }
}

fn kosync_request(
    method: &str,
    uri: &str,
    creds: Option<(&str, &str)>,
    accept: Option<&str>,
    body: Option<Value>,
) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(accept) = accept {
        builder = builder.header(header::ACCEPT, accept);
    }
    if let Some((user, key)) = creds {
        builder = builder
            .header("x-auth-user", user)
            .header("x-auth-key", key);
    }
    match body {
        Some(body) => builder
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string())),
        None => builder.body(Body::empty()),
    }
    .unwrap()
}

/// A request as stock KOReader sends it: its Accept header and the reader's credentials.
async fn send(r: &Reader, method: &str, uri: &str, body: Option<Value>) -> Response {
    let creds = Some((USERNAME, r.key.as_str()));
    let req = kosync_request(method, uri, creds, Some(ACCEPT), body);
    r.app.clone().oneshot(req).await.unwrap()
}

fn push_body(document: &str, progress: &str, percentage: f64) -> Value {
    json!({
        "document": document,
        "progress": progress,
        "percentage": percentage,
        "device": "Kobo",
        "device_id": "ab",
    })
}

/// A two-chapter book whose file's partial MD5 is filled in; returns `(uuid, document, file)`.
async fn seeded_book(r: &Reader) -> (String, String, std::path::PathBuf) {
    let spine = [("c1.xhtml", CHAPTER_ONE), ("c2.xhtml", CHAPTER_TWO)];
    let (uuid, file) = seed_epub_book(&r.pool, &spine).await;
    let document = db::partial_md5::partial_md5(&file).unwrap();
    sqlx::query("UPDATE book_files SET partial_md5 = ?")
        .bind(&document)
        .execute(&r.pool)
        .await
        .unwrap();
    (uuid, document, file)
}

/// What the web reader sees for the epub: the stored position.
async fn web_epub(r: &Reader, uuid: &str) -> Option<ProgressRecord> {
    let rest = rest_router(AppState::new(r.pool.clone()));
    let res = rest
        .oneshot(get_with_bearer(&format!("/api/progress/{uuid}"), &r.token))
        .await
        .unwrap();
    let progress: Option<BookProgress> = body_json(res).await;
    progress?
        .records
        .into_iter()
        .find(|rec| rec.format == ProgressFormat::Epub)
}

async fn web_writes(r: &Reader, body: Value) {
    let rest = rest_router(AppState::new(r.pool.clone()));
    let res = rest
        .oneshot(request("POST", "/api/progress", Some(&r.token), Some(body)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

mod auth {
    use super::*;

    #[tokio::test]
    async fn get_users_auth_accepts_the_md5_of_the_password() {
        let r = reader().await;

        let res = send(&r, "GET", "/kosync/users/auth", None).await;

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(body_json::<Value>(res).await, json!({"authorized": "OK"}));
    }

    #[tokio::test]
    async fn get_users_auth_refuses_bad_credentials_with_code_2001() {
        let r = reader().await;
        let wrong = md5_hex("wrong");
        let cases = [
            ("wrong key", Some((USERNAME, wrong.as_str()))),
            ("unknown user", Some(("grace", r.key.as_str()))),
            ("no headers", None),
        ];
        for (name, creds) in cases {
            let req = kosync_request("GET", "/kosync/users/auth", creds, Some(ACCEPT), None);

            let res = r.app.clone().oneshot(req).await.unwrap();

            assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{name}");
            let body: Value = body_json(res).await;
            assert_eq!(
                body,
                json!({"code": 2001, "message": "Unauthorized"}),
                "{name}"
            );
        }
    }

    #[tokio::test]
    async fn get_users_auth_answers_429_on_the_eleventh_failed_check_from_one_ip() {
        let r = reader().await;
        let wrong = md5_hex("wrong");
        let attempt = |key: String| {
            let req = kosync_request(
                "GET",
                "/kosync/users/auth",
                Some((USERNAME, key.as_str())),
                Some(ACCEPT),
                None,
            );
            r.app.clone().oneshot(req)
        };
        // Correct keys are never charged, however many arrive.
        for _ in 0..20 {
            assert_eq!(
                attempt(r.key.clone()).await.unwrap().status(),
                StatusCode::OK
            );
        }
        for _ in 0..10 {
            let res = attempt(wrong.clone()).await.unwrap();
            assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        }

        let eleventh = attempt(wrong.clone()).await.unwrap();

        assert_eq!(eleventh.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            attempt(r.key.clone()).await.unwrap().status(),
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn the_progress_routes_refuse_a_request_without_credentials() {
        let r = reader().await;
        let document = "0".repeat(32);
        let routes = [
            ("PUT", "/kosync/syncs/progress".to_owned()),
            ("GET", format!("/kosync/syncs/progress/{document}")),
        ];
        for (method, uri) in routes {
            let req = kosync_request(method, &uri, None, Some(ACCEPT), None);

            let res = r.app.clone().oneshot(req).await.unwrap();

            assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{method} {uri}");
        }
    }
}

mod users_create {
    use super::*;

    #[tokio::test]
    async fn post_users_create_refuses_registration_with_or_without_credentials() {
        let r = reader().await;
        let body = json!({"username": "new", "password": "md5ofit"});
        for creds in [None, Some((USERNAME, r.key.as_str()))] {
            let req = kosync_request(
                "POST",
                "/kosync/users/create",
                creds,
                Some(ACCEPT),
                Some(body.clone()),
            );

            let res = r.app.clone().oneshot(req).await.unwrap();

            assert_eq!(res.status(), StatusCode::FORBIDDEN);
            assert_eq!(
                body_json::<Value>(res).await,
                json!({
                    "code": 2005,
                    "message": "Create a sync password in Omnibus under Settings \u{203a} Devices."
                })
            );
        }
    }
}

mod accept_header {
    use super::*;

    #[tokio::test]
    async fn every_route_answers_412_code_101_without_the_koreader_accept_header() {
        let r = reader().await;
        let document = "0".repeat(32);
        let routes = [
            ("POST", "/kosync/users/create".to_owned()),
            ("GET", "/kosync/users/auth".to_owned()),
            ("PUT", "/kosync/syncs/progress".to_owned()),
            ("GET", format!("/kosync/syncs/progress/{document}")),
        ];
        for accept in [None, Some("application/json")] {
            for (method, uri) in &routes {
                let creds = Some((USERNAME, r.key.as_str()));
                let req = kosync_request(method, uri, creds, accept, None);

                let res = r.app.clone().oneshot(req).await.unwrap();

                assert_eq!(
                    res.status(),
                    StatusCode::PRECONDITION_FAILED,
                    "{method} {uri}"
                );
                let body: Value = body_json(res).await;
                assert_eq!(
                    body,
                    json!({"code": 101, "message": "Invalid Accept header format."})
                );
            }
        }
    }
}

mod put_progress {
    use super::*;

    #[tokio::test]
    async fn put_syncs_progress_lands_on_the_web_as_a_percent_and_a_cfi() {
        let r = reader().await;
        let (uuid, document, _file) = seeded_book(&r).await;

        let res = send(
            &r,
            "PUT",
            "/kosync/syncs/progress",
            Some(push_body(&document, SECOND_PARAGRAPH_XPOINTER, 0.6378)),
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let body: Value = body_json(res).await;
        assert_eq!(body["document"], document);
        assert!(body["timestamp"].as_i64().is_some_and(|t| t > 0));
        let epub = web_epub(&r, &uuid).await.unwrap();
        assert_eq!(epub.progress_percent, Some(63));
        assert_eq!(epub.epub_cfi.as_deref(), Some(SECOND_PARAGRAPH_CFI));
    }

    #[tokio::test]
    async fn put_syncs_progress_with_an_unprovable_xpointer_stores_the_percent_alone() {
        let r = reader().await;
        let (uuid, document, _file) = seeded_book(&r).await;
        let unprovable = "/body/DocFragment[2]/body/p[9]/text().1";

        let res = send(
            &r,
            "PUT",
            "/kosync/syncs/progress",
            Some(push_body(&document, unprovable, 0.5)),
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let epub = web_epub(&r, &uuid).await.unwrap();
        assert_eq!((epub.epub_cfi, epub.progress_percent), (None, Some(50)));
        let pulled = send(
            &r,
            "GET",
            &format!("/kosync/syncs/progress/{document}"),
            None,
        )
        .await;
        assert_eq!(body_json::<Value>(pulled).await["progress"], unprovable);
    }

    #[tokio::test]
    async fn put_syncs_progress_resolves_the_digest_of_an_override_baked_download() {
        let export = tempfile::tempdir().unwrap();
        let _env = EnvVarGuard::set_os("OMNIBUS_EXPORT_EPUB_DIR", Some(export.path().as_os_str()));
        let r = reader().await;
        let (uuid, _original, file) = seeded_book(&r).await;
        let overrides = MetadataOverrides {
            title: Some("Retitled".into()),
            ..Default::default()
        };
        db::upsert_metadata_overrides(&r.pool, &uuid, &overrides, false, r.user_id)
            .await
            .unwrap();
        let id = db::resolve_book_id_by_uuid(&r.pool, &uuid)
            .await
            .unwrap()
            .unwrap();
        let baked = db::rewritten_epub_path(&r.pool, id, &file)
            .await
            .unwrap()
            .expect("an override bakes a download");
        let baked_digest = db::partial_md5::partial_md5(&baked).unwrap();

        let res = send(
            &r,
            "PUT",
            "/kosync/syncs/progress",
            Some(push_body(&baked_digest, SECOND_PARAGRAPH_XPOINTER, 0.6378)),
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            web_epub(&r, &uuid).await.unwrap().progress_percent,
            Some(63)
        );
    }

    #[tokio::test]
    async fn put_syncs_progress_accepts_the_percentage_bounds_and_the_longest_progress() {
        let r = reader().await;
        let (uuid, document, _file) = seeded_book(&r).await;
        let longest = "a".repeat(omnibus_shared::EPUB_CFI_MAX_LEN);
        let cases = [
            (0.0, SECOND_PARAGRAPH_XPOINTER, 0),
            (1.0, longest.as_str(), 100),
        ];
        for (percentage, progress, stored) in cases {
            let body = push_body(&document, progress, percentage);

            let res = send(&r, "PUT", "/kosync/syncs/progress", Some(body)).await;

            assert_eq!(res.status(), StatusCode::OK, "{percentage}");
            let epub = web_epub(&r, &uuid).await.unwrap();
            assert_eq!(epub.progress_percent, Some(stored), "{percentage}");
        }
    }

    #[tokio::test]
    async fn put_syncs_progress_answers_200_and_stores_nothing_for_an_unknown_document() {
        let r = reader().await;
        let (uuid, _document, _file) = seeded_book(&r).await;
        let unknown = "f".repeat(32);

        let res = send(
            &r,
            "PUT",
            "/kosync/syncs/progress",
            Some(push_body(&unknown, SECOND_PARAGRAPH_XPOINTER, 0.5)),
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(body_json::<Value>(res).await["document"], unknown);
        assert!(web_epub(&r, &uuid).await.is_none());
    }

    #[tokio::test]
    async fn put_syncs_progress_refuses_a_malformed_document_with_code_2004() {
        let r = reader().await;
        for document in ["z".repeat(32), "a".repeat(31), String::new()] {
            let res = send(
                &r,
                "PUT",
                "/kosync/syncs/progress",
                Some(push_body(&document, SECOND_PARAGRAPH_XPOINTER, 0.5)),
            )
            .await;

            assert_eq!(res.status(), StatusCode::FORBIDDEN, "{document:?}");
            assert_eq!(body_json::<Value>(res).await["code"], 2004, "{document:?}");
        }
    }

    #[tokio::test]
    async fn put_syncs_progress_refuses_an_invalid_body_with_code_2003() {
        let r = reader().await;
        let (_uuid, document, _file) = seeded_book(&r).await;
        let valid = push_body(&document, SECOND_PARAGRAPH_XPOINTER, 0.5);
        let with = |field: &str, value: Option<Value>| {
            let mut body = valid.clone();
            match value {
                Some(v) => body[field] = v,
                None => {
                    body.as_object_mut().unwrap().remove(field);
                }
            }
            body
        };
        let too_long = "a".repeat(omnibus_shared::EPUB_CFI_MAX_LEN + 1);
        let cases = [
            ("percentage above 1", with("percentage", Some(json!(1.2)))),
            ("percentage below 0", with("percentage", Some(json!(-0.1)))),
            ("missing percentage", with("percentage", None)),
            ("missing progress", with("progress", None)),
            ("empty progress", with("progress", Some(json!("")))),
            (
                "oversized progress",
                with("progress", Some(json!(too_long))),
            ),
            ("missing device", with("device", None)),
        ];
        for (name, body) in cases {
            let res = send(&r, "PUT", "/kosync/syncs/progress", Some(body)).await;

            assert_eq!(res.status(), StatusCode::FORBIDDEN, "{name}");
            let body: Value = body_json(res).await;
            assert_eq!(
                body,
                json!({"code": 2003, "message": "Invalid request"}),
                "{name}"
            );
        }
    }
}

mod get_progress {
    use super::*;

    #[tokio::test]
    async fn get_syncs_progress_hands_back_the_pushed_xpointer_byte_for_byte() {
        let r = reader().await;
        let (_uuid, document, _file) = seeded_book(&r).await;
        let spelled = "/body/DocFragment[2]/body/p[2]/text()[1].6";
        send(
            &r,
            "PUT",
            "/kosync/syncs/progress",
            Some(push_body(&document, spelled, 0.6378)),
        )
        .await;

        let res = send(
            &r,
            "GET",
            &format!("/kosync/syncs/progress/{document}"),
            None,
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let body: Value = body_json(res).await;
        assert_eq!(body["progress"], spelled);
        assert_eq!(body["percentage"], 0.63);
        assert_eq!(body["device"], "Omnibus");
        assert_eq!(body["device_id"], "omnibus");
        assert_eq!(body["document"], document);
    }

    #[tokio::test]
    async fn get_syncs_progress_turns_a_later_web_position_into_an_xpointer() {
        let r = reader().await;
        let (uuid, document, _file) = seeded_book(&r).await;
        let pushed = send(
            &r,
            "PUT",
            "/kosync/syncs/progress",
            Some(push_body(&document, SECOND_PARAGRAPH_XPOINTER, 0.6378)),
        )
        .await;
        let pushed_at = body_json::<Value>(pushed).await["timestamp"]
            .as_i64()
            .unwrap();
        web_writes(
            &r,
            json!({
                "book_uuid": uuid,
                "format": "epub",
                "epub_cfi": FIRST_PARAGRAPH_CFI,
                "progress_percent": 55,
            }),
        )
        .await;

        let res = send(
            &r,
            "GET",
            &format!("/kosync/syncs/progress/{document}"),
            None,
        )
        .await;

        let body: Value = body_json(res).await;
        assert_eq!(body["progress"], FIRST_PARAGRAPH_XPOINTER);
        assert_eq!(body["percentage"], 0.55);
        assert_eq!(body["device"], "Omnibus");
        assert!(body["timestamp"].as_i64().unwrap() >= pushed_at);
    }

    #[tokio::test]
    async fn get_syncs_progress_derives_a_position_for_a_percent_only_row_on_a_measured_book() {
        let r = reader().await;
        let (uuid, document, file) = seeded_book(&r).await;
        let structure = db::ebook::toc::extract_structure_from_path(&file)
            .unwrap()
            .unwrap();
        let (file_id, _) = db::book_file_with_id(&r.pool, 1, "EPUB")
            .await
            .unwrap()
            .unwrap();
        db::epub_structure::replace_structure(&r.pool, file_id, &structure)
            .await
            .unwrap();
        web_writes(
            &r,
            json!({"book_uuid": uuid, "format": "epub", "progress_percent": 50}),
        )
        .await;

        let res = send(
            &r,
            "GET",
            &format!("/kosync/syncs/progress/{document}"),
            None,
        )
        .await;

        let body: Value = body_json(res).await;
        assert_eq!(body["progress"], "/body/DocFragment[2]/body/p[1]/text().6");
        assert_eq!(body["percentage"], 0.5);
    }

    #[tokio::test]
    async fn get_syncs_progress_answers_an_empty_object_when_no_position_can_be_produced() {
        let r = reader().await;
        let (uuid, document, _file) = seeded_book(&r).await;
        let uri = format!("/kosync/syncs/progress/{document}");

        let before_any_position = send(&r, "GET", &uri, None).await;
        assert_eq!(body_json::<Value>(before_any_position).await, json!({}));

        // An unmeasured book: a bare percent has no position to hand a KOReader.
        web_writes(
            &r,
            json!({"book_uuid": uuid, "format": "epub", "progress_percent": 50}),
        )
        .await;
        let percent_only = send(&r, "GET", &uri, None).await;
        assert_eq!(body_json::<Value>(percent_only).await, json!({}));
    }

    #[tokio::test]
    async fn get_syncs_progress_answers_an_empty_object_for_an_unknown_document() {
        let r = reader().await;
        let unknown = "f".repeat(32);

        let res = send(
            &r,
            "GET",
            &format!("/kosync/syncs/progress/{unknown}"),
            None,
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(body_json::<Value>(res).await, json!({}));
    }
}
