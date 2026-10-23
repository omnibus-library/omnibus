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
    device_holding, dune_stub, never_answers, new_entitlement, request_lines, spawn_stub,
    spawn_sync, stub_control, stub_control_with, wait_until, Stub, STUB_TOKEN,
};

use super::*;

fn device_holding_book_1() -> Device {
    device_holding("book-1", "Dune")
}

/// A downloaded "book-1", wired to `stub` as its `reading_services_host` —
/// without it, a highlight action fails with "sync first".
fn device_holding_downloaded_book_1(stub: &crate::test_support::RunningStub) -> Device {
    let mut device = device_holding_book_1();
    device.library.get_mut("book-1").unwrap().downloaded = true;
    device.reading_services_host = Some(stub.origin.clone());
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
async fn download_never_leaks_a_cached_urls_token_after_a_retarget() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        download_status: StatusCode::NOT_FOUND,
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    control.sync(DownloadPolicy::None).await.unwrap();

    control
        .retarget(Retarget::Token("typed-token-b".into()))
        .await
        .unwrap();
    control.download(vec!["book-1".into()]).await.unwrap();

    let problem = control.view().library["book-1"].download_problem.clone();
    for leaked in [STUB_TOKEN, "typed-token-b"] {
        assert!(
            !request_lines(&control.requests())
                .iter()
                .any(|line| line.contains(leaked)),
            "requests() leaked {leaked}"
        );
        if let Some(problem) = &problem {
            assert!(
                !problem.contains(leaked),
                "download_problem leaked {leaked}: {problem}"
            );
        }
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
        device_holding_downloaded_book_1(&stub),
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
        device_holding_downloaded_book_1(&stub),
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
        device_holding_downloaded_book_1(&stub),
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
        device_holding_downloaded_book_1(&stub),
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

fn new_highlight() -> crate::annotations::NewHighlight {
    crate::annotations::NewHighlight {
        text: "a passage".into(),
        color: crate::annotations::Swatch::Blue,
        note: None,
        location: None,
    }
}

fn device_holding_downloaded_book_1_with_highlight(stub: &crate::test_support::RunningStub) -> Device {
    let mut device = device_holding_downloaded_book_1(stub);
    device
        .highlight("book-1", "h-1".into(), new_highlight())
        .unwrap();
    device
}

fn patch_count(stub: &crate::test_support::RunningStub, book: &str) -> usize {
    stub.requests_to(&format!("/api/v3/content/{book}/annotations"))
        .iter()
        .filter(|r| r.method == "PATCH")
        .count()
}

#[tokio::test]
async fn highlight_sends_the_highlight_and_keeps_it_on_the_device() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control_with(
        &stub,
        device_holding_downloaded_book_1(&stub),
        dir.path().join("kobo.json"),
    );

    let result = control
        .highlight("book-1".into(), new_highlight())
        .await
        .unwrap();

    match result {
        Acted::Done(view) => {
            let highlights = &view.library["book-1"].annotations;
            assert_eq!(highlights.len(), 1);
            assert_eq!(highlights[0].id.len(), 32);
            assert!(highlights[0].id.chars().all(|c| c.is_ascii_hexdigit()));
        }
        other => panic!("expected Done, got {other:?}"),
    }
    assert_eq!(patch_count(&stub, "book-1"), 1);
}

#[tokio::test]
async fn highlight_reports_the_failure_and_keeps_the_highlight_when_the_patch_answers_500() {
    let stub = spawn_stub(Stub {
        patch_status: StatusCode::INTERNAL_SERVER_ERROR,
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let control = stub_control_with(
        &stub,
        device_holding_downloaded_book_1(&stub),
        dir.path().join("kobo.json"),
    );

    let result = control
        .highlight("book-1".into(), new_highlight())
        .await
        .unwrap();

    match result {
        Acted::Failed { quirk: None, .. } => {}
        other => panic!("expected Failed, got {other:?}"),
    }
    assert_eq!(control.view().library["book-1"].annotations.len(), 1);
}

#[tokio::test]
async fn highlight_returns_not_downloaded_without_a_request() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control_with(&stub, device_holding_book_1(), dir.path().join("kobo.json"));

    let result = control.highlight("book-1".into(), new_highlight()).await;

    assert!(matches!(
        result,
        Err(ControlError::Device(DeviceError::NotDownloaded(_)))
    ));
    assert!(stub.paths().is_empty());
}

#[tokio::test]
async fn highlight_returns_unknown_book_without_a_request() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));

    let result = control.highlight("book-1".into(), new_highlight()).await;

    assert!(matches!(
        result,
        Err(ControlError::Device(DeviceError::UnknownBook(_)))
    ));
    assert!(stub.paths().is_empty());
}

#[tokio::test]
async fn highlight_returns_sync_in_progress_while_a_sync_runs() {
    let stub = spawn_stub(never_answers()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control_with(
        &stub,
        device_holding_downloaded_book_1(&stub),
        dir.path().join("kobo.json"),
    );
    let running = spawn_sync(&control);
    wait_until(|| control.view().syncing).await;

    let result = control.highlight("book-1".into(), new_highlight()).await;

    assert!(matches!(result, Err(ControlError::SyncInProgress)));
    running.abort();
}

#[tokio::test]
async fn highlight_returns_state_not_saved_when_state_file_cannot_be_written() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let parent = dir.path().join("parent");
    std::fs::write(&parent, "").unwrap();
    let control = stub_control_with(
        &stub,
        device_holding_downloaded_book_1(&stub),
        parent.join("kobo.json"),
    );

    let result = control.highlight("book-1".into(), new_highlight()).await;

    assert!(matches!(result, Err(ControlError::StateNotSaved(_))));
}

#[tokio::test]
async fn delete_highlight_sends_the_delete_and_drops_it_from_the_device() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control_with(
        &stub,
        device_holding_downloaded_book_1_with_highlight(&stub),
        dir.path().join("kobo.json"),
    );

    let result = control
        .delete_highlight("book-1".into(), "h-1".into())
        .await
        .unwrap();

    match result {
        Acted::Done(view) => assert!(view.library["book-1"].annotations.is_empty()),
        other => panic!("expected Done, got {other:?}"),
    }
    assert_eq!(patch_count(&stub, "book-1"), 1);
}

#[tokio::test]
async fn delete_highlight_returns_unknown_highlight_without_a_request() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control_with(
        &stub,
        device_holding_downloaded_book_1(&stub),
        dir.path().join("kobo.json"),
    );

    let result = control
        .delete_highlight("book-1".into(), "h-1".into())
        .await;

    assert!(matches!(
        result,
        Err(ControlError::Device(DeviceError::UnknownHighlight(_)))
    ));
    assert!(stub.paths().is_empty());
}

#[tokio::test]
async fn delete_highlight_returns_unknown_book_without_a_request() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));

    let result = control
        .delete_highlight("book-1".into(), "h-1".into())
        .await;

    assert!(matches!(
        result,
        Err(ControlError::Device(DeviceError::UnknownBook(_)))
    ));
    assert!(stub.paths().is_empty());
}

#[tokio::test]
async fn delete_highlight_returns_sync_in_progress_while_a_sync_runs() {
    let stub = spawn_stub(never_answers()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control_with(
        &stub,
        device_holding_downloaded_book_1_with_highlight(&stub),
        dir.path().join("kobo.json"),
    );
    let running = spawn_sync(&control);
    wait_until(|| control.view().syncing).await;

    let result = control
        .delete_highlight("book-1".into(), "h-1".into())
        .await;

    assert!(matches!(result, Err(ControlError::SyncInProgress)));
    running.abort();
}

#[tokio::test]
async fn delete_highlight_returns_state_not_saved_when_state_file_cannot_be_written() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let parent = dir.path().join("parent");
    std::fs::write(&parent, "").unwrap();
    let control = stub_control_with(
        &stub,
        device_holding_downloaded_book_1_with_highlight(&stub),
        parent.join("kobo.json"),
    );

    let result = control
        .delete_highlight("book-1".into(), "h-1".into())
        .await;

    assert!(matches!(result, Err(ControlError::StateNotSaved(_))));
}
