//! `perform` for each job against a stub Omnibus and a real temp state file.

use std::sync::Arc;
use std::time::Duration;

use axum::http::StatusCode;
use tempfile::TempDir;

use crate::control::{Control, ControlError, LastSync, RESET_MESSAGE};
use crate::downloads::DownloadPolicy;
use crate::firmware::Quirk;
use crate::reading::{Percent, ReadStatus};
use crate::state::{self, StateError};
use crate::test_support::{
    control_wired_against, dune_stub, never_answers, new_entitlement, spawn_stub, spawn_sync,
    stub_control, stub_with_device, wait_until, Stub, STUB_TOKEN,
};
use crate::tui::app::{Job, Status};

use super::*;

const SEED_USER: &str = "admin:omnibus-dev";
const NOT_LOCAL: &str = "http://192.0.2.1:9";

/// A wiring for the state file `kobo.json`, as `autowire::device_name` would name it.
fn wiring() -> Wiring {
    Wiring {
        seed_user: Some(SEED_USER.to_owned()),
        device_name: "Mock Kobo (kobo)".to_owned(),
    }
}

async fn saved(path: &std::path::Path) -> state::SavedState {
    state::load(path).await.unwrap().unwrap()
}

#[tokio::test]
async fn perform_sync_reports_sync_complete_against_healthy_stub() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));

    let status = perform(&control, &wiring(), Job::Sync).await;

    assert_eq!(status, Status::Info("sync complete".to_owned()));
    assert_eq!(control.view().library["book-1"].title, "Dune");
}

#[tokio::test]
async fn perform_sync_reports_failed_sync_message_when_store_path_returns_404() {
    let stub = spawn_stub(Stub {
        store_path_status: StatusCode::NOT_FOUND,
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));

    let status = perform(&control, &wiring(), Job::Sync).await;

    let message = "sync failed (StorePaths): /kobo/<token>/v1/user/profile answered 404 Not Found";
    assert_eq!(status, Status::Error(message.to_owned()));
    let Some(LastSync::Failed { quirk, .. }) = control.view().last_sync else {
        panic!("expected a failed last sync");
    };
    assert_eq!(quirk, Some(Quirk::StorePaths));
}

#[tokio::test]
async fn perform_sync_reports_sync_in_progress_while_another_sync_runs() {
    let stub = spawn_stub(never_answers()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    let running = spawn_sync(&control);
    wait_until(|| control.view().syncing).await;

    let status = perform(&control, &wiring(), Job::Sync).await;

    assert_eq!(
        status,
        Status::Error("a sync is already running".to_owned())
    );
    running.abort();
}

#[tokio::test]
async fn perform_reset_reports_reset_message_and_empties_library() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    control.sync(DownloadPolicy::None).await.unwrap();

    let status = perform(&control, &wiring(), Job::Reset).await;

    assert_eq!(status, Status::Info(RESET_MESSAGE.to_owned()));
    assert!(control.view().library.is_empty());
}

#[tokio::test]
async fn perform_set_token_saves_token_without_wired_url() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let control = control_wired_against(
        "http://old.example:1",
        Some("http://old.example:1"),
        path.clone(),
    );

    let status = perform(&control, &wiring(), Job::SetToken("typed-token".into())).await;

    assert_eq!(status, Status::Info("token saved".to_owned()));
    let saved = saved(&path).await;
    assert_eq!(saved.token, "typed-token");
    assert_eq!(saved.wired_url, None);
}

#[tokio::test]
async fn perform_set_url_syncs_against_new_url() {
    let old = spawn_stub(Stub::default()).await;
    let new = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&old, dir.path().join("kobo.json"));

    let status = perform(&control, &wiring(), Job::SetUrl(new.origin.clone())).await;
    let synced = perform(&control, &wiring(), Job::Sync).await;

    let expected = format!("now syncing against {}", new.origin);
    assert_eq!(status, Status::Info(expected));
    assert_eq!(synced, Status::Info("sync complete".to_owned()));
    assert_eq!(control.view().library["book-1"].title, "Dune");
    assert!(old.paths().is_empty());
    assert!(new.requests_to("/api/auth/login").is_empty());
}

#[tokio::test]
async fn perform_set_url_rewires_token_wired_against_another_url() {
    let old = spawn_stub(Stub::default()).await;
    let new = spawn_stub(stub_with_device("new-server-token")).await;
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let control = control_wired_against(&old.origin, Some(&old.origin), path.clone());

    let status = perform(&control, &wiring(), Job::SetUrl(new.origin.clone())).await;

    let Status::Info(message) = status else {
        panic!("expected an info status, got {status:?}");
    };
    assert!(
        message.starts_with(&format!("now syncing against {}; wired to", new.origin)),
        "{message}"
    );
    let saved = saved(&path).await;
    assert_eq!(saved.token, "new-server-token");
    assert_eq!(saved.wired_url, Some(new.origin.clone()));
    assert_eq!(saved.url, Some(new.origin.clone()));
    assert_eq!(new.requests_to("/api/auth/login").len(), 1);
    assert!(old.paths().is_empty());
}

#[tokio::test]
async fn perform_set_url_reports_rewire_failure_for_non_local_url() {
    let old = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let control = control_wired_against(&old.origin, Some(&old.origin), path.clone());

    let status = perform(&control, &wiring(), Job::SetUrl(NOT_LOCAL.to_owned())).await;

    let expected = format!(
        "now syncing against {NOT_LOCAL}, but its token was wired for another server: \
         auto-wire only logs in to a local dev server, not {NOT_LOCAL}: \
         press t to enter a token"
    );
    assert_eq!(status, Status::Error(expected));
    assert_eq!(control.view().url, NOT_LOCAL);
    let saved = saved(&path).await;
    assert_eq!(saved.url, Some(NOT_LOCAL.to_owned()));
    assert_eq!(saved.token, STUB_TOKEN);
}

#[tokio::test]
async fn perform_set_url_reports_sync_in_progress_while_sync_runs() {
    let stub = spawn_stub(never_answers()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    let running = spawn_sync(&control);
    wait_until(|| control.view().syncing).await;

    let status = perform(
        &control,
        &wiring(),
        Job::SetUrl("http://127.0.0.1:1".into()),
    )
    .await;

    assert_eq!(
        status,
        Status::Error("a sync is already running".to_owned())
    );
    assert_eq!(control.view().url, stub.origin);
    running.abort();
}

#[tokio::test]
async fn perform_set_url_refuses_rewire_while_sync_runs_without_contacting_server() {
    let old = spawn_stub(never_answers()).await;
    let new = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let control = control_wired_against(&old.origin, Some(&old.origin), dir.path().join("k.json"));
    let running = spawn_sync(&control);
    wait_until(|| control.view().syncing).await;

    let status = perform(&control, &wiring(), Job::SetUrl(new.origin.clone())).await;

    assert_eq!(
        status,
        Status::Error("a sync is already running".to_owned())
    );
    assert!(new.paths().is_empty());
    running.abort();
}

#[tokio::test]
async fn perform_wire_refuses_while_sync_runs_without_contacting_server() {
    let stub = spawn_stub(never_answers()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    let running = spawn_sync(&control);
    wait_until(|| control.view().syncing).await;

    let status = perform(&control, &wiring(), Job::Wire).await;

    assert_eq!(
        status,
        Status::Error("a sync is already running".to_owned())
    );
    assert!(stub.requests_to("/api/auth/login").is_empty());
    running.abort();
}

#[test]
fn wired_status_reports_sync_that_started_before_token_was_saved() {
    let status = wired_status(Err(ControlError::SyncInProgress), "Mock Kobo (kobo)", false);

    let expected = "wired \"Mock Kobo (kobo)\", but a sync started before its token could be \
                    saved; press w again when it finishes";
    assert_eq!(status, Status::Error(expected.to_owned()));
}

#[test]
fn wired_status_reports_state_not_saved_error() {
    let not_saved = StateError::Write {
        path: "kobo.json".into(),
        source: std::io::Error::other("disk full"),
    };

    let status = wired_status(Err(not_saved.into()), "Mock Kobo (kobo)", false);

    assert_eq!(
        status,
        Status::Error("device state not saved: cannot write kobo.json: disk full".to_owned())
    );
}

#[tokio::test]
async fn perform_wire_retargets_to_existing_device_and_reports_reuse() {
    let stub = spawn_stub(stub_with_device("existing-token")).await;
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let control = stub_control(&stub, path.clone());

    let status = perform(&control, &wiring(), Job::Wire).await;

    let expected = "wired to the existing Omnibus device \"Mock Kobo (kobo)\"; press r before \
                    the next sync for a full resend";
    assert_eq!(status, Status::Info(expected.to_owned()));
    let saved = saved(&path).await;
    assert_eq!(saved.token, "existing-token");
    assert_eq!(saved.wired_url, Some(stub.origin.clone()));
}

#[tokio::test]
async fn perform_wire_retargets_to_new_device_when_none_matches() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let control = stub_control(&stub, path.clone());

    let status = perform(&control, &wiring(), Job::Wire).await;

    let expected = "wired to the new Omnibus device \"Mock Kobo (kobo)\"";
    assert_eq!(status, Status::Info(expected.to_owned()));
    let saved = saved(&path).await;
    assert_eq!(saved.token, STUB_TOKEN);
    assert_eq!(saved.wired_url, Some(stub.origin.clone()));
    assert_eq!(stub.requests_to("/api/rpc/kobo/devices/create").len(), 1);
}

#[tokio::test]
async fn perform_wire_reports_not_local_without_contacting_server() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let control = control_wired_against(NOT_LOCAL, None, path.clone());
    control.reset().await.unwrap();
    let before = saved(&path).await;

    let status = tokio::time::timeout(
        Duration::from_secs(5),
        perform(&control, &wiring(), Job::Wire),
    )
    .await
    .expect("a non-local URL is refused before any request");

    let expected = format!(
        "auto-wire only logs in to a local dev server, not {NOT_LOCAL}: \
         press t to enter a token"
    );
    assert_eq!(status, Status::Error(expected));
    assert_eq!(saved(&path).await, before);
}

#[tokio::test]
async fn perform_wire_reports_no_seed_user_when_unset() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let control: Arc<Control> = stub_control(&stub, path.clone());
    let unset = Wiring {
        seed_user: None,
        ..wiring()
    };

    let status = perform(&control, &unset, Job::Wire).await;

    let expected = "can't auto-wire: OMNIBUS_DEV_SEED_USER is not set; press t to enter a token";
    assert_eq!(status, Status::Error(expected.to_owned()));
    assert!(stub.paths().is_empty());
}

#[tokio::test]
async fn perform_download_reports_downloaded_against_a_healthy_stub() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    control.sync(DownloadPolicy::None).await.unwrap();

    let status = perform(&control, &wiring(), Job::Download("book-1".into())).await;

    assert_eq!(status, Status::Info("downloaded".to_owned()));
    assert!(control.view().library["book-1"].downloaded);
}

#[tokio::test]
async fn perform_download_reports_the_problem_when_the_download_fails() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![serde_json::json!([new_entitlement("book-1", "Dune")])],
        download_status: StatusCode::NOT_FOUND,
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    control.sync(DownloadPolicy::None).await.unwrap();

    let status = perform(&control, &wiring(), Job::Download("book-1".into())).await;

    let Status::Error(message) = status else {
        panic!("expected an error status");
    };
    assert!(message.contains("book-1"));
}

#[tokio::test]
async fn perform_read_reports_state_sent() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    control.sync(DownloadPolicy::All).await.unwrap();

    let status = perform(
        &control,
        &wiring(),
        Job::Read {
            book: "book-1".into(),
            percent: Percent::new(42).unwrap(),
        },
    )
    .await;

    assert_eq!(status, Status::Info("state sent".to_owned()));
    assert_eq!(
        control.view().library["book-1"].reading.status,
        ReadStatus::Reading
    );
}

#[tokio::test]
async fn perform_finish_reports_state_sent() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    control.sync(DownloadPolicy::None).await.unwrap();

    let status = perform(&control, &wiring(), Job::Finish("book-1".into())).await;

    assert_eq!(status, Status::Info("state sent".to_owned()));
    assert_eq!(
        control.view().library["book-1"].reading.status,
        ReadStatus::Finished
    );
}

#[tokio::test]
async fn perform_remove_download_reports_removed() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    control.sync(DownloadPolicy::All).await.unwrap();

    let status = perform(&control, &wiring(), Job::RemoveDownload("book-1".into())).await;

    assert_eq!(status, Status::Info("removed".to_owned()));
    assert!(!control.view().library["book-1"].downloaded);
}

fn a_highlight() -> crate::annotations::NewHighlight {
    crate::annotations::NewHighlight {
        text: "a passage".into(),
        color: crate::annotations::Swatch::Blue,
        note: None,
        location: None,
    }
}

#[tokio::test]
async fn perform_highlight_reports_annotation_sent() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    control.sync(DownloadPolicy::All).await.unwrap();

    let status = perform(
        &control,
        &wiring(),
        Job::Highlight {
            book: "book-1".into(),
            highlight: a_highlight(),
        },
    )
    .await;

    assert_eq!(status, Status::Info("annotation sent".to_owned()));
    assert_eq!(control.view().library["book-1"].annotations.len(), 1);
}

#[tokio::test]
async fn perform_delete_highlight_deletes_the_newest_highlight() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    control.sync(DownloadPolicy::All).await.unwrap();
    perform(
        &control,
        &wiring(),
        Job::Highlight {
            book: "book-1".into(),
            highlight: a_highlight(),
        },
    )
    .await;

    let status = perform(&control, &wiring(), Job::DeleteHighlight("book-1".into())).await;

    assert_eq!(status, Status::Info("annotation sent".to_owned()));
    assert!(control.view().library["book-1"].annotations.is_empty());
}

#[tokio::test]
async fn perform_delete_highlight_reports_no_highlights_on_a_book_without_any() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    control.sync(DownloadPolicy::None).await.unwrap();

    let status = perform(&control, &wiring(), Job::DeleteHighlight("book-1".into())).await;

    assert_eq!(
        status,
        Status::Error("no highlights on this book".to_owned())
    );
}
