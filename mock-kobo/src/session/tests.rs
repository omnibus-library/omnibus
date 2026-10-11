use super::*;
use crate::client::REQUEST_TIMEOUT;
use crate::device::Device;
use crate::firmware::Quirk;
use axum::http::StatusCode;
use serde_json::json;

use crate::test_support::{new_entitlement, spawn_stub, Stub, STUB_TOKEN};

fn request_lines(report: &SyncReport) -> Vec<String> {
    report
        .requests
        .iter()
        .map(|r| format!("{} {}", r.method, r.path))
        .collect()
}

#[tokio::test]
async fn sync_now_completes_handshake_against_healthy_stub() {
    let stub = spawn_stub(Stub::default()).await;
    let mut device = Device::new("HW-1");

    let report = sync_now(&mut device, &stub.endpoint).await.unwrap();

    assert_eq!(
        request_lines(&report),
        [
            "GET /kobo/<token>/v1/initialization",
            "POST /kobo/<token>/v1/analytics/gettests",
            "GET /kobo/<token>/v1/user/profile",
            "GET /kobo/<token>/v1/user/loyalty/benefits",
            "GET /kobo/<token>/v1/products/books/subscriptions",
            "GET /kobo/<token>/v1/deals",
            "GET /kobo/<token>/v1/library/sync",
        ]
    );
}

#[tokio::test]
async fn sync_now_fails_when_initialization_lacks_api_token() {
    let stub = spawn_stub(Stub {
        api_token: None,
        ..Stub::default()
    })
    .await;

    let failure = sync_now(&mut Device::new("HW-1"), &stub.endpoint)
        .await
        .unwrap_err();

    assert!(matches!(
        failure,
        SyncFailure::Quirk {
            quirk: Quirk::ApiToken,
            ..
        }
    ));
}

#[tokio::test]
async fn sync_now_fails_when_gettests_rejects_post() {
    let stub = spawn_stub(Stub {
        gettests_accepts_post: false,
        ..Stub::default()
    })
    .await;

    let failure = sync_now(&mut Device::new("HW-1"), &stub.endpoint)
        .await
        .unwrap_err();

    assert!(matches!(
        failure,
        SyncFailure::Quirk {
            quirk: Quirk::GetTestsPost,
            ..
        }
    ));
}

#[tokio::test]
async fn sync_now_fails_before_library_sync_when_store_path_returns_404() {
    let stub = spawn_stub(Stub {
        store_path_status: StatusCode::NOT_FOUND,
        ..Stub::default()
    })
    .await;

    let failure = sync_now(&mut Device::new("HW-1"), &stub.endpoint)
        .await
        .unwrap_err();

    assert!(matches!(
        failure,
        SyncFailure::Quirk {
            quirk: Quirk::StorePaths,
            ..
        }
    ));
    assert!(!stub.paths().iter().any(|p| p.ends_with("/v1/library/sync")));
}

#[tokio::test]
async fn sync_now_fails_when_store_path_redirects() {
    let stub = spawn_stub(Stub {
        store_path_status: StatusCode::FOUND,
        ..Stub::default()
    })
    .await;

    let failure = sync_now(&mut Device::new("HW-1"), &stub.endpoint)
        .await
        .unwrap_err();

    assert!(matches!(
        failure,
        SyncFailure::Quirk {
            quirk: Quirk::StorePaths,
            ..
        }
    ));
}

#[tokio::test(start_paused = true)]
async fn sync_now_fails_when_server_never_answers() {
    let stub = spawn_stub(Stub {
        sync_never_answers: true,
        ..Stub::default()
    })
    .await;

    let outcome = tokio::time::timeout(
        REQUEST_TIMEOUT * 2,
        sync_now(&mut Device::new("HW-1"), &stub.endpoint),
    )
    .await;

    let failure = outcome
        .expect("sync_now should give up on the silent server before the deadline")
        .unwrap_err();
    assert!(matches!(failure, SyncFailure::Transport(_)));
}

#[tokio::test]
async fn sync_now_failure_omits_device_token_when_store_path_returns_404() {
    let stub = spawn_stub(Stub {
        store_path_status: StatusCode::NOT_FOUND,
        ..Stub::default()
    })
    .await;

    let failure = sync_now(&mut Device::new("HW-1"), &stub.endpoint)
        .await
        .unwrap_err();

    assert_eq!(
        failure.to_string(),
        "sync failed (StorePaths): /kobo/<token>/v1/user/profile answered 404 Not Found"
    );
    assert!(!format!("{failure:?}").contains(STUB_TOKEN));
}

#[tokio::test]
async fn sync_now_failure_omits_device_token_when_server_unreachable() {
    // Port 1 is privileged, so a parallel stub's `bind("127.0.0.1:0")` is never handed it.
    let endpoint = format!("http://127.0.0.1:1/kobo/{STUB_TOKEN}");

    let failure = sync_now(&mut Device::new("HW-1"), &endpoint)
        .await
        .unwrap_err();

    assert!(matches!(failure, SyncFailure::Transport(_)));
    assert!(!format!("{failure:?}").contains(STUB_TOKEN));
}

#[tokio::test]
async fn sync_now_sends_hardware_id_on_every_request() {
    let stub = spawn_stub(Stub::default()).await;

    sync_now(&mut Device::new("HW-1"), &stub.endpoint)
        .await
        .unwrap();

    let requests = stub.requests.lock().unwrap();
    let ids: Vec<Option<&str>> = requests
        .iter()
        .map(|r| {
            r.headers
                .get("x-kobo-deviceid")
                .and_then(|v| v.to_str().ok())
        })
        .collect();
    assert_eq!(ids, vec![Some("HW-1"); 7]);
}

#[tokio::test]
async fn sync_now_follows_urls_from_adopted_resources() {
    let stub = spawn_stub(Stub {
        resources_under: "/moved",
        ..Stub::default()
    })
    .await;

    sync_now(&mut Device::new("HW-1"), &stub.endpoint)
        .await
        .unwrap();

    let paths = stub.paths();
    assert_eq!(
        paths[1],
        "/kobo/stub-device-token/moved/v1/analytics/gettests"
    );
    assert_eq!(
        paths.last().unwrap(),
        "/kobo/stub-device-token/moved/v1/library/sync"
    );
}

#[tokio::test]
async fn sync_now_applies_every_page_until_server_stops_continuing() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![
            json!([new_entitlement("book-1", "First")]),
            json!([new_entitlement("book-2", "Second")]),
        ],
        ..Stub::default()
    })
    .await;
    let mut device = Device::new("HW-1");

    sync_now(&mut device, &stub.endpoint).await.unwrap();

    let titles: Vec<&str> = device.library.values().map(|b| b.title.as_str()).collect();
    assert_eq!(titles, ["First", "Second"]);
}

#[tokio::test]
async fn sync_now_echoes_sync_token_on_continued_pages() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([]), json!([])],
        ..Stub::default()
    })
    .await;

    let report = sync_now(&mut Device::new("HW-1"), &stub.endpoint)
        .await
        .unwrap();

    assert_eq!(report.pages, 2);
    let requests = stub.requests.lock().unwrap();
    let tokens: Vec<Option<&str>> = requests
        .iter()
        .filter(|r| r.path.ends_with("/v1/library/sync"))
        .map(|r| {
            r.headers
                .get("x-kobo-synctoken")
                .and_then(|v| v.to_str().ok())
        })
        .collect();
    assert_eq!(tokens, [None, Some("page-1")]);
}

#[tokio::test]
async fn sync_now_fails_when_sync_never_stops_continuing() {
    let stub = spawn_stub(Stub {
        sync_never_ends: true,
        ..Stub::default()
    })
    .await;

    let failure = sync_now(&mut Device::new("HW-1"), &stub.endpoint)
        .await
        .unwrap_err();

    assert!(matches!(
        failure,
        SyncFailure::Quirk {
            quirk: Quirk::SyncPaging,
            ..
        }
    ));
}

#[tokio::test]
async fn sync_now_fails_when_library_sync_body_is_malformed() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!({ "not": "a list" })],
        ..Stub::default()
    })
    .await;

    let failure = sync_now(&mut Device::new("HW-1"), &stub.endpoint)
        .await
        .unwrap_err();

    assert!(matches!(failure, SyncFailure::BadResponse(_)));
    assert!(failure
        .to_string()
        .contains("invalid type: map, expected a sequence"));
    assert!(!format!("{failure:?}").contains(STUB_TOKEN));
}
