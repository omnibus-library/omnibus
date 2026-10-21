//! Metadata-provider REST handlers — mobile-facing; web hits the analogous
//! `/api/rpc/metadata/*` server fns, which mirror these gates. The catalog is
//! readable by any authenticated user and carries no key material; the edition
//! search and hydrate are `can_edit`-gated, since they spend outbound provider
//! calls.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db as db;
use omnibus_shared::metadata_lookup::{
    EditionHydrateRequest, EditionSearchRequest, EditionSearchResponse, ProviderEdition,
    ProviderInfo,
};

use super::{internal, AppState};
use crate::auth::AuthUser;

/// The provider config for this instance: saved settings keys win over the
/// `GOOGLE_BOOKS_API_KEY` / `HARDCOVER_API_KEY` env vars — the same
/// resolution the check-in scan ladder uses, so a saved key and an env key
/// report `configured: true` identically.
async fn provider_config(state: &AppState) -> Result<db::MetadataLookupConfig, db::SettingsError> {
    Ok(db::MetadataLookupConfig::live(
        db::provider_keys(&state.pool).await?,
    ))
}

/// List the metadata providers
///
/// Every external metadata provider the server knows: its name, whether it needs an API
/// key, whether it can be asked right now, and what it can answer. No key material is
/// returned.
#[utoipa::path(
    get,
    path = "/api/metadata/providers",
    tag = "Metadata",
    operation_id = "list_metadata_providers",
    responses((status = 200, description = "The providers.", body = Vec<ProviderInfo>)),
)]
pub(super) async fn get_providers(_user: AuthUser, State(state): State<AppState>) -> Response {
    match provider_config(&state).await {
        Ok(config) => Json(db::catalog(&config)).into_response(),
        Err(e) => internal("metadata provider catalog", e),
    }
}

/// Search the providers for editions
///
/// Asks the metadata providers, all of them or those in `providers`, for editions that
/// match, and returns every candidate labelled with the provider it came from. Each
/// provider also gets a row in `sources`: a provider that fails or is skipped says so
/// there, and the search still succeeds. Send `title`, `author` and `isbn` when you have
/// them; `query` alone is searched as a title. Needs the edit permission.
#[utoipa::path(
    post,
    path = "/api/metadata/editions/search",
    tag = "Metadata",
    request_body = EditionSearchRequest,
    responses(
        (status = 200, description = "The candidates and each provider's status.", body = EditionSearchResponse),
        (status = 400, description = "Every field is blank, a field is too long, or `providers` is an empty list; the body says which."),
        (status = 403, description = "You lack the edit permission."),
    ),
)]
pub(super) async fn post_edition_search(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<EditionSearchRequest>,
) -> Response {
    // Gated on edit because it spends outbound provider calls.
    if !user.is_admin && !user.can_edit {
        return (StatusCode::FORBIDDEN, "edit permission required").into_response();
    }
    if let Err(msg) = req.validate() {
        return (StatusCode::BAD_REQUEST, msg).into_response();
    }
    let config = match provider_config(&state).await {
        Ok(c) => c,
        Err(e) => return internal("edition_search_provider_keys", e),
    };
    let found =
        db::search_all_providers(&config, &search_query(&req), req.providers.as_deref()).await;
    Json(found).into_response()
}

/// Fetch an edition's full record
///
/// Fetches one search candidate again from the provider that offered it, which returns
/// more than the search did. Answers `null` when the provider no longer knows the
/// candidate. Send the candidate's `isbn13` when it has one: it names the exact printing.
/// Needs the edit permission.
#[utoipa::path(
    post,
    path = "/api/metadata/editions/hydrate",
    tag = "Metadata",
    request_body = EditionHydrateRequest,
    responses(
        (status = 200, description = "The full edition, or `null`.", body = Option<ProviderEdition>),
        (status = 400, description = "`provider_ref` is blank or longer than 256 bytes, or `isbn13` is longer than 32 characters."),
        (status = 403, description = "You lack the edit permission."),
        (status = 502, description = "The provider couldn't be reached, or it rate-limited the server recently and is still cooling down."),
    ),
)]
pub(super) async fn post_edition_hydrate(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<EditionHydrateRequest>,
) -> Response {
    if !user.is_admin && !user.can_edit {
        return (StatusCode::FORBIDDEN, "edit permission required").into_response();
    }
    if let Err(msg) = req.validate() {
        return (StatusCode::BAD_REQUEST, msg).into_response();
    }
    let config = match provider_config(&state).await {
        Ok(c) => c,
        Err(e) => return internal("edition_hydrate_provider_keys", e),
    };
    let found = db::hydrate_edition(
        &config,
        req.source,
        req.provider_ref.trim(),
        req.isbn13
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty()),
    )
    .await;
    match found {
        Ok(edition) => Json(edition).into_response(),
        // Logged with `?e`, not `{e:#}`: thiserror lowers a literal
        // `#[error("…")]` to a `write_str`, which ignores the alternate flag,
        // so `{e:#}` would record the same fixed sentence the caller already
        // got and the provider's own cause would reach nothing. `Debug` walks
        // the chain. Safe to log in full — `providers::http::strip_url` has
        // already removed the request URL, and so any `?key=`, from every
        // provider error. Mirrors `rpc_hydrate_edition`'s handling.
        Err(e) => {
            tracing::warn!(error = ?e, "hydrate edition failed");
            (StatusCode::BAD_GATEWAY, e.to_string()).into_response()
        }
    }
}

/// Turn a request into the query the providers are actually asked. The structured
/// fields win when the caller sent them; free text falls back to a title-only query.
/// Mirrors `omnibus_frontend::rpc::metadata_search`'s own helper, as the two front
/// doors must agree on what a request means.
fn search_query(req: &EditionSearchRequest) -> db::SearchQuery {
    // Built first, then checked for content — the structured fields are
    // *cleaned* (blanks trimmed to absent, an unusable ISBN discarded), so
    // branching on `is_some()` alone would let `{"query":"Dune","title":"  "}`
    // throw the reader's query away and search for nothing.
    let structured = db::SearchQuery::new(
        req.title.as_deref(),
        req.author.as_deref(),
        req.isbn.as_deref(),
    );
    if structured.is_empty() {
        return db::SearchQuery::from_text(&req.query);
    }
    // Returned as-is. An earlier version backfilled an absent `title` from the
    // free text, which for an author-only search copied the author's name into
    // the title slot — asking Open Library for a book whose *title* contains
    // "Frank Herbert" and scoring every candidate against that, which is the
    // precise bug this whole path exists to remove. A query with no title is
    // handled honestly downstream: `relevance::filter_and_rank` has nothing to
    // rank against and returns the providers' own results unscored.
    structured
}

#[cfg(test)]
mod tests;
