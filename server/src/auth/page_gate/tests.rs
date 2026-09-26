//! Tests for the page-load session gate, driven through a router whose
//! fallback stands in for the Dioxus SSR + static-asset service.

use axum::{
    body::Body,
    http::{Request as HttpRequest, StatusCode},
    middleware::from_fn_with_state,
    Router,
};
use omnibus_db as db;
use sqlx::SqlitePool;
use tower::ServiceExt;

use super::*;
use crate::auth::test_support::{bearer_token, cookie_value, create_user};

async fn app() -> (Router, SqlitePool) {
    let pool = db::init_db("sqlite::memory:").await.unwrap();
    let state = AppState::new(pool.clone());
    let router = Router::new()
        .fallback(|| async { "page" })
        .layer(from_fn_with_state(state, require_page_session));
    (router, pool)
}

async fn send(app: &Router, method: Method, uri: &str, cookie: Option<&str>) -> Response {
    let mut req = HttpRequest::builder().method(method).uri(uri);
    if let Some(cookie) = cookie {
        req = req.header(header::COOKIE, cookie);
    }
    app.clone()
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap()
}

async fn get(app: &Router, uri: &str) -> Response {
    send(app, Method::GET, uri, None).await
}

fn location(res: &Response) -> &str {
    res.headers()
        .get(header::LOCATION)
        .expect("a redirect carries a Location")
        .to_str()
        .unwrap()
}

fn assert_redirects_to(res: &Response, expected: &str) {
    assert_eq!(res.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(res), expected);
}

#[tokio::test]
async fn require_page_session_redirects_a_cookieless_page_load_to_login_with_next() {
    let (app, _pool) = app().await;
    assert_redirects_to(&get(&app, "/stats").await, "/login?next=%2Fstats");
    assert_redirects_to(
        &get(&app, "/books/some-uuid").await,
        "/login?next=%2Fbooks%2Fsome-uuid",
    );
}

#[tokio::test]
async fn require_page_session_redirects_the_landing_page_to_bare_login() {
    let (app, _pool) = app().await;
    assert_redirects_to(&get(&app, "/").await, "/login");
}

#[tokio::test]
async fn require_page_session_redirects_a_redirect_stub_page_too() {
    // `/account` renders an empty body on web while it redirects client-side
    // — the black page the issue reported.
    let (app, _pool) = app().await;
    assert_redirects_to(&get(&app, "/account").await, "/login?next=%2Faccount");
}

#[tokio::test]
async fn require_page_session_redirects_a_head_of_a_page() {
    let (app, _pool) = app().await;
    let res = send(&app, Method::HEAD, "/stats", None).await;
    assert_redirects_to(&res, "/login?next=%2Fstats");
}

#[tokio::test]
async fn require_page_session_percent_encodes_the_query_into_next() {
    let (app, _pool) = app().await;
    assert_redirects_to(
        &get(&app, "/settings?section=library").await,
        "/login?next=%2Fsettings%3Fsection%3Dlibrary",
    );
    assert_redirects_to(
        &get(&app, "/pdf/book-a?file_id=917&page=4").await,
        "/login?next=%2Fpdf%2Fbook-a%3Ffile_id%3D917%2526page%3D4",
    );
}

#[tokio::test]
async fn require_page_session_marks_the_redirect_uncacheable() {
    let (app, _pool) = app().await;
    let res = get(&app, "/stats").await;
    assert_eq!(res.headers()[header::CACHE_CONTROL], "no-store");
    assert_eq!(res.headers()[header::VARY], "Cookie, Authorization");
}

#[tokio::test]
async fn require_page_session_serves_a_page_to_a_live_session_cookie() {
    let (app, pool) = app().await;
    let user = create_user(&pool, "alice").await;
    let cookie = cookie_value(&pool, user.id).await;
    for uri in ["/", "/stats", "/settings?section=library"] {
        let res = send(&app, Method::GET, uri, Some(&cookie)).await;
        assert_eq!(res.status(), StatusCode::OK, "{uri} must render");
    }
}

#[tokio::test]
async fn require_page_session_serves_a_page_to_a_live_bearer() {
    let (app, pool) = app().await;
    let user = create_user(&pool, "alice").await;
    let token = bearer_token(&pool, user.id).await;
    let res = app
        .clone()
        .oneshot(
            HttpRequest::builder()
                .uri("/stats")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn require_page_session_redirects_a_session_cookie_that_has_expired() {
    let (app, pool) = app().await;
    let user = create_user(&pool, "alice").await;
    let cookie = cookie_value(&pool, user.id).await;
    sqlx::query("UPDATE sessions SET expires_at = 0")
        .execute(&pool)
        .await
        .unwrap();
    let res = send(&app, Method::GET, "/stats", Some(&cookie)).await;
    assert_redirects_to(&res, "/login?next=%2Fstats");
}

#[tokio::test]
async fn require_page_session_redirects_an_unknown_session_cookie() {
    let (app, _pool) = app().await;
    let cookie = format!("{}=not-a-session", crate::auth::SESSION_COOKIE);
    let res = send(&app, Method::GET, "/", Some(&cookie)).await;
    assert_redirects_to(&res, "/login");
}

#[tokio::test]
async fn require_page_session_serves_the_page_when_the_session_lookup_fails() {
    // Fail open: the client's own 401 redirect still catches a signed-out
    // reader, where a 303 here would lock everyone out on a DB hiccup.
    let (app, pool) = app().await;
    let user = create_user(&pool, "alice").await;
    let cookie = cookie_value(&pool, user.id).await;
    pool.close().await;
    let res = send(&app, Method::GET, "/stats", Some(&cookie)).await;
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn require_page_session_passes_the_sign_in_screens_through_without_a_session() {
    let (app, _pool) = app().await;
    for uri in ["/login", "/login?next=%2Fstats", "/register", "/connect"] {
        assert_eq!(get(&app, uri).await.status(), StatusCode::OK, "{uri}");
    }
}

#[tokio::test]
async fn require_page_session_passes_assets_api_and_unknown_paths_through() {
    // Everything that isn't a page lands in the router's catch-all.
    let (app, _pool) = app().await;
    for uri in [
        "/api/ebooks",
        "/api/rpc/stats",
        "/api/auth/me",
        "/assets/atrium-dxh1234.css",
        "/wasm/omnibus_bg.wasm",
        "/_dioxus",
        "/_dioxus/hot-reload",
        "/metrics",
        "/mcp",
        "/opds/catalog",
        "/kobo/some-token/v1/library/sync",
        "/favicon.ico",
        "/definitely-not-a-page",
    ] {
        assert_eq!(get(&app, uri).await.status(), StatusCode::OK, "{uri}");
    }
}

#[tokio::test]
async fn require_page_session_passes_a_non_read_method_through() {
    let (app, _pool) = app().await;
    for method in [Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS] {
        let res = send(&app, method.clone(), "/stats", None).await;
        assert_eq!(res.status(), StatusCode::OK, "{method}");
    }
}

#[test]
fn requires_session_exempts_only_the_sign_in_screens_and_the_catch_all() {
    assert!(requires_session(&Route::Landing {}));
    assert!(requires_session(&Route::Account {}));
    assert!(requires_session(&Route::BookRead { uuid: "b".into() }));
    assert!(!requires_session(&Route::Login { next: None }));
    assert!(!requires_session(&Route::Register {}));
    assert!(!requires_session(&Route::ServerConnect {}));
    assert!(!requires_session(&Route::NotFound { segments: vec![] }));
}
