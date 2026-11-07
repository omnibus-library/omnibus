//! Helpers for bootstrapping authenticated sessions in handler integration
//! tests, so each test attaches a real bearer token (or cookie) in one line.
//! User creation goes through raw SQL rather than [`db::auth::create_user`],
//! which auto-promotes the first user to admin and flips `registration_enabled`
//! off — tests want explicit role assignment, not the registration policy.

use axum::Router;
use omnibus_db::{
    self as db,
    auth::{NewSession, SessionKind, User},
};
use sqlx::SqlitePool;

use super::{auth_router, AuthUser, BEARER_TTL_SECS, COOKIE_TTL_SECS, SESSION_COOKIE};
use crate::backend::AppState;
// `SESSION_COOKIE` (plain name) is intentionally used here even on a
// production-shaped deploy: the read side `parse_session_token` accepts
// either form, so integration-test cookies don't need to negotiate the
// `OMNIBUS_SECURE_COOKIES` env var to hit the same code path.

/// The `/api/auth/*` router over a fresh in-memory database, and that database's pool.
pub async fn app() -> (Router, SqlitePool) {
    let pool = db::init_db("sqlite::memory:").await.unwrap();
    let router = auth_router(AppState::new(pool.clone()));
    (router, pool)
}

/// Insert a user with the given `is_admin` flag, bypassing the registration
/// gate and first-user auto-promote logic. The password hash is a sentinel
/// that no `verify_password` call will accept — these test users only log
/// in via direct session minting.
async fn insert_user(pool: &SqlitePool, username: &str, is_admin: bool) -> User {
    let admin_flag = if is_admin { 1i64 } else { 0 };
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO users (username, password_hash, is_admin, can_upload, can_edit, can_download,
                            can_start_requests, can_choose_request_versions)
         VALUES (?, '!test-no-password', ?, ?, ?, 1, ?, ?)
         RETURNING id",
    )
    .bind(username)
    .bind(admin_flag)
    .bind(admin_flag)
    .bind(admin_flag)
    .bind(admin_flag)
    .bind(admin_flag)
    .fetch_one(pool)
    .await
    .expect("insert user");
    User {
        id,
        username: username.to_string(),
        is_admin,
        can_upload: is_admin,
        can_edit: is_admin,
        can_download: true,
        can_start_requests: is_admin,
        can_choose_request_versions: is_admin,
        kindle_email: None,
        display_name: None,
        has_avatar: false,
        hidden_formats: Vec::new(),
        book_detail_scroll_stops: false,
        stack_series: false,
        share_stats: true,
        stats_exclusions: Default::default(),
    }
}

/// Overwrite a user's stored `is_admin` and request permissions, as an admin editing them would.
pub async fn set_request_flags(
    pool: &SqlitePool,
    user_id: i64,
    is_admin: bool,
    can_start_requests: bool,
    can_choose_request_versions: bool,
) {
    sqlx::query(
        "UPDATE users SET is_admin = ?, can_start_requests = ?, can_choose_request_versions = ?
         WHERE id = ?",
    )
        .bind(is_admin)
        .bind(can_start_requests)
        .bind(can_choose_request_versions)
        .bind(user_id)
        .execute(pool)
        .await
        .expect("set request flags");
}

/// Create a non-admin user.
pub async fn create_user(pool: &SqlitePool, username: &str) -> User {
    insert_user(pool, username, false).await
}

/// Create a non-admin user holding the edit permission.
pub async fn create_editor(pool: &SqlitePool, username: &str) -> User {
    let user = create_user(pool, username).await;
    sqlx::query("UPDATE users SET can_edit = 1 WHERE id = ?")
        .bind(user.id)
        .execute(pool)
        .await
        .expect("grant can_edit");
    User {
        can_edit: true,
        ..user
    }
}

/// Create an admin user.
pub async fn create_admin(pool: &SqlitePool, username: &str) -> User {
    insert_user(pool, username, true).await
}

/// Create a non-admin user whose password actually verifies, for flows that
/// authenticate with raw credentials rather than a minted session (OPDS
/// HTTP Basic). The default [`create_user`] sentinel hash deliberately
/// fails `verify_password`, so it can't back these tests.
pub async fn create_user_with_password(pool: &SqlitePool, username: &str, password: &str) -> User {
    let phc = db::auth::hash_password(password).expect("hash password");
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO users (username, password_hash, is_admin, can_upload, can_edit, can_download)
         VALUES (?, ?, 0, 0, 0, 1)
         RETURNING id",
    )
    .bind(username)
    .bind(&phc)
    .fetch_one(pool)
    .await
    .expect("insert user");
    User {
        id,
        username: username.to_string(),
        is_admin: false,
        can_upload: false,
        can_edit: false,
        can_download: true,
        can_start_requests: false,
        can_choose_request_versions: false,
        kindle_email: None,
        display_name: None,
        has_avatar: false,
        hidden_formats: Vec::new(),
        book_detail_scroll_stops: false,
        stack_series: false,
        share_stats: true,
        stats_exclusions: Default::default(),
    }
}

/// Issue a bearer session for `user_id`. Returns the raw token (no `Bearer `
/// prefix) — call sites format it as `format!("Bearer {token}")`.
pub async fn bearer_token(pool: &SqlitePool, user_id: i64) -> String {
    let issued: NewSession = db::auth::create_session(
        pool,
        user_id,
        None,
        SessionKind::Bearer,
        BEARER_TTL_SECS,
        None,
    )
    .await
    .expect("create_session should succeed");
    issued.raw_token
}

/// Issue a cookie session for `user_id`. Returns the full `name=value` pair
/// suitable for the `Cookie` request header.
pub async fn cookie_value(pool: &SqlitePool, user_id: i64) -> String {
    let issued: NewSession = db::auth::create_session(
        pool,
        user_id,
        None,
        SessionKind::Cookie,
        COOKIE_TTL_SECS,
        None,
    )
    .await
    .expect("create_session should succeed");
    format!("{}={}", SESSION_COOKIE, issued.raw_token)
}

/// A non-admin `AuthUser` for driving a handler directly with a pool closed afterwards:
/// closing it before a routed request would fail the extractor's own session lookup
/// instead of the handler body under test.
pub fn fake_auth_user(id: i64, session_id: i64) -> AuthUser {
    AuthUser {
        id,
        username: "reader".to_string(),
        is_admin: false,
        can_upload: false,
        can_edit: false,
        can_download: true,
        can_start_requests: false,
        can_choose_request_versions: false,
        kindle_email: None,
        display_name: None,
        has_avatar: false,
        hidden_formats: Vec::new(),
        book_detail_scroll_stops: false,
        stack_series: false,
        share_stats: true,
        stats_exclusions: Default::default(),
        session_id,
        session_kind: SessionKind::Bearer,
        impersonator_id: None,
        session_expires_at: i64::MAX,
    }
}
