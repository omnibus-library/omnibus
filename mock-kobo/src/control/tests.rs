//! `Control::sync`, `view` and `requests` against a stub Omnibus and a real temp state file.

use std::sync::Arc;
use std::time::Duration;

use axum::http::StatusCode;
use serde_json::json;
use tempfile::TempDir;
use tokio::sync::Notify;

use crate::device::Device;
use crate::state;
use crate::test_support::{new_entitlement, spawn_stub, stub_control, Stub, STUB_TOKEN};

use super::*;

/// Poll `condition` until it holds, failing the test at a deadline.
async fn wait_until(mut condition: impl FnMut() -> bool) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while !condition() {
        assert!(
            tokio::time::Instant::now() < deadline,
            "timed out waiting for the condition"
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

/// A device already holding the book "Dune".
fn device_with_dune() -> Device {
    let mut device = Device::new("HW-1");
    device.apply(serde_json::from_value(new_entitlement("book-1", "Dune")).unwrap());
    device
}

/// Start a sync on its own task, as the control API's handler does.
fn spawn_sync(control: &Arc<Control>) -> tokio::task::JoinHandle<Result<LastSync, ControlError>> {
    let control = Arc::clone(control);
    tokio::spawn(async move { control.sync().await })
}

fn dune_stub() -> Stub {
    Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        ..Stub::default()
    }
}

#[tokio::test]
async fn sync_records_synced_last_sync_and_library_against_healthy_stub() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));

    let last_sync = control.sync().await.unwrap();

    assert_eq!(last_sync, LastSync::Synced { pages: 1 });
    let view = control.view();
    assert_eq!(view.last_sync, Some(LastSync::Synced { pages: 1 }));
    assert_eq!(view.library["book-1"].title, "Dune");
    assert_eq!(view.sync_token, Some("page-1".to_owned()));
}

#[tokio::test]
async fn sync_records_failed_last_sync_with_quirk_when_store_path_returns_404() {
    let stub = spawn_stub(Stub {
        store_path_status: StatusCode::NOT_FOUND,
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    let failed = LastSync::Failed {
        quirk: Some(Quirk::StorePaths),
        message: "sync failed (StorePaths): /kobo/<token>/v1/user/profile answered 404 Not Found"
            .into(),
    };

    let last_sync = control.sync().await.unwrap();

    assert_eq!(last_sync, failed);
    assert_eq!(control.view().last_sync, Some(failed));
}

#[tokio::test]
async fn sync_records_failed_last_sync_without_quirk_when_server_unreachable() {
    let saved = SavedState {
        url: None,
        token: STUB_TOKEN.into(),
        wired_url: None,
        device: Device::new("HW-1"),
    };
    let dir = TempDir::new().unwrap();
    // Port 1 is privileged, so a parallel stub's `bind("127.0.0.1:0")` is never handed it.
    let control = Arc::new(Control::new(
        saved,
        "http://127.0.0.1:1".into(),
        dir.path().join("kobo.json"),
    ));

    let last_sync = control.sync().await.unwrap();

    let LastSync::Failed { quirk, message } = last_sync else {
        panic!("expected a failed sync, got {last_sync:?}");
    };
    assert_eq!(quirk, None);
    assert!(!message.contains(STUB_TOKEN));
}

#[tokio::test]
async fn sync_appends_requests_of_failed_sync_to_request_log() {
    let stub = spawn_stub(Stub {
        store_path_status: StatusCode::NOT_FOUND,
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));

    control.sync().await.unwrap();
    control.sync().await.unwrap();

    let lines: Vec<String> = control
        .requests()
        .iter()
        .map(|r| format!("{} {} {}", r.method, r.path, r.status))
        .collect();
    let one_failed_sync = [
        "GET /kobo/<token>/v1/initialization 200",
        "POST /kobo/<token>/v1/analytics/gettests 200",
        "GET /kobo/<token>/v1/user/profile 404",
    ];
    assert_eq!(lines, [one_failed_sync, one_failed_sync].concat());
}

#[tokio::test]
async fn sync_returns_sync_in_progress_while_another_sync_runs() {
    let stub = spawn_stub(Stub {
        sync_never_answers: true,
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    let running = spawn_sync(&control);
    wait_until(|| control.view().syncing).await;

    let second = tokio::time::timeout(Duration::from_secs(5), control.sync())
        .await
        .expect("a second sync is turned away at once");

    assert!(matches!(second, Err(ControlError::SyncInProgress)));
    running.abort();
}

#[tokio::test]
async fn view_shows_syncing_while_sync_runs() {
    let stub = spawn_stub(Stub {
        sync_never_answers: true,
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    assert!(!control.view().syncing);

    let running = spawn_sync(&control);

    wait_until(|| control.view().syncing).await;
    assert_eq!(control.view().last_sync, None);
    running.abort();
}

#[tokio::test]
async fn sync_completes_when_caller_is_cancelled() {
    let gate = Arc::new(Notify::new());
    let stub = spawn_stub(Stub {
        sync_pages: vec![
            json!([new_entitlement("book-1", "Dune")]),
            json!([new_entitlement("book-2", "Dune Messiah")]),
        ],
        second_page_gate: Some(Arc::clone(&gate)),
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    let library_sync = format!("/kobo/{STUB_TOKEN}/v1/library/sync");
    let running = spawn_sync(&control);
    wait_until(|| stub.requests_to(&library_sync).len() == 2).await;

    running.abort();
    running.await.unwrap_err();
    gate.notify_one();

    wait_until(|| !control.view().syncing).await;
    let view = control.view();
    assert_eq!(view.last_sync, Some(LastSync::Synced { pages: 2 }));
    let titles: Vec<_> = view.library.values().map(|b| b.title.as_str()).collect();
    assert_eq!(titles, ["Dune", "Dune Messiah"]);
    let sync_requests = control
        .requests()
        .iter()
        .filter(|r| r.path.ends_with("/v1/library/sync"))
        .count();
    assert_eq!(sync_requests, 2);
}

#[tokio::test]
async fn sync_saves_state_file_after_sync() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let control = stub_control(&stub, path.clone());

    control.sync().await.unwrap();

    let saved = state::load(&path).await.unwrap().unwrap();
    assert_eq!(saved.token, STUB_TOKEN);
    assert_eq!(saved.device.library["book-1"].title, "Dune");
    assert_eq!(saved.device.sync_token, Some("page-1".to_owned()));
}

#[tokio::test]
async fn sync_returns_state_not_saved_when_state_file_cannot_be_written() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let parent = dir.path().join("parent");
    std::fs::write(&parent, "").unwrap();
    let control = stub_control(&stub, parent.join("kobo.json"));

    let result = control.sync().await;

    assert!(matches!(result, Err(ControlError::StateNotSaved(_))));
    assert_eq!(
        control.view().last_sync,
        Some(LastSync::Synced { pages: 1 })
    );
}

#[tokio::test]
async fn reset_wipes_library_sync_token_last_sync_and_requests() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    control.sync().await.unwrap();

    let view = control.reset().await.unwrap();

    assert_eq!(view, control.view());
    assert!(view.library.is_empty());
    assert_eq!(view.sync_token, None);
    assert_eq!(view.last_sync, None);
    assert!(control.requests().is_empty());
}

#[tokio::test]
async fn reset_keeps_hardware_id_and_token() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    control.sync().await.unwrap();

    let view = control.reset().await.unwrap();

    assert_eq!(view.hardware_id, "HW-1");
    assert_eq!(control.sync().await.unwrap(), LastSync::Synced { pages: 1 });
    assert_eq!(control.view().library["book-1"].title, "Dune");
}

#[tokio::test]
async fn reset_keeps_pinned_url_in_state_file() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let saved = SavedState {
        url: Some("http://pinned.example:3000".into()),
        token: STUB_TOKEN.into(),
        wired_url: None,
        device: Device::new("HW-1"),
    };
    let control = Arc::new(Control::new(
        saved,
        "http://pinned.example:3000".into(),
        path.clone(),
    ));

    control.reset().await.unwrap();

    let reloaded = state::load(&path).await.unwrap().unwrap();
    assert_eq!(reloaded.url, Some("http://pinned.example:3000".to_owned()));
}

#[tokio::test]
async fn reset_saves_wiped_state_file() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let control = stub_control(&stub, path.clone());
    control.sync().await.unwrap();

    control.reset().await.unwrap();

    let saved = state::load(&path).await.unwrap().unwrap();
    assert_eq!(saved.token, STUB_TOKEN);
    assert_eq!(saved.device, Device::new("HW-1"));
}

#[tokio::test]
async fn reset_returns_sync_in_progress_while_sync_runs() {
    let stub = spawn_stub(Stub {
        sync_never_answers: true,
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let saved = SavedState {
        url: None,
        token: STUB_TOKEN.into(),
        wired_url: None,
        device: device_with_dune(),
    };
    let control = Arc::new(Control::new(
        saved,
        stub.origin.clone(),
        dir.path().join("kobo.json"),
    ));
    let running = spawn_sync(&control);
    wait_until(|| control.view().syncing).await;

    let result = control.reset().await;

    assert!(matches!(result, Err(ControlError::SyncInProgress)));
    assert_eq!(control.view().library, device_with_dune().library);
    running.abort();
}
