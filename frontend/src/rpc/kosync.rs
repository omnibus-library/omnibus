//! Per-user KOReader progress-sync password server functions: read whether one exists and
//! generate a new one for the Settings card. Scoped to the authenticated `AuthUser`.

use dioxus::fullstack::post;
use dioxus::prelude::*;
use omnibus_shared::{KosyncPassword, KosyncStatus};

#[cfg(feature = "server")]
use omnibus_db as db;

#[cfg(feature = "server")]
use super::{internal_rpc_error, AuthUser, PoolExt};

/// Whether the caller has generated a KOReader progress-sync password.
#[post("/api/rpc/kosync/status", pool: PoolExt, user: AuthUser)]
pub async fn rpc_kosync_status() -> Result<KosyncStatus> {
    match db::kosync::kosync_configured(&pool.0, user.id).await {
        Ok(configured) => Ok(KosyncStatus { configured }),
        Err(e) => Err(internal_rpc_error("read kosync status", e).into()),
    }
}

/// Generate the caller's progress-sync password, replacing any earlier one. The only time it
/// is returned.
#[post("/api/rpc/kosync/generate", pool: PoolExt, user: AuthUser)]
pub async fn rpc_generate_kosync_password() -> Result<KosyncPassword> {
    let password = db::kosync::generate_kosync_password(&pool.0, user.id)
        .await
        .map_err(|e| internal_rpc_error("generate kosync password", e))?;
    match db::auth::get_user_by_id(&pool.0, user.id).await {
        Ok(Some(account)) => Ok(KosyncPassword {
            username: account.username,
            password,
        }),
        Ok(None) => Err(ServerFnError::new("account not found").into()),
        Err(e) => Err(internal_rpc_error("look up username", e).into()),
    }
}
