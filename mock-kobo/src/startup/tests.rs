//! How `start` decides where a device points and which token it holds: the
//! precedence table (unit), then real state files and a stub Omnibus.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;
use tempfile::TempDir;

use crate::control::LastSync;
use crate::device::Device;
use crate::state::{self, StateError};
use crate::test_support::{new_entitlement, spawn_stub, Stub, STUB_TOKEN};

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

fn dune_stub() -> Stub {
    Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        ..Stub::default()
    }
}

fn saved(url: Option<&str>, token: &str) -> SavedState {
    SavedState {
        url: url.map(str::to_owned),
        token: token.to_owned(),
        device: Device::new("mock-ab"),
    }
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

    assert_eq!(target.url, "http://127.0.0.1:3000");
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
    let first = Arc::new(start(&args, None, &no_runtime(&dir)).await.unwrap());
    first.sync().await.unwrap();
    let before = first.view();
    drop(first);

    let second = start(&args, None, &no_runtime(&dir)).await.unwrap();

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
            .unwrap(),
    );

    assert_eq!(second.view().url, stub.origin);
    assert_eq!(second.sync().await.unwrap(), LastSync::Synced { pages: 1 });
}

#[tokio::test]
async fn start_follows_dev_server_port_without_saving_it() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let runtime = dir.path().join("runtime");
    std::fs::create_dir(&runtime).unwrap();
    let port = stub.origin.rsplit(':').next().unwrap();
    std::fs::write(runtime.join("port"), format!("{port}\n")).unwrap();
    let args = args_in(&dir, None, Some(STUB_TOKEN));

    let control = start(&args, None, &runtime).await.unwrap();

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
            .unwrap(),
    );

    let created = stub.requests_to("/api/rpc/kobo/devices/create");
    assert_eq!(created.len(), 1);
    let body: serde_json::Value = serde_json::from_str(&created[0].body).unwrap();
    assert_eq!(body, json!({ "name": "Mock Kobo (kobo)" }));
    let saved = state::load(&args.state).await.unwrap().unwrap();
    assert_eq!(saved.token, STUB_TOKEN);
    assert_eq!(control.sync().await.unwrap(), LastSync::Synced { pages: 1 });
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
