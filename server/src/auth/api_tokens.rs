//! `/api/auth/api-tokens` handlers: the self-service create/list/revoke
//! surface for long-lived API tokens. Every route is scoped to the
//! authenticated caller — one user's request can only see or revoke their
//! own tokens. The create response is the only place the raw secret ever
//! appears (AC2); the listing carries names and timestamps, never secrets.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::auth::{self as auth_db, ApiToken, AuthError};
use omnibus_shared::{
    ApiTokenView, CreateApiTokenRequest, CreateApiTokenResponse, RenameApiTokenRequest,
};

use super::extractor::AuthUser;
use crate::backend::AppState;
use crate::http_errors::internal;

/// Project a db token row to its wire view (no hash, no secret).
fn to_view(t: ApiToken) -> ApiTokenView {
    ApiTokenView {
        id: t.id,
        name: t.name,
        created_at: t.created_at,
        last_used_at: t.last_used_at,
        suffix: t.suffix,
    }
}

/// List your API tokens
///
/// Names, dates and the last four characters of each live token. A token's secret is shown
/// only once, when it is created.
#[utoipa::path(
    get,
    path = "/api/auth/api-tokens",
    tag = "Auth",
    operation_id = "list_api_tokens",
    responses((status = 200, description = "Your live API tokens.", body = Vec<ApiTokenView>)),
)]
pub async fn get_api_tokens_handler(user: AuthUser, State(state): State<AppState>) -> Response {
    match auth_db::list_api_tokens_for_user(state.pool(), user.id).await {
        Ok(rows) => Json(rows.into_iter().map(to_view).collect::<Vec<_>>()).into_response(),
        Err(e) => internal("list api tokens", e),
    }
}

/// Create an API token
///
/// Makes a long-lived token that authenticates as you, for scripts and integrations. Copy
/// `secret` from the response: the server keeps only a hash of it and can't show it again.
#[utoipa::path(
    post,
    path = "/api/auth/api-tokens",
    tag = "Auth",
    operation_id = "create_api_token",
    request_body = CreateApiTokenRequest,
    responses(
        (status = 200, description = "The new token, with its secret.", body = CreateApiTokenResponse),
        (status = 400, description = "The name is empty or too long."),
    ),
)]
pub async fn post_api_token_handler(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<CreateApiTokenRequest>,
) -> Response {
    match auth_db::create_api_token(state.pool(), user.id, &req.name).await {
        Ok(minted) => Json(CreateApiTokenResponse {
            token: to_view(minted.token),
            secret: minted.raw_token,
        })
        .into_response(),
        Err(AuthError::Validation(msg)) => (StatusCode::BAD_REQUEST, msg).into_response(),
        Err(e) => internal("create api token", e),
    }
}

/// Rename an API token
#[utoipa::path(
    patch,
    path = "/api/auth/api-tokens/{id}",
    tag = "Auth",
    operation_id = "rename_api_token",
    params(("id" = i64, Path, description = "The token's id.")),
    request_body = RenameApiTokenRequest,
    responses(
        (status = 204, description = "Renamed."),
        (status = 400, description = "The name is empty or too long."),
        (status = 404, description = "You have no live token with that id."),
    ),
)]
pub async fn patch_api_token_handler(
    user: AuthUser,
    State(state): State<AppState>,
    Path(token_id): Path<i64>,
    Json(req): Json<RenameApiTokenRequest>,
) -> Response {
    match auth_db::rename_api_token_for_user(state.pool(), user.id, token_id, &req.name).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(AuthError::Validation(msg)) => (StatusCode::BAD_REQUEST, msg).into_response(),
        Err(AuthError::ApiTokenNotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => internal("rename api token", e),
    }
}

/// Revoke an API token
///
/// The token stops working at once.
#[utoipa::path(
    delete,
    path = "/api/auth/api-tokens/{id}",
    tag = "Auth",
    operation_id = "revoke_api_token",
    params(("id" = i64, Path, description = "The token's id.")),
    responses(
        (status = 204, description = "Revoked."),
        // Unknown, already revoked and someone else's all answer 404, so ids can't be probed.
        (status = 404, description = "You have no live token with that id."),
    ),
)]
pub async fn delete_api_token_handler(
    user: AuthUser,
    State(state): State<AppState>,
    Path(token_id): Path<i64>,
) -> Response {
    match auth_db::revoke_api_token_for_user(state.pool(), user.id, token_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(AuthError::ApiTokenNotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => internal("revoke api token", e),
    }
}

#[cfg(test)]
mod tests;
