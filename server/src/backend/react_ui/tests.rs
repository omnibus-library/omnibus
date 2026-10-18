use axum::{
    body::{to_bytes, Body},
    http::{header, Request},
};
use tempfile::TempDir;
use tower::ServiceExt;

use super::*;

/// A build directory shaped like `vite build`'s output.
fn build_dir() -> TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), "<div id=\"root\"></div>").unwrap();
    std::fs::create_dir(dir.path().join("assets")).unwrap();
    std::fs::write(dir.path().join("assets/app.js"), "console.log(1)").unwrap();
    dir
}

async fn get(dir: &TempDir, uri: &str, if_none_match: Option<&str>) -> Response {
    let mut req = Request::get(uri);
    if let Some(etag) = if_none_match {
        req = req.header(header::IF_NONE_MATCH, etag);
    }
    react_ui_router(dir.path().to_path_buf())
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap()
}

async fn body_text(res: Response) -> String {
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    String::from_utf8(bytes.to_vec()).unwrap()
}

#[test]
fn react_dir_returns_the_directory_when_it_holds_a_build() {
    let dir = build_dir();

    assert_eq!(
        react_dir(Some(dir.path().as_os_str().to_owned())),
        Some(dir.path().to_path_buf())
    );
}

#[test]
fn react_dir_returns_none_when_unset() {
    assert_eq!(react_dir(None), None);
}

#[test]
fn react_dir_returns_none_when_the_directory_has_no_index() {
    let dir = tempfile::tempdir().unwrap();

    assert_eq!(react_dir(Some(dir.path().as_os_str().to_owned())), None);
}

#[tokio::test]
async fn resolve_returns_an_asset_that_exists() {
    let dir = build_dir();

    assert_eq!(
        resolve(dir.path(), "assets/app.js").await,
        Resolved::File(dir.path().join("assets/app.js"))
    );
}

#[tokio::test]
async fn resolve_returns_the_shell_for_a_client_route() {
    let dir = build_dir();

    assert_eq!(
        resolve(dir.path(), "books/abc").await,
        Resolved::File(dir.path().join("index.html"))
    );
}

#[tokio::test]
async fn resolve_returns_not_found_for_a_missing_asset() {
    let dir = build_dir();

    assert_eq!(
        resolve(dir.path(), "assets/gone.js").await,
        Resolved::NotFound
    );
}

#[tokio::test]
async fn resolve_refuses_a_path_that_climbs_out_of_the_build() {
    let dir = build_dir();

    assert_eq!(resolve(dir.path(), "../secret").await, Resolved::NotFound);
}

#[tokio::test]
async fn react_ui_router_serves_the_shell_as_html() {
    let dir = build_dir();

    let res = get(&dir, "/react/", None).await;

    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers()[header::CONTENT_TYPE],
        "text/html; charset=utf-8"
    );
    assert_eq!(body_text(res).await, "<div id=\"root\"></div>");
}

#[tokio::test]
async fn react_ui_router_serves_the_shell_for_a_deep_link() {
    let dir = build_dir();

    let res = get(&dir, "/react/books/abc", None).await;

    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(body_text(res).await, "<div id=\"root\"></div>");
}

#[tokio::test]
async fn react_ui_router_serves_an_asset_with_its_type() {
    let dir = build_dir();

    let res = get(&dir, "/react/assets/app.js", None).await;

    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers()[header::CONTENT_TYPE],
        "text/javascript; charset=utf-8"
    );
}

#[tokio::test]
async fn react_ui_router_answers_not_modified_for_a_current_etag() {
    let dir = build_dir();
    let first = get(&dir, "/react/assets/app.js", None).await;
    let etag = first.headers()[header::ETAG].to_str().unwrap().to_owned();

    let res = get(&dir, "/react/assets/app.js", Some(&etag)).await;

    assert_eq!(res.status(), StatusCode::NOT_MODIFIED);
}

#[tokio::test]
async fn react_ui_router_returns_not_found_for_a_missing_asset() {
    let dir = build_dir();

    let res = get(&dir, "/react/assets/gone.js", None).await;

    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn react_ui_router_redirects_the_bare_prefix_to_the_shell() {
    let dir = build_dir();

    let res = get(&dir, "/react", None).await;

    assert_eq!(res.status(), StatusCode::PERMANENT_REDIRECT);
    assert_eq!(res.headers()[header::LOCATION], "/react/");
}
