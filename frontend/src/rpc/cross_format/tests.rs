//! Cross-format RPC errors retain typed refusal details across Dioxus serialization.

use super::*;
use dioxus::fullstack::axum::body::to_bytes;
use dioxus::fullstack::magic::{MakeAxumError, ServerFnDecoder};

#[tokio::test]
async fn rpc_error_carries_refusals_as_structured_conflicts() {
    use db::cross_format::CrossFormatError as E;
    for (error, code) in [
        (E::LinkRequired, "link_required"),
        (E::AudioSetMismatch, "audio_set_mismatch"),
        (E::CounterpartMissing, "counterpart_missing"),
    ] {
        let message = error.to_string();
        let error = rpc_error("declare sync point", error);
        let decoder = ServerFnDecoder::<Result<()>>::new();
        let response = (&&decoder).make_axum_error(Err(error.into()));
        // Dioxus keeps CapturedError HTTP responses at 500; its client reads the payload code.
        assert_eq!(response.status(), 500);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let wire: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(wire["data"], code);
        assert_eq!(wire["message"], message);
        assert_eq!(wire["code"], 409);
    }
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
