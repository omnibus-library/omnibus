//! `Control::download`, `remove_download`, `read` and `finish` against a
//! stub Omnibus and a real temp state file.

use axum::http::StatusCode;
use serde_json::json;
use tempfile::TempDir;

use crate::control::Retarget;
use crate::device::{Device, DeviceError};
use crate::downloads::DownloadPolicy;
use crate::firmware::Quirk;
use crate::reading::{Percent, ReadStatus};
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

fn device_holding_downloaded_book_1() -> Device {
    let mut device = device_holding_book_1();
    device.library.get_mut("book-1").unwrap().downloaded = true;
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

#[tokio::test]
async fn read_sends_the_position_and_keeps_it_on_the_device() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control_with(
        &stub,
        device_holding_downloaded_book_1(),
        dir.path().join("kobo.json"),
    );

    let result = control
        .read("book-1".into(), Percent::new(42).unwrap(), None)
        .await
        .unwrap();

    match result {
        Acted::Done(view) => {
            let reading = &view.library["book-1"].reading;
            assert_eq!(reading.status, ReadStatus::Reading);
            assert_eq!(reading.bookmark.as_ref().unwrap().percent, Percent::new(42));
        }
        other => panic!("expected Done, got {other:?}"),
    }
}

#[tokio::test]
async fn read_reports_state_put_result_when_a_sub_result_is_not_success() {
    let stub = spawn_stub(Stub {
        state_reply: Some(json!({
            "RequestResult": "Success",
            "UpdateResults": [{
                "StatusInfoResult": { "Result": "Success" },
                "CurrentBookmarkResult": { "Result": "Conflict" },
            }],
        })),
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let control = stub_control_with(
        &stub,
        device_holding_downloaded_book_1(),
        dir.path().join("kobo.json"),
    );

    let result = control
        .read("book-1".into(), Percent::new(42).unwrap(), None)
        .await
        .unwrap();

    match result {
        Acted::Failed {
            quirk: Some(Quirk::StatePutResult),
            message,
        } => {
            assert!(message.contains("Conflict"), "{message}");
            assert!(message.contains("CurrentBookmarkResult"), "{message}");
        }
        other => panic!("expected Failed, got {other:?}"),
    }
    // A failed PUT keeps the device's change.
    assert_eq!(
        control.view().library["book-1"].reading.status,
        ReadStatus::Reading
    );
}

#[tokio::test]
async fn finish_marks_the_book_finished_and_sends_it() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control_with(&stub, device_holding_book_1(), dir.path().join("kobo.json"));

    let result = control.finish("book-1".into()).await.unwrap();

    match result {
        Acted::Done(view) => {
            assert_eq!(view.library["book-1"].reading.status, ReadStatus::Finished);
        }
        other => panic!("expected Done, got {other:?}"),
    }
}

#[tokio::test]
async fn read_returns_unknown_book_for_a_book_it_lacks() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let state_path = dir.path().join("kobo.json");
    let control = stub_control(&stub, state_path.clone());

    let result = control
        .read("book-1".into(), Percent::new(42).unwrap(), None)
        .await;

    match result {
        Err(ControlError::Device(DeviceError::UnknownBook(id))) => assert_eq!(id, "book-1"),
        other => panic!("expected UnknownBook, got {other:?}"),
    }
    assert!(stub.paths().is_empty(), "no request should have been made");
    assert!(!state_path.exists(), "nothing should have been saved");
}

#[tokio::test]
async fn read_returns_not_downloaded_for_an_undownloaded_book() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let state_path = dir.path().join("kobo.json");
    let control = stub_control_with(&stub, device_holding_book_1(), state_path.clone());

    let result = control
        .read("book-1".into(), Percent::new(42).unwrap(), None)
        .await;

    match result {
        Err(ControlError::Device(DeviceError::NotDownloaded(id))) => assert_eq!(id, "book-1"),
        other => panic!("expected NotDownloaded, got {other:?}"),
    }
    assert!(stub.paths().is_empty(), "no request should have been made");
    assert!(!state_path.exists(), "nothing should have been saved");
}

#[tokio::test]
async fn read_returns_sync_in_progress_while_a_sync_runs() {
    let stub = spawn_stub(never_answers()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control_with(
        &stub,
        device_holding_downloaded_book_1(),
        dir.path().join("kobo.json"),
    );
    let running = spawn_sync(&control);
    wait_until(|| control.view().syncing).await;

    let result = control
        .read("book-1".into(), Percent::new(42).unwrap(), None)
        .await;

    assert!(matches!(result, Err(ControlError::SyncInProgress)));
    running.abort();
}

#[tokio::test]
async fn read_returns_state_not_saved_when_state_file_cannot_be_written() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let parent = dir.path().join("parent");
    std::fs::write(&parent, "").unwrap();
    let control = stub_control_with(
        &stub,
        device_holding_downloaded_book_1(),
        parent.join("kobo.json"),
    );

    let result = control
        .read("book-1".into(), Percent::new(42).unwrap(), None)
        .await;

    assert!(matches!(result, Err(ControlError::StateNotSaved(_))));
}

#[tokio::test]
async fn finish_returns_unknown_book_for_a_book_it_lacks() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));

    let result = control.finish("book-1".into()).await;

    match result {
        Err(ControlError::Device(DeviceError::UnknownBook(id))) => assert_eq!(id, "book-1"),
        other => panic!("expected UnknownBook, got {other:?}"),
    }
}

#[tokio::test]
async fn finish_returns_sync_in_progress_while_a_sync_runs() {
    let stub = spawn_stub(never_answers()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control_with(&stub, device_holding_book_1(), dir.path().join("kobo.json"));
    let running = spawn_sync(&control);
    wait_until(|| control.view().syncing).await;

    let result = control.finish("book-1".into()).await;

    assert!(matches!(result, Err(ControlError::SyncInProgress)));
    running.abort();
}

#[tokio::test]
async fn finish_returns_state_not_saved_when_state_file_cannot_be_written() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let parent = dir.path().join("parent");
    std::fs::write(&parent, "").unwrap();
    let control = stub_control_with(&stub, device_holding_book_1(), parent.join("kobo.json"));

    let result = control.finish("book-1".into()).await;

    assert!(matches!(result, Err(ControlError::StateNotSaved(_))));
}
