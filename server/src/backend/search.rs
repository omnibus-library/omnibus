//! `GET /api/search` family: metadata search, book-content search, and the
//! command palette.
//!
//! Cookie-gated FTS5 search across the configured libraries. The metadata
//! search returns a capped result vec plus the full hit count via
//! `X-Total-Count` / `X-Total-Cap` headers; all three routes are mounted on
//! a sub-router that carries its own per-IP rate limit.

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db};
#[cfg(test)]
use omnibus_shared::SEARCH_QUERY_MAX_LEN as MAX_SEARCH_QUERY_LEN;
use omnibus_shared::{
    search_query_too_long, ContentSearchQuery, ContentSearchResults, EbookLibrary, PaletteQuery,
    PaletteResults, SearchQuery,
};

use super::{internal, with_pagination_headers, AppState};
use crate::auth::AuthUser;

/// The uuids a content search scopes to, from either spelling.
fn scope_uuids(params: &ContentSearchQuery) -> Vec<String> {
    let mut uuids: Vec<String> = Vec::new();
    if let Some(one) = params.book_uuid.as_deref() {
        uuids.push(one.trim().to_string());
    }
    if let Some(many) = params.book_uuids.as_deref() {
        uuids.extend(
            many.split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string),
        );
    }
    uuids.retain(|u| !u.is_empty());
    uuids.sort();
    uuids.dedup();
    uuids
}

/// Reject an over-length query with 400 so oversized input is never forwarded
/// into the search db calls. Returns `Some(response)` when `q` exceeds
/// `omnibus_shared::SEARCH_QUERY_MAX_LEN` — the same cap the RPC search
/// entrypoints enforce via [`search_query_too_long`].
fn reject_if_over_length(q: &str) -> Option<Response> {
    search_query_too_long(q).then(|| (StatusCode::BAD_REQUEST, "query too long").into_response())
}

/// Search books
///
/// Books whose title, author or series matches `q`, best match first, up to 50,000.
/// `X-Total-Count` holds how many books match. With no library folder configured, the
/// answer is an empty list.
#[utoipa::path(
    get,
    path = "/api/search",
    tag = "Search",
    params(SearchQuery),
    responses(
        (status = 200, description = "The matching books.", body = EbookLibrary, headers(
            ("X-Total-Count" = i64, description = "How many books match."),
            ("X-Total-Cap" = i64, description = "The cap, sent when it cut the list short."),
        )),
        (status = 400, description = "`q` is longer than 1,024 bytes."),
    ),
)]
pub(super) async fn get_search(
    _user: AuthUser,
    State(state): State<AppState>,
    Query(params): Query<SearchQuery>,
) -> Response {
    if let Some(rejection) = reject_if_over_length(&params.q) {
        return rejection;
    }
    let settings = match db::get_settings(&state.pool).await {
        Ok(s) => s,
        Err(error) => return internal("read settings", error),
    };
    let ebook = settings.ebook_library_path;
    let audiobook = settings.audiobook_library_path;
    let paths = db::collect_paths(ebook.as_deref(), audiobook.as_deref());
    if paths.is_empty() {
        // Match the `/api/ebooks` contract: even an empty result attaches
        // `X-Total-Count: 0` so clients can rely on the header always
        // being present.
        return with_pagination_headers(Json(EbookLibrary::default()).into_response(), 0);
    }
    let path = paths[0].to_string();
    // One FTS5 pass yields both the (capped) vec and the *full* hit count via a
    // scalar COUNT over the materialized matches CTE.
    let (books, total) =
        match db::search_books_for_paths_with_total(&state.pool, &paths, &params.q).await {
            Ok(pair) => pair,
            Err(error) => return internal("search books", error),
        };
    // The full hit count rides the `X-Total-Count` / `X-Total-Cap` headers so
    // clients can detect truncation without changing the JSON body shape.
    let body = Json(EbookLibrary {
        path: Some(path),
        books,
        error: None,
        total: None,
    })
    .into_response();
    with_pagination_headers(body, total)
}

/// Search the text of books
///
/// Chapters whose text holds every word of `q`, best match first, up to 50. Each hit names
/// the book, the chapter's spine index and title, and quotes an excerpt with the matches in
/// `[` and `]`. By default a hit past your own reading position is marked as ahead of you;
/// `spoiler_filter=exclude` leaves it out and counts it in `withheld_ahead`. An empty answer
/// can carry a `hint` saying why. With no library folder configured, or an empty `q`, the
/// answer has no hits.
#[utoipa::path(
    get,
    path = "/api/search/content",
    tag = "Search",
    params(ContentSearchQuery),
    responses(
        (status = 200, description = "The matching chapters.", body = ContentSearchResults),
        (status = 400, description = "`q` is longer than 1,024 bytes."),
    ),
)]
pub(super) async fn get_search_content(
    user: AuthUser,
    State(state): State<AppState>,
    Query(params): Query<ContentSearchQuery>,
) -> Response {
    if let Some(rejection) = reject_if_over_length(&params.q) {
        return rejection;
    }
    let settings = match db::get_settings(&state.pool).await {
        Ok(s) => s,
        Err(error) => return internal("read settings", error),
    };
    let paths = db::collect_paths(
        settings.ebook_library_path.as_deref(),
        settings.audiobook_library_path.as_deref(),
    );
    if paths.is_empty() {
        return Json(ContentSearchResults::default()).into_response();
    }
    let scope = db::ContentSearchScope {
        book_uuids: scope_uuids(&params),
        limit: params.limit,
    };
    let mut hits = match db::search_content_for_paths(&state.pool, &paths, &params.q, &scope).await
    {
        Ok(hits) => hits,
        Err(error) => return internal("search content", error),
    };
    let withheld =
        match db::annotate_spoilers(&state.pool, user.id, &mut hits, params.spoiler_filter).await {
            Ok(withheld) => withheld,
            Err(error) => return internal("annotate spoilers", error),
        };
    // Only worth explaining when there is nothing to show: a hint alongside
    // results would be noise, and the per-term counts cost a query each.
    let hint = if hits.is_empty() && withheld.unwrap_or(0) == 0 {
        match db::explain_empty_content_search(&state.pool, &paths, &params.q, &scope).await {
            Ok(hint) => hint,
            Err(error) => return internal("explain content search", error),
        }
    } else {
        None
    };
    Json(ContentSearchResults {
        hits,
        withheld_ahead: withheld,
        hint,
    })
    .into_response()
}

/// Search for the command palette
///
/// Books, authors, series, tags and genres matching `q`, grouped by kind, up to 5 of each
/// unless `limit` says otherwise. Each kind's `_total` field counts all its matches. Books
/// match on title, author and series; the rest on any part of the name.
#[utoipa::path(
    get,
    path = "/api/search/palette",
    tag = "Search",
    params(PaletteQuery),
    responses(
        (status = 200, description = "The matches, grouped by kind.", body = PaletteResults),
        (status = 400, description = "`q` is longer than 1,024 bytes."),
    ),
)]
pub(super) async fn get_search_palette(
    _user: AuthUser,
    State(state): State<AppState>,
    Query(params): Query<PaletteQuery>,
) -> Response {
    if let Some(rejection) = reject_if_over_length(&params.q) {
        return rejection;
    }
    let settings = match db::get_settings(&state.pool).await {
        Ok(s) => s,
        Err(error) => return internal("read settings", error),
    };
    let paths = db::collect_paths(
        settings.ebook_library_path.as_deref(),
        settings.audiobook_library_path.as_deref(),
    );
    if paths.is_empty() {
        return Json(PaletteResults::default()).into_response();
    }
    let results = match params.limit {
        Some(limit) => {
            db::search_palette_for_paths_limited(&state.pool, &paths, &params.q, limit).await
        }
        None => db::search_palette_for_paths(&state.pool, &paths, &params.q).await,
    };
    match results {
        Ok(results) => Json(results).into_response(),
        Err(error) => internal("search palette", error),
    }
}

#[cfg(test)]
mod tests;
