use axum::{
    body::Body,
    http::{header, Request, StatusCode},
    response::Response,
    Router,
};
use omnibus_db as db;
use omnibus_shared::UserSummary;
use tower::ServiceExt;

use super::super::test_support::{bearer_token, cookie_value, create_admin, create_user};
use super::super::{auth_router, COOKIE_TTL_SECS, IMPERSONATION_TTL_SECS};
use crate::backend::AppState;

async fn app() -> (Router, sqlx::SqlitePool) {
    let pool = db::init_db("sqlite::memory:").await.unwrap();
    let router = auth_router(AppState::new(pool.clone()));
    (router, pool)
}

async fn post(app: &Router, uri: &str, cookie: &str) -> Response {
    let req = Request::builder()
        .uri(uri)
        .method("POST")
        .header(header::COOKIE, cookie)
        .body(Body::empty())
        .unwrap();
    app.clone().oneshot(req).await.unwrap()
}

fn impersonate_uri(user_id: i64) -> String {
    format!("/api/admin/users/{user_id}/impersonate")
}

/// The `Set-Cookie` header a response carries.
fn set_cookie(res: &Response) -> String {
    res.headers()
        .get(header::SET_COOKIE)
        .expect("response sets a cookie")
        .to_str()
        .unwrap()
        .to_string()
}

/// The `name=value` pair of a `Set-Cookie` header, as a request `Cookie` header.
fn request_cookie(set_cookie: &str) -> String {
    set_cookie.split(';').next().unwrap().to_string()
}

async fn me(app: &Router, cookie: &str) -> (StatusCode, Option<UserSummary>) {
    let req = Request::builder()
        .uri("/api/auth/me")
        .header(header::COOKIE, cookie)
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).ok())
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

#[tokio::test]
async fn impersonate_signs_the_admin_in_as_the_target() {
    let (app, pool) = app().await;
    let admin = create_admin(&pool, "ada").await;
    sqlx::query("UPDATE users SET display_name = 'Ada Admin' WHERE id = ?")
        .bind(admin.id)
        .execute(&pool)
        .await
        .unwrap();
    let target = create_user(&pool, "bob").await;
    let admin_cookie = cookie_value(&pool, admin.id).await;

    let res = post(&app, &impersonate_uri(target.id), &admin_cookie).await;

    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    let header = set_cookie(&res);
    assert!(
        header.contains(&format!("Max-Age={IMPERSONATION_TTL_SECS}")),
        "got {header}"
    );
    let (status, summary) = me(&app, &request_cookie(&header)).await;
    assert_eq!(status, StatusCode::OK);
    let summary = summary.unwrap();
    assert_eq!(summary.id, target.id);
    let impersonation = summary.impersonation.expect("me reports the impersonation");
    assert_eq!(impersonation.impersonator_id, admin.id);
    assert_eq!(impersonation.impersonator_name, "Ada Admin");
    let remaining = impersonation.expires_at - unix_now();
    assert!(
        (IMPERSONATION_TTL_SECS - 10..=IMPERSONATION_TTL_SECS).contains(&remaining),
        "expires_at is {remaining}s away"
    );
    // Starting revokes the admin's own session in the same transaction.
    assert_eq!(me(&app, &admin_cookie).await.0, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn me_reports_no_impersonation_for_an_ordinary_session() {
    let (app, pool) = app().await;
    let user = create_user(&pool, "bob").await;

    let (status, summary) = me(&app, &cookie_value(&pool, user.id).await).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(summary.unwrap().impersonation, None);
}

#[tokio::test]
async fn impersonate_is_forbidden_for_a_non_admin() {
    let (app, pool) = app().await;
    let reader = create_user(&pool, "bob").await;
    let other = create_user(&pool, "cy").await;

    let res = post(
        &app,
        &impersonate_uri(other.id),
        &cookie_value(&pool, reader.id).await,
    )
    .await;

    assert_eq!(res.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn impersonate_refuses_your_own_account() {
    let (app, pool) = app().await;
    let admin = create_admin(&pool, "ada").await;

    let res = post(
        &app,
        &impersonate_uri(admin.id),
        &cookie_value(&pool, admin.id).await,
    )
    .await;

    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn impersonate_refuses_while_already_impersonating() {
    let (app, pool) = app().await;
    let admin = create_admin(&pool, "ada").await;
    let other_admin = create_admin(&pool, "ben").await;
    let target = create_user(&pool, "cy").await;
    let started = post(
        &app,
        &impersonate_uri(other_admin.id),
        &cookie_value(&pool, admin.id).await,
    )
    .await;
    let nested_cookie = request_cookie(&set_cookie(&started));

    let res = post(&app, &impersonate_uri(target.id), &nested_cookie).await;

    assert_eq!(res.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn impersonate_returns_404_for_an_unknown_user() {
    let (app, pool) = app().await;
    let admin = create_admin(&pool, "ada").await;

    let res = post(
        &app,
        &impersonate_uri(9999),
        &cookie_value(&pool, admin.id).await,
    )
    .await;

    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn impersonate_refuses_a_bearer_session() {
    let (app, pool) = app().await;
    let admin = create_admin(&pool, "ada").await;
    let target = create_user(&pool, "bob").await;
    let req = Request::builder()
        .uri(impersonate_uri(target.id))
        .method("POST")
        .header(
            header::AUTHORIZATION,
            format!("Bearer {}", bearer_token(&pool, admin.id).await),
        )
        .body(Body::empty())
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();

    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn me_is_unauthenticated_once_the_impersonation_session_expires() {
    let (app, pool) = app().await;
    let admin = create_admin(&pool, "ada").await;
    let target = create_user(&pool, "bob").await;
    let started = post(
        &app,
        &impersonate_uri(target.id),
        &cookie_value(&pool, admin.id).await,
    )
    .await;
    let cookie = request_cookie(&set_cookie(&started));
    assert_eq!(me(&app, &cookie).await.0, StatusCode::OK);

    sqlx::query("UPDATE sessions SET expires_at = 1 WHERE impersonator_id IS NOT NULL")
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(me(&app, &cookie).await.0, StatusCode::UNAUTHORIZED);
}

/// Start impersonating `target_id` as `admin_id`; returns the impersonation cookie.
async fn start_impersonating(
    app: &Router,
    pool: &sqlx::SqlitePool,
    admin_id: i64,
    target_id: i64,
) -> String {
    let res = post(
        app,
        &impersonate_uri(target_id),
        &cookie_value(pool, admin_id).await,
    )
    .await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    request_cookie(&set_cookie(&res))
}

#[tokio::test]
async fn stop_impersonation_returns_to_the_admin() {
    let (app, pool) = app().await;
    let admin = create_admin(&pool, "ada").await;
    let target = create_user(&pool, "bob").await;
    let impersonating = start_impersonating(&app, &pool, admin.id, target.id).await;

    let res = post(&app, "/api/auth/impersonation/stop", &impersonating).await;

    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    let header = set_cookie(&res);
    assert!(
        header.contains(&format!("Max-Age={COOKIE_TTL_SECS}")),
        "got {header}"
    );
    let (status, summary) = me(&app, &request_cookie(&header)).await;
    assert_eq!(status, StatusCode::OK);
    let summary = summary.unwrap();
    assert_eq!(summary.id, admin.id);
    assert_eq!(summary.impersonation, None);
    assert_eq!(me(&app, &impersonating).await.0, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn stop_impersonation_refuses_a_session_that_is_not_impersonating() {
    let (app, pool) = app().await;
    let admin = create_admin(&pool, "ada").await;

    let res = post(
        &app,
        "/api/auth/impersonation/stop",
        &cookie_value(&pool, admin.id).await,
    )
    .await;

    assert_eq!(res.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn logout_while_impersonating_returns_to_the_admin() {
    let (app, pool) = app().await;
    let admin = create_admin(&pool, "ada").await;
    let target = create_user(&pool, "bob").await;
    let impersonating = start_impersonating(&app, &pool, admin.id, target.id).await;

    let res = post(&app, "/api/auth/logout", &impersonating).await;

    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    let header = set_cookie(&res);
    assert!(
        header.contains(&format!("Max-Age={COOKIE_TTL_SECS}")),
        "got {header}"
    );
    let (status, summary) = me(&app, &request_cookie(&header)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(summary.unwrap().id, admin.id);
    assert_eq!(me(&app, &impersonating).await.0, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn admin_password_reset_ends_the_impersonation_session_that_admin_opened() {
    let (app, pool) = app().await;
    let admin = create_admin(&pool, "ada").await;
    let target = create_user(&pool, "bob").await;
    let impersonating = start_impersonating(&app, &pool, admin.id, target.id).await;

    db::auth::admin_set_password(&pool, admin.id, "a-brand-new-password")
        .await
        .unwrap();

    let res = post(&app, "/api/auth/impersonation/stop", &impersonating).await;
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    assert!(res.headers().get(header::SET_COOKIE).is_none());
}

#[tokio::test]
async fn stop_impersonation_refuses_a_cookie_that_already_stopped() {
    let (app, pool) = app().await;
    let admin = create_admin(&pool, "ada").await;
    let target = create_user(&pool, "bob").await;
    let impersonating = start_impersonating(&app, &pool, admin.id, target.id).await;
    let first = post(&app, "/api/auth/impersonation/stop", &impersonating).await;
    assert_eq!(first.status(), StatusCode::NO_CONTENT);

    let again = post(&app, "/api/auth/impersonation/stop", &impersonating).await;

    assert_eq!(again.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn return_to_impersonator_opens_no_admin_session_when_the_impersonation_was_already_revoked()
{
    let (app, pool) = app().await;
    let admin = create_admin(&pool, "ada").await;
    let target = create_user(&pool, "bob").await;
    start_impersonating(&app, &pool, admin.id, target.id).await;
    let session_id: i64 =
        sqlx::query_scalar("SELECT id FROM sessions WHERE impersonator_id IS NOT NULL")
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query("UPDATE sessions SET revoked_at = 1 WHERE id = ?")
        .bind(session_id)
        .execute(&pool)
        .await
        .unwrap();

    let result = super::return_to_impersonator(
        &AppState::new(pool.clone()),
        target.id,
        &target.username,
        session_id,
        Some(admin.id),
        None,
    )
    .await;

    assert!(matches!(result, Err(db::auth::AuthError::SessionNotFound)));
    let live_admin_sessions: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sessions WHERE user_id = ? AND revoked_at IS NULL",
    )
    .bind(admin.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(live_admin_sessions, 0);
}
