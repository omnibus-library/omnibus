//! Alignment + link transport. Web/SSR goes straight to the RPCs — these
//! writes are configuration-shaped (rule 08) and never queue. The hybrid
//! mobile shell has no alignment surface, so its arms are deliberate
//! error stubs, mirroring `merge_books`.

use omnibus_shared::{AlignmentView, ConfirmCrossFormatLink};

#[cfg(not(feature = "mobile"))]
use super::note_server_fn_err;
use super::DataError;

/// Fetch the alignment payload for one book.
#[cfg(not(feature = "mobile"))]
pub async fn get_alignment(_server_url: &str, uuid: &str) -> Result<AlignmentView, DataError> {
    crate::rpc::rpc_get_alignment(uuid.to_string())
        .await
        .map_err(note_server_fn_err)
}

/// Confirm (or re-confirm) the cross-format link.
#[cfg(not(feature = "mobile"))]
pub async fn confirm_cross_format_link(
    _server_url: &str,
    update: ConfirmCrossFormatLink,
) -> Result<(), DataError> {
    crate::rpc::rpc_confirm_cross_format_link(update)
        .await
        .map_err(note_server_fn_err)
}

/// Turn sync off for one book.
#[cfg(not(feature = "mobile"))]
pub async fn unlink_cross_format(_server_url: &str, uuid: &str) -> Result<bool, DataError> {
    crate::rpc::rpc_unlink_cross_format(uuid.to_string())
        .await
        .map_err(note_server_fn_err)
}

/// The hybrid shell has no alignment surface — native iOS owns it there.
#[cfg(feature = "mobile")]
pub async fn get_alignment(_server_url: &str, _uuid: &str) -> Result<AlignmentView, DataError> {
    Err(DataError::Other(
        "alignment is not available in the mobile shell".into(),
    ))
}

#[cfg(feature = "mobile")]
pub async fn confirm_cross_format_link(
    _server_url: &str,
    _update: ConfirmCrossFormatLink,
) -> Result<(), DataError> {
    Err(DataError::Other(
        "alignment is not available in the mobile shell".into(),
    ))
}

#[cfg(feature = "mobile")]
pub async fn unlink_cross_format(_server_url: &str, _uuid: &str) -> Result<bool, DataError> {
    Err(DataError::Other(
        "alignment is not available in the mobile shell".into(),
    ))
}

/// Why a "synced here" declaration failed, split so the surfaces can
/// route "link first" to the link affordance instead of a dead-end
/// generic failure.
#[derive(Debug)]
pub enum SyncPointError {
    /// No link yet and the book can't auto-link (several audio files) —
    /// the fix is confirming the alignment, not retrying.
    LinkRequired,
    /// Genuine failure: offline, server error, anything else.
    Other(DataError),
}

/// Read the refusal's status code before the general transport mapper
/// flattens the error to its message.
#[cfg(not(feature = "mobile"))]
pub fn classify_sync_point_err(e: dioxus::CapturedError) -> SyncPointError {
    use dioxus::fullstack::ServerFnError;
    use omnibus_shared::CrossFormatErrorCode;

    if let Some(ServerFnError::ServerError { code, .. }) = e.0.downcast_ref::<ServerFnError>() {
        if CrossFormatErrorCode::from_status(*code) == Some(CrossFormatErrorCode::LinkRequired) {
            return SyncPointError::LinkRequired;
        }
    }
    SyncPointError::Other(note_server_fn_err(e))
}

/// Declare a "synced here" sync point from the reader or player.
#[cfg(not(feature = "mobile"))]
pub async fn declare_sync_point(
    _server_url: &str,
    decl: omnibus_shared::cross_format::DeclareSyncPoint,
) -> Result<(), SyncPointError> {
    crate::rpc::rpc_declare_sync_point(decl)
        .await
        .map_err(classify_sync_point_err)
}

/// Map a [`declare_sync_point`] outcome to the label text both
/// `SyncHereButton` (listen) and `SyncHerePill` (reader) drive. Split out
/// from [`declare_sync_and_label`] so the mapping is unit-testable without
/// a network round trip.
#[cfg(not(feature = "mobile"))]
fn sync_point_label(result: Result<(), SyncPointError>) -> &'static str {
    match result {
        Ok(()) => "Synced \u{2713}",
        Err(SyncPointError::LinkRequired) => "Link formats first",
        Err(_) => "Sync failed",
    }
}

/// Run one "synced here" declaration and map its outcome to a label.
#[cfg(not(feature = "mobile"))]
pub async fn declare_sync_and_label(
    decl: omnibus_shared::cross_format::DeclareSyncPoint,
) -> &'static str {
    sync_point_label(declare_sync_point("", decl).await)
}

/// Flip follow mode on an existing link.
#[cfg(not(feature = "mobile"))]
pub async fn set_follow_mode(
    _server_url: &str,
    uuid: &str,
    enabled: bool,
) -> Result<(), DataError> {
    crate::rpc::rpc_set_follow_mode(
        uuid.to_string(),
        omnibus_shared::cross_format::SetFollowMode { enabled },
    )
    .await
    .map_err(note_server_fn_err)
}

#[cfg(feature = "mobile")]
pub async fn declare_sync_point(
    _server_url: &str,
    _decl: omnibus_shared::cross_format::DeclareSyncPoint,
) -> Result<(), SyncPointError> {
    Err(SyncPointError::Other(DataError::Other(
        "alignment is not available in the mobile shell".into(),
    )))
}

#[cfg(feature = "mobile")]
pub async fn set_follow_mode(
    _server_url: &str,
    _uuid: &str,
    _enabled: bool,
) -> Result<(), DataError> {
    Err(DataError::Other(
        "alignment is not available in the mobile shell".into(),
    ))
}

#[cfg(all(test, not(feature = "mobile")))]
mod tests;
