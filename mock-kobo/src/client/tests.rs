//! The device's HTTP client against a stub Omnibus: its timeout, its request log, and token redaction.

use std::time::Duration;

use serde_json::json;

use crate::test_support::{spawn_stub, RunningStub, Stub, STUB_TOKEN};
use crate::wire::SyncItem;

use super::*;

fn stub_url(stub: &RunningStub, path: &str) -> String {
    format!("{}{path}", stub.endpoint)
}

fn answered(method: &str, path: &str) -> RequestRecord {
    RequestRecord {
        method: method.to_owned(),
        path: path.to_owned(),
        status: 200,
    }
}

#[test]
fn redact_replaces_device_token_from_kobo_endpoint() {
    let client = Client::new("http://h/kobo/abc123", "HW-1").unwrap();

    let redacted = client.redact("GET /kobo/abc123/v1/deals");

    assert_eq!(redacted, "GET /kobo/<token>/v1/deals");
}

#[test]
fn redact_leaves_text_unchanged_when_endpoint_has_no_kobo_segment() {
    let client = Client::new("http://h/elsewhere", "HW-1").unwrap();

    let redacted = client.redact("GET /elsewhere/v1/deals");

    assert_eq!(redacted, "GET /elsewhere/v1/deals");
}

#[tokio::test]
async fn client_records_each_request_with_redacted_path_and_status() {
    let stub = spawn_stub(Stub::default()).await;
    let mut client = Client::new(&stub.endpoint, "HW-1").unwrap();

    client.initialization().await.unwrap();
    let tests_url = stub_url(&stub, "/v1/analytics/gettests");
    client.get_tests(&tests_url).await.unwrap();
    client.store_path("/v1/deals").await.unwrap();
    let sync_url = stub_url(&stub, "/v1/library/sync");
    client.library_sync(&sync_url, None).await.unwrap();

    assert_eq!(
        client.into_requests(),
        [
            answered("GET", "/kobo/<token>/v1/initialization"),
            answered("POST", "/kobo/<token>/v1/analytics/gettests"),
            answered("GET", "/kobo/<token>/v1/deals"),
            answered("GET", "/kobo/<token>/v1/library/sync"),
        ]
    );
}

#[tokio::test]
async fn library_sync_reports_transport_failure_naming_path_when_server_never_answers() {
    let stub = spawn_stub(Stub {
        sync_never_answers: true,
        ..Stub::default()
    })
    .await;
    let timeout = Duration::from_millis(200);
    let mut client = Client::with_timeout(&stub.endpoint, "HW-1", timeout).unwrap();
    let url = stub_url(&stub, "/v1/library/sync");

    let outcome = tokio::time::timeout(Duration::from_secs(10), client.library_sync(&url, None));

    let failure = outcome
        .await
        .expect("library_sync should give up on the silent server")
        .unwrap_err();
    let SyncFailure::Transport(message) = failure else {
        panic!("expected a transport failure, got {failure:?}");
    };
    assert!(
        message.contains("/kobo/<token>/v1/library/sync"),
        "{message}"
    );
}

#[tokio::test]
async fn decode_reports_bad_response_naming_redacted_path() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!({ "not": "a list" })],
        ..Stub::default()
    })
    .await;
    let mut client = Client::new(&stub.endpoint, "HW-1").unwrap();
    let url = stub_url(&stub, "/v1/library/sync");
    let response = client.library_sync(&url, None).await.unwrap();

    let failure = client.decode::<Vec<SyncItem>>(response).await.unwrap_err();

    let SyncFailure::BadResponse(message) = failure else {
        panic!("expected a bad response, got {failure:?}");
    };
    assert!(
        message.contains("/kobo/<token>/v1/library/sync"),
        "{message}"
    );
    assert!(!message.contains(STUB_TOKEN), "{message}");
}
