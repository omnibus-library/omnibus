//! Cross-format RPC refusals survive Dioxus's own encode and decode with
//! their status code and message intact.

use super::*;
use dioxus::fullstack::axum::body::to_bytes;
use dioxus::fullstack::magic::{MakeAxumError, RequestDecodeErr, ServerFnDecoder};
use dioxus::CapturedError;

use crate::data::{classify_sync_point_err, DataError, SyncPointError};

/// Encode `error` as the server does and decode it as the web client does,
/// at the autoref depth the `#[post]` expansion uses for both.
#[allow(clippy::needless_borrow)] // the depth picks the impl; keep the macro's
async fn round_trip(error: ServerFnError) -> CapturedError {
    let response = (&&&&&ServerFnDecoder::<Result<()>>::new()).make_axum_error(Err(error.into()));
    assert!(!response.status().is_success());
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    // The client's `decode_client_response`: a non-2xx body is an `ErrorPayload`.
    let wire: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let decoded = ServerFnError::ServerError {
        message: wire["message"].as_str().unwrap().to_owned(),
        code: wire["code"].as_u64().unwrap() as u16,
        details: wire.get("data").cloned(),
    };
    (&&&&&ServerFnDecoder::<Result<()>>::new())
        .decode_client_err(Ok(Err(decoded)))
        .await
        .unwrap_err()
}

#[tokio::test]
async fn rpc_error_refusals_reach_the_client_with_status_and_message_intact() {
    use db::cross_format::CrossFormatError as E;
    for (error, code) in [
        (E::LinkRequired, CrossFormatErrorCode::LinkRequired),
        (E::AudioSetMismatch, CrossFormatErrorCode::AudioSetMismatch),
        (
            E::CounterpartMissing,
            CrossFormatErrorCode::CounterpartMissing,
        ),
    ] {
        let message = error.to_string();
        let decoded = round_trip(rpc_error("declare sync point", error)).await;
        assert!(
            matches!(
                decoded.downcast_ref::<ServerFnError>(),
                Some(ServerFnError::ServerError { code: c, message: m, .. })
                    if *c == code.status() && *m == message
            ),
            "{code:?} decoded as {decoded:?}"
        );
    }
}

#[tokio::test]
async fn rpc_error_link_refusal_classifies_as_link_required_after_decoding() {
    let error = rpc_error(
        "declare sync point",
        db::cross_format::CrossFormatError::LinkRequired,
    );
    assert!(matches!(
        classify_sync_point_err(round_trip(error).await),
        SyncPointError::LinkRequired
    ));
}

#[tokio::test]
async fn rpc_error_other_refusals_classify_with_their_message_after_decoding() {
    let error = rpc_error(
        "declare sync point",
        db::cross_format::CrossFormatError::CounterpartMissing,
    );
    let message = db::cross_format::CrossFormatError::CounterpartMissing.to_string();
    assert!(matches!(
        classify_sync_point_err(round_trip(error).await),
        SyncPointError::Other(DataError::Other(m)) if m == message
    ));
}

#[test]
fn rpc_error_sanitizes_database_failures_without_a_refusal_code() {
    let error = rpc_error(
        "declare sync point",
        db::cross_format::CrossFormatError::Sqlx(sqlx::Error::PoolClosed),
    );
    assert!(matches!(error, ServerFnError::ServerError {
        code: 500, details: None, message,
    } if message == "internal server error"));
}
