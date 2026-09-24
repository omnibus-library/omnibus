//! Tests for the `Vary: Accept-Encoding` middleware: a precompressed static
//! file gains it, an unencoded response is untouched, and an existing `Vary`
//! is kept rather than overwritten or duplicated.

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
    middleware::from_fn,
    response::IntoResponse,
    routing::get,
    Router,
};
use tower::ServiceExt;
use tower_http::services::ServeFile;

use super::*;

fn vary_values(res: &Response) -> Vec<String> {
    res.headers()
        .get_all(header::VARY)
        .iter()
        .map(|v| v.to_str().unwrap().to_string())
        .collect()
}

async fn get_with_encoding(app: Router, uri: &str, accept_encoding: &str) -> Response {
    app.oneshot(
        Request::builder()
            .uri(uri)
            .header(header::ACCEPT_ENCODING, accept_encoding)
            .body(Body::empty())
            .unwrap(),
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn vary_on_content_encoding_marks_a_precompressed_brotli_asset() {
    let dir = tempfile::tempdir().unwrap();
    let wasm = dir.path().join("app.wasm");
    std::fs::write(&wasm, b"raw wasm bytes").unwrap();
    std::fs::write(dir.path().join("app.wasm.br"), b"brotli bytes").unwrap();
    let app = Router::new()
        .route_service("/app.wasm", ServeFile::new(&wasm).precompressed_br())
        .layer(from_fn(vary_on_content_encoding));

    let res = get_with_encoding(app, "/app.wasm", "gzip, br").await;

    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers()[header::CONTENT_ENCODING], "br");
    assert_eq!(vary_values(&res), ["accept-encoding"]);
}

#[tokio::test]
async fn vary_on_content_encoding_leaves_an_unencoded_response_alone() {
    let app = Router::new()
        .route("/", get(|| async { "plain" }))
        .layer(from_fn(vary_on_content_encoding));

    let res = get_with_encoding(app, "/", "gzip, br").await;

    assert!(res.headers().get(header::CONTENT_ENCODING).is_none());
    assert!(vary_values(&res).is_empty());
}

#[tokio::test]
async fn vary_on_content_encoding_keeps_an_existing_vary_without_duplicating() {
    let app = Router::new()
        .route(
            "/media",
            get(|| async {
                (
                    [
                        (header::CONTENT_ENCODING, "br"),
                        (header::VARY, "Cookie, Authorization"),
                    ],
                    "x",
                )
                    .into_response()
            }),
        )
        .route(
            "/already",
            get(|| async {
                (
                    [
                        (header::CONTENT_ENCODING, "br"),
                        (header::VARY, "Accept-Encoding"),
                    ],
                    "x",
                )
                    .into_response()
            }),
        )
        .layer(from_fn(vary_on_content_encoding));

    let media = get_with_encoding(app.clone(), "/media", "br").await;
    let already = get_with_encoding(app, "/already", "br").await;

    assert_eq!(
        vary_values(&media),
        ["Cookie, Authorization", "accept-encoding"]
    );
    assert_eq!(vary_values(&already), ["Accept-Encoding"]);
}
