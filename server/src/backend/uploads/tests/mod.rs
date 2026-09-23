//! Integration tests for the "add your own books" upload endpoints: split by
//! format into the sibling modules below, plus the routes' time limits. The
//! multipart request and fixture file helpers they share live here; the
//! commit happy paths run a real worker scan so the indexer inserts the book
//! before the override is layered on top.

mod audiobook;
mod ebook;
mod review;
mod timeouts;

use axum::{
    body::Body,
    http::{header::AUTHORIZATION, Request},
};

/// Read a small committed EPUB fixture (shared with the Playwright suite).
fn fixture_epub() -> Vec<u8> {
    fixture_epub_named("standalone-desert.epub")
}

/// Read one of the committed generated EPUBs by file name.
fn fixture_epub_named(name: &str) -> Vec<u8> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../test_data/epubs/generated")
        .join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("read fixture {}: {e}", path.display()))
}

/// Read a committed (non-download-gated) generated audiobook fixture.
fn fixture_audiobook(rel: &str) -> Vec<u8> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../test_data/audiobooks/generated")
        .join(rel);
    std::fs::read(&path).unwrap_or_else(|e| panic!("read fixture {}: {e}", path.display()))
}

/// Build a `multipart/form-data` body. Each part is
/// `(field_name, optional_filename, content)`; a filename marks a file part.
fn multipart_body(parts: &[(&str, Option<&str>, &[u8])]) -> (String, Vec<u8>) {
    let boundary = "----omnibus-upload-test-boundary";
    let mut body: Vec<u8> = Vec::new();
    for (name, filename, content) in parts {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        match filename {
            Some(fname) => body.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"{name}\"; filename=\"{fname}\"\r\n\r\n"
                )
                .as_bytes(),
            ),
            None => body.extend_from_slice(
                format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes(),
            ),
        }
        body.extend_from_slice(content);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}

fn post_multipart(
    uri: &str,
    token: &str,
    content_type: &str,
    body: impl Into<Body>,
) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .method("POST")
        .header("content-type", content_type)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(body.into())
        .unwrap()
}
