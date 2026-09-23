//! Sync-point refusal classification and the labels shared by reader and player.

use super::*;
use dioxus::fullstack::ServerFnError;
use omnibus_shared::CrossFormatErrorCode;

fn server_error(code: u16, message: &str) -> dioxus::CapturedError {
    ServerFnError::ServerError {
        message: message.into(),
        code,
        details: None,
    }
    .into()
}

#[test]
fn classify_sync_point_err_does_not_infer_a_refusal_from_prose() {
    let e = server_error(500, "confirm the alignment first — unrelated failure");
    assert!(matches!(
        classify_sync_point_err(e),
        SyncPointError::Other(_)
    ));
}

#[test]
fn classify_sync_point_err_maps_link_refusal_to_link_required() {
    let e = server_error(
        CrossFormatErrorCode::LinkRequired.status(),
        "This message can be rewritten freely",
    );
    assert!(matches!(
        classify_sync_point_err(e),
        SyncPointError::LinkRequired
    ));
}

#[test]
fn classify_sync_point_err_keeps_the_message_of_other_refusals() {
    for code in [
        CrossFormatErrorCode::AudioSetMismatch,
        CrossFormatErrorCode::CounterpartMissing,
    ] {
        match classify_sync_point_err(server_error(code.status(), "shown to the reader")) {
            SyncPointError::Other(DataError::Other(msg)) => {
                assert_eq!(msg, "shown to the reader")
            }
            other => panic!("{code:?} classified as {other:?}"),
        }
    }
}

#[test]
fn classify_sync_point_err_passes_other_failures_through() {
    let e = ServerFnError::new("connection reset").into();
    assert!(matches!(
        classify_sync_point_err(e),
        SyncPointError::Other(_)
    ));
}

#[test]
fn classify_sync_point_err_preserves_unauthorized() {
    assert!(matches!(
        classify_sync_point_err(server_error(401, "session expired")),
        SyncPointError::Other(DataError::Unauthorized)
    ));
}

#[test]
fn sync_point_label_reports_success() {
    assert_eq!(sync_point_label(Ok(())), "Synced \u{2713}");
}

#[test]
fn sync_point_label_prompts_linking_when_link_required() {
    assert_eq!(
        sync_point_label(Err(SyncPointError::LinkRequired)),
        "Link formats first"
    );
}

#[test]
fn sync_point_label_reports_failure_for_other_errors() {
    assert_eq!(
        sync_point_label(Err(SyncPointError::Other(DataError::Other(
            "connection reset".into()
        )))),
        "Sync failed"
    );
}
