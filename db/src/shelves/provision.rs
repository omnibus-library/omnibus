//! Provisioning the built-in per-user Wishlist shelf: one public, locked,
//! `wishlist_entries`-backed shelf per user. Migration `0047` seeds existing
//! users; [`provision_wishlist_shelves`] re-runs on boot and
//! [`provision_wishlist_shelf`] runs inline in `create_user` — both idempotent.

use sqlx::{Executor, Sqlite, SqlitePool};

use super::ShelfError;

/// Appended to the owner's display name (or username, when unset) for the
/// Wishlist shelf name (`alice` → `alice's Wishlist`). The composed name is
/// denormalized into `shelves.name`, so `db::auth::set_display_name` re-derives
/// it whenever the display name changes; both must use the same expression.
pub(crate) const WISHLIST_NAME_SUFFIX: &str = "'s Wishlist";

/// Ensure one user has a Wishlist shelf. Idempotent and race-safe: a `WHERE NOT
/// EXISTS` guard skips the common case, and `INSERT OR IGNORE` lets the
/// `idx_shelves_owner_wishlist` partial-unique index absorb a concurrent
/// double-provision. Takes any executor, but the `users` row must be visible to it
/// (`create_user` passes its registration tx); otherwise it silently inserts nothing.
pub async fn provision_wishlist_shelf<'e, E>(exec: E, user_id: i64) -> Result<(), ShelfError>
where
    E: Executor<'e, Database = Sqlite>,
{
    sqlx::query(
        "INSERT OR IGNORE INTO shelves (owner_user_id, kind, name, visibility)
         SELECT u.id, 'wishlist', COALESCE(u.display_name, u.username) || ?2, 'public'
           FROM users u
          WHERE u.id = ?1
            AND NOT EXISTS (
              SELECT 1 FROM shelves WHERE owner_user_id = ?1 AND kind = 'wishlist'
          )",
    )
    .bind(user_id)
    .bind(WISHLIST_NAME_SUFFIX)
    .execute(exec)
    .await?;
    Ok(())
}

/// Boot backfill: provision a Wishlist shelf for every user missing one. A
/// no-op once caught up, so it runs on every `init_db`. `INSERT OR IGNORE` keeps
/// it race-safe against a concurrent `create_user` on a multi-instance boot.
pub async fn provision_wishlist_shelves(pool: &SqlitePool) -> Result<(), ShelfError> {
    sqlx::query(
        "INSERT OR IGNORE INTO shelves (owner_user_id, kind, name, visibility)
         SELECT id, 'wishlist', COALESCE(display_name, username) || ?1, 'public' FROM users
          WHERE NOT EXISTS (
              SELECT 1 FROM shelves s WHERE s.owner_user_id = users.id AND s.kind = 'wishlist'
          )",
    )
    .bind(WISHLIST_NAME_SUFFIX)
    .execute(pool)
    .await?;
    Ok(())
}
