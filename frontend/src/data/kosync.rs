//! KOReader progress-sync password data access. Web/SSR-only — the Settings card has no mobile
//! surface, so it calls the `rpc_*kosync*` server functions directly, like `kobo`.
#![cfg(not(feature = "mobile"))]

use omnibus_shared::{KosyncPassword, KosyncStatus};

use super::{note_server_fn_err, DataError};

/// Whether the caller has generated a progress-sync password.
pub async fn kosync_status(_server_url: &str) -> Result<KosyncStatus, DataError> {
    crate::rpc::rpc_kosync_status()
        .await
        .map_err(note_server_fn_err)
}

/// Generate a new progress-sync password, replacing any earlier one.
pub async fn generate_kosync_password(_server_url: &str) -> Result<KosyncPassword, DataError> {
    crate::rpc::rpc_generate_kosync_password()
        .await
        .map_err(note_server_fn_err)
}
