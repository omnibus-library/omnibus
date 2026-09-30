//! CRUD for library-wide physical copies, plus wishlist fulfillment on
//! check-in. A copy is seen by all users (like a digital file) but belongs to
//! the reader who filed it: only they or an admin may re-note or remove it
//! ([`PhysicalCopy::can_change`], enforced here for REST, RPC and MCP alike).

use omnibus_shared::physical::PhysicalCopy;
use sqlx::SqlitePool;

use super::PhysicalError;
use crate::books::{resolve_canonical_book_uuid, resolve_canonical_book_uuid_exec};

/// A `physical_copies` row as read back from the DB, in [`COPY_COLUMNS`]
/// order: the stored columns, then the filer's display name.
type CopyRow = (
    i64,
    String,
    Option<String>,
    Option<i64>,
    i64,
    Option<String>,
    Option<String>,
);

/// The projection every read and `RETURNING` shares. The name is a scalar
/// subquery rather than a join so a `RETURNING` clause can carry it too.
const COPY_COLUMNS: &str = "id, book_uuid, isbn, added_by_user_id, checked_in_at, note,
    (SELECT COALESCE(u.display_name, u.username) FROM users u
      WHERE u.id = physical_copies.added_by_user_id)";

fn map_copy(r: CopyRow) -> PhysicalCopy {
    PhysicalCopy {
        id: r.0,
        book_uuid: r.1,
        isbn: r.2,
        added_by_user_id: r.3,
        added_by_name: r.6,
        checked_in_at: r.4,
        note: r.5,
        checked_in_at_iso: None,
    }
    .with_iso()
}

/// Check in a physical copy for a book, fulfilling every user's wishlist for it.
///
/// The uuid is folded to its canonical `books.uuid` (honoring `merged_uuids`)
/// before anything is written, so the stored copy and the wishlist sweep both
/// key on the same value the rest of the system uses; an unresolvable uuid
/// returns [`PhysicalError::BookNotFound`]. The insert and the sweep run in one
/// transaction, so a copy never lands without its fulfillment side effect.
pub async fn add_physical_copy(
    pool: &SqlitePool,
    book_uuid: &str,
    isbn: Option<&str>,
    added_by_user_id: Option<i64>,
    note: Option<&str>,
) -> Result<PhysicalCopy, PhysicalError> {
    let mut tx = pool.begin().await?;

    let canonical = resolve_canonical_book_uuid_exec(&mut *tx, book_uuid)
        .await?
        .ok_or(PhysicalError::BookNotFound)?;

    let row = sqlx::query_as::<_, CopyRow>(&format!(
        "INSERT INTO physical_copies (book_uuid, isbn, added_by_user_id, note)
         VALUES (?1, ?2, ?3, ?4)
         RETURNING {COPY_COLUMNS}"
    ))
    .bind(&canonical)
    .bind(isbn)
    .bind(added_by_user_id)
    .bind(note)
    .fetch_one(&mut *tx)
    .await?;

    // Fulfillment: a checked-in copy clears the book from EVERY user's wishlist.
    sqlx::query("DELETE FROM wishlist_entries WHERE book_uuid = ?1")
        .bind(&canonical)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(map_copy(row))
}

/// List a book's physical copies, oldest check-in first.
///
/// Folds the uuid to canonical first, so copies are found when the caller
/// passes a `merged_uuids` ledger key. An unresolvable uuid has no copies.
pub async fn list_physical_copies(
    pool: &SqlitePool,
    book_uuid: &str,
) -> Result<Vec<PhysicalCopy>, PhysicalError> {
    let Some(canonical) = resolve_canonical_book_uuid(pool, book_uuid).await? else {
        return Ok(Vec::new());
    };
    list_physical_copies_by_canonical_uuid_exec(pool, &canonical).await
}

/// Executor-generic counterpart to [`list_physical_copies`] for a uuid
/// already resolved to canonical, so a caller holding an open transaction
/// (e.g. book deletion's count-inside-the-tx fix) reads on the same
/// connection its writes will run on, without a second `merged_uuids`
/// resolution. Pass `&pool` for a standalone read or `&mut *tx` from within
/// a transaction.
pub async fn list_physical_copies_by_canonical_uuid_exec<'e, E>(
    executor: E,
    canonical_uuid: &str,
) -> Result<Vec<PhysicalCopy>, PhysicalError>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    let rows = sqlx::query_as::<_, CopyRow>(&format!(
        "SELECT {COPY_COLUMNS}
           FROM physical_copies
          WHERE book_uuid = ?1
          ORDER BY checked_in_at, id"
    ))
    .bind(canonical_uuid)
    .fetch_all(executor)
    .await?;
    Ok(rows.into_iter().map(map_copy).collect())
}

/// Load a copy and refuse `actor_id` unless [`PhysicalCopy::can_change`]
/// allows it — [`PhysicalError::CopyNotFound`] for an unknown id,
/// [`PhysicalError::NotCopyOwner`] for someone else's copy.
async fn copy_for_change<'e, E>(
    executor: E,
    copy_id: i64,
    actor_id: i64,
    is_admin: bool,
) -> Result<PhysicalCopy, PhysicalError>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    let copy = sqlx::query_as::<_, CopyRow>(&format!(
        "SELECT {COPY_COLUMNS} FROM physical_copies WHERE id = ?1"
    ))
    .bind(copy_id)
    .fetch_optional(executor)
    .await?
    .map(map_copy)
    .ok_or(PhysicalError::CopyNotFound)?;
    if copy.can_change(actor_id, is_admin) {
        Ok(copy)
    } else {
        Err(PhysicalError::NotCopyOwner)
    }
}

/// Replace a copy's free-text note on behalf of `actor_id`, returning the
/// updated row. `None` clears it. Errors as [`copy_for_change`] does.
pub async fn update_physical_copy_note(
    pool: &SqlitePool,
    copy_id: i64,
    actor_id: i64,
    is_admin: bool,
    note: Option<&str>,
) -> Result<PhysicalCopy, PhysicalError> {
    // Treat a blank note as a clear, so the UI's empty input doesn't persist an
    // empty string that renders as a stray blank line on the copy card.
    let note = note.map(str::trim).filter(|s| !s.is_empty());
    let mut tx = pool.begin().await?;
    copy_for_change(&mut *tx, copy_id, actor_id, is_admin).await?;
    let row = sqlx::query_as::<_, CopyRow>(&format!(
        "UPDATE physical_copies SET note = ?2 WHERE id = ?1 RETURNING {COPY_COLUMNS}"
    ))
    .bind(copy_id)
    .bind(note)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(map_copy(row))
}

/// Delete a single physical copy ("I sold it") on behalf of `actor_id`.
/// Errors as [`copy_for_change`] does.
pub async fn delete_physical_copy(
    pool: &SqlitePool,
    copy_id: i64,
    actor_id: i64,
    is_admin: bool,
) -> Result<(), PhysicalError> {
    let mut tx = pool.begin().await?;
    copy_for_change(&mut *tx, copy_id, actor_id, is_admin).await?;
    sqlx::query("DELETE FROM physical_copies WHERE id = ?1")
        .bind(copy_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}
