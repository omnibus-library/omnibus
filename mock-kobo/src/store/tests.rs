//! `DeviceStore` against a real temp dir: what a restart brings back, and what a reset keeps.

use std::fs;

use tempfile::TempDir;

use crate::test_support::new_entitlement;

use super::*;

fn fresh_id() -> String {
    "HW-NEW".to_owned()
}

fn no_new_id() -> String {
    panic!("a saved device keeps its hardware id")
}

fn state_path(dir: &TempDir) -> PathBuf {
    dir.path().join("mock-kobo.json")
}

/// A store in `dir` holding server settings, a sync token and one book, saved.
fn saved_store(dir: &TempDir) -> DeviceStore {
    let mut store = DeviceStore::open(state_path(dir), fresh_id).unwrap();
    let state = store.state_mut();
    state.url = Some("http://omnibus.test".into());
    state.token = Some("device-token".into());
    state.device.sync_token = Some("page-1".into());
    let item = serde_json::from_value(new_entitlement("book-1", "Dune")).unwrap();
    state.device.apply(item);
    store.save().unwrap();
    store
}

#[test]
fn device_store_restores_library_after_restart() {
    let dir = tempfile::tempdir().unwrap();
    let saved = saved_store(&dir).state().clone();

    let reopened = DeviceStore::open(state_path(&dir), no_new_id).unwrap();

    assert_eq!(reopened.state().device.library["book-1"].title, "Dune");
    assert_eq!(reopened.state(), &saved);
}

#[test]
fn device_store_creates_device_with_fresh_hardware_id_when_no_file() {
    let dir = tempfile::tempdir().unwrap();

    let store = DeviceStore::open(state_path(&dir), fresh_id).unwrap();

    let expected = SavedState {
        url: None,
        token: None,
        device: Device::new("HW-NEW"),
    };
    assert_eq!(store.state(), &expected);
}

#[test]
fn device_store_reset_wipes_saved_state() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = saved_store(&dir);

    store.reset().unwrap();

    let reopened = DeviceStore::open(state_path(&dir), no_new_id).unwrap();
    let expected = SavedState {
        url: Some("http://omnibus.test".into()),
        token: Some("device-token".into()),
        device: Device::new("HW-NEW"),
    };
    assert_eq!(reopened.state(), &expected);
}

#[test]
fn device_store_open_fails_when_state_file_is_corrupt() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(state_path(&dir), "not a device").unwrap();

    let failure = DeviceStore::open(state_path(&dir), fresh_id).unwrap_err();

    assert!(matches!(failure, StoreError::Corrupt { .. }), "{failure}");
}

#[test]
fn device_store_open_fails_when_state_path_is_a_directory() {
    let dir = tempfile::tempdir().unwrap();

    let failure = DeviceStore::open(dir.path(), fresh_id).unwrap_err();

    assert!(matches!(failure, StoreError::Io { .. }), "{failure}");
}

#[test]
fn device_store_save_fails_when_state_directory_is_a_file() {
    let dir = tempfile::tempdir().unwrap();
    let runtime = dir.path().join("runtime");
    let store = DeviceStore::open(runtime.join("mock-kobo.json"), fresh_id).unwrap();
    fs::write(&runtime, "").unwrap();

    let failure = store.save().unwrap_err();

    assert!(matches!(failure, StoreError::Io { .. }), "{failure}");
}
