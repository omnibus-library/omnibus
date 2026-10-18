//! Boot-time admin hooks: two opt-in env-driven functions run at server
//! startup. See [`apply_initial_admin`] (account-recovery promotion) and
//! [`seed_dev_user`] (dev-only admin and Kobo shelf seeding) for the env vars
//! and gating each reads.

use anyhow::Context;
use omnibus_db::ShelfError;
use omnibus_shared::{
    CreateShelfRequest, MatchMode, RuleField, RuleOp, ShelfKind, ShelfRule, UpdateShelfRequest,
    Visibility,
};
use sqlx::SqlitePool;

/// Read `OMNIBUS_INITIAL_ADMIN` and promote the named user (if present) to
/// admin. No-op when the env var is unset or the named user doesn't exist.
pub async fn apply_initial_admin(pool: &SqlitePool) -> Result<(), omnibus_db::auth::AuthError> {
    let Ok(username) = std::env::var("OMNIBUS_INITIAL_ADMIN") else {
        return Ok(());
    };
    let username = username.trim();
    if username.is_empty() {
        return Ok(());
    }
    let promoted = omnibus_db::auth::promote_to_admin(pool, username).await?;
    if promoted {
        tracing::warn!(
            user = username,
            "OMNIBUS_INITIAL_ADMIN promoted user to admin (recovery hook)"
        );
    } else {
        tracing::warn!(
            user = username,
            "OMNIBUS_INITIAL_ADMIN set but user does not exist; no promotion performed"
        );
    }
    Ok(())
}

/// Read `OMNIBUS_DEV_SEED_USER=<username>:<password>` and create that user as an
/// admin with a Kobo-synced shelf of every Kobo-readable book. No-op in release
/// builds, when the variable is unset, malformed or has empty halves, or when the
/// user already exists.
pub async fn seed_dev_user(pool: &SqlitePool) -> anyhow::Result<()> {
    // Release builds must not provision admin credentials from env, even
    // if OMNIBUS_DEV_SEED_USER is somehow set. We additionally warn so a
    // misconfigured deploy is visible in the logs.
    if !cfg!(debug_assertions) {
        if std::env::var_os("OMNIBUS_DEV_SEED_USER").is_some() {
            tracing::warn!(
                "OMNIBUS_DEV_SEED_USER is set in a release build; ignoring (dev-only hook)"
            );
        }
        return Ok(());
    }

    let Ok(raw) = std::env::var("OMNIBUS_DEV_SEED_USER") else {
        return Ok(());
    };
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(());
    }
    let Some((username, password)) = raw.split_once(':') else {
        tracing::warn!("OMNIBUS_DEV_SEED_USER is malformed; expected username:password, ignoring");
        return Ok(());
    };
    let username = username.trim();
    if username.is_empty() || password.is_empty() {
        tracing::warn!("OMNIBUS_DEV_SEED_USER has an empty username or password; ignoring");
        return Ok(());
    }

    if omnibus_db::auth::get_user_by_username(pool, username)
        .await?
        .is_some()
    {
        tracing::debug!(
            user = username,
            "OMNIBUS_DEV_SEED_USER already exists; no-op"
        );
        return Ok(());
    }

    // create_user gates on registration_enabled, which flips to false
    // after the first user exists. Snapshot the current value, flip on
    // for the insert, then restore — so seeding doesn't accidentally
    // re-open registration in a half-bootstrapped DB.
    let prior_registration = omnibus_db::auth::registration_enabled(pool).await?;
    omnibus_db::auth::set_registration_enabled(pool, true).await?;
    let create_result = omnibus_db::auth::create_user(pool, username, password).await;
    // Restore the prior flag whether the insert succeeded or not. We
    // ignore restore errors so they don't mask a more useful create_user
    // error — surfacing the underlying failure matters more than a
    // best-effort restore.
    let _ = omnibus_db::auth::set_registration_enabled(pool, prior_registration).await;
    let user = create_result?;

    let promoted = omnibus_db::auth::promote_to_admin(pool, username).await?;
    if !promoted {
        tracing::warn!(
            user = username,
            "OMNIBUS_DEV_SEED_USER created user but promote_to_admin did not update a row"
        );
    }
    tracing::warn!(
        user = username,
        "OMNIBUS_DEV_SEED_USER created admin user (dev seed hook)"
    );
    seed_kobo_shelf(pool, user.id)
        .await
        .context("OMNIBUS_DEV_SEED_USER: seeding the admin's Kobo library shelf")?;
    Ok(())
}

/// Give `owner_id` a smart shelf of every EPUB, CBZ and PDF with Kobo sync on.
/// Those are the formats `DOWNLOADABLE_PREDICATE` in `db::kobo` lets a Kobo download.
async fn seed_kobo_shelf(pool: &SqlitePool, owner_id: i64) -> Result<(), ShelfError> {
    let includes_format = |value: &str| ShelfRule {
        field: RuleField::Format,
        op: RuleOp::Includes,
        value: value.into(),
    };
    let request = CreateShelfRequest {
        kind: ShelfKind::Smart,
        name: "Kobo library".into(),
        description: None,
        visibility: Visibility::Private,
        match_mode: Some(MatchMode::Any),
        rules: ["EPUB", "CBZ", "PDF"].map(includes_format).to_vec(),
        book_uuids: vec![],
    };
    let shelf = omnibus_db::shelves::create_shelf(pool, owner_id, &request).await?;
    let sync = UpdateShelfRequest {
        sync_to_kobo: Some(true),
        ..Default::default()
    };
    omnibus_db::shelves::update_shelf(pool, shelf.id, &sync).await?;
    Ok(())
}

#[cfg(test)]
mod tests;
