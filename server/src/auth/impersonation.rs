//! An admin signing in as another account for a bounded time. The handlers
//! swap the admin's cookie session for a one-hour session of the target that
//! names the admin, and `me_handler` reads that back as [`Impersonation`].
//! They live here, apart from `handlers.rs`, because they share the
//! session-swap transaction and the audit log lines.

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use axum_extra::extract::cookie::CookieJar;
use omnibus_db::auth::{self as auth_db, AuthError, NewSession, SessionKind};
use omnibus_shared::Impersonation;

use super::extractor::{AdminUser, AuthUser};
use super::handlers::{request_user_agent, session_cookie};
use super::{COOKIE_TTL_SECS, IMPERSONATION_TTL_SECS};
use crate::backend::AppState;
use crate::http_errors::internal;

/// A session swap that failed: 401 when the session was revoked under the request, else a 500.
fn swap_failure(context: &'static str, e: AuthError) -> Response {
    match e {
        AuthError::SessionNotFound => (StatusCode::UNAUTHORIZED, "unauthorized").into_response(),
        e => internal(context, e),
    }
}

/// The name another reader sees for `user`: their display name, else their username.
pub fn shown_name(user: &auth_db::User) -> &str {
    user.display_name.as_deref().unwrap_or(&user.username)
}

/// Sign in as another account
///
/// Replaces your session with a one-hour session as that user, with every permission they
/// have, sent back as a session cookie. Your own session ends, so once the hour is up you
/// sign in again. `GET /api/auth/me` reports who is behind the session. It works only for a
/// browser session, never inside another impersonation, and never on your own account.
/// Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/admin/users/{id}/impersonate",
    tag = "Admin",
    operation_id = "admin_impersonate_user",
    params(("id" = i64, Path, description = "The user's id.")),
    responses(
        (status = 204, description = "You are signed in as that user.",
            headers(("Set-Cookie" = String, description = "The new session cookie."))),
        (status = 400, description = "The request is not a browser session, or the id is your own."),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "No user has that id."),
        (status = 409, description = "You are already signed in as another user."),
    ),
)]
pub async fn impersonate_handler(
    admin: AdminUser,
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Path(user_id): Path<i64>,
) -> Response {
    let admin = admin.0;
    if admin.session_kind != SessionKind::Cookie {
        return (
            StatusCode::BAD_REQUEST,
            "only a browser session can sign in as another user",
        )
            .into_response();
    }
    if admin.impersonator_id.is_some() {
        return (StatusCode::CONFLICT, "already signed in as another user").into_response();
    }
    if user_id == admin.id {
        return (StatusCode::BAD_REQUEST, "that is your own account").into_response();
    }
    let target = match auth_db::get_user_by_id(state.pool(), user_id).await {
        Ok(Some(user)) => user,
        Ok(None) => return (StatusCode::NOT_FOUND, "user not found").into_response(),
        Err(e) => return internal("load impersonation target", e),
    };

    let issued =
        match begin_impersonation(&state, &admin, target.id, request_user_agent(&headers)).await {
            Ok(issued) => issued,
            Err(e) => return internal("start impersonation", e),
        };

    tracing::info!(
        admin_id = admin.id,
        admin = %admin.username,
        user_id = target.id,
        user = %target.username,
        "impersonation started"
    );
    let jar = jar.add(session_cookie(issued.raw_token, IMPERSONATION_TTL_SECS));
    (StatusCode::NO_CONTENT, jar).into_response()
}

/// End the admin's own session and open the impersonation session in one transaction, so a
/// failure never leaves both alive or neither.
async fn begin_impersonation(
    state: &AppState,
    admin: &AuthUser,
    target_id: i64,
    user_agent: Option<&str>,
) -> Result<NewSession, AuthError> {
    let mut tx = state.pool().begin().await?;
    auth_db::revoke_session_checked(&mut *tx, admin.session_id).await?;
    let issued = auth_db::create_impersonation_session(
        &mut *tx,
        target_id,
        admin.id,
        IMPERSONATION_TTL_SECS,
        user_agent,
    )
    .await?;
    tx.commit().await?;
    Ok(issued)
}

/// Sign back in as the admin behind an impersonation session
///
/// Ends the impersonation and replaces it with a new session cookie for the admin who
/// started it. `POST /api/auth/logout` does the same while impersonating.
#[utoipa::path(
    post,
    path = "/api/auth/impersonation/stop",
    tag = "Auth",
    operation_id = "stop_impersonation",
    responses(
        (status = 204, description = "You are signed back in as the admin.",
            headers(("Set-Cookie" = String, description = "The admin's new session cookie."))),
        (status = 409, description = "The session is not an impersonation."),
    ),
)]
pub async fn stop_impersonation_handler(
    user: AuthUser,
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
) -> Response {
    match return_to_impersonator(
        &state,
        user.id,
        &user.username,
        user.session_id,
        user.impersonator_id,
        request_user_agent(&headers),
    )
    .await
    {
        Ok(Some(issued)) => signed_in_as_admin(jar, issued),
        Ok(None) => (StatusCode::CONFLICT, "not signed in as another user").into_response(),
        Err(e) => swap_failure("stop impersonation", e),
    }
}

/// The 204 that hands the browser the admin's new session cookie.
pub fn signed_in_as_admin(jar: CookieJar, issued: NewSession) -> Response {
    let jar = jar.add(session_cookie(issued.raw_token, COOKIE_TTL_SECS));
    (StatusCode::NO_CONTENT, jar).into_response()
}

/// End an impersonation session and open an ordinary one for the admin behind it, in one
/// transaction. `None` when `impersonator_id` is unset: the session is not an impersonation.
pub async fn return_to_impersonator(
    state: &AppState,
    user_id: i64,
    username: &str,
    session_id: i64,
    impersonator_id: Option<i64>,
    user_agent: Option<&str>,
) -> Result<Option<NewSession>, AuthError> {
    let Some(admin_id) = impersonator_id else {
        return Ok(None);
    };
    let admin = auth_db::get_user_by_id(state.pool(), admin_id)
        .await?
        .ok_or(AuthError::SessionNotFound)?;

    let mut tx = state.pool().begin().await?;
    auth_db::revoke_session_checked(&mut *tx, session_id).await?;
    let issued = auth_db::create_session(
        &mut *tx,
        admin.id,
        None,
        SessionKind::Cookie,
        COOKIE_TTL_SECS,
        user_agent,
    )
    .await?;
    tx.commit().await?;

    tracing::info!(
        admin_id = admin.id,
        admin = %admin.username,
        user_id,
        user = %username,
        "impersonation ended"
    );
    Ok(Some(issued))
}

/// Who is behind `user`'s session, or `None` for an ordinary sign-in.
pub async fn impersonation_of(
    state: &AppState,
    user: &AuthUser,
) -> Result<Option<Impersonation>, Response> {
    let Some(admin_id) = user.impersonator_id else {
        return Ok(None);
    };
    match auth_db::get_user_by_id(state.pool(), admin_id).await {
        Ok(Some(admin)) => Ok(Some(Impersonation {
            impersonator_id: admin.id,
            impersonator_name: shown_name(&admin).to_string(),
            expires_at: user.session_expires_at,
        })),
        // Deleting the admin cascades their sessions away, so this session is already dead.
        Ok(None) => Err((StatusCode::UNAUTHORIZED, "unauthorized").into_response()),
        Err(e) => Err(internal("load impersonator", e)),
    }
}

#[cfg(test)]
mod tests;
