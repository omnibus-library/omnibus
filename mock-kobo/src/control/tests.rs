//! `Control::sync`, `reset`, `retarget`, `view` and `requests` against a stub Omnibus and a real temp state file.

use std::sync::Arc;
use std::time::Duration;

use axum::http::StatusCode;
use serde_json::json;
use tempfile::TempDir;
use tokio::sync::Notify;

use crate::annotations::{NewHighlight, Swatch};
use crate::device::{Device, DeviceError};
use crate::downloads::DownloadPolicy;
use crate::state;
use crate::test_support::{
    control_wired_against, control_with_downloaded_book, device_holding, dune_stub, never_answers,
    new_entitlement, request_lines, spawn_stub, spawn_sync, stub_control, stub_control_with,
    wait_until, Stub, STUB_TOKEN,
};

use super::*;

/// A device already holding the book "Dune".
fn device_with_dune() -> Device {
    device_holding("book-1", "Dune")
}

#[tokio::test]
async fn sync_records_synced_last_sync_and_library_against_healthy_stub() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));

    let last_sync = control.sync(DownloadPolicy::None).await.unwrap();

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

    let last_sync = control.sync(DownloadPolicy::None).await.unwrap();

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

    let last_sync = control.sync(DownloadPolicy::None).await.unwrap();

    let LastSync::Failed { quirk, message } = last_sync else {
        panic!("expected a failed sync, got {last_sync:?}");
    };
    assert_eq!(quirk, None);
    assert!(!message.contains(STUB_TOKEN));
}

#[tokio::test]
async fn sync_refuses_token_wired_for_another_server() {
    let wired = spawn_stub(Stub::default()).await;
    let live = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let control = control_wired_against(
        &live.origin,
        Some(&wired.origin),
        dir.path().join("kobo.json"),
    );
    let refused = LastSync::Failed {
        quirk: None,
        message: format!(
            "the device token was auto-wired for {}, not {}: press w to wire one for this \
             server, or give one with t / --token",
            wired.origin, live.origin
        ),
    };

    let last_sync = control.sync(DownloadPolicy::None).await.unwrap();

    assert_eq!(last_sync, refused);
    assert_eq!(control.view().last_sync, Some(refused));
    assert!(!control.view().syncing);
    assert!(live.paths().is_empty());
    assert!(wired.paths().is_empty());
}

#[tokio::test]
async fn sync_sends_token_wired_for_the_live_server() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = control_wired_against(
        &stub.origin,
        Some(&stub.origin),
        dir.path().join("kobo.json"),
    );

    let last_sync = control.sync(DownloadPolicy::None).await.unwrap();

    assert_eq!(last_sync, LastSync::Synced { pages: 1 });
    let initialization = format!("/kobo/{STUB_TOKEN}/v1/initialization");
    assert_eq!(stub.requests_to(&initialization).len(), 1);
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

    control.sync(DownloadPolicy::None).await.unwrap();
    control.sync(DownloadPolicy::None).await.unwrap();

    let lines = request_lines(&control.requests());
    let one_failed_sync = [
        "GET /kobo/<token>/v1/initialization 200",
        "POST /kobo/<token>/v1/analytics/gettests 200",
        "GET /kobo/<token>/v1/user/profile 404",
    ];
    assert_eq!(lines, [one_failed_sync, one_failed_sync].concat());
}

#[tokio::test]
async fn sync_returns_sync_in_progress_while_another_sync_runs() {
    let stub = spawn_stub(never_answers()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    let running = spawn_sync(&control);
    wait_until(|| control.view().syncing).await;

    let second = tokio::time::timeout(Duration::from_secs(5), control.sync(DownloadPolicy::None))
        .await
        .expect("a second sync is turned away at once");

    assert!(matches!(second, Err(ControlError::SyncInProgress)));
    running.abort();
}

#[tokio::test]
async fn view_shows_syncing_while_sync_runs() {
    let stub = spawn_stub(never_answers()).await;
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
async fn wait_until_idle_returns_after_running_sync_commits() {
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
    let waiting = {
        let control = Arc::clone(&control);
        tokio::spawn(async move { control.wait_until_idle().await })
    };

    gate.notify_one();

    tokio::time::timeout(Duration::from_secs(5), waiting)
        .await
        .expect("it returns once the sync has ended")
        .unwrap();
    let view = control.view();
    assert!(!view.syncing);
    let titles: Vec<_> = view.library.values().map(|b| b.title.as_str()).collect();
    assert_eq!(titles, ["Dune", "Dune Messiah"]);
    running.await.unwrap().unwrap();
}

#[tokio::test]
async fn wait_until_idle_returns_at_once_when_no_sync_runs() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));

    tokio::time::timeout(Duration::from_secs(5), control.wait_until_idle())
        .await
        .expect("an idle device has nothing to wait for");
}

#[tokio::test]
async fn sync_saves_state_file_after_sync() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let control = stub_control(&stub, path.clone());

    control.sync(DownloadPolicy::None).await.unwrap();

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

    let result = control.sync(DownloadPolicy::None).await;

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
    control.sync(DownloadPolicy::None).await.unwrap();

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
    control.sync(DownloadPolicy::None).await.unwrap();

    let view = control.reset().await.unwrap();

    assert_eq!(view.hardware_id, "HW-1");
    assert_eq!(
        control.sync(DownloadPolicy::None).await.unwrap(),
        LastSync::Synced { pages: 1 }
    );
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
    control.sync(DownloadPolicy::None).await.unwrap();

    control.reset().await.unwrap();

    let saved = state::load(&path).await.unwrap().unwrap();
    assert_eq!(saved.token, STUB_TOKEN);
    assert_eq!(saved.device, Device::new("HW-1"));
}

#[tokio::test]
async fn reset_returns_state_not_saved_when_state_file_cannot_be_written() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let parent = dir.path().join("parent");
    std::fs::write(&parent, "").unwrap();
    let control = stub_control(&stub, parent.join("kobo.json"));

    let result = control.reset().await;

    assert!(matches!(result, Err(ControlError::StateNotSaved(_))));
}

#[tokio::test]
async fn reset_returns_sync_in_progress_while_sync_runs() {
    let stub = spawn_stub(never_answers()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control_with(&stub, device_with_dune(), dir.path().join("kobo.json"));
    let running = spawn_sync(&control);
    wait_until(|| control.view().syncing).await;

    let result = control.reset().await;

    assert!(matches!(result, Err(ControlError::SyncInProgress)));
    assert_eq!(control.view().library, device_with_dune().library);
    running.abort();
}

#[tokio::test]
async fn download_keeps_the_books_file_beside_the_state_file() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let control = stub_control(&stub, path);
    control.sync(DownloadPolicy::None).await.unwrap();

    control.download(vec!["book-1".into()]).await.unwrap();

    let file = dir.path().join("kobo.books").join("book-1.kepub.epub");
    assert!(file.exists());
}

#[tokio::test]
async fn download_refetches_a_downloaded_book_whose_file_is_missing() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    control.sync(DownloadPolicy::None).await.unwrap();
    control.download(vec!["book-1".into()]).await.unwrap();
    let file = dir.path().join("kobo.books").join("book-1.kepub.epub");
    assert!(file.exists());
    // Removed out-of-band (or never written by a state file carried over
    // from before this book had a file) — the device's flag still says
    // downloaded.
    std::fs::remove_file(&file).unwrap();

    control.download(vec!["book-1".into()]).await.unwrap();

    assert!(file.exists(), "a missing file must be re-fetched");
}

#[tokio::test]
async fn reset_keeps_downloading_into_the_same_storage() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let control = stub_control(&stub, path);
    control.sync(DownloadPolicy::None).await.unwrap();
    control.download(vec!["book-1".into()]).await.unwrap();
    let file = dir.path().join("kobo.books").join("book-1.kepub.epub");
    assert!(file.exists());

    control.reset().await.unwrap();
    control.sync(DownloadPolicy::None).await.unwrap();
    control.download(vec!["book-1".into()]).await.unwrap();

    assert!(file.exists());
}

#[tokio::test]
async fn book_file_names_a_downloaded_books_file_beside_the_state_file() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let (control, _stub) =
        control_with_downloaded_book(crate::test_support::READER_KEPUB, path).await;

    let file = control.book_file("book-1").unwrap();

    assert_eq!(
        file,
        dir.path().join("kobo.books").join("book-1.kepub.epub")
    );
    assert!(file.exists());
}

#[tokio::test]
async fn book_file_returns_not_downloaded_for_a_held_book_not_yet_downloaded() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    control.sync(DownloadPolicy::None).await.unwrap();

    let error = control.book_file("book-1").unwrap_err();

    assert!(matches!(error, DeviceError::NotDownloaded(_)));
}

#[tokio::test]
async fn book_file_returns_unknown_book_for_a_book_it_lacks() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));

    let error = control.book_file("book-1").unwrap_err();

    assert!(matches!(error, DeviceError::UnknownBook(_)));
}

#[tokio::test]
async fn retarget_url_syncs_against_new_url() {
    let old = spawn_stub(Stub::default()).await;
    let new = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&old, dir.path().join("kobo.json"));

    let retargeted = control
        .retarget(Retarget::Url(new.origin.clone()))
        .await
        .unwrap();
    let last_sync = control.sync(DownloadPolicy::None).await.unwrap();

    assert_eq!(retargeted.view.url, new.origin);
    assert_eq!(control.view().url, new.origin);
    assert_eq!(last_sync, LastSync::Synced { pages: 1 });
    assert_eq!(control.view().library["book-1"].title, "Dune");
    assert!(old.paths().is_empty());
    let initialization = format!("/kobo/{STUB_TOKEN}/v1/initialization");
    assert_eq!(new.requests_to(&initialization).len(), 1);
}

#[tokio::test]
async fn retarget_url_pins_url_in_state_file() {
    let old = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let control = stub_control(&old, path.clone());

    control
        .retarget(Retarget::Url("http://new.example:3000".into()))
        .await
        .unwrap();

    let saved = state::load(&path).await.unwrap().unwrap();
    assert_eq!(saved.url, Some("http://new.example:3000".to_owned()));
}

#[tokio::test]
async fn retarget_url_keeps_library_sync_token_and_hardware_id() {
    let old = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let control = stub_control(&old, path.clone());
    control.sync(DownloadPolicy::None).await.unwrap();
    let before = control.view();
    let saved_before = state::load(&path).await.unwrap().unwrap();

    let retargeted = control
        .retarget(Retarget::Url("http://new.example:3000".into()))
        .await
        .unwrap();

    let after = control.view();
    assert_eq!(retargeted.view, after);
    assert_eq!(after.hardware_id, before.hardware_id);
    assert_eq!(after.library, before.library);
    assert_eq!(after.sync_token, before.sync_token);
    assert_eq!(after.last_sync, before.last_sync);
    let saved_after = state::load(&path).await.unwrap().unwrap();
    let only_the_url_moved = SavedState {
        url: Some("http://new.example:3000".to_owned()),
        device: Device {
            // The prior sync learned a `reading_services_host` for the old
            // server; a retarget must drop it too, so it is excluded here.
            reading_services_host: None,
            ..saved_before.device.clone()
        },
        ..saved_before
    };
    assert_eq!(saved_after, only_the_url_moved);
}

#[tokio::test]
async fn retarget_clears_reading_services_host_so_a_highlight_reaches_no_server() {
    let stub_a = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub_a, dir.path().join("kobo.json"));
    control.sync(DownloadPolicy::All).await.unwrap();
    assert!(control.view().library["book-1"].downloaded);
    let requests_after_sync = stub_a.paths().len();

    control
        .retarget(Retarget::Url("http://elsewhere.example:1".into()))
        .await
        .unwrap();
    let result = control
        .highlight(
            "book-1".into(),
            NewHighlight {
                text: "a passage".into(),
                color: Swatch::Blue,
                note: None,
                location: None,
            },
        )
        .await
        .unwrap();

    match result {
        Acted::Failed { message, .. } => assert!(message.contains("sync first"), "{message}"),
        other => panic!("expected Failed, got {other:?}"),
    }
    assert_eq!(stub_a.paths().len(), requests_after_sync);
}

#[tokio::test]
async fn retarget_token_clears_reading_services_host_so_a_highlight_reaches_no_server() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    control.sync(DownloadPolicy::All).await.unwrap();
    assert!(control.view().library["book-1"].downloaded);
    let requests_after_sync = stub.paths().len();

    control
        .retarget(Retarget::Token("typed-token".into()))
        .await
        .unwrap();
    let result = control
        .highlight(
            "book-1".into(),
            NewHighlight {
                text: "a passage".into(),
                color: Swatch::Blue,
                note: None,
                location: None,
            },
        )
        .await
        .unwrap();

    match result {
        Acted::Failed { message, .. } => assert!(message.contains("sync first"), "{message}"),
        other => panic!("expected Failed, got {other:?}"),
    }
    assert_eq!(stub.paths().len(), requests_after_sync);
}

#[tokio::test]
async fn retarget_url_keeps_user_token_without_needing_wire() {
    let dir = TempDir::new().unwrap();
    let control = control_wired_against("http://old.example:1", None, dir.path().join("kobo.json"));

    let retargeted = control
        .retarget(Retarget::Url("http://new.example:1".into()))
        .await
        .unwrap();

    assert!(!retargeted.needs_wire);
}

#[tokio::test]
async fn retarget_url_reports_needs_wire_when_token_was_wired_against_another_url() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let control = control_wired_against(
        "http://old.example:1",
        Some("http://old.example:1"),
        path.clone(),
    );

    let retargeted = control
        .retarget(Retarget::Url("http://new.example:1".into()))
        .await
        .unwrap();

    assert!(retargeted.needs_wire);
    let saved = state::load(&path).await.unwrap().unwrap();
    assert_eq!(saved.wired_url, Some("http://old.example:1".to_owned()));
}

#[tokio::test]
async fn retarget_url_reports_no_wire_needed_when_url_is_the_wired_url() {
    let dir = TempDir::new().unwrap();
    let control = control_wired_against(
        "http://other.example:1",
        Some("http://wired.example:1"),
        dir.path().join("kobo.json"),
    );

    let retargeted = control
        .retarget(Retarget::Url("http://wired.example:1".into()))
        .await
        .unwrap();

    assert!(!retargeted.needs_wire);
}

#[tokio::test]
async fn retarget_token_saves_token_and_clears_wired_url() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let control = control_wired_against(
        "http://old.example:1",
        Some("http://old.example:1"),
        path.clone(),
    );

    let retargeted = control
        .retarget(Retarget::Token("typed-token".into()))
        .await
        .unwrap();

    assert!(!retargeted.needs_wire);
    assert_eq!(retargeted.view.url, "http://old.example:1");
    let saved = state::load(&path).await.unwrap().unwrap();
    assert_eq!(saved.token, "typed-token");
    assert_eq!(saved.wired_url, None);
    assert_eq!(saved.url, None);
}

#[tokio::test]
async fn retarget_token_clears_cached_download_urls_and_sync_token() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let control = stub_control(&stub, path.clone());
    control.sync(DownloadPolicy::None).await.unwrap();
    let before = state::load(&path).await.unwrap().unwrap();
    assert!(!before.device.download_urls.is_empty());
    assert!(before.device.sync_token.is_some());

    control
        .retarget(Retarget::Token("typed-token".into()))
        .await
        .unwrap();

    let after = state::load(&path).await.unwrap().unwrap();
    assert!(after.device.download_urls.is_empty());
    assert_eq!(after.device.sync_token, None);
    assert_eq!(
        after.device.library, before.device.library,
        "retarget keeps the library"
    );
}

#[tokio::test]
async fn retarget_wired_saves_token_and_wired_url() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let control = control_wired_against("http://now.example:1", None, path.clone());

    let retargeted = control
        .retarget(Retarget::Wired {
            token: "minted-token".into(),
            url: "http://now.example:1".into(),
        })
        .await
        .unwrap();

    assert!(!retargeted.needs_wire);
    let saved = state::load(&path).await.unwrap().unwrap();
    assert_eq!(saved.token, "minted-token");
    assert_eq!(saved.wired_url, Some("http://now.example:1".to_owned()));
}

#[tokio::test]
async fn retarget_wired_reports_needs_wire_when_url_is_not_the_device_url() {
    let dir = TempDir::new().unwrap();
    let control = control_wired_against("http://now.example:1", None, dir.path().join("kobo.json"));

    let retargeted = control
        .retarget(Retarget::Wired {
            token: "minted-token".into(),
            url: "http://elsewhere.example:1".into(),
        })
        .await
        .unwrap();

    assert!(retargeted.needs_wire);
}

#[tokio::test]
async fn retarget_returns_sync_in_progress_while_sync_runs() {
    let stub = spawn_stub(never_answers()).await;
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let control = stub_control(&stub, path.clone());
    let running = spawn_sync(&control);
    wait_until(|| control.view().syncing).await;

    let result = control
        .retarget(Retarget::Url("http://new.example:3000".into()))
        .await;

    assert!(matches!(result, Err(ControlError::SyncInProgress)));
    assert_eq!(control.view().url, stub.origin);
    assert!(state::load(&path).await.unwrap().is_none());
    running.abort();
}

#[tokio::test]
async fn retarget_returns_state_not_saved_when_state_file_cannot_be_written() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let parent = dir.path().join("parent");
    std::fs::write(&parent, "").unwrap();
    let control = stub_control(&stub, parent.join("kobo.json"));

    let result = control
        .retarget(Retarget::Url("http://new.example:3000".into()))
        .await;

    assert!(matches!(result, Err(ControlError::StateNotSaved(_))));
    assert_eq!(control.view().url, "http://new.example:3000");
}
