//! Send-to-Kindle REST handlers (mobile-facing). Mirrors the web server
//! functions in `frontend/src/rpc/{kindle,account}.rs` and the SMTP admin RPCs
//! in `frontend/src/rpc/settings.rs`: per-user send + Kindle-email, delivery
//! readiness, and the admin-only SMTP config (get / set / clear / test).

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, worker::Task};
use omnibus_shared::{
    KindleDelivery, KindleSendQueued, KindleSendRequest, KindleSendStatus, KindleSendStatusQuery,
    ProgressState, SetKindleEmail, SmtpConfigStatus, SmtpConfigUpdate, BOOK_UUID_MAX_LEN,
};

use super::{internal, AppState};
use crate::auth::{AdminUser, AuthUser};

/// Send a book to your Kindle
///
/// Queues an email of the book's EPUB, or its PDF when it has no EPUB, to your Kindle
/// address, and answers before it goes out. Poll `GET /api/kindle/send/status` with the
/// `task_id` to learn whether it was sent. A file over 50 MB fails there, not here.
#[utoipa::path(
    post,
    path = "/api/kindle/send",
    tag = "Account",
    operation_id = "send_to_kindle",
    request_body = KindleSendRequest,
    responses(
        (status = 200, description = "The send is queued.", body = KindleSendQueued),
        (status = 404, description = "No book has that uuid."),
        (status = 409, description = "The server has no email delivery set up."),
        (status = 422, description = "`book_uuid` is longer than 64 bytes, or you have no Kindle address set."),
    ),
)]
pub(super) async fn post_send(
    user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<KindleSendRequest>,
) -> Response {
    // Reject an oversized lookup key before any DB round trip.
    if body.book_uuid.len() > BOOK_UUID_MAX_LEN {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("book_uuid must be ≤ {BOOK_UUID_MAX_LEN} bytes"),
        )
            .into_response();
    }
    let recipient = match db::auth::get_kindle_email(&state.pool, user.id).await {
        Ok(Some(email)) => email,
        Ok(None) => {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                "add your Kindle email in Settings › Devices before sending",
            )
                .into_response();
        }
        Err(e) => return internal("read kindle email", e),
    };
    match db::effective_smtp_config(&state.pool).await {
        Ok(Some(_)) => {}
        Ok(None) => {
            return (
                StatusCode::CONFLICT,
                "email delivery is not configured on this server",
            )
                .into_response();
        }
        Err(e) => return internal("read smtp config", e),
    }
    let book_id = match db::resolve_book_id_by_uuid(&state.pool, &body.book_uuid).await {
        Ok(Some(id)) => id,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("resolve book", e),
    };

    let task_id = state.worker.post(Task::SendToKindle {
        book_id,
        book_file_id: body.file_id,
        recipient_email: recipient,
    });
    // Scope the pollable status to this user so the guessable task-id space
    // can't be probed for other users' send outcomes.
    state.worker.set_task_owner(task_id, user.id);
    Json(KindleSendQueued { task_id }).into_response()
}

/// Check on a Kindle send
///
/// Whether a send from `POST /api/kindle/send` is still going, went out, or failed. Poll
/// about once a second: a finished send is forgotten 10 seconds after it ends.
#[utoipa::path(
    get,
    path = "/api/kindle/send/status",
    tag = "Account",
    operation_id = "get_kindle_send_status",
    params(KindleSendStatusQuery),
    responses(
        (status = 200, description = "Where the send stands.", body = KindleSendStatus),
        (status = 404, description = "No send of yours has that `task_id`, or it ended more than 10 seconds ago."),
    ),
)]
pub(super) async fn get_send_status(
    user: AuthUser,
    State(state): State<AppState>,
    Query(q): Query<KindleSendStatusQuery>,
) -> Response {
    // Owner-scoped so the guessable task-id space can't be probed for other users' sends.
    match state.worker.owned_task_state(q.task_id, user.id) {
        Some(ProgressState::Running { .. }) => Json(KindleSendStatus::Pending).into_response(),
        Some(ProgressState::Done { .. }) => Json(KindleSendStatus::Sent).into_response(),
        Some(ProgressState::Failed { message }) => {
            Json(KindleSendStatus::Failed { message }).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Set your Kindle address
///
/// Sets or clears the address `POST /api/kindle/send` emails books to. Read back as
/// `kindle_email` on `GET /api/auth/me`.
#[utoipa::path(
    post,
    path = "/api/account/kindle-email",
    tag = "Account",
    request_body = SetKindleEmail,
    responses(
        (status = 200, description = "The address is saved."),
        (status = 422, description = "The address doesn't look like an email address, or is over 320 bytes."),
    ),
)]
pub(super) async fn post_kindle_email(
    user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<SetKindleEmail>,
) -> Response {
    match db::auth::set_kindle_email(&state.pool, user.id, body.email.as_deref()).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(db::auth::AuthError::Validation(msg)) => {
            (StatusCode::UNPROCESSABLE_ENTITY, msg).into_response()
        }
        Err(e) => internal("set kindle email", e),
    }
}

/// Check Send to Kindle delivery
///
/// Whether the server can email books, and the sender address you must approve at Amazon
/// before a Kindle accepts them. Never carries the mail server or its credentials.
#[utoipa::path(
    get,
    path = "/api/kindle/delivery",
    tag = "Account",
    operation_id = "get_kindle_delivery",
    responses(
        (status = 200, description = "The sender address, or null when the server has no email delivery set up.", body = KindleDelivery),
    ),
)]
pub(super) async fn get_delivery(_user: AuthUser, State(state): State<AppState>) -> Response {
    match db::effective_smtp_config(&state.pool).await {
        Ok(config) => Json(KindleDelivery {
            sender_address: config.map(|c| c.from_email),
        })
        .into_response(),
        Err(e) => internal("read smtp config", e),
    }
}

/// Get the email settings
///
/// The outgoing mail server Send to Kindle uses, with the password left out. Needs an
/// admin account.
#[utoipa::path(
    get,
    path = "/api/smtp",
    tag = "Admin",
    operation_id = "get_smtp_config",
    responses(
        (status = 200, description = "The email settings.", body = SmtpConfigStatus),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn get_smtp(_admin: AdminUser, State(state): State<AppState>) -> Response {
    match db::smtp_status(&state.pool).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => internal("read smtp config", e),
    }
}

/// Save the email settings
///
/// Sets the outgoing mail server Send to Kindle uses. Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/smtp",
    tag = "Admin",
    operation_id = "set_smtp_config",
    request_body = SmtpConfigUpdate,
    responses(
        (status = 200, description = "The settings are saved; the body is what is now set.", body = SmtpConfigStatus),
        (status = 403, description = "You aren't an admin."),
        (status = 422, description = "`host` is empty or over 255 bytes, `port` is 0, `username` is over 255 bytes, `password` is over 1024 bytes, or `from_email` isn't an email address; the body says which."),
    ),
)]
pub(super) async fn post_smtp(
    _admin: AdminUser,
    State(state): State<AppState>,
    Json(update): Json<SmtpConfigUpdate>,
) -> Response {
    match db::set_smtp_config(&state.pool, &update).await {
        Ok(()) => {}
        Err(db::SettingsError::Validation(msg)) => {
            return (StatusCode::UNPROCESSABLE_ENTITY, msg).into_response();
        }
        Err(e) => return internal("save smtp config", e),
    }
    match db::smtp_status(&state.pool).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => internal("read smtp config", e),
    }
}

/// Clear the email settings
///
/// Removes the saved outgoing mail server. Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/smtp/clear",
    tag = "Admin",
    operation_id = "clear_smtp_config",
    responses(
        (status = 200, description = "The settings are cleared; the body is what is now set.", body = SmtpConfigStatus),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn post_smtp_clear(_admin: AdminUser, State(state): State<AppState>) -> Response {
    match db::clear_smtp_config(&state.pool).await {
        Ok(()) => match db::smtp_status(&state.pool).await {
            Ok(s) => Json(s).into_response(),
            Err(e) => internal("read smtp config", e),
        },
        Err(e) => internal("clear smtp config", e),
    }
}

/// Send a test email
///
/// Emails a short message, with no book attached, to your own Kindle address through the
/// saved mail server, and waits for the server to accept it. Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/smtp/test",
    tag = "Admin",
    operation_id = "test_smtp_config",
    responses(
        (status = 200, description = "The mail server accepted the test email."),
        (status = 403, description = "You aren't an admin."),
        (status = 409, description = "The server has no email delivery set up."),
        (status = 422, description = "You have no Kindle address set."),
        (status = 502, description = "The mail server refused the email or didn't answer within 90 seconds."),
    ),
)]
pub(super) async fn post_smtp_test(admin: AdminUser, State(state): State<AppState>) -> Response {
    let recipient = match db::auth::get_kindle_email(&state.pool, admin.0.id).await {
        Ok(Some(email)) => email,
        Ok(None) => {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                "set your Kindle email in Settings › Devices first, then send a test",
            )
                .into_response();
        }
        Err(e) => return internal("read kindle email", e),
    };
    match db::kindle::send_test(&state.pool, &recipient).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(db::kindle::KindleError::NotConfigured) => (
            StatusCode::CONFLICT,
            "email delivery is not configured on this server",
        )
            .into_response(),
        // `NoEpub`/`Timeout` carry a safe, specific message.
        Err(e @ (db::kindle::KindleError::NoEpub | db::kindle::KindleError::Timeout)) => {
            (StatusCode::BAD_GATEWAY, e.to_string()).into_response()
        }
        // `Address`/`Build`/`Smtp` wrap opaque `lettre` internals, but are
        // still upstream-gateway failures (not our bug) — keep 502, drop the
        // raw error text, and log the real cause server-side.
        Err(
            e @ (db::kindle::KindleError::Address(_)
            | db::kindle::KindleError::Build(_)
            | db::kindle::KindleError::Smtp(_)),
        ) => {
            tracing::error!(error = %e, context = "send test email", "smtp gateway error");
            (
                StatusCode::BAD_GATEWAY,
                "failed to send the test email via the configured SMTP server",
            )
                .into_response()
        }
        // `Io`/`Settings`/`Books` are our own failures, not the gateway's.
        Err(e) => internal("send test email", e),
    }
}

#[cfg(test)]
mod tests;
