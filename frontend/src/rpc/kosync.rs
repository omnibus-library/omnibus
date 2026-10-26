//! Per-user KOReader progress-sync password server function: generate a new one for the
//! Settings KOReader card. Scoped to the authenticated `AuthUser`.

use dioxus::fullstack::post;
use dioxus::prelude::*;
use omnibus_shared::KosyncPassword;

#[cfg(feature = "server")]
use omnibus_db as db;

#[cfg(feature = "server")]
use super::{internal_rpc_error, AuthUser, PoolExt};

/// Generate the caller's progress-sync password, replacing any earlier one. The only time it
/// is returned.
#[post("/api/rpc/kosync/generate", pool: PoolExt, user: AuthUser)]
pub async fn rpc_generate_kosync_password() -> Result<KosyncPassword> {
    db::kosync::generate_kosync_password(&pool.0, user.id)
        .await
        .map_err(|e| internal_rpc_error("generate kosync password", e).into())
}
