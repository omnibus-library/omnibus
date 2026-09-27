//! `require_page_session` — top-level middleware, applied in `server/src/main.rs`
//! beside [`super::require_auth`], that answers a signed-out load of a page
//! needing a session with a `303` to `/login?next=…` rather than rendering the
//! app shell around data the reader can no longer fetch. Only a `GET`/`HEAD`
//! whose path parses to such a frontend [`Route`] is gated: assets, `/api/*`
//! and every protocol surface land in the router's catch-all and pass through.

use std::str::FromStr;

use axum::{
    extract::{Request, State},
    http::{header, HeaderValue, Method, Uri},
    middleware::Next,
    response::{IntoResponse, Redirect, Response},
};
use omnibus_db::auth as auth_db;
use omnibus_frontend::{login_href, Route};

use super::extractor::extract_token;
use crate::backend::AppState;

/// Redirect a `GET`/`HEAD` of a session-only page to `/login` when the request carries no live session.
///
/// A session lookup that fails for any reason other than "no such session"
/// serves the page anyway: the client's own 401 redirect still catches a
/// signed-out reader, where failing closed would lock every reader out for
/// the length of a database hiccup.
pub async fn require_page_session(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    if !is_session_only_page(&req) {
        return next.run(req).await;
    }
    let Some((token, _)) = extract_token(req.headers()) else {
        return redirect_to_login(req.uri());
    };
    match auth_db::resolve_token(state.pool(), &token).await {
        Ok(_) => next.run(req).await,
        Err(auth_db::AuthError::SessionNotFound) => redirect_to_login(req.uri()),
        Err(e) => {
            tracing::error!(error = %e, "require_page_session: session lookup failed; serving the page");
            next.run(req).await
        }
    }
}

/// Whether `req` loads a page that renders only for a signed-in reader.
fn is_session_only_page(req: &Request) -> bool {
    // The path alone picks the variant; parsing the query too would log every
    // malformed query argument a stray link carries.
    matches!(*req.method(), Method::GET | Method::HEAD)
        && Route::from_str(req.uri().path()).is_ok_and(|route| requires_session(&route))
}

/// Every page but the sign-in screens and the catch-all, so a new route is gated by default.
fn requires_session(route: &Route) -> bool {
    !matches!(
        route,
        Route::Login { .. } | Route::Register {} | Route::ServerConnect {} | Route::NotFound { .. }
    )
}

/// `303` to `/login`, carrying the requested path and query as `next`.
fn redirect_to_login(uri: &Uri) -> Response {
    let next = uri.path_and_query().map_or("/", |pq| pq.as_str());
    (
        // A cached copy served to a reader who has since signed in would
        // bounce them off every page they open.
        [
            (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
            (
                header::VARY,
                HeaderValue::from_static("Cookie, Authorization"),
            ),
        ],
        Redirect::to(&login_href(next)),
    )
        .into_response()
}

#[cfg(test)]
mod tests;
