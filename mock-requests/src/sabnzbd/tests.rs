//! Contract tests: the server's own SABnzbd client against the fake.

use std::fs;

use omnibus_db::requests::clients::usenet::{job_id, JobFolders};
use omnibus_db::requests::clients::{ClientFile, DownloadClient, Sabnzbd};
use omnibus_shared::ReleaseProtocol;
use reqwest::multipart::{Form, Part};
use serde_json::{json, Value};

use crate::test_support::{add_epub, control, found, nzb_bytes, spawn, Running, EPUB_BYTES};
use crate::CLIENT_PASSWORD;

fn client(mock: &Running) -> Sabnzbd {
    Sabnzbd::new(&mock.origin, CLIENT_PASSWORD)
        .unwrap()
        .with_folders(JobFolders::default())
}

async fn addfile(mock: &Running, nzbname: &str, nzb: &[u8]) -> Value {
    let part = Part::bytes(nzb.to_vec()).file_name("x.nzb");
    reqwest::Client::new()
        .post(format!("{}/api", mock.origin))
        .query(&[
            ("mode", "addfile"),
            ("nzbname", nzbname),
            ("output", "json"),
        ])
        .multipart(Form::new().part("name", part))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap()
}

#[tokio::test]
async fn test_succeeds_for_the_queue_listing() {
    let mock = spawn().await;

    client(&mock).test().await.unwrap();
}

#[tokio::test]
async fn prepare_names_the_job_by_the_sha1_of_the_link() {
    let mock = spawn().await;
    let release = found(&mock, ReleaseProtocol::Usenet, "EPUB").await;

    let prepared = client(&mock).prepare(&release.link).await.unwrap();

    assert_eq!(prepared.hash, job_id(&release.link));
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
async fn addfile_answers_a_false_status_for_an_nzb_it_never_offered() {
    let mock = spawn().await;
    let name = format!("omnibus-{}", "a".repeat(40));

    let reply = addfile(&mock, &name, b"<nzb></nzb>").await;

    assert_eq!(reply["status"], false);
    assert!(reply["error"].is_string());
}

#[tokio::test]
async fn addfile_refuses_a_job_name_that_could_be_a_path() {
    let mock = spawn().await;
    let release = found(&mock, ReleaseProtocol::Usenet, "EPUB").await;
    let nzb = nzb_bytes(&release).await;

    let reply = addfile(&mock, "../escape", &nzb).await;

    assert_eq!(reply["status"], false);
}

#[tokio::test]
async fn addfile_answers_a_job_id_for_a_valid_nzb() {
    let mock = spawn().await;
    let release = found(&mock, ReleaseProtocol::Usenet, "EPUB").await;
    let nzb = nzb_bytes(&release).await;

    let reply = addfile(&mock, &format!("omnibus-{}", release.guid), &nzb).await;

    assert_eq!(reply["status"], true);
    assert!(reply["nzo_ids"][0]
        .as_str()
        .unwrap()
        .starts_with("SABnzbd_nzo_"));
}
