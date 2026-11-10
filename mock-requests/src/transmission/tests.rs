//! Contract tests: the server's own Transmission client against the fake.

use std::fs;

use omnibus_db::requests::clients::{ClientFile, DownloadClient, Transmission};
use omnibus_db::requests::ConnectionError;
use omnibus_shared::ReleaseProtocol;
use serde_json::{json, Value};

use crate::test_support::{add_epub, control, spawn, Running, EPUB_BYTES};
use crate::{CLIENT_PASSWORD, CLIENT_USERNAME};

const SESSION: &str = "x-transmission-session-id";

fn client(mock: &Running) -> Transmission {
    Transmission::new(&mock.origin, CLIENT_USERNAME, CLIENT_PASSWORD).unwrap()
}

async fn rpc(mock: &Running, session: Option<&str>, body: Value) -> reqwest::Response {
    let mut request = reqwest::Client::new()
        .post(format!("{}/transmission/rpc", mock.origin))
        .json(&body);
    if let Some(session) = session {
        request = request.header(SESSION, session);
    }
    request.send().await.unwrap()
}

#[tokio::test]
async fn rpc_answers_409_carrying_the_session_id_when_a_call_lacks_it() {
    let mock = spawn().await;

    let refused = rpc(&mock, None, json!({"method": "session-get"})).await;
    let id = refused.headers()[SESSION].to_str().unwrap().to_string();
    let accepted = rpc(&mock, Some(&id), json!({"method": "session-get"})).await;

    assert_eq!(refused.status(), 409);
    assert!(accepted.status().is_success());
}

#[tokio::test]
async fn test_succeeds_after_the_session_handshake() {
    let mock = spawn().await;

    client(&mock).test().await.unwrap();
}

#[tokio::test]
async fn status_reads_downloading_before_the_download_is_done() {
    let mock = spawn().await;

    let (hash, _) = add_epub(&mock, &client(&mock), ReleaseProtocol::Torrent).await;

    let status = client(&mock).status(&hash).await.unwrap().unwrap();
    assert_eq!(status.state, "downloading");
    assert!(status.progress < 1.0);
    assert!(status.eta.is_some_and(|eta| eta > 0));
    assert!(status.added_on.is_some());
}

#[tokio::test]
async fn status_files_and_disk_agree_once_the_download_is_done() {
    let mock = spawn().await;
    control(&mock, "/_mock/downloads", json!({"secs": 0})).await;

    let (hash, _) = add_epub(&mock, &client(&mock), ReleaseProtocol::Torrent).await;

    let status = client(&mock).status(&hash).await.unwrap().unwrap();
    assert_eq!(status.state, "uploading");
    assert_eq!(status.progress, 1.0);
    assert_eq!(status.save_path, mock.downloads.to_str().unwrap());
    let name = format!("mock-{hash}/mock-{hash}.epub");
    let files = client(&mock).files(&hash).await.unwrap();
    assert_eq!(
        files,
        [ClientFile {
            name: name.clone(),
            size: EPUB_BYTES.len() as u64
        }]
    );
    assert_eq!(fs::read(mock.downloads.join(name)).unwrap(), EPUB_BYTES);
}

#[tokio::test]
async fn status_reads_error_when_downloads_are_set_to_fail() {
    let mock = spawn().await;
    control(&mock, "/_mock/downloads", json!({"outcome": "fail"})).await;

    let (hash, _) = add_epub(&mock, &client(&mock), ReleaseProtocol::Torrent).await;

    assert_eq!(
        client(&mock).status(&hash).await.unwrap().unwrap().state,
        "error"
    );
}

#[tokio::test]
async fn status_holds_the_bar_short_of_full_when_downloads_stall() {
    let mock = spawn().await;
    control(&mock, "/_mock/downloads", json!({"outcome": "stall"})).await;

    let (hash, _) = add_epub(&mock, &client(&mock), ReleaseProtocol::Torrent).await;

    let status = client(&mock).status(&hash).await.unwrap().unwrap();
    assert_eq!(status.state, "downloading");
    assert!(status.progress < 1.0);
    assert_eq!(status.eta, None);
}

#[tokio::test]
async fn remove_deletes_the_download_and_its_folder() {
    let mock = spawn().await;
    control(&mock, "/_mock/downloads", json!({"secs": 0})).await;
    let (hash, _) = add_epub(&mock, &client(&mock), ReleaseProtocol::Torrent).await;
    client(&mock).status(&hash).await.unwrap();
    assert!(mock.downloads.join(format!("mock-{hash}")).exists());

    client(&mock).remove(&hash, true).await.unwrap();

    assert!(client(&mock).status(&hash).await.unwrap().is_none());
    assert!(!mock.downloads.join(format!("mock-{hash}")).exists());
    assert!(mock.downloads.exists());
}

#[tokio::test]
async fn remove_is_ok_for_a_hash_it_does_not_hold() {
    let mock = spawn().await;

    client(&mock).remove(&"a".repeat(40), true).await.unwrap();
}

#[tokio::test]
async fn add_rejects_a_magnet_for_a_release_it_never_offered() {
    let mock = spawn().await;
    let magnet = format!("magnet:?xt=urn:btih:{}", "c".repeat(40));
    let prepared = client(&mock).prepare(&magnet).await.unwrap();

    let err = client(&mock).add(prepared, "").await.unwrap_err();

    assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
}

#[tokio::test]
async fn add_answers_a_failure_result_for_a_filename_that_is_not_a_magnet() {
    let mock = spawn().await;
    let body =
        json!({"method": "torrent-add", "arguments": {"filename": "http://example.com/x.torrent"}});

    let refused = rpc(&mock, None, json!({})).await;
    let id = refused.headers()[SESSION].to_str().unwrap().to_string();

    let reply: Value = rpc(&mock, Some(&id), body).await.json().await.unwrap();

    assert_ne!(reply["result"], "success");
}
