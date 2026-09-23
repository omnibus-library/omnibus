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

use super::{fixture_audiobook, fixture_epub, multipart_body, post_multipart};
use crate::auth::test_support as auth_test_support;
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

/// A router carrying the test-scale time limits, plus an admin's token.
async fn timed_app(request_timeout: Duration) -> (Router, String) {
    let pool = omnibus_db::init_db("sqlite::memory:")
        .await
        .expect("db should initialize");
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
    (app, token)
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

/// Both inspect routes, each with a file its parser accepts.
fn inspect_uploads() -> [(&'static str, &'static str, Vec<u8>); 2] {
    [
        ("/api/uploads/ebooks/inspect", "book.epub", fixture_epub()),
        (
            "/api/uploads/audiobooks/inspect",
            "book.mp3",
            fixture_audiobook("ada_lovelace_solo/the_analytical_audiobook.mp3"),
        ),
    ]
}

#[tokio::test]
async fn upload_inspect_outlasts_the_request_timeout_while_its_body_keeps_arriving() {
    for (uri, filename, file) in inspect_uploads() {
        let (app, token) = timed_app(REQUEST_TIMEOUT).await;
        let (ct, body) = multipart_body(&[("file", Some(filename), &file)]);

        let started = Instant::now();
        let res = app
            .oneshot(post_multipart(uri, &token, &ct, trickled(body)))
            .await
            .expect("request should succeed");

        assert!(
            started.elapsed() > REQUEST_TIMEOUT,
            "{uri}: the body must take longer than the request timeout to arrive"
        );
        assert_eq!(res.status(), StatusCode::OK, "{uri}");
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
    let (app, token) = timed_app(Duration::from_secs(10)).await;
    let res = app.oneshot(validators(&token)).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let (app, token) = timed_app(REQUEST_TIMEOUT).await;
    let res = app.oneshot(validators(&token)).await.unwrap();
    assert_eq!(res.status(), StatusCode::REQUEST_TIMEOUT);
}

#[tokio::test]
async fn upload_inspect_answers_408_stalled_once_its_body_stops_arriving() {
    for (uri, filename, file) in inspect_uploads() {
        let (app, token) = timed_app(REQUEST_TIMEOUT).await;
        let (ct, body) = multipart_body(&[("file", Some(filename), &file)]);

        // Bounded, so a missing idle timeout fails here instead of hanging.
        let res = tokio::time::timeout(
            UPLOAD_IDLE_TIMEOUT * 10,
            app.oneshot(post_multipart(uri, &token, &ct, stalled(body))),
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
