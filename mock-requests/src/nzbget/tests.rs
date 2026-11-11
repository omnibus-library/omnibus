//! Contract tests: the server's own NZBGet client against the fake.

use std::fs;

use base64::engine::{general_purpose::STANDARD, Engine as _};
use omnibus_db::requests::clients::usenet::JobFolders;
use omnibus_db::requests::clients::{ClientFile, DownloadClient, Nzbget};
use omnibus_shared::ReleaseProtocol;
use serde_json::{json, Value};

use crate::test_support::{add_epub, control, found, nzb_bytes, spawn, Running, EPUB_BYTES};
use crate::{CLIENT_PASSWORD, CLIENT_USERNAME};

fn client(mock: &Running) -> Nzbget {
    Nzbget::new(&mock.origin, CLIENT_USERNAME, CLIENT_PASSWORD)
        .unwrap()
        .with_folders(JobFolders::default())
}

async fn rpc(mock: &Running, method: &str, params: Value) -> Value {
    reqwest::Client::new()
        .post(format!("{}/jsonrpc", mock.origin))
        .json(&json!({"method": method, "params": params, "id": 1}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap()
}

async fn append(mock: &Running, name: &str, nzb: &[u8]) -> Value {
    let params = json!([
        name,
        STANDARD.encode(nzb),
        "",
        0,
        false,
        false,
        "",
        0,
        "SCORE",
        []
    ]);
    rpc(mock, "append", params).await
}

#[tokio::test]
async fn test_succeeds_for_the_version_call() {
    let mock = spawn().await;

    client(&mock).test().await.unwrap();
}

#[tokio::test]
async fn status_reads_downloading_before_the_download_is_done() {
    let mock = spawn().await;

    let (hash, _) = add_epub(&mock, &client(&mock), ReleaseProtocol::Usenet).await;

    let status = client(&mock).status(&hash).await.unwrap().unwrap();
    assert_eq!(status.state, "downloading");
    assert!(status.progress < 1.0);
}

#[tokio::test]
async fn status_and_files_read_the_job_folder_once_the_download_is_done() {
    let mock = spawn().await;
    control(&mock, "/_mock/downloads", json!({"secs": 0})).await;

    let (hash, release) = add_epub(&mock, &client(&mock), ReleaseProtocol::Usenet).await;

    let status = client(&mock).status(&hash).await.unwrap().unwrap();
    assert_eq!(status.state, "stoppedUP");
    assert_eq!(status.progress, 1.0);
    let name = format!("mock-{release}.epub");
    let files = client(&mock).files(&hash).await.unwrap();
    assert_eq!(
        files,
        [ClientFile {
            name: name.clone(),
            size: EPUB_BYTES.len() as u64
        }]
    );
    let folder = mock.downloads.join(format!("omnibus-{hash}"));
    assert_eq!(fs::read(folder.join(name)).unwrap(), EPUB_BYTES);
}

#[tokio::test]
async fn status_reads_error_when_downloads_are_set_to_fail() {
    let mock = spawn().await;
    control(&mock, "/_mock/downloads", json!({"outcome": "fail"})).await;

    let (hash, _) = add_epub(&mock, &client(&mock), ReleaseProtocol::Usenet).await;

    assert_eq!(
        client(&mock).status(&hash).await.unwrap().unwrap().state,
        "error"
    );
}

#[tokio::test]
async fn status_holds_the_job_in_the_queue_when_downloads_stall() {
    let mock = spawn().await;
    control(&mock, "/_mock/downloads", json!({"outcome": "stall"})).await;

    let (hash, _) = add_epub(&mock, &client(&mock), ReleaseProtocol::Usenet).await;

    let status = client(&mock).status(&hash).await.unwrap().unwrap();
    assert_eq!(status.state, "downloading");
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

    let (hash, _) = add_epub(&mock, &client(&mock), ReleaseProtocol::Usenet).await;

    let names: Vec<_> = client(&mock)
        .files(&hash)
        .await
        .unwrap()
        .into_iter()
        .map(|f| f.name)
        .collect();
    assert_eq!(names, ["README.txt"]);
}

#[tokio::test]
async fn remove_deletes_a_finished_job_and_its_folder() {
    let mock = spawn().await;
    control(&mock, "/_mock/downloads", json!({"secs": 0})).await;
    let (hash, _) = add_epub(&mock, &client(&mock), ReleaseProtocol::Usenet).await;
    client(&mock).status(&hash).await.unwrap();
    assert!(mock.downloads.join(format!("omnibus-{hash}")).exists());

    client(&mock).remove(&hash, true).await.unwrap();

    assert!(client(&mock).status(&hash).await.unwrap().is_none());
    assert!(!mock.downloads.join(format!("omnibus-{hash}")).exists());
    assert!(mock.downloads.exists());
}

#[tokio::test]
async fn remove_cancels_a_job_still_in_the_queue() {
    let mock = spawn().await;
    let (hash, _) = add_epub(&mock, &client(&mock), ReleaseProtocol::Usenet).await;

    client(&mock).remove(&hash, true).await.unwrap();

    assert!(client(&mock).status(&hash).await.unwrap().is_none());
}

#[tokio::test]
async fn append_answers_an_error_for_an_nzb_it_never_offered() {
    let mock = spawn().await;
    let name = format!("omnibus-{}.nzb", "a".repeat(40));

    let reply = append(&mock, &name, b"<nzb></nzb>").await;

    assert!(reply["error"]["message"].is_string(), "{reply}");
}

#[tokio::test]
async fn append_refuses_a_job_name_that_could_be_a_path() {
    let mock = spawn().await;
    let release = found(&mock, ReleaseProtocol::Usenet, "EPUB").await;
    let nzb = nzb_bytes(&release).await;

    let reply = append(&mock, "../escape.nzb", &nzb).await;

    assert!(reply["error"]["message"].is_string(), "{reply}");
}

#[tokio::test]
async fn append_answers_a_positive_job_id_for_a_valid_nzb() {
    let mock = spawn().await;
    let release = found(&mock, ReleaseProtocol::Usenet, "EPUB").await;
    let nzb = nzb_bytes(&release).await;

    let reply = append(&mock, &format!("omnibus-{}.nzb", release.guid), &nzb).await;

    assert!(reply["result"].as_i64().unwrap() > 0, "{reply}");
}
