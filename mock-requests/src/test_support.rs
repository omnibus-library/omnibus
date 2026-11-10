//! Spawns the mock on a free loopback port with temp payload files and a temp downloads
//! folder, for the contract tests that call it through `omnibus-db`'s real clients.

use std::fs;

use tempfile::TempDir;

use crate::catalogue::Payloads;
use crate::{router, Mock};

pub const EPUB_BYTES: &[u8] = b"mock epub payload";
pub const M4B_BYTES: &[u8] = b"mock m4b payload";

/// A running mock and the temp dirs it works in; both go when this drops.
pub struct Running {
    pub origin: String,
    _dirs: (TempDir, TempDir),
}

pub async fn spawn() -> Running {
    let downloads_dir = tempfile::tempdir().unwrap();
    let payload_dir = tempfile::tempdir().unwrap();
    let payloads = Payloads {
        epub: payload_dir.path().join("alpha.epub"),
        m4b: payload_dir.path().join("book.m4b"),
    };
    fs::write(&payloads.epub, EPUB_BYTES).unwrap();
    fs::write(&payloads.m4b, M4B_BYTES).unwrap();
    let downloads = downloads_dir.path().canonicalize().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let app = router(Mock::new(origin.clone(), downloads, payloads));
    tokio::spawn(async move { axum::serve(listener, app).await });
    Running {
        origin,
        _dirs: (downloads_dir, payload_dir),
    }
}
