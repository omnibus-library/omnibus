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
    std::fs::create_dir(dir.path().join("vendor")).unwrap();
    std::fs::write(dir.path().join("vendor/lib.js"), "lib").unwrap();
    dir
}

async fn send(dir: Option<&TempDir>, req: Request<Body>) -> Response {
    react_ui_router(dir.map(|d| d.path().to_path_buf()))
        .oneshot(req)
        .await
        .unwrap()
}

async fn get(dir: &TempDir, uri: &str) -> Response {
    send(Some(dir), Request::get(uri).body(Body::empty()).unwrap()).await
}

async fn get_with(dir: &TempDir, uri: &str, name: header::HeaderName, value: &str) -> Response {
    let req = Request::get(uri).header(name, value).body(Body::empty());
    send(Some(dir), req.unwrap()).await
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
async fn resolve_returns_the_shell_for_a_client_route_with_dots_in_its_last_segment() {
    let dir = build_dir();

    assert_eq!(
        resolve(dir.path(), "search/J.K.%20Rowling").await,
        Resolved::File(dir.path().join("index.html"))
    );
}

#[tokio::test]
async fn resolve_returns_not_found_for_a_missing_file_under_a_build_directory() {
    let dir = build_dir();

    assert_eq!(resolve(dir.path(), "vendor/x").await, Resolved::NotFound);
}

#[tokio::test]
async fn resolve_returns_not_found_for_a_missing_root_file_with_a_known_extension() {
    let dir = build_dir();

    assert_eq!(resolve(dir.path(), "gone.png").await, Resolved::NotFound);
}

#[tokio::test]
async fn resolve_refuses_a_path_that_climbs_out_of_the_build() {
    let dir = build_dir();

    assert_eq!(resolve(dir.path(), "../secret").await, Resolved::NotFound);
}

#[tokio::test]
async fn react_ui_router_serves_the_shell_at_the_root_as_revalidating_html() {
    let dir = build_dir();

    let res = get(&dir, "/").await;

    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers()[header::CONTENT_TYPE],
        "text/html; charset=utf-8"
    );
    assert_eq!(res.headers()[header::CACHE_CONTROL], "no-cache");
    assert_eq!(body_text(res).await, "<div id=\"root\"></div>");
}

#[tokio::test]
async fn react_ui_router_serves_the_shell_for_a_deep_link() {
    let dir = build_dir();

    let res = get(&dir, "/books/abc/edit").await;

    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(body_text(res).await, "<div id=\"root\"></div>");
}

#[tokio::test]
async fn react_ui_router_serves_a_hashed_asset_as_immutable_with_its_type() {
    let dir = build_dir();

    let res = get(&dir, "/assets/app.js").await;

    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers()[header::CONTENT_TYPE],
        "text/javascript; charset=utf-8"
    );
    assert_eq!(res.headers()[header::CACHE_CONTROL], IMMUTABLE);
    assert_eq!(res.headers()[header::VARY], "Accept-Encoding");
}

#[tokio::test]
async fn react_ui_router_answers_not_modified_for_a_current_etag() {
    let dir = build_dir();
    let first = get(&dir, "/assets/app.js").await;
    let etag = first.headers()[header::ETAG].to_str().unwrap().to_owned();

    let res = get_with(&dir, "/assets/app.js", header::IF_NONE_MATCH, &etag).await;

    assert_eq!(res.status(), StatusCode::NOT_MODIFIED);
    assert_eq!(res.headers()[header::VARY], "Accept-Encoding");
}

#[tokio::test]
async fn react_ui_router_returns_not_found_for_a_missing_asset() {
    let dir = build_dir();

    let res = get(&dir, "/assets/gone.js").await;

    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn react_ui_router_serves_the_brotli_sibling_to_a_client_that_accepts_it() {
    let dir = build_dir();
    std::fs::write(dir.path().join("assets/app.js.br"), "brotli bytes").unwrap();
    std::fs::write(dir.path().join("assets/app.js.gz"), "gzip bytes").unwrap();

    let res = get_with(&dir, "/assets/app.js", header::ACCEPT_ENCODING, "gzip, br").await;

    assert_eq!(res.headers()[header::CONTENT_ENCODING], "br");
    assert_eq!(
        res.headers()[header::CONTENT_TYPE],
        "text/javascript; charset=utf-8"
    );
    assert_eq!(body_text(res).await, "brotli bytes");
}

#[tokio::test]
async fn react_ui_router_falls_back_to_gzip_when_brotli_is_refused() {
    let dir = build_dir();
    std::fs::write(dir.path().join("assets/app.js.br"), "brotli bytes").unwrap();
    std::fs::write(dir.path().join("assets/app.js.gz"), "gzip bytes").unwrap();

    let res = get_with(
        &dir,
        "/assets/app.js",
        header::ACCEPT_ENCODING,
        "br;q=0, gzip",
    )
    .await;

    assert_eq!(res.headers()[header::CONTENT_ENCODING], "gzip");
    assert_eq!(body_text(res).await, "gzip bytes");
}

#[tokio::test]
async fn react_ui_router_reads_a_refusal_with_an_uppercase_or_spaced_q() {
    let dir = build_dir();
    std::fs::write(dir.path().join("assets/app.js.br"), "brotli bytes").unwrap();
    std::fs::write(dir.path().join("assets/app.js.gz"), "gzip bytes").unwrap();

    for accept in ["br;Q=0, gzip", "br; q = 0, gzip"] {
        let res = get_with(&dir, "/assets/app.js", header::ACCEPT_ENCODING, accept).await;

        assert_eq!(res.headers()[header::CONTENT_ENCODING], "gzip", "{accept}");
    }
}

#[tokio::test]
async fn react_ui_router_serves_identity_when_no_sibling_was_built() {
    let dir = build_dir();

    let res = get_with(&dir, "/assets/app.js", header::ACCEPT_ENCODING, "br, gzip").await;

    assert!(res.headers().get(header::CONTENT_ENCODING).is_none());
    assert_eq!(body_text(res).await, "console.log(1)");
}

#[tokio::test]
async fn react_ui_router_answers_an_unknown_api_path_with_a_json_404() {
    let dir = build_dir();

    let res = get(&dir, "/api/nope").await;

    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    assert_eq!(res.headers()[header::CONTENT_TYPE], "application/json");
    assert_eq!(body_text(res).await, r#"{"error":"not found"}"#);
}

#[tokio::test]
async fn react_ui_router_redirects_an_opt_in_era_link_to_the_root() {
    let dir = build_dir();

    let res = get(&dir, "/react/books/abc?tab=notes").await;

    assert_eq!(res.status(), StatusCode::PERMANENT_REDIRECT);
    assert_eq!(res.headers()[header::LOCATION], "/books/abc?tab=notes");
}

#[tokio::test]
async fn react_ui_router_redirects_the_bare_prefix_to_the_root() {
    let dir = build_dir();

    let res = get(&dir, "/react").await;

    assert_eq!(res.headers()[header::LOCATION], "/");
}

#[tokio::test]
async fn react_ui_router_keeps_a_double_slash_redirect_on_this_origin() {
    let dir = build_dir();

    let res = get(&dir, "/react//evil.example/x").await;

    assert_eq!(res.status(), StatusCode::PERMANENT_REDIRECT);
    assert_eq!(res.headers()[header::LOCATION], "/evil.example/x");
}

#[test]
fn legacy_react_target_strips_leading_backslashes_so_the_target_stays_on_this_origin() {
    let uri = Uri::try_from("/react/\\\\evil.example").unwrap();

    assert_eq!(legacy_react_target(&uri).as_deref(), Some("/evil.example"));
}

#[tokio::test]
async fn react_ui_router_does_not_redirect_a_path_that_only_starts_with_react() {
    let dir = build_dir();

    let res = get(&dir, "/reactions").await;

    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(body_text(res).await, "<div id=\"root\"></div>");
}

#[tokio::test]
async fn react_ui_router_serves_the_shell_for_a_search_deep_link_with_dots() {
    let dir = build_dir();

    let res = get(&dir, "/search/J.K.%20Rowling").await;

    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(body_text(res).await, "<div id=\"root\"></div>");
}

#[tokio::test]
async fn react_ui_router_answers_503_when_no_build_is_installed() {
    let res = send(None, Request::get("/").body(Body::empty()).unwrap()).await;

    assert_eq!(res.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn react_ui_router_returns_not_found_for_a_write_to_a_client_path() {
    let dir = build_dir();
    let req = Request::post("/books/abc").body(Body::empty()).unwrap();

    let res = send(Some(&dir), req).await;

    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}
