//! Spawns the mock on a free loopback port with temp payload files and a temp downloads
//! folder, for the contract tests that call it through `omnibus-db`'s real clients.

use std::fs;
use std::path::PathBuf;

use omnibus_db::requests::clients::DownloadClient;
use omnibus_db::requests::prowlarr::{Prowlarr, ProwlarrRelease};
use omnibus_shared::{ReleaseProtocol, RequestKind};
use serde_json::Value;
use tempfile::TempDir;

use crate::catalogue::Payloads;
use crate::{router, Mock, PROWLARR_API_KEY};

pub const EPUB_BYTES: &[u8] = b"mock epub payload";
pub const M4B_BYTES: &[u8] = b"mock m4b payload";

/// A running mock and the temp dirs it works in; both go when this drops.
pub struct Running {
    pub origin: String,
    /// The canonical folder finished downloads land in.
    pub downloads: PathBuf,
    _dirs: (TempDir, TempDir),
}

/// A mock whose downloads take the default 30 seconds.
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
    let mock = Mock::new(origin.clone(), downloads.clone(), payloads, 30);
    let app = router(mock);
    tokio::spawn(async move { axum::serve(listener, app).await });
    Running {
        origin,
        downloads,
        _dirs: (downloads_dir, payload_dir),
    }
}

/// The mock's search result for "Dracula Bram Stoker" in `format` (`EPUB`, `M4B`) over `protocol`.
pub async fn found(mock: &Running, protocol: ReleaseProtocol, format: &str) -> ProwlarrRelease {
    let kind = if format == "M4B" {
        RequestKind::Audiobook
    } else {
        RequestKind::Ebook
    };
    let client = Prowlarr::new(&mock.origin, PROWLARR_API_KEY).unwrap();
    let releases = client.search("Dracula Bram Stoker", kind).await.unwrap();
    releases
        .into_iter()
        .find(|r| r.protocol == Some(protocol) && r.title.ends_with(format))
        .unwrap()
}

/// `PUT` a control-API `body` to `path` and return the reply.
pub async fn control(mock: &Running, path: &str, body: Value) -> reqwest::Response {
    reqwest::Client::new()
        .put(format!("{}{path}", mock.origin))
        .json(&body)
        .send()
        .await
        .unwrap()
}

/// Hands `client` the EPUB of `protocol` and returns its job id and the release's own id.
pub async fn add_epub(
    mock: &Running,
    client: &impl DownloadClient,
    protocol: ReleaseProtocol,
) -> (String, String) {
    let release = found(mock, protocol, "EPUB").await;
    let prepared = client.prepare(&release.link).await.unwrap();
    let hash = prepared.hash.clone();
    client.add(prepared, "").await.unwrap();
    (hash, release.guid)
}

/// The NZB the mock serves for a usenet `release`, as the server would fetch it.
pub async fn nzb_bytes(release: &ProwlarrRelease) -> Vec<u8> {
    let reply = reqwest::get(&release.link).await.unwrap();
    reply.bytes().await.unwrap().to_vec()
}
