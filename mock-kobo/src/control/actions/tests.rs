//! `Control::download` and `Control::remove_download` against a stub Omnibus and a real temp state file.

use axum::http::StatusCode;
use serde_json::json;
use tempfile::TempDir;

use crate::control::Retarget;
use crate::device::{Device, DeviceError};
use crate::downloads::DownloadPolicy;
use crate::firmware::Quirk;
use crate::test_support::{
    dune_stub, never_answers, new_entitlement, spawn_stub, spawn_sync, stub_control,
    stub_control_with, wait_until, Stub,
};

use super::*;

fn device_holding_book_1() -> Device {
    let mut device = Device::new("HW-1");
    device.apply(serde_json::from_value(new_entitlement("book-1", "Dune")).unwrap());
    device
}

#[tokio::test]
async fn download_marks_the_book_downloaded_against_a_healthy_stub() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    control.sync(DownloadPolicy::None).await.unwrap();

    let result = control.download(vec!["book-1".into()]).await.unwrap();

    match result {
        Acted::Done(view) => assert!(view.library["book-1"].downloaded),
        other => panic!("expected Done, got {other:?}"),
    }
}

#[tokio::test]
async fn download_reports_failed_with_the_quirk_when_a_book_fails() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        download_status: StatusCode::NOT_FOUND,
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    control.sync(DownloadPolicy::None).await.unwrap();

    let result = control.download(vec!["book-1".into()]).await.unwrap();

    match result {
        Acted::Failed {
            quirk: Some(Quirk::DownloadFailure),
            message,
        } => assert!(message.contains("book-1")),
        other => panic!("expected Failed, got {other:?}"),
    }
}

#[tokio::test]
async fn download_returns_unknown_book_without_a_request() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));

    let result = control.download(vec!["book-1".into()]).await;

    match result {
        Err(ControlError::Device(DeviceError::UnknownBook(id))) => assert_eq!(id, "book-1"),
        other => panic!("expected UnknownBook, got {other:?}"),
    }
    assert!(stub.paths().is_empty());
}

#[tokio::test]
async fn download_returns_sync_in_progress_while_a_sync_runs() {
    let stub = spawn_stub(never_answers()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control_with(&stub, device_holding_book_1(), dir.path().join("kobo.json"));
    let running = spawn_sync(&control);
    wait_until(|| control.view().syncing).await;

    let result = control.download(vec!["book-1".into()]).await;

    assert!(matches!(result, Err(ControlError::SyncInProgress)));
    running.abort();
}

#[tokio::test]
async fn download_returns_state_not_saved_when_state_file_cannot_be_written() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let parent = dir.path().join("parent");
    std::fs::write(&parent, "").unwrap();
    let control = stub_control_with(&stub, device_holding_book_1(), parent.join("kobo.json"));

    let result = control.download(vec!["book-1".into()]).await;

    assert!(matches!(result, Err(ControlError::StateNotSaved(_))));
}

#[tokio::test]
async fn download_refuses_a_token_wired_for_another_server() {
    let wired = spawn_stub(Stub::default()).await;
    let live = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control_with(&live, device_holding_book_1(), dir.path().join("kobo.json"));
    control
        .retarget(Retarget::Wired {
            token: "another-token".into(),
            url: wired.origin.clone(),
        })
        .await
        .unwrap();

    let result = control.download(vec!["book-1".into()]).await.unwrap();

    match result {
        Acted::Failed {
            quirk: None,
            message,
        } => assert!(message.contains(&wired.origin)),
        other => panic!("expected a refusal, got {other:?}"),
    }
    assert!(live.paths().is_empty());
    assert_eq!(control.view().last_sync, None);
}

#[tokio::test]
async fn remove_download_returns_sync_in_progress_while_a_sync_runs() {
    let stub = spawn_stub(never_answers()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control_with(&stub, device_holding_book_1(), dir.path().join("kobo.json"));
    let running = spawn_sync(&control);
    wait_until(|| control.view().syncing).await;

    let result = control.remove_download("book-1").await;

    assert!(matches!(result, Err(ControlError::SyncInProgress)));
    running.abort();
}

#[tokio::test]
async fn remove_download_returns_state_not_saved_when_state_file_cannot_be_written() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let parent = dir.path().join("parent");
    std::fs::write(&parent, "").unwrap();
    let control = stub_control_with(&stub, device_holding_book_1(), parent.join("kobo.json"));

    let result = control.remove_download("book-1").await;

    assert!(matches!(result, Err(ControlError::StateNotSaved(_))));
}
