//! The React client's build, served at `/` as the router's fallback.
//!
//! `OMNIBUS_REACT_DIR` names a `vite build` output (`frontend-js/dist`; the
//! Docker image sets `/app/react`). Every path no other route claims lands here:
//! an unknown `/api/*` path answers a JSON 404, and everything else is the
//! client. A path naming no file gets `index.html`, so a deep link reaches the
//! client's router, unless it names an asset (it has an extension): that 404s
//! rather than answering a script with HTML. `/react/*`, where the client lived
//! while it was opt-in, redirects to the same path at the root.
//!
//! Every byte goes through the conditional path (rule 09a). A `.br` or `.gz`
//! sibling written at build time is served in place of a file the client
//! accepts that encoding for, under its own validator. Vite's hashed `/assets/*`
//! are cached for a year; everything else revalidates. No auth here: the shell
//! is public, and the API it calls is not.

use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use axum::{
    extract::{Request, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode, Uri},
    response::{IntoResponse, Redirect, Response},
    Json, Router,
};

use super::conditional;

/// Env var naming the React build directory to serve at `/`.
pub const REACT_DIR_ENV: &str = "OMNIBUS_REACT_DIR";

/// Vite content-hashes every file under `assets/`, so a name never changes bytes.
const IMMUTABLE: &str = "public, max-age=31536000, immutable";
/// The shell and the unhashed files beside it (icons, manifest) revalidate on every load.
const REVALIDATE: &str = "no-cache";

/// The directory `raw` names when it holds an `index.html`; `None` when unset,
/// and `None` with a warning when it names something that isn't a build.
pub fn react_dir(raw: Option<OsString>) -> Option<PathBuf> {
    let dir = PathBuf::from(raw?);
    if dir.join("index.html").is_file() {
        return Some(dir);
    }
    tracing::warn!(
        dir = %dir.display(),
        "{REACT_DIR_ENV} has no index.html; the React client is not served"
    );
    None
}

/// What a request path resolves to inside the build directory.
#[derive(Debug, PartialEq, Eq)]
pub enum Resolved {
    File(PathBuf),
    NotFound,
}

/// Resolve `rel`, the request path without its leading `/`, inside `dir`: the
/// file itself, the app shell for any other extensionless path, and `NotFound`
/// for a missing asset or a path that would step outside `dir`.
pub async fn resolve(dir: &Path, rel: &str) -> Resolved {
    let rel = Path::new(rel);
    if !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return Resolved::NotFound;
    }
    let candidate = dir.join(rel);
    if is_file(&candidate).await {
        return Resolved::File(candidate);
    }
    if rel.extension().is_some() {
        return Resolved::NotFound;
    }
    Resolved::File(dir.join("index.html"))
}

/// The router's fallback: unknown `/api/*` paths as JSON 404s, `/react/*` redirected to
/// the root, and everything else served from `dir` — or a 503 naming the missing build.
pub fn react_ui_router(dir: Option<PathBuf>) -> Router {
    Router::new()
        .fallback(fallback)
        .with_state(dir.map(Arc::new))
}

async fn fallback(State(dir): State<Option<Arc<PathBuf>>>, req: Request) -> Response {
    let path = req.uri().path();
    if path == "/api" || path.starts_with("/api/") {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "not found" })),
        )
            .into_response();
    }
    if !matches!(*req.method(), Method::GET | Method::HEAD) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Some(target) = legacy_react_target(req.uri()) {
        return Redirect::permanent(&target).into_response();
    }
    let Some(dir) = dir else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            format!(
                "The web client is not installed: set {REACT_DIR_ENV} to a `vite build` output."
            ),
        )
            .into_response();
    };
    let rel = path.trim_start_matches('/').to_owned();
    match resolve(&dir, &rel).await {
        Resolved::File(file) => serve(&dir, &file, req).await,
        Resolved::NotFound => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Where a `/react` or `/react/…` link from the opt-in era now lives, query kept.
fn legacy_react_target(uri: &Uri) -> Option<String> {
    let rest = uri.path().strip_prefix("/react")?;
    if !(rest.is_empty() || rest.starts_with('/')) {
        return None;
    }
    let path = if rest.is_empty() { "/" } else { rest };
    Some(match uri.query() {
        Some(query) => format!("{path}?{query}"),
        None => path.to_owned(),
    })
}

async fn serve(dir: &Path, file: &Path, req: Request) -> Response {
    let cache_control = if file.starts_with(dir.join("assets")) {
        IMMUTABLE
    } else {
        REVALIDATE
    };
    let (path, encoding) = precompressed(file, req.headers()).await;
    let open = match conditional::open(&path).await {
        Ok(open) => open,
        Err(e) => {
            tracing::warn!(?path, error = %e, "web client file open failed");
            return StatusCode::NOT_FOUND.into_response();
        }
    };
    let mut res = match conditional::evaluate(req.headers(), &open.validator, open.len) {
        conditional::Precondition::NotModified(etag) => {
            conditional::not_modified(&etag, cache_control, "Accept-Encoding")
        }
        conditional::Precondition::Failed => StatusCode::PRECONDITION_FAILED.into_response(),
        conditional::Precondition::Proceed { range } => {
            conditional::serve(
                open,
                range,
                conditional::FileResponse {
                    content_type: content_type(file),
                    cache_control,
                    disposition: None,
                },
            )
            .await
        }
    };
    let headers = res.headers_mut();
    // The client's files don't depend on who asks, only on how they can decode it.
    headers.insert(header::VARY, HeaderValue::from_static("Accept-Encoding"));
    if let Some(encoding) = encoding {
        headers.insert(header::CONTENT_ENCODING, HeaderValue::from_static(encoding));
    }
    res
}

/// The `.br` or `.gz` sibling of `file` to send instead, with its coding, when the
/// request accepts that coding and the build wrote one; otherwise `file` itself.
async fn precompressed(file: &Path, headers: &HeaderMap) -> (PathBuf, Option<&'static str>) {
    for (coding, suffix) in [("br", ".br"), ("gzip", ".gz")] {
        if !accepts_encoding(headers, coding) {
            continue;
        }
        let mut name = file.as_os_str().to_owned();
        name.push(suffix);
        let candidate = PathBuf::from(name);
        if is_file(&candidate).await {
            return (candidate, Some(coding));
        }
    }
    (file.to_path_buf(), None)
}

/// Whether `Accept-Encoding` lists `coding` without refusing it (`q=0`).
fn accepts_encoding(headers: &HeaderMap, coding: &str) -> bool {
    headers
        .get_all(header::ACCEPT_ENCODING)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .any(|item| {
            let mut parts = item.split(';');
            let name = parts.next().unwrap_or_default().trim();
            name.eq_ignore_ascii_case(coding)
                && !parts.any(|p| {
                    p.trim()
                        .strip_prefix("q=")
                        .and_then(|q| q.parse::<f32>().ok())
                        == Some(0.0)
                })
        })
}

async fn is_file(path: &Path) -> bool {
    tokio::fs::metadata(path)
        .await
        .is_ok_and(|meta| meta.is_file())
}

/// The MIME type for what `vite build` emits; anything else is opaque bytes.
fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json" | "webmanifest") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("wasm") => "application/wasm",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests;
