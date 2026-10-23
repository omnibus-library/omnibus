//! What a KOReader progress-sync request names: the book behind a partial MD5 document id.
//! Called by the `/kosync` routes; the digests come from `book_files.partial_md5`.

use sqlx::SqlitePool;

/// The book a KOReader partial MD5 names, by an original EPUB file. `None` when no file
/// matches or the digest matches more than one book (never guess).
pub async fn resolve_document(pool: &SqlitePool, digest: &str) -> anyhow::Result<Option<String>> {
    let mut uuids: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT b.uuid FROM book_files bf JOIN books b ON b.id = bf.book_id \
         WHERE bf.partial_md5 = ? AND bf.format = 'EPUB' COLLATE NOCASE LIMIT 2",
    )
    .bind(digest)
    .fetch_all(pool)
    .await?;
    Ok(if uuids.len() == 1 { uuids.pop() } else { None })
}

#[cfg(test)]
mod tests;
