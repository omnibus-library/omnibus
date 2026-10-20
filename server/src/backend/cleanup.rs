//! The library-cleanup review routes under `/api/admin/cleanup`, behind the
//! Administration Cleanup section and its review page. REST twins of the
//! `rpc_cleanup_*` server functions, all `AdminUser`-gated.
//!
//! A refusal the reviewer can act on becomes a 409 carrying its sentence; a
//! fault in the database or in a stored row is logged and answered generically.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{
    self as db,
    cleanup::{CleanupStoreError, REVIEW_QUEUE_MAX},
    worker::Task,
    CleanupApplyError, MetadataOverridesError,
};
use omnibus_shared::{
    CleanupDecisionOutcome, CleanupDecisionRequest, CleanupKind, CleanupKindCounts, SuggestionCard,
};

use super::{internal, AppState};
use crate::auth::AdminUser;

/// A store failure as a response: the refusals safe to show are 409, the rest 500.
fn store_error(context: &'static str, error: CleanupStoreError) -> Response {
    match error {
        CleanupStoreError::Refused(message) => (StatusCode::CONFLICT, message).into_response(),
        CleanupStoreError::Apply(inner) => apply_error(context, inner),
        CleanupStoreError::Db(_)
        | CleanupStoreError::Payload(_)
        | CleanupStoreError::UnknownToken(_) => internal(context, error),
    }
}

/// An apply or undo failure as a response: only the opaque faults are 500, the typed
/// variants carry a sentence safe to show.
fn apply_error(context: &'static str, error: CleanupApplyError) -> Response {
    match error {
        CleanupApplyError::Db(inner) => internal(context, inner),
        CleanupApplyError::Snapshot(inner) => internal(context, inner),
        CleanupApplyError::Overrides(
            inner @ (MetadataOverridesError::BookNotFound(_)
            | MetadataOverridesError::TooManyValues { .. }),
        ) => (StatusCode::CONFLICT, inner.to_string()).into_response(),
        CleanupApplyError::Overrides(inner) => internal(context, inner),
        other => (StatusCode::CONFLICT, other.to_string()).into_response(),
    }
}

/// Get the cleanup counts
///
/// How many cleanup suggestions are pending, accepted and rejected for each kind of
/// record, in the order `author`, `series`, `tag`, `book_title`. Needs an admin account.
#[utoipa::path(
    get,
    path = "/api/admin/cleanup/counts",
    tag = "Admin",
    responses(
        (status = 200, description = "The counts for each kind.", body = Vec<CleanupKindCounts>),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn get_cleanup_counts(
    _admin: AdminUser,
    State(state): State<AppState>,
) -> Response {
    match db::cleanup::review_counts(&state.pool).await {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|(kind, counts)| CleanupKindCounts { kind, counts })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(error) => store_error("cleanup counts", error),
    }
}

/// List a kind's cleanup suggestions
///
/// The suggestions of one kind still waiting for a decision, oldest first, up to 50. Each
/// has the names involved and how many books it would touch. Needs an admin account.
#[utoipa::path(
    get,
    path = "/api/admin/cleanup/{kind}/queue",
    tag = "Admin",
    params(("kind" = CleanupKind, Path, description = "The kind of record to review.")),
    responses(
        (status = 200, description = "The pending suggestions.", body = Vec<SuggestionCard>),
        (status = 400, description = "`kind` isn't `author`, `series`, `tag` or `book_title`."),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn get_cleanup_queue(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(kind): Path<CleanupKind>,
) -> Response {
    match db::cleanup::review_queue(&state.pool, kind, REVIEW_QUEUE_MAX).await {
        Ok(cards) => Json(cards).into_response(),
        Err(error) => store_error("cleanup queue", error),
    }
}

/// Decide a cleanup suggestion
///
/// Accepts or rejects one pending suggestion. An accept applies the change before the call
/// answers, and returns the id that undoes it; a reject changes nothing. Needs an admin
/// account.
#[utoipa::path(
    post,
    path = "/api/admin/cleanup/suggestions/{id}/decision",
    tag = "Admin",
    params(("id" = i64, Path, description = "The suggestion's id.")),
    request_body = CleanupDecisionRequest,
    responses(
        (status = 200, description = "The decision is recorded.", body = CleanupDecisionOutcome),
        (status = 403, description = "You aren't an admin."),
        (status = 409, description = "No suggestion has that id, it was already reviewed, `decision` is `pending`, `value` isn't accepted for it, or the change can't be applied."),
    ),
)]
pub(super) async fn post_cleanup_decision(
    admin: AdminUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(request): Json<CleanupDecisionRequest>,
) -> Response {
    match db::cleanup::decide_suggestion(
        &state.pool,
        id,
        request.decision,
        admin.0.id,
        request.value.as_deref(),
    )
    .await
    {
        Ok(log_id) => Json(CleanupDecisionOutcome { log_id }).into_response(),
        Err(error) => store_error("cleanup decide", error),
    }
}

/// Look for cleanup suggestions
///
/// Queues a pass of every detector and answers without waiting for it. The counts update
/// as it finishes. Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/admin/cleanup/detect",
    tag = "Admin",
    responses(
        (status = 202, description = "The detection is queued."),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn post_cleanup_detect(
    _admin: AdminUser,
    State(state): State<AppState>,
) -> StatusCode {
    state.worker.post(Task::DetectCleanup { kind: None });
    StatusCode::ACCEPTED
}

/// Undo a cleanup change
///
/// Reverses a change an accepted suggestion applied, by the `log_id` that decision
/// returned. Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/admin/cleanup/undo/{log_id}",
    tag = "Admin",
    params(("log_id" = i64, Path, description = "The id the accepted decision returned.")),
    responses(
        (status = 204, description = "The change is undone."),
        (status = 403, description = "You aren't an admin."),
        (status = 409, description = "No change has that id, or it was already undone."),
    ),
)]
pub(super) async fn post_cleanup_undo(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(log_id): Path<i64>,
) -> Response {
    match db::cleanup::undo(&state.pool, log_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => apply_error("cleanup undo", error),
    }
}

#[cfg(test)]
mod tests;
