//! Sync-point refusal classification and the labels shared by reader and player.

use super::*;
use dioxus::fullstack::ServerFnError;

#[test]
fn classify_sync_point_err_does_not_infer_a_refusal_from_prose() {
    let e = ServerFnError::new("confirm the alignment first — unrelated failure").into();
    assert!(matches!(
        classify_sync_point_err(e),
        SyncPointError::Other(_)
    ));
}

#[test]
fn classify_sync_point_err_maps_link_refusal_to_link_required() {
    let e = ServerFnError::ServerError {
        message: "This message can be rewritten freely".into(),
        code: 409,
        details: Some(serde_json::json!("link_required")),
    }
    .into();
    assert!(matches!(
        classify_sync_point_err(e),
        SyncPointError::LinkRequired
    ));
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

#[test]
fn classify_sync_point_err_preserves_unknown_and_other_refusals() {
    for details in [
        None,
        Some(serde_json::json!("audio_set_mismatch")),
        Some(serde_json::json!("counterpart_missing")),
        Some(serde_json::json!("future_refusal")),
        Some(serde_json::json!({"unexpected": true})),
    ] {
        let error = ServerFnError::ServerError {
            message: "confirm the alignment first — not a link-required code".into(),
            code: 409,
            details,
        };
        assert!(matches!(
            classify_sync_point_err(error.into()),
            SyncPointError::Other(DataError::Other(_))
        ));
    }
}

#[test]
fn classify_sync_point_err_preserves_unauthorized_even_with_refusal_details() {
    let error = ServerFnError::ServerError {
        message: "session expired".into(),
        code: 401,
        details: Some(serde_json::json!("link_required")),
    };
    assert!(matches!(
        classify_sync_point_err(error.into()),
        SyncPointError::Other(DataError::Unauthorized)
    ));
}
