//! The React client's build, served at `/react/` when an operator opts in.
//!
//! `OMNIBUS_REACT_DIR` names a `vite build` output (`frontend-js/dist`). Unset,
//! nothing mounts and `/react/*` reaches the Dioxus catch-all like any unknown
//! path. It sits beside the Dioxus UI rather than replacing it: the React client
//! is being ported screen by screen, so one server can carry both, on one origin
//! and one session cookie.
//!
//! Every byte goes through `serve_file` (rule 09a). A path naming no file gets
//! `index.html`, so a deep link reaches the client's router, unless it names an
//! asset (it has an extension): that 404s rather than answering a script with
//! HTML. No auth here: the shell is public, and the API it calls is not.

use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use axum::{
    extract::{Path as UrlPath, Request, State},
    http::StatusCode,
    response::{IntoResponse, Redirect, Response},
    routing::get,
    Router,
};

/// Env var naming the React build directory to serve at `/react/`.
pub const REACT_DIR_ENV: &str = "OMNIBUS_REACT_DIR";

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

/// What a request under `/react/` resolves to inside the build directory.
#[derive(Debug, PartialEq, Eq)]
pub enum Resolved {
    File(PathBuf),
    NotFound,
}

/// Resolve `rel`, the path after `/react/`, inside `dir`: the file itself, the
/// app shell for any other extensionless path, and `NotFound` for a missing
/// asset or a path that would step outside `dir`.
pub async fn resolve(dir: &Path, rel: &str) -> Resolved {
    let rel = Path::new(rel);
    if !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return Resolved::NotFound;
    }
    let candidate = dir.join(rel);
    if tokio::fs::metadata(&candidate)
        .await
        .is_ok_and(|meta| meta.is_file())
    {
        return Resolved::File(candidate);
    }
    if rel.extension().is_some() {
        return Resolved::NotFound;
    }
    Resolved::File(dir.join("index.html"))
}

/// Routes `/react` and everything under it to the build in `dir`.
pub fn react_ui_router(dir: PathBuf) -> Router {
    Router::new()
        .route("/react", get(|| async { Redirect::permanent("/react/") }))
        .route("/react/", get(serve_shell))
        .route("/react/{*path}", get(serve_path))
        .with_state(Arc::new(dir))
}

async fn serve_shell(State(dir): State<Arc<PathBuf>>, req: Request) -> Response {
    serve(&dir, "", req).await
}

async fn serve_path(
    State(dir): State<Arc<PathBuf>>,
    UrlPath(path): UrlPath<String>,
    req: Request,
) -> Response {
    serve(&dir, &path, req).await
}

async fn serve(dir: &Path, rel: &str, req: Request) -> Response {
    match resolve(dir, rel).await {
        Resolved::File(file) => super::serve_file(req, &file, content_type(&file), None).await,
        Resolved::NotFound => StatusCode::NOT_FOUND.into_response(),
    }
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
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests;
