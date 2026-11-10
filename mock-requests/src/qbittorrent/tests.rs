//! Contract tests: the server's own qBittorrent client against the fake.

use std::fs;

use omnibus_db::requests::clients::{ClientFile, DownloadClient, Qbittorrent};
use omnibus_db::requests::ConnectionError;
use omnibus_shared::ReleaseProtocol;
use serde_json::json;

use crate::test_support::{control, found, spawn, Running, EPUB_BYTES};
use crate::{CLIENT_PASSWORD, CLIENT_USERNAME};

fn client(mock: &Running) -> Qbittorrent {
    Qbittorrent::new(&mock.origin, CLIENT_USERNAME, CLIENT_PASSWORD).unwrap()
}

/// Hands the client the torrent EPUB and returns its hash.
async fn add_epub(mock: &Running) -> String {
    let link = found(mock, ReleaseProtocol::Torrent, "EPUB").await.link;
    let prepared = client(mock).prepare(&link).await.unwrap();
    let hash = prepared.hash.clone();
    client(mock).add(prepared, "").await.unwrap();
    hash
}

#[tokio::test]
async fn test_succeeds_with_any_login() {
    let mock = spawn().await;

    client(&mock).test().await.unwrap();
}

#[tokio::test]
async fn prepare_gives_the_release_id_as_the_hash() {
    let mock = spawn().await;
    let release = found(&mock, ReleaseProtocol::Torrent, "EPUB").await;

    let prepared = client(&mock).prepare(&release.link).await.unwrap();

    assert_eq!(prepared.hash, release.guid);
}

#[tokio::test]
async fn status_reads_downloading_before_the_download_is_done() {
    let mock = spawn().await;

    let hash = add_epub(&mock).await;

    let status = client(&mock).status(&hash).await.unwrap().unwrap();
    assert_eq!(status.state, "downloading");
    assert!(status.progress < 1.0);
    assert!(status.eta.is_some_and(|eta| eta > 0));
}

#[tokio::test]
async fn status_files_and_disk_agree_once_the_download_is_done() {
    let mock = spawn().await;
    control(&mock, "/_mock/downloads", json!({"secs": 0})).await;

    let hash = add_epub(&mock).await;

    let status = client(&mock).status(&hash).await.unwrap().unwrap();
    assert_eq!(status.state, "stalledUP");
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
async fn remove_deletes_the_download_and_its_folder_but_not_the_downloads_dir() {
    let mock = spawn().await;
    control(&mock, "/_mock/downloads", json!({"secs": 0})).await;
    let hash = add_epub(&mock).await;
    client(&mock).status(&hash).await.unwrap();

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
async fn status_reads_error_when_downloads_are_set_to_fail() {
    let mock = spawn().await;
    control(&mock, "/_mock/downloads", json!({"outcome": "fail"})).await;

    let hash = add_epub(&mock).await;

    assert_eq!(
        client(&mock).status(&hash).await.unwrap().unwrap().state,
        "error"
    );
}

#[tokio::test]
async fn status_reads_stalled_with_the_bar_short_of_full_when_downloads_stall() {
    let mock = spawn().await;
    control(&mock, "/_mock/downloads", json!({"outcome": "stall"})).await;

    let hash = add_epub(&mock).await;

    let status = client(&mock).status(&hash).await.unwrap().unwrap();
    assert_eq!(status.state, "stalledDL");
    assert!(status.progress < 1.0);
}

#[tokio::test]
async fn files_lists_only_a_readme_when_downloads_are_set_to_junk() {
    let mock = spawn().await;
    control(
        &mock,
        "/_mock/downloads",
        json!({"outcome": "junk", "secs": 0}),
    )
    .await;

    let hash = add_epub(&mock).await;

    let files = client(&mock).files(&hash).await.unwrap();
    let names: Vec<_> = files.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(names, [format!("mock-{hash}/README.txt")]);
}

#[tokio::test]
async fn hash_for_tag_finds_nothing_though_info_lists_every_download() {
    let mock = spawn().await;
    add_epub(&mock).await;

    assert_eq!(client(&mock).hash_for_tag("x").await.unwrap(), None);
}

#[tokio::test]
async fn files_is_empty_for_a_hash_it_does_not_hold() {
    let mock = spawn().await;

    assert!(client(&mock)
        .files(&"b".repeat(40))
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn add_rejects_a_magnet_for_a_release_it_never_offered() {
    let mock = spawn().await;
    let magnet = format!("magnet:?xt=urn:btih:{}", "c".repeat(40));
    let prepared = client(&mock).prepare(&magnet).await.unwrap();

    let err = client(&mock).add(prepared, "").await.unwrap_err();

    assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
}
