//! The wiring against a stub Omnibus that records what it is sent.

use omnibus_shared::RequestsSettingsUpdate;
use serde_json::{json, Value};

use super::test_support::{
    body_of, calls, config, run, saved_with, spawn_stub, Config, Stub, MOCK,
};
use super::*;

#[tokio::test]
async fn wire_logs_in_saves_and_tests_each_connection_then_logs_out() {
    let (origin, stub) = spawn_stub(config()).await;

    run(&origin, DownloadClientKind::Transmission)
        .await
        .unwrap();

    assert_eq!(
        calls(&stub),
        [
            "POST /api/auth/login",
            "GET /api/settings",
            "GET /api/admin/requests/settings",
            "PUT /api/admin/requests/settings",
            "POST /api/admin/requests/settings/test-indexer",
            "POST /api/admin/requests/settings/test-client",
            "GET /api/admin/notifications/connections",
            "POST /api/admin/notifications/connections",
            "POST /api/admin/notifications/test",
            "POST /api/auth/logout",
        ]
    );
    let bearers = stub.bearers.lock().unwrap();
    assert!(
        bearers
            .iter()
            .skip(1)
            .all(|(_, b)| b.as_deref() == Some("Bearer tok")),
        "{bearers:?}"
    );
}

#[tokio::test]
async fn wire_saves_every_field_the_mock_answers_to() {
    let (origin, stub) = spawn_stub(config()).await;

    run(&origin, DownloadClientKind::Sabnzbd).await.unwrap();

    let body = body_of(&stub, "PUT /api/admin/requests/settings");
    let saved: RequestsSettingsUpdate = serde_json::from_value(body).unwrap();
    assert_eq!(saved.prowlarr_url, MOCK);
    assert_eq!(saved.prowlarr_api_key.as_deref(), Some("mock-requests"));
    assert_eq!(saved.download_client_kind, DownloadClientKind::Sabnzbd);
    assert_eq!(saved.download_client_url, MOCK);
    assert_eq!(saved.download_client_username, "mock");
    assert_eq!(saved.download_client_password.as_deref(), Some("mock"));
    assert_eq!(saved.download_client_category, "");
    assert_eq!(saved.download_client_path_prefix, "/dl");
    assert_eq!(saved.download_path_prefix, "/dl");
}

/// A saved download client at `url` logging in as `username`.
fn client_saved(url: &str, username: &str) -> Value {
    let mut saved = saved_with(None, Some(url));
    saved["download_client_username"] = json!(username);
    saved
}

#[tokio::test]
async fn wire_replaces_a_previous_mock_wiring() {
    let mut cfg = config();
    cfg.saved = client_saved("http://127.0.0.1:5555", "mock");
    cfg.saved["prowlarr_url"] = json!("http://127.0.0.1:5555");
    cfg.saved["prowlarr_api_key_masked"] = json!(PROWLARR_KEY_MASKED);
    let (origin, stub) = spawn_stub(cfg).await;

    run(&origin, DownloadClientKind::Qbittorrent).await.unwrap();

    assert!(calls(&stub).contains(&"PUT /api/admin/requests/settings".to_string()));
}

#[tokio::test]
async fn wire_refuses_real_services_on_this_machine() {
    let mut real_prowlarr = saved_with(Some("http://localhost:9696"), None);
    real_prowlarr["prowlarr_api_key_masked"] = json!("abcd\u{2026}wxyz");
    let cases = [
        (real_prowlarr, "Prowlarr"),
        (
            client_saved("http://127.0.0.1:8080", "admin"),
            "download client",
        ),
        (
            saved_with(None, Some("http://127.0.0.1:8080")),
            "download client",
        ),
    ];
    for (saved, who) in cases {
        let mut cfg = config();
        cfg.saved = saved;
        let (origin, stub) = spawn_stub(cfg).await;

        let err = run(&origin, DownloadClientKind::Qbittorrent)
            .await
            .unwrap_err();

        assert!(
            matches!(&err, WireError::InUse(w) if w.contains(who)),
            "{who}: {err:?}"
        );
        assert!(!calls(&stub).iter().any(|c| c.starts_with("PUT")), "{who}");
    }
}

#[tokio::test]
async fn wire_refuses_to_overwrite_a_saved_address_that_is_not_on_this_machine() {
    let mut mock_key_elsewhere = saved_with(Some("http://prowlarr.lan:9696"), None);
    mock_key_elsewhere["prowlarr_api_key_masked"] = json!(PROWLARR_KEY_MASKED);
    let cases = [
        (mock_key_elsewhere, "Prowlarr"),
        (
            client_saved("http://qbit.lan:8080", "mock"),
            "download client",
        ),
        (
            saved_with(Some("http://prowlarr.lan:9696"), None),
            "Prowlarr",
        ),
        (
            saved_with(None, Some("https://qbit.example.com")),
            "download client",
        ),
    ];
    for (saved, who) in cases {
        let mut cfg = config();
        cfg.saved = saved;
        let (origin, stub) = spawn_stub(cfg).await;

        let err = run(&origin, DownloadClientKind::Qbittorrent)
            .await
            .unwrap_err();

        assert!(
            matches!(&err, WireError::InUse(w) if w.contains(who)),
            "{err:?}"
        );
        assert!(!calls(&stub).iter().any(|c| c.starts_with("PUT")), "{who}");
        assert_eq!(calls(&stub).last().unwrap(), "POST /api/auth/logout");
    }
}

#[tokio::test]
async fn wire_says_requests_are_off_when_the_settings_answer_404() {
    let mut cfg = config();
    cfg.settings = 404;
    let (origin, _) = spawn_stub(cfg).await;

    let err = run(&origin, DownloadClientKind::Qbittorrent)
        .await
        .unwrap_err();

    assert!(matches!(err, WireError::RequestsOff), "{err:?}");
    assert!(err.to_string().contains("OMNIBUS_BOOK_REQUESTS=1"));
}

#[tokio::test]
async fn wire_sends_nothing_when_it_cannot_be_set_up() {
    let (origin, stub) = spawn_stub(config()).await;
    let mock = MOCK;
    let kind = DownloadClientKind::Qbittorrent;
    let dl = Path::new("/dl");

    let remote = wire("http://192.0.2.1:3000", Some("a:b"), mock, kind, dl).await;
    let missing = wire(&origin, None, mock, kind, dl).await;
    let empty = wire(&origin, Some(""), mock, kind, dl).await;
    let malformed = wire(&origin, Some("nocolon"), mock, kind, dl).await;
    let nameless = wire(&origin, Some(":pw"), mock, kind, dl).await;

    for result in [remote, missing, empty, malformed, nameless] {
        assert!(matches!(result, Err(WireError::Setup(_))), "{result:?}");
    }
    assert!(calls(&stub).is_empty());
}

#[tokio::test]
async fn wire_names_the_step_that_a_server_refused() {
    type Tweak = fn(&mut Config);
    let steps: [(Tweak, &str); 4] = [
        (|c| c.login = 401, "login"),
        (|c| c.put = 422, "save"),
        (
            |c| c.test_indexer = (502, "the API key was rejected"),
            "test-indexer",
        ),
        (
            |c| c.test_client = (502, "could not connect"),
            "test-client",
        ),
    ];
    for (tweak, step) in steps {
        let mut cfg = config();
        tweak(&mut cfg);
        let (origin, _) = spawn_stub(cfg).await;

        let err = run(&origin, DownloadClientKind::Qbittorrent)
            .await
            .unwrap_err();

        let shown = err.to_string();
        assert!(
            matches!(&err, WireError::Server { step: s, .. } if s.contains(step)),
            "{shown}"
        );
        assert!(!shown.contains("127.0.0.1"), "{shown}");
    }
}

fn puts(stub: &Stub) -> usize {
    calls(stub)
        .iter()
        .filter(|r| *r == "PUT /api/admin/requests/settings")
        .count()
}

#[tokio::test]
async fn wire_retries_a_save_the_server_fails_with_a_500_then_finishes() {
    let mut cfg = config();
    cfg.put_500s = 2;
    let (origin, stub) = spawn_stub(cfg).await;

    run(&origin, DownloadClientKind::Qbittorrent).await.unwrap();

    assert_eq!(puts(&stub), 3);
    assert_eq!(
        calls(&stub).last().map(String::as_str),
        Some("POST /api/auth/logout")
    );
}

#[tokio::test]
async fn wire_gives_up_on_a_save_that_keeps_failing_with_a_500() {
    let mut cfg = config();
    cfg.put_500s = usize::MAX;
    let (origin, stub) = spawn_stub(cfg).await;

    let err = run(&origin, DownloadClientKind::Qbittorrent)
        .await
        .unwrap_err();

    assert!(
        matches!(&err, WireError::Server { step: "save settings", detail } if detail.contains("500")),
        "{err}"
    );
    assert_eq!(puts(&stub), 4);
}

#[tokio::test]
async fn wire_does_not_retry_a_save_the_server_refused_as_invalid() {
    let mut cfg = config();
    cfg.put = 422;
    let (origin, stub) = spawn_stub(cfg).await;

    run(&origin, DownloadClientKind::Qbittorrent)
        .await
        .unwrap_err();

    assert_eq!(puts(&stub), 1);
}

#[tokio::test]
async fn wire_puts_the_servers_reason_in_the_error() {
    let mut cfg = config();
    cfg.test_client = (502, "could not connect (connection refused or failed)");
    let (origin, _) = spawn_stub(cfg).await;

    let err = run(&origin, DownloadClientKind::Qbittorrent)
        .await
        .unwrap_err();

    assert!(err
        .to_string()
        .contains("could not connect (connection refused or failed)"));
}

#[tokio::test]
async fn wire_follows_no_redirect_so_the_password_goes_nowhere_else() {
    let mut cfg = config();
    cfg.redirect_login = true;
    let (origin, stub) = spawn_stub(cfg).await;

    let err = run(&origin, DownloadClientKind::Qbittorrent)
        .await
        .unwrap_err();

    assert!(
        matches!(err, WireError::Server { step: "login", .. }),
        "{err:?}"
    );
    assert_eq!(calls(&stub), ["POST /api/auth/login"]);
}

#[tokio::test]
async fn wire_refuses_a_library_inside_any_test_data_before_saving_anything() {
    let other_checkout = tempfile::tempdir().unwrap();
    std::fs::create_dir(other_checkout.path().join(".git")).unwrap();
    let inside = other_checkout.path().join("test_data/epubs");
    std::fs::create_dir_all(&inside).unwrap();
    let inside = inside.to_str().unwrap();
    for field in ["ebook_library_path", "audiobook_library_path"] {
        let mut cfg = config();
        cfg.libraries = json!({ field: inside });
        let (origin, stub) = spawn_stub(cfg).await;

        let err = run(&origin, DownloadClientKind::Qbittorrent)
            .await
            .unwrap_err();

        let shown = err.to_string();
        assert!(
            matches!(&err, WireError::Setup(_)) && shown.contains("test_data"),
            "{field}: {shown}"
        );
        assert!(
            !calls(&stub).iter().any(|c| c.starts_with("PUT")),
            "{field}"
        );
        assert_eq!(calls(&stub).last().unwrap(), "POST /api/auth/logout");
    }
}

fn libraries_at(path: &Path) -> Settings {
    Settings {
        ebook_library_path: Some(path.to_str().unwrap().into()),
        ..Settings::default()
    }
}

#[test]
fn prowlarr_key_masked_previews_the_first_and_last_four_of_the_key() {
    let key: Vec<char> = PROWLARR_API_KEY.chars().collect();
    let head: String = key[..4].iter().collect();
    let tail: String = key[key.len() - 4..].iter().collect();

    assert_eq!(PROWLARR_KEY_MASKED, format!("{head}\u{2026}{tail}"));
}

#[test]
fn guard_libraries_refuses_a_missing_leaf_reached_through_a_symlink_into_test_data() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::create_dir(tmp.path().join("repo")).unwrap();
    std::fs::create_dir(tmp.path().join("repo/.git")).unwrap();
    std::fs::create_dir_all(tmp.path().join("repo/test_data/epubs")).unwrap();
    std::os::unix::fs::symlink(
        tmp.path().join("repo/test_data/epubs"),
        tmp.path().join("link"),
    )
    .unwrap();

    let err = guard_libraries(&libraries_at(&tmp.path().join("link/not-yet"))).unwrap_err();

    assert!(matches!(err, WireError::Setup(_)), "{err:?}");
}

#[test]
fn guard_libraries_refuses_a_checkouts_test_data_folder_itself() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::create_dir(tmp.path().join(".git")).unwrap();
    std::fs::create_dir(tmp.path().join("test_data")).unwrap();

    let err = guard_libraries(&libraries_at(&tmp.path().join("test_data"))).unwrap_err();

    assert!(matches!(err, WireError::Setup(_)), "{err:?}");
}

#[test]
fn guard_libraries_refuses_a_relative_library_path() {
    let err = guard_libraries(&libraries_at(Path::new("books"))).unwrap_err();

    assert!(matches!(err, WireError::Setup(_)), "{err:?}");
}

#[test]
fn guard_libraries_refuses_test_data_in_any_letter_case() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::create_dir(tmp.path().join(".git")).unwrap();
    std::fs::create_dir_all(tmp.path().join("Test_Data/epubs")).unwrap();

    let err = guard_libraries(&libraries_at(&tmp.path().join("Test_Data/epubs"))).unwrap_err();

    assert!(matches!(err, WireError::Setup(_)), "{err:?}");
}

#[test]
fn guard_libraries_accepts_a_checkout_that_merely_lives_under_a_test_data_folder() {
    let tmp = tempfile::tempdir().unwrap();
    let lib = tmp.path().join("chore/test_data/repo/.claude/runtime/lib");
    std::fs::create_dir_all(&lib).unwrap();
    std::fs::create_dir(tmp.path().join("chore/test_data/repo/.git")).unwrap();

    guard_libraries(&libraries_at(&lib)).unwrap();
}

#[test]
fn guard_libraries_accepts_a_test_data_folder_that_is_not_in_a_checkout() {
    let tmp = tempfile::tempdir().unwrap();
    let lib = tmp.path().join("nas/test_data/books");
    std::fs::create_dir_all(&lib).unwrap();

    guard_libraries(&libraries_at(&lib)).unwrap();
}

/// Writes `port` as the dev server's published port in a fresh runtime dir.
fn runtime_dir(port: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("port"), format!("{port}\n")).unwrap();
    dir
}

fn port_of(origin: &str) -> &str {
    origin.rsplit(':').next().unwrap()
}

#[tokio::test]
async fn local_origin_reads_the_port_the_dev_server_published() {
    let (origin, _) = spawn_stub(config()).await;
    let dir = runtime_dir(port_of(&origin));

    let found = local_origin(dir.path(), Path::new("/repo")).await.unwrap();

    assert_eq!(found, origin);
}

#[tokio::test]
async fn local_origin_asks_for_dev_up_when_no_port_was_published() {
    let dir = tempfile::tempdir().unwrap();

    let err = local_origin(dir.path(), Path::new("/repo"))
        .await
        .unwrap_err();

    assert!(
        matches!(&err, WireError::Setup(m) if m.contains("just dev-up")),
        "{err:?}"
    );
}

#[tokio::test]
async fn local_origin_refuses_a_port_file_that_names_another_checkouts_server() {
    let mut cfg = config();
    cfg.repo_root = "/elsewhere/omnibus".into();
    let (origin, _) = spawn_stub(cfg).await;
    let dir = runtime_dir(port_of(&origin));

    let err = local_origin(dir.path(), Path::new("/repo"))
        .await
        .unwrap_err();

    assert!(
        matches!(&err, WireError::Setup(m) if m.contains("another checkout")),
        "{err:?}"
    );
}

#[tokio::test]
async fn local_origin_asks_for_dev_up_when_nothing_answers_on_the_published_port() {
    let dir = runtime_dir("1");

    let err = local_origin(dir.path(), Path::new("/repo"))
        .await
        .unwrap_err();

    assert!(
        matches!(&err, WireError::Setup(m) if m.contains("just dev-up")),
        "{err:?}"
    );
}
