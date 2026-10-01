//! Physical-collection server functions for book detail: a book's library-wide
//! copies, the caller's wishlist entry, and fileless-book removal. Mobile uses
//! the analogous REST routes in `server::backend::physical`.

use dioxus::fullstack::post;
use dioxus::prelude::*;
#[cfg(feature = "server")]
use omnibus_db as db;
use omnibus_shared::physical::{PhysicalCopy, WishlistEntry, WishlistRemoval};
// Only the server-side body names the source; the client half never sees it.
#[cfg(feature = "server")]
use omnibus_shared::physical::WishlistSource;
// Only the server-side body constructs one to reuse its `validate()`.
#[cfg(feature = "server")]
use omnibus_shared::physical::UpdateCopyNoteRequest;

#[cfg(feature = "server")]
use super::{internal_rpc_error, AuthUser, PoolExt};

/// Map a data-layer error onto the wire. Only the cases book detail can act on
/// get a typed message; the rest collapse to an opaque internal error.
#[cfg(feature = "server")]
fn map_physical_error(context: &'static str, e: db::PhysicalError) -> ServerFnError {
    match e {
        db::PhysicalError::BookNotFound => ServerFnError::new("book not found"),
        db::PhysicalError::CopyNotFound => ServerFnError::new("physical copy not found"),
        db::PhysicalError::NotCopyOwner => ServerFnError::ServerError {
            message: "not your copy".into(),
            code: 403,
            details: None,
        },
        db::PhysicalError::BookHasFiles => {
            ServerFnError::new("book still has files; remove them first")
        }
        other => internal_rpc_error(context, other),
    }
}

/// Reject a caller without `can_edit`. Deleting a fileless book removes it for
/// every user — same gate as the metadata-override writes. (A copy's own
/// writes are gated on ownership in the data layer instead.)
#[cfg(feature = "server")]
fn require_edit(user: &AuthUser) -> Result<(), ServerFnError> {
    if !user.is_admin && !user.can_edit {
        return Err(ServerFnError::new("edit permission required"));
    }
    Ok(())
}

/// A book's physical copies, oldest check-in first. An unknown uuid has none.
// `_user` is bound purely to gate the call on a session; the read itself is
// library-wide, not per-user.
#[post("/api/rpc/physical/copies", pool: PoolExt, _user: AuthUser)]
pub async fn rpc_list_physical_copies(uuid: String) -> Result<Vec<PhysicalCopy>> {
    Ok(db::list_physical_copies(&pool.0, &uuid)
        .await
        .map_err(|e| map_physical_error("list physical copies", e))?)
}

/// Replace a copy's free-text note, returning the updated copy. A blank note
/// clears it. Refused unless the caller filed the copy or is an admin.
#[post("/api/rpc/physical/copies/note", pool: PoolExt, user: AuthUser)]
pub async fn rpc_update_physical_copy_note(
    copy_id: i64,
    note: Option<String>,
) -> Result<PhysicalCopy> {
    let req = UpdateCopyNoteRequest { note };
    if let Err(msg) = req.validate() {
        return Err(ServerFnError::new(msg).into());
    }
    let note = req.note.as_deref();
    Ok(
        db::update_physical_copy_note(&pool.0, copy_id, user.id, user.is_admin, note)
            .await
            .map_err(|e| map_physical_error("update physical copy note", e))?,
    )
}

/// Delete one physical copy ("I sold it"). Refused unless the caller filed
/// the copy or is an admin.
#[post("/api/rpc/physical/copies/delete", pool: PoolExt, user: AuthUser)]
pub async fn rpc_delete_physical_copy(copy_id: i64) -> Result<()> {
    Ok(
        db::delete_physical_copy(&pool.0, copy_id, user.id, user.is_admin)
            .await
            .map_err(|e| map_physical_error("delete physical copy", e))?,
    )
}

/// The caller's wishlist entry for a book, or `None` when not wishlisted.
#[post("/api/rpc/physical/wishlist/get", pool: PoolExt, user: AuthUser)]
pub async fn rpc_get_wishlist_entry(uuid: String) -> Result<Option<WishlistEntry>> {
    Ok(db::get_wishlist_entry(&pool.0, user.id, &uuid)
        .await
        .map_err(|e| map_physical_error("get wishlist entry", e))?)
}

/// Add a book to the caller's wishlist from its detail page. Idempotent — a
/// second add returns the existing entry unchanged.
#[post("/api/rpc/physical/wishlist/add", pool: PoolExt, user: AuthUser)]
pub async fn rpc_add_wishlist_entry(uuid: String) -> Result<WishlistEntry> {
    Ok(
        db::add_wishlist_entry(&pool.0, user.id, &uuid, WishlistSource::Detail)
            .await
            .map_err(|e| map_physical_error("add wishlist entry", e))?,
    )
}

/// Remove a book from the caller's wishlist. A no-op when absent. Reports
/// whether the book itself went with the entry — a wishlist-only book nobody
/// else wants has no reason left to exist, and the page needs to leave it.
#[post("/api/rpc/physical/wishlist/remove", pool: PoolExt, user: AuthUser)]
pub async fn rpc_remove_wishlist_entry(uuid: String) -> Result<WishlistRemoval> {
    Ok(db::remove_wishlist_entry(&pool.0, user.id, &uuid)
        .await
        .map_err(|e| map_physical_error("remove wishlist entry", e))?)
}

/// Delete a fileless book outright — the "remove it entirely" branch of the
/// last-copy prompt. Errors when the book still has digital files.
#[post("/api/rpc/physical/book/delete", pool: PoolExt, user: AuthUser)]
pub async fn rpc_delete_fileless_book(uuid: String) -> Result<()> {
    require_edit(&user)?;
    Ok(db::delete_fileless_book(&pool.0, &uuid)
        .await
        .map_err(|e| map_physical_error("delete fileless book", e))?)
}

// `server`-gated: exercises the `is_admin || can_edit` gate and the ownership
// refusal's mapping directly, no DB needed. CI runs this via
// `cargo test -p omnibus-frontend --features server`.
#[cfg(all(test, feature = "server"))]
mod tests {
    use super::{db, map_physical_error, require_edit, AuthUser, ServerFnError};

    fn auth_user(is_admin: bool, can_edit: bool) -> AuthUser {
        AuthUser {
            id: 1,
            is_admin,
            can_edit,
            session_id: 0,
        }
    }

    #[test]
    fn require_edit_allows_an_admin_without_the_can_edit_flag() {
        let user = auth_user(true, false);
        assert!(require_edit(&user).is_ok());
    }

    #[test]
    fn require_edit_allows_a_non_admin_with_can_edit() {
        let user = auth_user(false, true);
        assert!(require_edit(&user).is_ok());
    }

    #[test]
    fn require_edit_denies_a_non_admin_without_can_edit() {
        let user = auth_user(false, false);
        let err = require_edit(&user).unwrap_err();
        assert!(err.to_string().contains("edit permission required"));
    }

    #[test]
    fn map_physical_error_answers_a_non_owner_with_a_403() {
        match map_physical_error("delete physical copy", db::PhysicalError::NotCopyOwner) {
            ServerFnError::ServerError { message, code, .. } => {
                assert_eq!(code, 403);
                assert!(message.contains("not your copy"), "got: {message}");
            }
            other => panic!("expected ServerError, got {other:?}"),
        }
    }
}
