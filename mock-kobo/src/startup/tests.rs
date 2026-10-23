//! How `start` decides where a device points and which token it holds: the
//! precedence table (unit), then real state files and a stub Omnibus.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::json;
use tempfile::TempDir;

use crate::control::{ControlError, LastSync, Retarget};
use crate::device::Device;
use crate::downloads::DownloadPolicy;
use crate::state::{self, StateError};
use crate::test_support::{
    dune_stub, new_highlight, spawn_stub, stub_with_device, RunningStub, Stub, STUB_TOKEN,
};

use super::*;

fn serve_args(url: Option<&str>, token: Option<&str>) -> ServeArgs {
    ServeArgs {
        url: url.map(str::to_owned),
        token: token.map(str::to_owned),
        port: 0,
        state: "kobo.json".into(),
    }
}

/// `serve` arguments saving to `kobo.json` inside `dir`.
fn args_in(dir: &TempDir, url: Option<&str>, token: Option<&str>) -> ServeArgs {
    ServeArgs {
        state: dir.path().join("kobo.json"),
        ..serve_args(url, token)
    }
}

/// A runtime dir that never holds a dev server's port file.
fn no_runtime(dir: &TempDir) -> PathBuf {
    dir.path().join("runtime")
}

fn saved(url: Option<&str>, token: &str) -> SavedState {
    SavedState {
        url: url.map(str::to_owned),
        token: token.to_owned(),
        wired_url: None,
        device: Device::new("mock-ab"),
    }
}

/// Saved state holding a token auto-wired against `wired_url`.
fn auto_wired(token: &str, wired_url: &str) -> SavedState {
    SavedState {
        wired_url: Some(wired_url.to_owned()),
        ..saved(None, token)
    }
}

/// Publish `stub` as this worktree's dev server, as `just dev-up` does.
fn publish_dev_server(runtime: &Path, stub: &RunningStub) {
    std::fs::create_dir_all(runtime).unwrap();
    let port = stub.origin.rsplit(':').next().unwrap();
    std::fs::write(runtime.join("port"), format!("{port}\n")).unwrap();
}

fn dev_server() -> Option<String> {
    Some("http://dev:1".to_owned())
}

#[test]
fn resolve_target_prefers_given_url_over_saved_url() {
    let args = serve_args(Some("http://given:1"), None);

    let target = resolve_target(
        &args,
        Some(&saved(Some("http://saved:1"), "t")),
        dev_server(),
    );

    assert_eq!(target.url, "http://given:1");
}

#[test]
fn resolve_target_prefers_saved_url_over_dev_server() {
    let args = serve_args(None, None);

    let target = resolve_target(
        &args,
        Some(&saved(Some("http://saved:1"), "t")),
        dev_server(),
    );

    assert_eq!(target.url, "http://saved:1");
}

#[test]
fn resolve_target_prefers_dev_server_over_default() {
    let args = serve_args(None, None);

    let target = resolve_target(&args, Some(&saved(None, "t")), dev_server());

    assert_eq!(target.url, "http://dev:1");
}

#[test]
fn resolve_target_defaults_url_when_nothing_known() {
    let target = resolve_target(&serve_args(None, None), None, None);

    assert_eq!(target.url, "http://localhost:3000");
}

#[test]
fn resolve_target_pins_only_a_given_or_saved_url() {
    let given = resolve_target(
        &serve_args(Some("http://given:1"), None),
        None,
        dev_server(),
    );
    let from_saved = resolve_target(
        &serve_args(None, None),
        Some(&saved(Some("http://saved:1"), "t")),
        dev_server(),
    );
    let discovered = resolve_target(
        &serve_args(None, None),
        Some(&saved(None, "t")),
        dev_server(),
    );
    let default = resolve_target(&serve_args(None, None), None, None);

    assert_eq!(given.pinned_url, Some("http://given:1".to_owned()));
    assert_eq!(from_saved.pinned_url, Some("http://saved:1".to_owned()));
    assert_eq!(discovered.pinned_url, None);
    assert_eq!(default.pinned_url, None);
}

#[test]
fn resolve_target_prefers_given_token_over_saved_token() {
    let args = serve_args(None, Some("given-token"));

    let target = resolve_target(&args, Some(&saved(None, "saved-token")), None);

    assert_eq!(target.token, Some("given-token".to_owned()));
}

#[test]
fn resolve_target_uses_saved_token_when_none_given() {
    let target = resolve_target(
        &serve_args(None, None),
        Some(&saved(None, "saved-token")),
        None,
    );

    assert_eq!(target.token, Some("saved-token".to_owned()));
}

#[test]
fn resolve_target_drops_auto_wired_token_when_url_changed() {
    let saved = auto_wired("old-server-token", "http://old:1");

    let target = resolve_target(&serve_args(None, None), Some(&saved), dev_server());

    assert_eq!(target.url, "http://dev:1");
    assert_eq!(target.token, None);
}

#[test]
fn resolve_target_keeps_auto_wired_token_when_url_unchanged() {
    let saved = auto_wired("wired-token", "http://dev:1");

    let target = resolve_target(&serve_args(None, None), Some(&saved), dev_server());

    assert_eq!(target.token, Some("wired-token".to_owned()));
    assert_eq!(target.wired_url, Some("http://dev:1".to_owned()));
}

#[test]
fn resolve_target_keeps_given_token_when_url_changed() {
    let saved = auto_wired("old-server-token", "http://old:1");

    let target = resolve_target(
        &serve_args(None, Some("given-token")),
        Some(&saved),
        dev_server(),
    );

    assert_eq!(target.token, Some("given-token".to_owned()));
    assert_eq!(target.wired_url, None);
}

#[test]
fn resolve_target_keeps_saved_token_the_user_gave_when_url_changed() {
    let saved = saved(None, "user-token");

    let target = resolve_target(&serve_args(None, None), Some(&saved), dev_server());

    assert_eq!(target.token, Some("user-token".to_owned()));
}

#[test]
fn resolve_target_leaves_token_unset_when_none_known() {
    let target = resolve_target(&serve_args(None, None), None, None);

    assert_eq!(target.token, None);
}

#[tokio::test]
async fn start_creates_state_file_with_minted_hardware_id() {
    let dir = TempDir::new().unwrap();
    let args = args_in(&dir, Some("http://127.0.0.1:1"), Some("tok-1"));

    start(&args, None, &no_runtime(&dir)).await.unwrap();

    let saved = state::load(&args.state).await.unwrap().unwrap();
    assert_eq!(saved.token, "tok-1");
    let digits = saved.device.hardware_id.strip_prefix("mock-").unwrap();
    assert_eq!(digits.len(), 32);
}

#[tokio::test]
async fn start_restores_synced_library_after_restart() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let args = args_in(&dir, Some(&stub.origin), Some(STUB_TOKEN));
    let first = Arc::new(start(&args, None, &no_runtime(&dir)).await.unwrap().control);
    first.sync(DownloadPolicy::None).await.unwrap();
    let before = first.view();
    drop(first);

    let second = start(&args, None, &no_runtime(&dir)).await.unwrap().control;

    let after = second.view();
    assert_eq!(after.hardware_id, before.hardware_id);
    assert_eq!(after.library["book-1"].title, "Dune");
    assert_eq!(after.sync_token, Some("page-1".to_owned()));
}

#[tokio::test]
async fn start_persists_given_url_and_token_across_restarts() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let given = args_in(&dir, Some(&stub.origin), Some(STUB_TOKEN));
    drop(start(&given, None, &no_runtime(&dir)).await.unwrap());

    let second = Arc::new(
        start(&args_in(&dir, None, None), None, &no_runtime(&dir))
            .await
            .unwrap()
            .control,
    );

    assert_eq!(second.view().url, stub.origin);
    assert_eq!(
        second.sync(DownloadPolicy::None).await.unwrap(),
        LastSync::Synced { pages: 1 }
    );
}

#[tokio::test]
async fn start_restores_url_set_by_retarget_after_restart() {
    let first = spawn_stub(Stub::default()).await;
    let second = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let given = args_in(&dir, Some(&first.origin), Some(STUB_TOKEN));
    let running = Arc::new(
        start(&given, None, &no_runtime(&dir))
            .await
            .unwrap()
            .control,
    );
    running
        .retarget(Retarget::Url(second.origin.clone()))
        .await
        .unwrap();
    drop(running);

    let restarted = Arc::new(
        start(&args_in(&dir, None, None), None, &no_runtime(&dir))
            .await
            .unwrap()
            .control,
    );

    assert_eq!(restarted.view().url, second.origin);
    assert_eq!(
        restarted.sync(DownloadPolicy::None).await.unwrap(),
        LastSync::Synced { pages: 1 }
    );
    assert!(first.paths().is_empty());
    assert!(!second.paths().is_empty());
}

#[tokio::test]
async fn start_restores_token_set_by_retarget_after_restart() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let given = args_in(&dir, Some(&stub.origin), Some("wrong"));
    let running = Arc::new(
        start(&given, None, &no_runtime(&dir))
            .await
            .unwrap()
            .control,
    );
    running
        .retarget(Retarget::Token(STUB_TOKEN.to_owned()))
        .await
        .unwrap();
    drop(running);

    let restarted = Arc::new(
        start(&args_in(&dir, None, None), None, &no_runtime(&dir))
            .await
            .unwrap()
            .control,
    );

    assert_eq!(
        restarted.sync(DownloadPolicy::None).await.unwrap(),
        LastSync::Synced { pages: 1 }
    );
}

#[tokio::test]
async fn start_follows_dev_server_port_without_saving_it() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let runtime = no_runtime(&dir);
    publish_dev_server(&runtime, &stub);
    let args = args_in(&dir, None, Some(STUB_TOKEN));

    let control = start(&args, None, &runtime).await.unwrap().control;

    assert_eq!(control.view().url, stub.origin);
    let saved = state::load(&args.state).await.unwrap().unwrap();
    assert_eq!(saved.url, None);
}

#[tokio::test]
async fn start_fails_when_state_file_is_unreadable() {
    let dir = TempDir::new().unwrap();
    let args = args_in(&dir, None, Some("tok-1"));
    std::fs::write(&args.state, "not json").unwrap();

    let result = start(&args, None, &no_runtime(&dir)).await;

    assert!(matches!(
        result,
        Err(StartError::State(StateError::Corrupt { .. }))
    ));
    assert_eq!(std::fs::read_to_string(&args.state).unwrap(), "not json");
}

#[tokio::test]
async fn start_auto_wires_seed_admin_device_when_no_token_known() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let args = args_in(&dir, Some(&stub.origin), None);

    let control = Arc::new(
        start(&args, Some("admin:omnibus-dev"), &no_runtime(&dir))
            .await
            .unwrap()
            .control,
    );

    let created = stub.requests_to("/api/rpc/kobo/devices/create");
    assert_eq!(created.len(), 1);
    let body: serde_json::Value = serde_json::from_str(&created[0].body).unwrap();
    assert_eq!(body, json!({ "name": "Mock Kobo (kobo)" }));
    let saved = state::load(&args.state).await.unwrap().unwrap();
    assert_eq!(saved.token, STUB_TOKEN);
    assert_eq!(
        control.sync(DownloadPolicy::None).await.unwrap(),
        LastSync::Synced { pages: 1 }
    );
}

#[tokio::test]
async fn start_records_wired_url_with_auto_wired_token() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let args = args_in(&dir, Some(&stub.origin), None);

    start(&args, Some("admin:omnibus-dev"), &no_runtime(&dir))
        .await
        .unwrap();

    let saved = state::load(&args.state).await.unwrap().unwrap();
    assert_eq!(saved.wired_url, Some(stub.origin.clone()));
}

#[tokio::test]
async fn start_clears_wired_url_when_token_is_given() {
    let dir = TempDir::new().unwrap();
    let args = args_in(&dir, Some("http://127.0.0.1:1"), Some("given-token"));
    let earlier = auto_wired("old-server-token", "http://old:1");
    state::save(&args.state, &earlier).await.unwrap();

    start(&args, None, &no_runtime(&dir)).await.unwrap();

    let saved = state::load(&args.state).await.unwrap().unwrap();
    assert_eq!(saved.token, "given-token");
    assert_eq!(saved.wired_url, None);
}

#[tokio::test]
async fn start_rewires_when_dev_server_moves_to_another_server() {
    let server_a = spawn_stub(stub_with_device("tok-a")).await;
    let server_b = spawn_stub(stub_with_device("tok-b")).await;
    let dir = TempDir::new().unwrap();
    let runtime = no_runtime(&dir);
    let args = args_in(&dir, None, None);
    publish_dev_server(&runtime, &server_a);
    start(&args, Some("admin:omnibus-dev"), &runtime)
        .await
        .unwrap();
    publish_dev_server(&runtime, &server_b);

    start(&args, Some("admin:omnibus-dev"), &runtime)
        .await
        .unwrap();

    assert_eq!(server_b.requests_to("/api/auth/login").len(), 1);
    let saved = state::load(&args.state).await.unwrap().unwrap();
    assert_eq!(saved.token, "tok-b");
    assert_eq!(saved.wired_url, Some(server_b.origin.clone()));
}

#[tokio::test]
async fn start_reuses_auto_wired_token_when_dev_server_is_unchanged() {
    let server = spawn_stub(stub_with_device("tok-a")).await;
    let dir = TempDir::new().unwrap();
    let runtime = no_runtime(&dir);
    let args = args_in(&dir, None, None);
    publish_dev_server(&runtime, &server);
    start(&args, Some("admin:omnibus-dev"), &runtime)
        .await
        .unwrap();

    start(&args, Some("admin:omnibus-dev"), &runtime)
        .await
        .unwrap();

    assert_eq!(server.requests_to("/api/auth/login").len(), 1);
    let saved = state::load(&args.state).await.unwrap().unwrap();
    assert_eq!(saved.token, "tok-a");
}

#[tokio::test]
async fn start_notes_when_new_device_reuses_server_device() {
    let stub = spawn_stub(Stub {
        devices: vec![("Mock Kobo (kobo)".to_owned(), "tok-a".to_owned())],
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let args = args_in(&dir, Some(&stub.origin), None);

    let started = start(&args, Some("admin:omnibus-dev"), &no_runtime(&dir))
        .await
        .unwrap();

    assert_eq!(
        started.notice.as_deref(),
        Some("wired a new local device to the existing Omnibus device \"Mock Kobo (kobo)\"")
    );
}

#[tokio::test]
async fn start_does_not_warn_when_auto_wire_creates_device() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let args = args_in(&dir, Some(&stub.origin), None);

    let started = start(&args, Some("admin:omnibus-dev"), &no_runtime(&dir))
        .await
        .unwrap();

    assert_eq!(started.notice, None);
}

#[tokio::test]
async fn start_does_not_warn_when_existing_device_is_rewired() {
    let server_a = spawn_stub(stub_with_device("tok-a")).await;
    let server_b = spawn_stub(stub_with_device("tok-b")).await;
    let dir = TempDir::new().unwrap();
    let runtime = no_runtime(&dir);
    let args = args_in(&dir, None, None);
    publish_dev_server(&runtime, &server_a);
    start(&args, Some("admin:omnibus-dev"), &runtime)
        .await
        .unwrap();
    publish_dev_server(&runtime, &server_b);

    let started = start(&args, Some("admin:omnibus-dev"), &runtime)
        .await
        .unwrap();

    assert_eq!(started.notice, None);
}

#[tokio::test]
async fn start_refuses_to_auto_wire_against_non_local_server() {
    let dir = TempDir::new().unwrap();
    let args = args_in(&dir, Some("http://192.0.2.1:9"), None);

    let result = start(&args, Some("admin:omnibus-dev"), &no_runtime(&dir)).await;

    let Err(StartError::AutoWire(AutoWireError::NotLocal { url })) = result else {
        panic!("expected a refusal to auto-wire, got {:?}", result.err());
    };
    assert_eq!(url, "http://192.0.2.1:9");
    assert!(!args.state.exists());
}

#[tokio::test]
async fn start_fails_without_token_or_seed_user() {
    let dir = TempDir::new().unwrap();
    let args = args_in(&dir, Some("http://127.0.0.1:1"), None);

    let result = start(&args, None, &no_runtime(&dir)).await;

    assert!(matches!(
        result,
        Err(StartError::AutoWire(AutoWireError::NoSeedUser))
    ));
    assert!(!args.state.exists());
}

#[tokio::test]
async fn start_forgets_the_old_servers_reading_services_host_when_resolving_a_different_server() {
    let stub_a = spawn_stub(dune_stub()).await;
    let stub_b = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let given_a = args_in(&dir, Some(&stub_a.origin), Some(STUB_TOKEN));
    let first = Arc::new(
        start(&given_a, None, &no_runtime(&dir))
            .await
            .unwrap()
            .control,
    );
    first.sync(DownloadPolicy::All).await.unwrap();
    assert!(first.view().library["book-1"].downloaded);
    drop(first);

    // A later start resolving to a different server, e.g. this worktree's
    // dev server port-walked to a new one — same token, different origin.
    let given_b = args_in(&dir, Some(&stub_b.origin), Some(STUB_TOKEN));
    let restarted = Arc::new(
        start(&given_b, None, &no_runtime(&dir))
            .await
            .unwrap()
            .control,
    );
    let requests_before = stub_a.paths().len();

    let result = restarted
        .highlight("book-1".into(), new_highlight(None, None))
        .await;

    assert!(matches!(result, Err(ControlError::NotSynced)), "{result:?}");
    assert!(restarted.view().library["book-1"].annotations.is_empty());
    assert_eq!(stub_a.paths().len(), requests_before);
}

#[tokio::test]
async fn start_drops_sync_token_and_download_urls_when_the_resolved_token_changed() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let given = args_in(&dir, Some(&stub.origin), Some(STUB_TOKEN));
    let first = Arc::new(
        start(&given, None, &no_runtime(&dir))
            .await
            .unwrap()
            .control,
    );
    first.sync(DownloadPolicy::None).await.unwrap();
    assert!(!first.view().library.is_empty());
    drop(first);
    let given_other_token = args_in(&dir, Some(&stub.origin), Some("other-token"));

    start(&given_other_token, None, &no_runtime(&dir))
        .await
        .unwrap();

    let saved = state::load(&given_other_token.state)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(saved.device.sync_token, None);
    assert!(saved.device.download_urls.is_empty());
}
