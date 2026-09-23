//! The book uploads' time limits, driven at a sub-second scale through
//! `rest_router_with_timeouts`: an upload whose body keeps arriving outlasts
//! the request timeout that answers 408 on every other route, and one whose
//! body stops arriving is cut off by the idle timeout instead.

use std::{
    convert::Infallible,
    sync::Arc,
    time::{Duration, Instant},
};

use axum::{
    body::{to_bytes, Body, Bytes},
    http::{header::AUTHORIZATION, Request, StatusCode},
    Router,
};
use futures_util::{stream, StreamExt};
use tower::ServiceExt;

use omnibus_shared::Settings;

use super::{fixture_audiobook, fixture_epub, multipart_body, post_multipart};
use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::CoversDirGuard;
use crate::backend::{
    rest_router_with_timeouts, AppState, SEARCH_RATE_LIMIT_MAX, SEARCH_RATE_LIMIT_WINDOW,
};
use crate::rate_limit::RateLimiter;

/// Whole-request budget, standing in for the 30 s production one.
const REQUEST_TIMEOUT: Duration = Duration::from_millis(250);
/// Idle-body budget for the uploads: ten gaps' worth, so only a body that has
/// really stopped trips it.
const UPLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(1);
/// Silence before each piece of a trickled body.
const GAP: Duration = Duration::from_millis(100);
/// Pieces in a trickled body — their gaps add up to twice [`REQUEST_TIMEOUT`].
const PIECES: usize = 5;

/// A router carrying the test-scale time limits, an admin's token, and the
/// ebook and audiobook libraries the commit routes file into.
async fn timed_app(request_timeout: Duration) -> (Router, String, [tempfile::TempDir; 2]) {
    let pool = omnibus_db::init_db("sqlite::memory:")
        .await
        .expect("db should initialize");
    let libraries = [
        tempfile::tempdir().expect("temp ebook library"),
        tempfile::tempdir().expect("temp audiobook library"),
    ];
    let [ebooks, audiobooks] = &libraries;
    omnibus_db::set_settings(
        &pool,
        &Settings {
            ebook_library_path: Some(ebooks.path().to_string_lossy().to_string()),
            audiobook_library_path: Some(audiobooks.path().to_string_lossy().to_string()),
            scan_interval_hours: None,
        },
    )
    .await
    .expect("set library paths");
    let admin = auth_test_support::create_admin(&pool, "admin").await;
    let token = auth_test_support::bearer_token(&pool, admin.id).await;
    let search_limiter = Arc::new(RateLimiter::with_policy(
        SEARCH_RATE_LIMIT_WINDOW,
        SEARCH_RATE_LIMIT_MAX,
    ));
    let app = rest_router_with_timeouts(
        AppState::new(pool),
        search_limiter,
        request_timeout,
        UPLOAD_IDLE_TIMEOUT,
    );
    (app, token, libraries)
}

/// `bytes` in [`PIECES`] pieces, each after [`GAP`] of silence: a slow link
/// that is still making progress.
fn trickled(bytes: Vec<u8>) -> Body {
    let len = bytes.len();
    let pieces: Vec<Bytes> = (0..PIECES)
        .map(|i| Bytes::copy_from_slice(&bytes[i * len / PIECES..(i + 1) * len / PIECES]))
        .collect();
    Body::from_stream(stream::iter(pieces).then(|piece| async move {
        tokio::time::sleep(GAP).await;
        Ok::<_, Infallible>(piece)
    }))
}

/// The first half of `bytes`, then nothing ever again: a client that stopped
/// sending without closing the connection.
fn stalled(bytes: Vec<u8>) -> Body {
    let head = Bytes::copy_from_slice(&bytes[..bytes.len() / 2]);
    Body::from_stream(stream::iter([Ok::<_, Infallible>(head)]).chain(stream::pending()))
}

/// One book upload request, and the status its handler answers on success.
struct Upload {
    uri: &'static str,
    content_type: String,
    body: Vec<u8>,
    accepted: StatusCode,
}

/// A body `uri` accepts: the file alone for an inspect, plus the title and
/// author a commit files it under.
fn upload(uri: &'static str, filename: &str, file: &[u8], commit: bool) -> Upload {
    let mut parts: Vec<(&str, Option<&str>, &[u8])> = Vec::new();
    if commit {
        parts.push(("title", None, b"Slow Upload"));
        parts.push(("author", None, b"Patient Author"));
    }
    parts.push(("file", Some(filename), file));
    let (content_type, body) = multipart_body(&parts);
    let accepted = if commit {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Upload {
        uri,
        content_type,
        body,
        accepted,
    }
}

/// Every book upload route: inspect and commit, ebook and audiobook.
fn book_uploads() -> [Upload; 4] {
    let epub = fixture_epub();
    let mp3 = fixture_audiobook("ada_lovelace_solo/the_analytical_audiobook.mp3");
    [
        upload("/api/uploads/ebooks/inspect", "book.epub", &epub, false),
        upload("/api/uploads/ebooks", "book.epub", &epub, true),
        upload("/api/uploads/audiobooks/inspect", "book.mp3", &mp3, false),
        upload("/api/uploads/audiobooks", "book.mp3", &mp3, true),
    ]
}

#[tokio::test]
async fn book_upload_outlasts_the_request_timeout_while_its_body_keeps_arriving() {
    let _covers = CoversDirGuard::new("upload_outlasts_request_timeout");
    for upload in book_uploads() {
        let (app, token, _libraries) = timed_app(REQUEST_TIMEOUT).await;
        let uri = upload.uri;

        let started = Instant::now();
        let res = app
            .oneshot(post_multipart(
                uri,
                &token,
                &upload.content_type,
                trickled(upload.body),
            ))
            .await
            .expect("request should succeed");

        assert!(
            started.elapsed() > REQUEST_TIMEOUT,
            "{uri}: the body must take longer than the request timeout to arrive"
        );
        assert_eq!(res.status(), upload.accepted, "{uri}");
    }
}

#[tokio::test]
async fn non_upload_route_answers_408_once_the_same_body_outlasts_the_request_timeout() {
    let validators = |token: &str| {
        Request::builder()
            .uri("/api/downloads/validators")
            .method("POST")
            .header("content-type", "application/json")
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .body(trickled(br#"{"files":[]}"#.to_vec()))
            .unwrap()
    };

    // With a budget the body fits in, the same request succeeds — so the 408
    // below is the timeout, not the trickled body.
    let (app, token, _libraries) = timed_app(Duration::from_secs(10)).await;
    let res = app.oneshot(validators(&token)).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let (app, token, _libraries) = timed_app(REQUEST_TIMEOUT).await;
    let res = app.oneshot(validators(&token)).await.unwrap();
    assert_eq!(res.status(), StatusCode::REQUEST_TIMEOUT);
}

#[tokio::test]
async fn book_upload_answers_408_stalled_once_its_body_stops_arriving() {
    let _covers = CoversDirGuard::new("upload_stalled");
    for upload in book_uploads() {
        let (app, token, _libraries) = timed_app(REQUEST_TIMEOUT).await;
        let uri = upload.uri;

        // Bounded, so a missing idle timeout fails here instead of hanging.
        let res = tokio::time::timeout(
            UPLOAD_IDLE_TIMEOUT * 10,
            app.oneshot(post_multipart(
                uri,
                &token,
                &upload.content_type,
                stalled(upload.body),
            )),
        )
        .await
        .unwrap_or_else(|_| panic!("{uri}: nothing cut the stalled body off"))
        .expect("request should succeed");

        assert_eq!(res.status(), StatusCode::REQUEST_TIMEOUT, "{uri}");
        let text = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        assert!(
            String::from_utf8_lossy(&text).contains("upload stalled"),
            "{uri}: a stall answers with its own message, not the request timeout's empty 408"
        );
    }
}
