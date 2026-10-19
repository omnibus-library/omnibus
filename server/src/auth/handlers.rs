//! `/api/auth/*` handlers plus the small router that mounts them. Cookie
//! sessions (web) and bearer sessions (mobile) are selected by `client_kind` in
//! the request body: `ios`/`android`/`bearer` yields a bearer session with the
//! token in the JSON response; anything else (or unset) yields a cookie session
//! with the token in `Set-Cookie`.

use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json, Router,
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use omnibus_db::auth::{self as auth_db, AuthError, NewSession, SessionKind};
use omnibus_shared::{
    ChangePasswordRequest, LoginRequest, LoginResponse, RegisterRequest, RegistrationStatus,
    SessionView, UserSummary,
};
use utoipa_axum::{router::OpenApiRouter, routes};

use super::extractor::{extract_token, AuthUser};
use super::session_view::session_views;
use super::{session_cookie_name, BEARER_TTL_SECS, COOKIE_TTL_SECS};
use crate::backend::AppState;
use crate::http_errors::internal;

/// The `/api/auth/*` routes with their documentation, before state: [`auth_router`]
/// serves them and `backend::openapi::spec` documents them.
pub fn auth_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(register_handler))
        .routes(routes!(registration_handler))
        .routes(routes!(login_handler))
        .routes(routes!(logout_handler))
        .routes(routes!(me_handler))
        .routes(routes!(get_sessions_handler))
        .routes(routes!(delete_session_handler))
        .routes(routes!(change_password_handler))
        .routes(routes!(
            super::api_tokens::get_api_tokens_handler,
            super::api_tokens::post_api_token_handler
        ))
        .routes(routes!(
            super::api_tokens::delete_api_token_handler,
            super::api_tokens::patch_api_token_handler
        ))
}

/// Build the `/api/auth/*` router.
pub fn auth_router(state: AppState) -> Router {
    let pool = state.pool().clone();
    let (router, _doc) = auth_routes().split_for_parts();
    router
        .with_state(state)
        // `AuthUser` reads the pool from `Extension<SqlitePool>` so it stays
        // state-agnostic. Keep this layer here so the router is usable
        // standalone (in integration tests) without relying on the
        // top-level Extension layer in `main.rs`.
        .layer(Extension(pool))
}

fn user_summary(u: &auth_db::User) -> UserSummary {
    UserSummary {
        id: u.id,
        username: u.username.clone(),
        is_admin: u.is_admin,
        can_upload: u.can_upload,
        can_edit: u.can_edit,
        can_download: u.can_download,
        kindle_email: u.kindle_email.clone(),
        display_name: u.display_name.clone(),
        has_avatar: u.has_avatar,
        hidden_formats: u.hidden_formats.clone(),
        book_detail_scroll_stops: u.book_detail_scroll_stops,
        stack_series: u.stack_series,
        share_stats: u.share_stats,
    }
}

fn auth_error_to_response(e: AuthError) -> Response {
    match e {
        AuthError::InvalidCredentials => {
            (StatusCode::UNAUTHORIZED, "invalid credentials").into_response()
        }
        // Reachable only for a caller that presented the correct password —
        // `verify_login` answers `InvalidCredentials` for a wrong one on a
        // locked row, so this 429 confirms nothing about whether a username
        // exists. The generic body is kept anyway.
        AuthError::AccountLocked { until_unix } => {
            // Fall open at `until_unix` if SystemTime is unreadable or
            // doesn't fit i64 — that makes `retry_after = 0` rather than
            // an enormous header that prolongs the lockout for a clock
            // glitch the client didn't cause.
            let now_unix = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .ok()
                .and_then(|d| i64::try_from(d.as_secs()).ok())
                .unwrap_or(until_unix);
            let retry_after = until_unix.saturating_sub(now_unix).max(0);
            let mut headers = HeaderMap::new();
            if let Ok(v) = retry_after.to_string().parse() {
                headers.insert(header::RETRY_AFTER, v);
            }
            (
                StatusCode::TOO_MANY_REQUESTS,
                headers,
                "invalid credentials",
            )
                .into_response()
        }
        // The one credential oracle left standing, deliberately: a sign-up
        // form cannot work without telling the caller the name is taken.
        // Self-registration is off by default once the first user exists.
        AuthError::UsernameTaken => (StatusCode::CONFLICT, "username taken").into_response(),
        // Not reachable from login/register, but the match is exhaustive: the
        // admin user-management surface (`backend::users`) owns these.
        AuthError::UserNotFound => (StatusCode::NOT_FOUND, "user not found").into_response(),
        AuthError::LastAdmin => {
            (StatusCode::CONFLICT, "cannot remove the last administrator").into_response()
        }
        AuthError::Validation(msg) => (StatusCode::BAD_REQUEST, msg).into_response(),
        AuthError::RegistrationDisabled => {
            (StatusCode::FORBIDDEN, "registration disabled").into_response()
        }
        AuthError::SessionNotFound => (StatusCode::UNAUTHORIZED, "unauthorized").into_response(),
        // Not reachable from login/register/logout/sessions; the admin
        // device-revoke surface (`backend::admin_sessions`) owns this.
        AuthError::DeviceNotFound => (StatusCode::NOT_FOUND, "device not found").into_response(),
        // Not reachable from these handlers either; the API-token surface
        // (`auth::api_tokens`) owns this.
        AuthError::ApiTokenNotFound => {
            (StatusCode::NOT_FOUND, "api token not found").into_response()
        }
        AuthError::Internal(e) => internal("auth error", e),
        AuthError::Crypto(e) => internal("auth crypto error", e),
    }
}

fn want_bearer(kind: Option<&str>) -> bool {
    matches!(kind, Some("ios") | Some("android") | Some("bearer"))
}

/// Parse the `OMNIBUS_SECURE_COOKIES` env value (defaults to `true` when unset).
pub fn parse_secure_cookies(raw: Option<&str>) -> bool {
    match raw {
        Some(v) => {
            let v = v.trim().to_ascii_lowercase();
            !matches!(v.as_str(), "0" | "false" | "no" | "")
        }
        None => true, // default on; set OMNIBUS_SECURE_COOKIES=0 only for non-localhost HTTP origins (e.g. LAN IPs)
    }
}

fn secure_cookies() -> bool {
    parse_secure_cookies(std::env::var("OMNIBUS_SECURE_COOKIES").ok().as_deref())
}

/// Build a session cookie: `__Host-omnibus_session` (always `Secure`, `Path=/`, no
/// `Domain`, as the prefix requires) when `OMNIBUS_SECURE_COOKIES` is on (the
/// default), else the plain `omnibus_session` name so loopback/LAN HTTP keeps working.
fn session_cookie(value: String, max_age_secs: i64) -> Cookie<'static> {
    let secure = secure_cookies();
    // Invariants required by the `__Host-` prefix when `secure` is true:
    // no Domain attribute, Path=/, Secure. We set all three unconditionally
    // here so a future edit can't break the prefix contract by accident.
    let mut c = Cookie::new(session_cookie_name(secure), value);
    c.set_http_only(true);
    c.set_same_site(SameSite::Lax);
    c.set_path("/");
    c.set_secure(secure);
    c.set_max_age(time::Duration::seconds(max_age_secs));
    c
}

fn cleared_cookie() -> Cookie<'static> {
    let secure = secure_cookies();
    let mut c = Cookie::new(session_cookie_name(secure), "");
    c.set_http_only(true);
    c.set_same_site(SameSite::Lax);
    c.set_path("/");
    c.set_secure(secure);
    c.set_max_age(time::Duration::seconds(0));
    c
}

/// Create an account
///
/// Creates a user and signs them in, exactly as `POST /api/auth/login` does. The first
/// account on a new server becomes its admin. After that, registration works only while an
/// admin keeps it open; `GET /api/auth/registration` says whether it is.
#[utoipa::path(
    post,
    path = "/api/auth/register",
    tag = "Auth",
    operation_id = "register",
    security(()),
    request_body = RegisterRequest,
    responses(
        (status = 200, description = "The account exists and is signed in.", body = LoginResponse,
            headers(("Set-Cookie" = String, description = "The session cookie, unless `client_kind` asked for a token."))),
        (status = 400, description = "The username or password breaks a rule; the body says which."),
        (status = 403, description = "Registration is closed."),
        (status = 409, description = "That username is taken."),
    ),
)]
async fn register_handler(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(req): Json<RegisterRequest>,
) -> Response {
    let user = match auth_db::create_user(state.pool(), &req.username, &req.password).await {
        Ok(u) => u,
        Err(e) => return auth_error_to_response(e),
    };
    issue_session(
        &state,
        jar,
        user,
        req.client_kind,
        req.device_name,
        req.client_version,
        request_user_agent(&headers),
    )
    .await
}

/// The request's `User-Agent`, or `None` when absent or not valid UTF-8. The
/// header is how a web session — which registers no device — is later named in
/// the sessions listing.
fn request_user_agent(headers: &HeaderMap) -> Option<&str> {
    headers.get(header::USER_AGENT)?.to_str().ok()
}

/// Check whether registration is open
///
/// Whether `POST /api/auth/register` will accept a new account. An admin opens and closes
/// registration with `POST /api/settings/registration`.
#[utoipa::path(
    get,
    path = "/api/auth/registration",
    tag = "Auth",
    operation_id = "get_registration",
    security(()),
    responses((status = 200, description = "Whether registration is open.", body = RegistrationStatus)),
)]
async fn registration_handler(State(state): State<AppState>) -> Response {
    // Public by design: the sign-in and sign-up pages read it before any session
    // exists, and it reveals nothing `POST /api/auth/register` wouldn't.
    match auth_db::registration_enabled(state.pool()).await {
        Ok(enabled) => Json(RegistrationStatus { enabled }).into_response(),
        Err(e) => auth_error_to_response(e),
    }
}

/// Sign in
///
/// Checks the username and password and opens a session. Set `client_kind` to `ios`,
/// `android` or `bearer` to get the token in the body, for an `Authorization: Bearer`
/// header; without it the session arrives as a cookie. Send `device_name` as well and the
/// session is listed under that name.
#[utoipa::path(
    post,
    path = "/api/auth/login",
    tag = "Auth",
    operation_id = "login",
    security(()),
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Signed in.", body = LoginResponse,
            headers(("Set-Cookie" = String, description = "The session cookie, unless `client_kind` asked for a token."))),
        (status = 400, description = "`device_name` or `client_version` is too long or holds control characters."),
        (status = 401, description = "Wrong username or password."),
        (status = 429, description = "Too many wrong passwords: the account is locked for the number of seconds in `Retry-After`.",
            headers(("Retry-After" = i64, description = "Seconds until the account unlocks."))),
    ),
)]
async fn login_handler(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(req): Json<LoginRequest>,
) -> Response {
    let user = match auth_db::verify_login(state.pool(), &req.username, &req.password).await {
        Ok(u) => u,
        Err(e) => return auth_error_to_response(e),
    };
    issue_session(
        &state,
        jar,
        user,
        req.client_kind,
        req.device_name,
        req.client_version,
        request_user_agent(&headers),
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn issue_session(
    state: &AppState,
    jar: CookieJar,
    user: auth_db::User,
    client_kind: Option<String>,
    device_name: Option<String>,
    client_version: Option<String>,
    user_agent: Option<&str>,
) -> Response {
    let bearer = want_bearer(client_kind.as_deref());

    let (kind, ttl) = if bearer {
        (SessionKind::Bearer, BEARER_TTL_SECS)
    } else {
        (SessionKind::Cookie, COOKIE_TTL_SECS)
    };

    let issued = match persist_session(
        state,
        user.id,
        device_name.as_deref(),
        client_kind.as_deref(),
        client_version.as_deref(),
        kind,
        ttl,
        user_agent,
    )
    .await
    {
        Ok(s) => s,
        Err(e) => return auth_error_to_response(e),
    };

    let body = LoginResponse {
        user: user_summary(&user),
        token: if bearer {
            Some(issued.raw_token.clone())
        } else {
            None
        },
    };

    if bearer {
        (StatusCode::OK, Json(body)).into_response()
    } else {
        let jar = jar.add(session_cookie(issued.raw_token, ttl));
        (StatusCode::OK, jar, Json(body)).into_response()
    }
}

/// Atomically insert the (optional) device row and the session row inside a
/// single `sqlx::Transaction`. If either write — or the commit — fails, the
/// transaction rolls back on drop so a device row never lingers without its
/// matching session.
#[allow(clippy::too_many_arguments)]
async fn persist_session(
    state: &AppState,
    user_id: i64,
    device_name: Option<&str>,
    client_kind: Option<&str>,
    client_version: Option<&str>,
    kind: SessionKind,
    ttl: i64,
    user_agent: Option<&str>,
) -> Result<NewSession, AuthError> {
    let mut tx = state.pool().begin().await?;

    let device_id = if let (Some(name), Some(client_kind)) = (device_name, client_kind) {
        let d =
            auth_db::register_device(&mut *tx, user_id, name, client_kind, client_version).await?;
        Some(d.id)
    } else {
        None
    };

    let issued =
        auth_db::create_session(&mut *tx, user_id, device_id, kind, ttl, user_agent).await?;
    tx.commit().await?;
    Ok(issued)
}

/// Sign out
///
/// Ends the session the request carries and clears the session cookie. Signing out of a
/// session that has already ended still succeeds.
#[utoipa::path(
    post,
    path = "/api/auth/logout",
    tag = "Auth",
    operation_id = "logout",
    security((), ("bearer" = []), ("session_cookie" = [])),
    responses((status = 204, description = "Signed out.")),
)]
async fn logout_handler(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
) -> Response {
    // Resolve the session from either cookie or bearer, revoke it, and
    // clear the cookie. Idempotent: unknown tokens still return 204.
    if let Some((token, _)) = extract_token(&headers) {
        match auth_db::lookup_session(state.pool(), &token).await {
            Ok((_user, session)) => {
                if let Err(e) = auth_db::revoke_session(state.pool(), session.id).await {
                    return internal("revoke session", e);
                }
            }
            Err(AuthError::SessionNotFound) => {}
            Err(e) => return internal("lookup session", e),
        }
    }
    let jar = jar.add(cleared_cookie());
    (StatusCode::NO_CONTENT, jar).into_response()
}

/// Get the signed-in user
///
/// The account the request's session belongs to: its permissions and preferences.
#[utoipa::path(
    get,
    path = "/api/auth/me",
    tag = "Auth",
    operation_id = "get_me",
    responses(
        (status = 200, description = "The signed-in user.", body = UserSummary),
        // Listed although any route can answer it: clients read it here as "signed out".
        (status = 401, description = "The request has no live session."),
    ),
)]
async fn me_handler(user: AuthUser) -> Response {
    Json(user.summary()).into_response()
}

/// List your sessions
///
/// Every live session on your account. The one making this request has `is_current` set,
/// since it can't be ended from here.
#[utoipa::path(
    get,
    path = "/api/auth/sessions",
    tag = "Auth",
    operation_id = "list_sessions",
    responses((status = 200, description = "Your live sessions.", body = Vec<SessionView>)),
)]
async fn get_sessions_handler(user: AuthUser, State(state): State<AppState>) -> Response {
    let rows = match auth_db::list_sessions_for_user(state.pool(), user.id).await {
        Ok(rows) => rows,
        Err(e) => return internal("list own sessions", e),
    };
    match session_views(state.pool(), user.id, rows, Some(user.session_id)).await {
        Ok(views) => Json(views).into_response(),
        Err(e) => internal("list own sessions", e),
    }
}

/// End one of your sessions
///
/// Signs that session out wherever it is. To end the session making this request, use
/// `POST /api/auth/logout`.
#[utoipa::path(
    delete,
    path = "/api/auth/sessions/{id}",
    tag = "Auth",
    operation_id = "delete_session",
    params(("id" = i64, Path, description = "The session's id, from `GET /api/auth/sessions`.")),
    responses(
        (status = 204, description = "The session has ended."),
        (status = 400, description = "That is the session making this request."),
        // Unknown, already ended and someone else's all answer 404, so ids can't be probed.
        (status = 404, description = "You have no live session with that id."),
    ),
)]
async fn delete_session_handler(
    user: AuthUser,
    State(state): State<AppState>,
    Path(session_id): Path<i64>,
) -> Response {
    if session_id == user.session_id {
        return (
            StatusCode::BAD_REQUEST,
            "cannot revoke the currently-active session",
        )
            .into_response();
    }
    match auth_db::revoke_session_for_user(state.pool(), user.id, session_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(AuthError::SessionNotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => internal("revoke own session", e),
    }
}

/// Change your password
///
/// Switches your password and signs out every other session, keeping the one making this
/// request. Sign in with your password to call it: an API token can't, so a leaked token
/// can't take the account.
#[utoipa::path(
    post,
    path = "/api/auth/password",
    tag = "Auth",
    operation_id = "change_password",
    request_body = ChangePasswordRequest,
    responses(
        (status = 204, description = "The password is changed and your other sessions are signed out."),
        (status = 400, description = "`new_password` fails the password rules; the body says which."),
        (status = 403, description = "`current_password` is wrong, or the request is authenticated by an API token or HTTP Basic rather than a session."),
    ),
)]
async fn change_password_handler(
    user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<ChangePasswordRequest>,
) -> Response {
    // A token or Basic principal has no session to keep alive.
    if !matches!(user.session_kind, SessionKind::Cookie | SessionKind::Bearer) {
        return (
            StatusCode::FORBIDDEN,
            "sign in with your password to change it",
        )
            .into_response();
    }
    match auth_db::change_password(
        state.pool(),
        user.id,
        &body.current_password,
        &body.new_password,
        user.session_id,
    )
    .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        // Not 401: the caller is signed in, and a client reads 401 as a dead session.
        Err(AuthError::InvalidCredentials) => {
            (StatusCode::FORBIDDEN, "current password is incorrect").into_response()
        }
        Err(e) => auth_error_to_response(e),
    }
}

#[cfg(test)]
mod tests;
