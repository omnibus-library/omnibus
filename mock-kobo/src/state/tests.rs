//! `state::load` and `state::save` against a real temp directory.

use std::path::Path;

use tempfile::TempDir;

use crate::device::{Book, Device, DEVICE_FORMAT};
use crate::wire::Series;

use super::*;

fn dune() -> Book {
    Book {
        title: "Dune".into(),
        description: "Spice.".into(),
        authors: vec!["Frank Herbert".into()],
        series: Some(Series {
            name: "Dune".into(),
            number: Some(1.0),
            id: "s-1".into(),
        }),
        downloaded: false,
        archived: false,
        cover_image_id: "book-1".into(),
        cover: None,
        download_problem: None,
        reading: crate::reading::Reading::default(),
    }
}

fn synced_state() -> SavedState {
    let mut device = Device::new("mock-ab");
    device.library.insert("book-1".into(), dune());
    device.sync_token = Some("page-2".into());
    SavedState {
        url: None,
        token: "tok-1".into(),
        wired_url: Some("http://dev:1".into()),
        device,
    }
}

#[tokio::test]
async fn load_returns_none_when_state_file_is_missing() {
    let dir = TempDir::new().unwrap();

    let loaded = load(&dir.path().join("kobo.json")).await.unwrap();

    assert_eq!(loaded, None);
}

#[tokio::test]
async fn save_then_load_round_trips_device_and_token() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let state = synced_state();

    save(&path, &state).await.unwrap();

    assert_eq!(load(&path).await.unwrap(), Some(state));
}

#[tokio::test]
async fn load_drops_the_sync_token_of_a_device_saved_before_covers_and_downloads() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    // A format-0 file has no `format`, `covers` or `download_urls` fields at all.
    let legacy = serde_json::json!({
        "url": null,
        "token": "tok-1",
        "device": {
            "hardware_id": "mock-ab",
            "library": {},
            "sync_token": "page-7",
        },
    });
    std::fs::write(&path, legacy.to_string()).unwrap();

    let loaded = load(&path).await.unwrap().unwrap();

    assert_eq!(
        (loaded.device.format, loaded.device.sync_token),
        (DEVICE_FORMAT, None)
    );
}

#[tokio::test]
async fn load_reads_wired_url_as_none_when_state_file_lacks_it() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    let device = serde_json::to_value(Device::new("mock-ab")).unwrap();
    let older = serde_json::json!({ "url": null, "token": "tok-1", "device": device });
    std::fs::write(&path, older.to_string()).unwrap();

    let loaded = load(&path).await.unwrap().unwrap();

    assert_eq!(loaded.wired_url, None);
    assert_eq!(loaded.token, "tok-1");
}

#[tokio::test]
async fn save_creates_missing_parent_directories() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("a").join("b").join("kobo.json");

    save(&path, &synced_state()).await.unwrap();

    assert_eq!(load(&path).await.unwrap(), Some(synced_state()));
}

#[tokio::test]
async fn save_leaves_no_temp_file_behind() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");

    save(&path, &synced_state()).await.unwrap();

    let names: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(names, ["kobo.json"]);
}

#[cfg(unix)]
#[tokio::test]
async fn save_writes_state_file_readable_only_by_owner() {
    use std::os::unix::fs::PermissionsExt;
    let mode_of = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");

    save(&path, &synced_state()).await.unwrap();
    let first = mode_of(&path);
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    save(&path, &synced_state()).await.unwrap();

    assert_eq!((first, mode_of(&path)), (0o600, 0o600));
}

#[test]
fn save_uses_a_fresh_temp_file_for_each_write() {
    let path = Path::new("/some/dir/kobo.json");

    let first = temp_path(path).unwrap();
    let second = temp_path(path).unwrap();

    assert_ne!(first, second);
    assert_eq!(first.parent(), path.parent());
    assert_eq!(second.parent(), path.parent());
}

#[tokio::test]
async fn save_leaves_no_temp_file_behind_when_rename_fails() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    std::fs::create_dir(&path).unwrap();

    let error = save(&path, &synced_state()).await.unwrap_err();

    assert!(matches!(error, StateError::Write { .. }));
    let names: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(names, ["kobo.json"]);
}

#[tokio::test]
async fn load_reports_corrupt_when_file_is_not_state_json() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("kobo.json");
    std::fs::write(&path, "not json").unwrap();

    let error = load(&path).await.unwrap_err();

    assert!(matches!(error, StateError::Corrupt { .. }));
    assert!(error.to_string().contains("kobo.json"));
}

#[tokio::test]
async fn load_reports_read_error_when_path_is_a_directory() {
    let dir = TempDir::new().unwrap();

    let error = load(dir.path()).await.unwrap_err();

    assert!(matches!(error, StateError::Read { .. }));
}

#[tokio::test]
async fn save_reports_write_error_when_parent_is_a_file() {
    let dir = TempDir::new().unwrap();
    let parent = dir.path().join("parent");
    std::fs::write(&parent, "").unwrap();

    let error = save(&parent.join("kobo.json"), &synced_state())
        .await
        .unwrap_err();

    assert!(matches!(error, StateError::Write { .. }));
}

#[test]
fn token_wired_for_is_true_for_a_token_the_user_gave() {
    let state = SavedState {
        wired_url: None,
        ..synced_state()
    };

    assert!(state.token_wired_for("http://anywhere:1"));
}

#[test]
fn token_wired_for_is_true_for_the_url_it_was_wired_against() {
    let state = synced_state();

    assert!(state.token_wired_for("http://dev:1"));
}

#[test]
fn token_wired_for_is_false_for_another_url() {
    let state = synced_state();

    assert!(!state.token_wired_for("http://other:1"));
}
