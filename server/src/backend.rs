//! Hand-written `/api/*` REST routes for the mobile client. Web uses Dioxus
//! server functions (see `omnibus_frontend::rpc`), mounted automatically by
//! `dioxus::server::router(App)`; these REST routes are merged alongside them
//! in `main.rs` so mobile's existing `reqwest` paths keep working unchanged.

use std::sync::Arc;

use axum::{
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Extension, Router,
};
use omnibus_db::{
    self as db,
    worker::{Worker, WorkerConfig},
};
use sqlx::SqlitePool;

use crate::auth::AuthUser;
use crate::http_errors::internal;
use crate::rate_limit::{RateLimiter, RateLimits};

mod account;
mod admin_health;
mod admin_sessions;
mod audiobooks;
mod author_photos;
mod authors;
mod bookmarks;
mod conditional;
mod covers;
mod cross_format;
mod deletion;
mod ebooks;
mod genres;
mod health;
mod highlights;
mod image_upload;
mod journals;
mod kindle;
mod kobo;
mod merge;
mod metadata;
mod opds;
mod overrides;
mod physical;
mod process_meta;
mod profile;
mod progress;
mod ratings;
mod read_status;
mod routes;
mod scan;
mod search;
mod series;
mod settings;
mod shelves;
mod stats;
mod suggestions;
mod summary;
mod tags;
mod uploads;
mod users;

pub use kobo::{kobo_router, reading_services_router};
pub use opds::opds_router;
#[cfg(test)]
use process_meta::read_app_version;
pub use process_meta::{
    app_version, build_id, init_app_version, init_build_id, init_repo_root, repo_root,
};

/// Per-IP rate-limit budget for `/api/search/*` and the `/api/rpc/search-*` server
/// functions, separate from the auth limiter. Each request runs four FTS5 queries plus
/// joins; the budget still covers a user typing into the command palette.
pub const SEARCH_RATE_LIMIT_WINDOW: std::time::Duration = std::time::Duration::from_secs(10);
/// Max search requests per [`SEARCH_RATE_LIMIT_WINDOW`] per IP.
pub const SEARCH_RATE_LIMIT_MAX: u32 = 30;

/// Per-IP rate-limit policy for both upload routers (`routes::upload_router`: cover, journal
/// image, avatar and author-photo writes; `routes::book_upload_router`: book and audiobook
/// uploads): 10 requests per 60 seconds, each router in its own bucket. Each request carries
/// a multi-MiB payload or an outbound fetch, so one principal looping could exhaust resources.
pub const UPLOAD_RATE_LIMIT_WINDOW: std::time::Duration = std::time::Duration::from_secs(60);
/// Max upload requests per [`UPLOAD_RATE_LIMIT_WINDOW`] per IP.
pub const UPLOAD_RATE_LIMIT_MAX: u32 = 10;

/// Wall-clock budget for a whole request, on every route but the book
/// uploads: a slow client or a stuck handler cannot hold a task past it.
pub const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// The [`REQUEST_TIMEOUT`] guard, answering 408. `main.rs` puts it on every
/// surface except this module's router, which carries its own.
pub fn request_timeout_layer() -> tower_http::timeout::TimeoutLayer {
    timeout_layer(REQUEST_TIMEOUT)
}

fn timeout_layer(timeout: std::time::Duration) -> tower_http::timeout::TimeoutLayer {
    tower_http::timeout::TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, timeout)
}

/// 403 unless `user` may download. The single enforcement point for every
/// download-shaped route (one handing the caller a file to keep via
/// `Content-Disposition: attachment`; in-app reading/streaming routes stay open to
/// any authenticated user), shared with `opds::delegate`'s acquisition routes so
/// the two surfaces cannot drift on what counts as a download.
fn deny_without_download(user: &AuthUser) -> Option<Response> {
    (!user.can_download).then(|| (StatusCode::FORBIDDEN, "download not permitted").into_response())
}

/// Serve a file from disk as a browser download: streamed (so large
/// audiobook files aren't buffered into memory), Range-capable, conditional,
/// and forced to `Content-Disposition: attachment` with the on-disk basename
/// as the suggested filename. `content_type` overrides the guessed MIME.
async fn serve_download(
    req: axum::extract::Request,
    path: &std::path::Path,
    content_type: &str,
) -> Response {
    let filename = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("download");
    serve_file(
        req,
        path,
        content_type,
        Some(content_disposition_attachment(filename)),
    )
    .await
}

/// The shared body of every endpoint that streams bytes off disk: one open handle for
/// validator and bytes, preconditions before any byte, 404 only for a missing file (rule 09a).
async fn serve_file(
    req: axum::extract::Request,
    path: &std::path::Path,
    content_type: &str,
    disposition: Option<String>,
) -> Response {
    let open = match conditional::open(path).await {
        Ok(open) => open,
        Err(e) => {
            tracing::warn!(?path, error = %e, "media file open failed");
            return axum::http::StatusCode::NOT_FOUND.into_response();
        }
    };
    let range = match conditional::evaluate(req.headers(), &open.validator, open.len) {
        conditional::Precondition::NotModified(etag) => {
            return conditional::not_modified(
                &etag,
                conditional::MEDIA_CACHE_CONTROL,
                conditional::MEDIA_VARY,
            )
        }
        conditional::Precondition::Failed => {
            return axum::http::StatusCode::PRECONDITION_FAILED.into_response()
        }
        conditional::Precondition::Proceed { range } => range,
    };
    conditional::serve(
        open,
        range,
        conditional::FileResponse {
            content_type,
            cache_control: conditional::MEDIA_CACHE_CONTROL,
            disposition,
        },
    )
    .await
}

/// Build a `Content-Disposition: attachment` value for `filename`.
/// Emits a sanitized ASCII `filename="…"` fallback (control chars, quotes, backslashes
/// and path separators become `_`) plus an RFC 5987 `filename*=UTF-8''…` form so
/// non-ASCII titles survive in browsers that honour it.
fn content_disposition_attachment(filename: &str) -> String {
    let ascii: String = filename
        .chars()
        .map(|c| {
            if c.is_ascii() && !c.is_ascii_control() && !matches!(c, '"' | '\\' | '/') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let mut encoded = String::new();
    for b in filename.as_bytes() {
        // Leave only RFC 3986 "unreserved" bytes (ALPHA / DIGIT / - . _ ~)
        // unescaped — a strict subset of RFC 5987's `attr-char`, so
        // %-encoding everything else is always valid (just more conservative).
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            encoded.push(*b as char);
        } else {
            encoded.push('%');
            encoded.push_str(&format!("{b:02X}"));
        }
    }
    format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}")
}

/// `?order=` on the annotation list routes. Shared by highlights and
/// bookmarks so the two cannot drift apart on the accepted vocabulary.
#[derive(Debug, Default, serde::Deserialize)]
pub(super) struct AnnotationOrderQuery {
    order: Option<String>,
}

impl From<AnnotationOrderQuery> for omnibus_db::AnnotationOrder {
    fn from(q: AnnotationOrderQuery) -> Self {
        q.order
            .as_deref()
            .map(omnibus_db::AnnotationOrder::parse)
            .unwrap_or_default()
    }
}

/// A create body plus `client_created_at`, the time the device made the row.
/// The mobile outbox sends it so a create it replays after a drain keeps the
/// time of the gesture rather than the drain; the db layer clamps it to
/// server-now. Flattened, so the wire body is the plain create plus one field.
#[derive(Debug, serde::Deserialize)]
pub(super) struct ClientStamped<T> {
    #[serde(flatten)]
    body: T,
    #[serde(default)]
    client_created_at: Option<i64>,
}

impl<T> ClientStamped<T> {
    /// A negative stamp is a 400, as `ProgressUpdate::validate` answers one.
    fn validate_stamp(&self) -> Result<(), String> {
        if self.client_created_at.is_some_and(|ts| ts < 0) {
            return Err("client_created_at must be non-negative".into());
        }
        Ok(())
    }
}

/// Shared axum router state — SQLite pool, worker handle, SSRF guard config.
#[derive(Clone)]
pub struct AppState {
    pool: SqlitePool,
    worker: Arc<Worker>,
    /// SSRF guard config for `put_author_photo_url`. Defaults to strict
    /// (`allow_private_addresses = false`). Integration tests that drive the
    /// handler against a `wiremock` server bound to `127.0.0.1` construct
    /// `AppState` via [`AppState::new_with_remote_image_config`] with the
    /// flag flipped on; production code must never do this.
    remote_image_config: Arc<db::author_photos::RemoteImageConfig>,
    /// Whether the per-IP limiters built from this state enforce their budgets.
    rate_limits: RateLimits,
    /// Feeds [`AppState::request_origin`], the origin Kobo download URLs and hosted-MCP
    /// image links are built on. CSRF still reads `auth::csrf::allowed_origins()`.
    /// An `Arc` keeps the per-request clone cheap.
    public_origins: Arc<[String]>,
}

impl AppState {
    /// Build an `AppState` with the default (strict) SSRF guard.
    pub fn new(pool: SqlitePool) -> Self {
        let worker = Worker::new(pool.clone(), WorkerConfig::default());
        Self {
            pool,
            worker,
            remote_image_config: Arc::new(db::author_photos::RemoteImageConfig::default()),
            rate_limits: RateLimits::default(),
            public_origins: Arc::default(),
        }
    }

    /// Replace the rate-limit switch; `new` defaults to `Enforced`.
    pub fn with_rate_limits(self, limits: RateLimits) -> Self {
        Self {
            rate_limits: limits,
            ..self
        }
    }

    /// Test-only constructor that overrides the SSRF guard config. Wraps
    /// [`AppState::new`] so the SQLite pool + worker stay identical and only
    /// the [`db::author_photos::RemoteImageConfig`] field differs. Marked
    /// `#[cfg(test)]` so production callers cannot accidentally flip
    /// `allow_private_addresses`.
    #[cfg(test)]
    pub(crate) fn new_with_remote_image_config(
        pool: SqlitePool,
        cfg: db::author_photos::RemoteImageConfig,
    ) -> Self {
        Self {
            remote_image_config: Arc::new(cfg),
            ..Self::new(pool)
        }
    }

    /// Replace the public origins; `new` defaults to none.
    pub fn with_public_origins(self, origins: &[String]) -> Self {
        Self {
            public_origins: origins.into(),
            ..self
        }
    }

    /// The origin (`scheme://host`) a request reached the server on, for URLs a
    /// client outside this process will open; `""` when no host is resolvable.
    pub fn request_origin(&self, headers: &HeaderMap) -> String {
        let origin = kobo::origin_for(headers, &self.public_origins);
        // Behind a TLS proxy that sends no X-Forwarded-Proto the header scheme is a guess; a configured origin on the same host knows it.
        let authority = origin.split_once("://").map_or("", |(_, a)| a);
        let listed = |o: &&String| {
            o.split_once("://")
                .is_some_and(|(_, a)| a.eq_ignore_ascii_case(authority))
        };
        self.public_origins
            .iter()
            .find(listed)
            .cloned()
            .unwrap_or(origin)
    }

    /// SQLite connection pool used by every handler.
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// Shared single-process background worker handle.
    pub fn worker(&self) -> &Arc<Worker> {
        &self.worker
    }

    /// SSRF guard config consulted before fetching admin-supplied URLs.
    pub fn remote_image_config(&self) -> &db::author_photos::RemoteImageConfig {
        &self.remote_image_config
    }

    /// Whether the per-IP limiters wired from this state enforce or admit everything.
    pub fn rate_limits(&self) -> RateLimits {
        self.rate_limits
    }
}

/// Build the `/api/*` REST router with a fresh per-call search rate-limiter.
pub fn rest_router(state: AppState) -> Router {
    // Standalone/test entrypoint: a fresh, dedicated search limiter per call.
    // The live server uses `rest_router_with_search_limiter` to share one (#249).
    let search_limiter = RateLimiter::with_policy(SEARCH_RATE_LIMIT_WINDOW, SEARCH_RATE_LIMIT_MAX)
        .with_limits(state.rate_limits());
    rest_router_with_search_limiter(state, std::sync::Arc::new(search_limiter))
}

/// Build the `/api/*` REST router, sharing `search_limiter` with the caller so
/// REST `/api/search/*` and RPC `/api/rpc/search-*` draw from one budget.
pub fn rest_router_with_search_limiter(
    state: AppState,
    search_limiter: std::sync::Arc<RateLimiter>,
) -> Router {
    rest_router_with_timeouts(
        state,
        search_limiter,
        REQUEST_TIMEOUT,
        uploads::UPLOAD_BODY_IDLE_TIMEOUT,
    )
}

/// [`rest_router_with_search_limiter`] with both time limits as arguments,
/// so a test can drive them at a sub-second scale.
fn rest_router_with_timeouts(
    state: AppState,
    search_limiter: std::sync::Arc<RateLimiter>,
    request_timeout: std::time::Duration,
    upload_body_idle_timeout: std::time::Duration,
) -> Router {
    let pool = state.pool().clone();
    let limits = state.rate_limits();
    routes::content_routes()
        .merge(routes::data_routes(search_limiter, limits))
        // Route-level, so it covers only the routes merged above. A book
        // upload's body alone can outlast it, so those routes are merged
        // after it and bound a stalled client with an idle timeout instead.
        .layer(timeout_layer(request_timeout))
        .merge(routes::book_upload_router(upload_body_idle_timeout, limits))
        .with_state(state)
        // `AuthUser`/`AdminUser` read the pool from `Extension<SqlitePool>`.
        // Layer it here so the router is self-contained for integration
        // tests; in the live server `main.rs` adds the same Extension at
        // the top, which is harmless overlap.
        .layer(Extension(pool))
        // `main.rs` layers the same cap at the top so the auth router and
        // Dioxus server functions are covered too; duplicating it here
        // means integration tests (which use `rest_router` directly) also
        // exercise it.
        .layer(axum::extract::DefaultBodyLimit::max(1024 * 1024))
}

/// Attach the pagination hint headers to a list/search response: `X-Total-Count` is
/// the true row count before the `MAX_BOOKS_RETURNED` cap, and `X-Total-Cap` is the
/// cap, set only when the response was truncated. The JSON body shape is unchanged,
/// so older mobile clients keep parsing it as `EbookLibrary`.
fn with_pagination_headers(mut resp: Response, total: i64) -> Response {
    use axum::http::HeaderValue;
    if let Ok(v) = HeaderValue::from_str(&total.to_string()) {
        resp.headers_mut().insert("X-Total-Count", v);
    }
    if total > db::MAX_BOOKS_RETURNED {
        if let Ok(v) = HeaderValue::from_str(&db::MAX_BOOKS_RETURNED.to_string()) {
            resp.headers_mut().insert("X-Total-Cap", v);
        }
    }
    resp
}

#[cfg(test)]
pub(crate) mod test_support;

#[cfg(test)]
mod tests;
