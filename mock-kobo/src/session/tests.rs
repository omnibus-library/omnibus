//! `sync_now` against a stub Omnibus, one test per firmware rule the device enforces.

use std::time::Duration;

use axum::http::StatusCode;
use serde_json::json;

use crate::device::Device;
use crate::downloads::DownloadPolicy;
use crate::firmware::Quirk;
use crate::test_support::{
    new_entitlement, request_lines, spawn_stub, RunningStub, Stub, STUB_TOKEN,
};

use super::*;

/// The `x-kobo-synctoken` each `library_sync` request carried, in order.
fn library_sync_tokens(stub: &RunningStub) -> Vec<Option<String>> {
    let requests = stub.requests.lock().unwrap();
    requests
        .iter()
        .filter(|r| r.path.ends_with("/v1/library/sync"))
        .map(|r| {
            r.headers
                .get("x-kobo-synctoken")
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned)
        })
        .collect()
}

/// The `name` header each request carried, in order.
fn header_on_every_request(stub: &RunningStub, name: &str) -> Vec<Option<String>> {
    let requests = stub.requests.lock().unwrap();
    requests
        .iter()
        .map(|r| {
            r.headers
                .get(name)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned)
        })
        .collect()
}

#[tokio::test]
async fn sync_now_completes_handshake_against_healthy_stub() {
    let stub = spawn_stub(Stub::default()).await;
    let mut device = Device::new("HW-1");

    let report = sync_now(&mut device, &stub.endpoint, &DownloadPolicy::None)
        .await
        .unwrap();

    assert_eq!(
        request_lines(&report.requests),
        [
            "GET /kobo/<token>/v1/initialization 200",
            "POST /kobo/<token>/v1/analytics/gettests 200",
            "GET /kobo/<token>/v1/user/profile 200",
            "GET /kobo/<token>/v1/user/loyalty/benefits 200",
            "GET /kobo/<token>/v1/products/books/subscriptions 200",
            "GET /kobo/<token>/v1/deals 200",
            "GET /kobo/<token>/v1/library/sync 200",
        ]
    );
}

#[tokio::test]
async fn sync_now_fails_when_initialization_lacks_api_token() {
    let stub = spawn_stub(Stub {
        sends_api_token: false,
        ..Stub::default()
    })
    .await;

    let failure = sync_now(
        &mut Device::new("HW-1"),
        &stub.endpoint,
        &DownloadPolicy::None,
    )
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
async fn sync_now_reports_status_when_initialization_is_rejected() {
    let stub = spawn_stub(Stub {
        initialization_status: StatusCode::UNAUTHORIZED,
        ..Stub::default()
    })
    .await;

    let failure = sync_now(
        &mut Device::new("HW-1"),
        &stub.endpoint,
        &DownloadPolicy::None,
    )
    .await
    .unwrap_err();

    assert!(matches!(failure, SyncFailure::Rejected(_)));
    assert_eq!(
        failure.to_string(),
        "sync failed: /kobo/<token>/v1/initialization answered 401 Unauthorized"
    );
    assert!(!format!("{failure:?}").contains(STUB_TOKEN));
}

#[tokio::test]
async fn sync_now_fails_when_library_sync_answers_server_error() {
    let stub = spawn_stub(Stub {
        sync_status: StatusCode::INTERNAL_SERVER_ERROR,
        ..Stub::default()
    })
    .await;

    let failure = sync_now(
        &mut Device::new("HW-1"),
        &stub.endpoint,
        &DownloadPolicy::None,
    )
    .await
    .unwrap_err();

    assert!(matches!(failure, SyncFailure::Rejected(_)));
    assert_eq!(
        failure.to_string(),
        "sync failed: /kobo/<token>/v1/library/sync answered 500 Internal Server Error"
    );
}

#[tokio::test]
async fn sync_now_fails_when_gettests_rejects_post() {
    let stub = spawn_stub(Stub {
        gettests_accepts_post: false,
        ..Stub::default()
    })
    .await;

    let failure = sync_now(
        &mut Device::new("HW-1"),
        &stub.endpoint,
        &DownloadPolicy::None,
    )
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

    let failure = sync_now(
        &mut Device::new("HW-1"),
        &stub.endpoint,
        &DownloadPolicy::None,
    )
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

    let failure = sync_now(
        &mut Device::new("HW-1"),
        &stub.endpoint,
        &DownloadPolicy::None,
    )
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

#[tokio::test]
async fn sync_now_failure_omits_device_token_when_store_path_returns_404() {
    let stub = spawn_stub(Stub {
        store_path_status: StatusCode::NOT_FOUND,
        ..Stub::default()
    })
    .await;

    let failure = sync_now(
        &mut Device::new("HW-1"),
        &stub.endpoint,
        &DownloadPolicy::None,
    )
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

    let failure = sync_now(&mut Device::new("HW-1"), &endpoint, &DownloadPolicy::None)
        .await
        .unwrap_err();

    assert!(matches!(failure, SyncFailure::Transport(_)));
    assert!(!format!("{failure:?}").contains(STUB_TOKEN));
}

#[tokio::test]
async fn sync_now_sends_hardware_id_on_every_request() {
    let stub = spawn_stub(Stub::default()).await;

    sync_now(
        &mut Device::new("HW-1"),
        &stub.endpoint,
        &DownloadPolicy::None,
    )
    .await
    .unwrap();

    let ids = header_on_every_request(&stub, "x-kobo-deviceid");
    assert_eq!(ids, vec![Some("HW-1".to_owned()); 7]);
}

#[tokio::test]
async fn sync_now_sends_host_without_port_on_every_request() {
    let stub = spawn_stub(Stub::default()).await;

    sync_now(
        &mut Device::new("HW-1"),
        &stub.endpoint,
        &DownloadPolicy::None,
    )
    .await
    .unwrap();

    let hosts = header_on_every_request(&stub, "host");
    assert_eq!(hosts, vec![Some("127.0.0.1".to_owned()); 7]);
}

#[tokio::test]
async fn sync_leaves_the_server_when_resources_are_built_on_a_portless_host() {
    let stub = spawn_stub(Stub {
        resources_from_host: true,
        ..Stub::default()
    })
    .await;
    let mut client = Client::with_timeout(&stub.endpoint, "HW-1", Duration::from_secs(1)).unwrap();

    // The stub hands out port 80 URLs, so what answers there decides the outcome. It is not asserted.
    let _ = run_sync(&mut client, &mut Device::new("HW-1"), &DownloadPolicy::None).await;

    let lines = request_lines(&client.into_requests());
    assert_eq!(
        lines.first().map(String::as_str),
        Some("GET /kobo/<token>/v1/initialization 200")
    );
    let paths = stub.paths();
    assert!(
        !paths.iter().any(|path| {
            path.ends_with("/v1/analytics/gettests") || path.ends_with("/v1/library/sync")
        }),
        "the stub received a Resources URL that should have left the server: {paths:?}"
    );
}

#[tokio::test]
async fn sync_now_follows_urls_from_adopted_resources() {
    let stub = spawn_stub(Stub {
        resources_under: "/moved",
        ..Stub::default()
    })
    .await;

    sync_now(
        &mut Device::new("HW-1"),
        &stub.endpoint,
        &DownloadPolicy::None,
    )
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

    sync_now(&mut device, &stub.endpoint, &DownloadPolicy::None)
        .await
        .unwrap();

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

    let report = sync_now(
        &mut Device::new("HW-1"),
        &stub.endpoint,
        &DownloadPolicy::None,
    )
    .await
    .unwrap();

    assert_eq!(report.pages, 2);
    assert_eq!(
        library_sync_tokens(&stub),
        [None, Some("page-1".to_owned())]
    );
}

#[tokio::test]
async fn sync_now_fails_when_sync_never_stops_continuing() {
    let stub = spawn_stub(Stub {
        sync_never_ends: true,
        ..Stub::default()
    })
    .await;

    let failure = sync_now(
        &mut Device::new("HW-1"),
        &stub.endpoint,
        &DownloadPolicy::None,
    )
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

    let failure = sync_now(
        &mut Device::new("HW-1"),
        &stub.endpoint,
        &DownloadPolicy::None,
    )
    .await
    .unwrap_err();

    assert!(matches!(failure, SyncFailure::BadResponse(_)));
    assert!(failure
        .to_string()
        .contains("invalid type: map, expected a sequence"));
    assert!(!format!("{failure:?}").contains(STUB_TOKEN));
}

#[tokio::test]
async fn attempt_sync_keeps_requests_when_sync_fails() {
    let stub = spawn_stub(Stub {
        store_path_status: StatusCode::NOT_FOUND,
        ..Stub::default()
    })
    .await;

    let attempt = attempt_sync(
        &mut Device::new("HW-1"),
        &stub.endpoint,
        &DownloadPolicy::None,
    )
    .await;

    assert!(matches!(
        attempt.outcome,
        Err(SyncFailure::Quirk {
            quirk: Quirk::StorePaths,
            ..
        })
    ));
    assert_eq!(
        request_lines(&attempt.requests),
        [
            "GET /kobo/<token>/v1/initialization 200",
            "POST /kobo/<token>/v1/analytics/gettests 200",
            "GET /kobo/<token>/v1/user/profile 404",
        ]
    );
}

#[tokio::test]
async fn attempt_sync_reports_pages_and_requests_when_sync_succeeds() {
    let stub = spawn_stub(Stub::default()).await;

    let attempt = attempt_sync(
        &mut Device::new("HW-1"),
        &stub.endpoint,
        &DownloadPolicy::None,
    )
    .await;

    assert!(matches!(attempt.outcome, Ok(1)));
    assert_eq!(attempt.requests.len(), 7);
}

#[tokio::test]
async fn sync_now_echoes_saved_sync_token_on_first_page() {
    let stub = spawn_stub(Stub::default()).await;
    let mut device = Device::new("HW-1");
    device.sync_token = Some("page-9".into());

    sync_now(&mut device, &stub.endpoint, &DownloadPolicy::None)
        .await
        .unwrap();

    assert_eq!(library_sync_tokens(&stub), [Some("page-9".to_owned())]);
}

#[tokio::test]
async fn sync_now_keeps_last_sync_token_on_device() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([]), json!([])],
        ..Stub::default()
    })
    .await;
    let mut device = Device::new("HW-1");

    sync_now(&mut device, &stub.endpoint, &DownloadPolicy::None)
        .await
        .unwrap();

    assert_eq!(device.sync_token, Some("page-2".to_owned()));
}

#[tokio::test]
async fn sync_now_keeps_saved_sync_token_when_page_carries_none() {
    let stub = spawn_stub(Stub {
        sends_sync_token: false,
        ..Stub::default()
    })
    .await;
    let mut device = Device::new("HW-1");
    device.sync_token = Some("page-9".into());

    sync_now(&mut device, &stub.endpoint, &DownloadPolicy::None)
        .await
        .unwrap();

    assert_eq!(device.sync_token, Some("page-9".to_owned()));
}

#[tokio::test]
async fn sync_now_keeps_saved_sync_token_when_page_fails_to_decode() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!({ "not": "a list" })],
        ..Stub::default()
    })
    .await;
    let mut device = Device::new("HW-1");
    device.sync_token = Some("page-9".into());

    sync_now(&mut device, &stub.endpoint, &DownloadPolicy::None)
        .await
        .unwrap_err();

    assert_eq!(device.sync_token, Some("page-9".to_owned()));
}
