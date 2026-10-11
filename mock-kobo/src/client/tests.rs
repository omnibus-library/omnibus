//! The device's HTTP client against a stub Omnibus: its timeout, its request log, and token redaction.

use std::time::Duration;

use crate::test_support::{spawn_stub, Stub};

use super::*;

#[tokio::test]
async fn library_sync_reports_transport_failure_naming_path_when_server_never_answers() {
    let stub = spawn_stub(Stub {
        sync_never_answers: true,
        ..Stub::default()
    })
    .await;
    let timeout = Duration::from_millis(200);
    let mut client = Client::with_timeout(&stub.endpoint, "HW-1", timeout).unwrap();
    let url = format!("{}/v1/library/sync", stub.endpoint);

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
