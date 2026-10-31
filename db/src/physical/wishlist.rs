//! CRUD for the per-user physical wishlist, plus the household reads over every reader's.
//! Orthogonal to digital ownership: a user can wishlist a book whose EPUB they already
//! have. Unique per `(user_id, book_uuid)`, so re-wishlisting is idempotent.

use std::collections::HashMap;

use omnibus_shared::physical::{
    WishlistBook, WishlistEntry, WishlistHolding, WishlistReader, WishlistReaders, WishlistRemoval,
    WishlistSource, WishlistWanter,
};
use omnibus_shared::EbookMetadata;
use sqlx::{Row, SqlitePool, Transaction};

use super::{PhysicalError, PHYSICAL_LIBRARY_PATH};
use crate::books::{
    get_books_by_ids_projected, resolve_canonical_book_uuid, resolve_canonical_book_uuid_exec,
    Projection,
};
use crate::helpers::ids_json;
use crate::stats::AUDIO_FORMATS;

/// Hard cap on how many entries `list_wishlist` returns for a single user.
/// Practical usage stays well under this; the cap exists so a pathological
/// or automated wishlist pipeline can't produce an unbounded REST response,
/// mirroring `bookmarks::LIST_BOOKMARKS_LIMIT`.
pub const LIST_WISHLIST_LIMIT: i64 = 1_000;

/// A `wishlist_entries` row as read back from the DB, in column order.
type WishlistRow = (i64, i64, String, i64, String);

/// Map a DB row to a wire entry. The `source` column is CHECK-constrained to a
/// known value, so a parse miss can only mean corruption — fall back to
/// `Manual` rather than propagate an error the caller can't act on.
fn map_entry(r: WishlistRow) -> WishlistEntry {
    WishlistEntry {
        id: r.0,
        user_id: r.1,
        book_uuid: r.2,
        added_at: r.3,
        source: WishlistSource::from_db(&r.4).unwrap_or(WishlistSource::Manual),
    }
}

/// Add a book to a user's wishlist, returning the entry. The uuid is folded to
/// canonical `books.uuid` (honoring `merged_uuids`) so uniqueness holds across a
/// merge; an unresolvable uuid returns [`PhysicalError::BookNotFound`].
/// Idempotent: a second add for the same `(user_id, canonical uuid)` returns the
/// existing row unchanged.
pub async fn add_wishlist_entry(
    pool: &SqlitePool,
    user_id: i64,
    book_uuid: &str,
    source: WishlistSource,
) -> Result<WishlistEntry, PhysicalError> {
    let mut tx = pool.begin().await?;
    let entry = add_wishlist_entry_in_tx(&mut tx, user_id, book_uuid, source).await?;
    tx.commit().await?;
    Ok(entry)
}

/// [`add_wishlist_entry`] on the caller's transaction, so a book created in the
/// same commit and its wishlist entry land together or not at all.
pub(crate) async fn add_wishlist_entry_in_tx(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    user_id: i64,
    book_uuid: &str,
    source: WishlistSource,
) -> Result<WishlistEntry, PhysicalError> {
    let canonical = resolve_canonical_book_uuid_exec(&mut **tx, book_uuid)
        .await?
        .ok_or(PhysicalError::BookNotFound)?;

    // ON CONFLICT ... DO UPDATE (a no-op self-assign) so RETURNING yields the
    // surviving row on both insert and conflict — a bare DO NOTHING returns no
    // row on conflict.
    let row = sqlx::query_as::<_, WishlistRow>(
        "INSERT INTO wishlist_entries (user_id, book_uuid, source)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id, book_uuid) DO UPDATE SET user_id = user_id
         RETURNING id, user_id, book_uuid, added_at, source",
    )
    .bind(user_id)
    .bind(&canonical)
    .bind(source.as_str())
    .fetch_one(&mut **tx)
    .await?;
    Ok(map_entry(row))
}

/// Remove a book from a user's wishlist. A no-op (not an error) when absent or
/// when the uuid is unresolvable. The uuid is folded to canonical first, so a
/// `merged_uuids` key still deletes the surviving book's row. The last entry
/// also purges a book that existed only to be wanted (fileless, no copy, no
/// other reader's entry), via [`super::delete_fileless_book`]'s sweep.
pub async fn remove_wishlist_entry(
    pool: &SqlitePool,
    user_id: i64,
    book_uuid: &str,
) -> Result<WishlistRemoval, PhysicalError> {
    let Some(canonical) = resolve_canonical_book_uuid(pool, book_uuid).await? else {
        return Ok(WishlistRemoval::default());
    };
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM wishlist_entries WHERE user_id = ?1 AND book_uuid = ?2")
        .bind(user_id)
        .bind(&canonical)
        .execute(&mut *tx)
        .await?;

    // Purged only under the physical pseudo-root (`l.path = ?2`); a ghosted
    // library book (file gone, root real) is the reindex's to retain.
    let orphan: Option<i64> = sqlx::query_scalar(
        "SELECT b.id FROM books b
           JOIN scan_roots l ON l.id = b.library_id
          WHERE b.uuid = ?1
            AND l.path = ?2
            AND NOT EXISTS (SELECT 1 FROM book_files bf WHERE bf.book_id = b.id)
            AND NOT EXISTS (SELECT 1 FROM physical_copies pc WHERE pc.book_uuid = b.uuid)
            AND NOT EXISTS (SELECT 1 FROM wishlist_entries we WHERE we.book_uuid = b.uuid)",
    )
    .bind(&canonical)
    .bind(PHYSICAL_LIBRARY_PATH)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(book_id) = orphan else {
        tx.commit().await?;
        return Ok(WishlistRemoval::default());
    };

    let images = crate::deletion::purge::purge_book(&mut tx, book_id, &canonical)
        .await
        .map_err(super::remove::map_delete_error)?;
    tx.commit().await?;

    super::remove::discard_cover_files(canonical).await;
    crate::journals::cleanup_orphaned_images(pool, images.into_iter().collect()).await;
    Ok(WishlistRemoval { book_deleted: true })
}

/// Fetch one user's wishlist entry for a book, or `None` when it isn't
/// wishlisted. Folds the uuid to canonical first, matching [`add_wishlist_entry`]
/// — book detail calls this to decide between the "Add to physical wishlist"
/// action and the tracking card.
pub async fn get_wishlist_entry(
    pool: &SqlitePool,
    user_id: i64,
    book_uuid: &str,
) -> Result<Option<WishlistEntry>, PhysicalError> {
    let Some(canonical) = resolve_canonical_book_uuid(pool, book_uuid).await? else {
        return Ok(None);
    };
    let row = sqlx::query_as::<_, WishlistRow>(
        "SELECT id, user_id, book_uuid, added_at, source
           FROM wishlist_entries
          WHERE user_id = ?1 AND book_uuid = ?2",
    )
    .bind(user_id)
    .bind(&canonical)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(map_entry))
}

/// List a user's wishlist, newest first, capped at [`LIST_WISHLIST_LIMIT`].
pub async fn list_wishlist(
    pool: &SqlitePool,
    user_id: i64,
) -> Result<Vec<WishlistEntry>, PhysicalError> {
    let rows = sqlx::query_as::<_, WishlistRow>(
        "SELECT id, user_id, book_uuid, added_at, source
           FROM wishlist_entries
          WHERE user_id = ?1
          ORDER BY added_at DESC, id DESC
          LIMIT ?2",
    )
    .bind(user_id)
    .bind(LIST_WISHLIST_LIMIT)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(map_entry).collect())
}

/// Whose wishlist [`wishlist_books`] reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WishlistScope {
    /// One reader's own entries.
    Reader(i64),
    /// Every reader's entries, merged into one row per book.
    Everyone,
}

/// Every reader, the caller first then the rest by name, with how many books each wants,
/// and how many distinct books anyone wants. Entries whose book is gone count nowhere,
/// so a count always equals the length of the list it opens.
pub async fn wishlist_readers(
    pool: &SqlitePool,
    caller_id: i64,
) -> Result<WishlistReaders, PhysicalError> {
    let rows = sqlx::query(
        "SELECT u.id AS id, COALESCE(u.display_name, u.username) AS name,
                EXISTS(SELECT 1 FROM user_avatars a WHERE a.user_id = u.id) AS has_avatar,
                (u.id = ?1) AS is_you,
                (SELECT COUNT(*) FROM wishlist_entries we
                   JOIN books b ON b.uuid = we.book_uuid
                  WHERE we.user_id = u.id) AS count
         FROM users u
         ORDER BY is_you DESC, name COLLATE dictionary, u.id",
    )
    .bind(caller_id)
    .fetch_all(pool)
    .await?;
    let everyone: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT b.id) FROM wishlist_entries we
           JOIN books b ON b.uuid = we.book_uuid",
    )
    .fetch_one(pool)
    .await?;

    let readers = rows
        .iter()
        .map(|row| WishlistReader {
            id: row.get("id"),
            name: row.get("name"),
            has_avatar: row.get::<i64, _>("has_avatar") != 0,
            is_you: row.get::<i64, _>("is_you") != 0,
            count: row.get("count"),
        })
        .collect();
    Ok(WishlistReaders { everyone, readers })
}

/// The wishlisted books of `scope`, newest add first, capped at [`LIST_WISHLIST_LIMIT`].
/// `Reader` for an id no user has is [`PhysicalError::UserNotFound`].
pub async fn wishlist_books(
    pool: &SqlitePool,
    scope: WishlistScope,
) -> Result<Vec<WishlistBook>, PhysicalError> {
    let reader = match scope {
        WishlistScope::Reader(id) => {
            let known: Option<i64> = sqlx::query_scalar("SELECT id FROM users WHERE id = ?1")
                .bind(id)
                .fetch_optional(pool)
                .await?;
            known.ok_or(PhysicalError::UserNotFound)?;
            Some(id)
        }
        WishlistScope::Everyone => None,
    };

    // NULL reader matches every entry, so both scopes share each query below.
    let ranked: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT b.id, MAX(we.added_at) AS added_at
           FROM wishlist_entries we
           JOIN books b ON b.uuid = we.book_uuid
          WHERE (?1 IS NULL OR we.user_id = ?1)
          GROUP BY b.id
          ORDER BY added_at DESC, MAX(we.id) DESC
          LIMIT ?2",
    )
    .bind(reader)
    .bind(LIST_WISHLIST_LIMIT)
    .fetch_all(pool)
    .await?;
    let ids: Vec<i64> = ranked.iter().map(|(id, _)| *id).collect();
    let ids_param = ids_json(&ids);

    let mut books: HashMap<i64, EbookMetadata> =
        get_books_by_ids_projected(pool, &ids, Projection::List)
            .await?
            .into_iter()
            .map(|book| (book.id, book))
            .collect();
    let mut wanters = wanters_by_book(pool, &ids_param, reader).await?;
    let mut holdings = holdings_by_book(pool, &ids_param).await?;

    Ok(ranked
        .into_iter()
        .filter_map(|(id, added_at)| {
            Some(WishlistBook {
                book: books.remove(&id)?,
                added_at,
                wanted_by: wanters.remove(&id).unwrap_or_default(),
                holdings: holdings.remove(&id).unwrap_or_default(),
            })
        })
        .collect())
}

/// Who wants each book in `ids_json`, by name. `reader` narrows it to one reader.
async fn wanters_by_book(
    pool: &SqlitePool,
    ids_json: &str,
    reader: Option<i64>,
) -> Result<HashMap<i64, Vec<WishlistWanter>>, PhysicalError> {
    let rows: Vec<(i64, i64, String)> = sqlx::query_as(
        "SELECT b.id, u.id, COALESCE(u.display_name, u.username) AS name
           FROM wishlist_entries we
           JOIN books b ON b.uuid = we.book_uuid
           JOIN users u ON u.id = we.user_id
          WHERE b.id IN (SELECT value FROM json_each(?1))
            AND (?2 IS NULL OR we.user_id = ?2)
          ORDER BY name COLLATE dictionary, u.id",
    )
    .bind(ids_json)
    .bind(reader)
    .fetch_all(pool)
    .await?;
    let mut by_book: HashMap<i64, Vec<WishlistWanter>> = HashMap::new();
    for (book_id, id, name) in rows {
        by_book
            .entry(book_id)
            .or_default()
            .push(WishlistWanter { id, name });
    }
    Ok(by_book)
}

/// What the library holds of each book in `ids_json`: a count per digital format, alphabetically,
/// then the physical copies as `PRINT`. A kind with none is absent, and a multi-part audiobook
/// counts once.
async fn holdings_by_book(
    pool: &SqlitePool,
    ids_json: &str,
) -> Result<HashMap<i64, Vec<WishlistHolding>>, PhysicalError> {
    // The parts of one audiobook are many rows in one folder, so an audio format counts folders;
    // anything else counts files.
    let editions = format!(
        "CASE WHEN UPPER(format) IN {AUDIO_FORMATS}
              THEN COUNT(DISTINCT rtrim(COALESCE(path, ''), replace(COALESCE(path, ''), '/', '')))
              ELSE COUNT(*) END"
    );
    let rows: Vec<(i64, String, i64)> = sqlx::query_as(&format!(
        "SELECT book_id, format, n FROM (
             SELECT book_id, UPPER(format) AS format,
                    {editions} AS n, 0 AS kind
               FROM book_files
              WHERE book_id IN (SELECT value FROM json_each(?1))
              GROUP BY book_id, UPPER(format)
             UNION ALL
             SELECT b.id, 'PRINT', COUNT(*), 1
               FROM physical_copies pc
               JOIN books b ON b.uuid = pc.book_uuid
              WHERE b.id IN (SELECT value FROM json_each(?1))
              GROUP BY b.id
         ) ORDER BY book_id, kind, format"
    ))
    .bind(ids_json)
    .fetch_all(pool)
    .await?;
    let mut by_book: HashMap<i64, Vec<WishlistHolding>> = HashMap::new();
    for (book_id, format, count) in rows {
        by_book
            .entry(book_id)
            .or_default()
            .push(WishlistHolding { format, count });
    }
    Ok(by_book)
}
