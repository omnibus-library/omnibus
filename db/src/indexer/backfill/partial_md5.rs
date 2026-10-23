//! Fills `book_files.partial_md5` for original EPUB files, the document identity a
//! KOReader device sends over its progress sync. Posted by the worker after each
//! ebook scan; a no-op once every row is hashed.

use std::path::PathBuf;

use sqlx::SqlitePool;

use crate::partial_md5::partial_md5;

/// Rows hashed between write transactions, bounding both memory and WAL flushes.
const CHUNK: usize = 250;

/// Hash every EPUB file under `library_path` that has no `partial_md5` yet.
/// `on_progress(processed, total, item)` fires per file. A file that cannot be read
/// stays NULL and is retried on the next scan.
pub(crate) async fn backfill_partial_md5(
    pool: &SqlitePool,
    library_path: &str,
    mut on_progress: impl FnMut(u32, u32, &str),
) -> anyhow::Result<()> {
    let candidates = fetch_candidates(pool, library_path).await?;
    if candidates.is_empty() {
        return Ok(());
    }

    let total = u32::try_from(candidates.len()).unwrap_or(u32::MAX);
    tracing::info!(
        count = total,
        "fingerprinting ebook files for KOReader sync"
    );

    let mut processed = 0u32;
    for chunk in candidates.chunks(CHUNK) {
        let mut hashed = Vec::with_capacity(chunk.len());
        for (id, title, path) in chunk {
            processed = processed.saturating_add(1);
            on_progress(processed, total, title);

            let path = path.clone();
            match tokio::task::spawn_blocking(move || partial_md5(&path)).await {
                Ok(Ok(digest)) => hashed.push((*id, digest)),
                Ok(Err(e)) => {
                    tracing::warn!(file_id = id, error = %e, "partial MD5: file unreadable; leaving NULL");
                }
                Err(join_err) => tracing::warn!(
                    file_id = id,
                    %join_err,
                    is_panic = join_err.is_panic(),
                    "partial MD5 task failed; leaving NULL"
                ),
            }
        }
        // Writes happen after the chunk is hashed, so the hashing never holds a write lock.
        let mut tx = pool.begin().await?;
        for (id, digest) in &hashed {
            sqlx::query("UPDATE book_files SET partial_md5 = ? WHERE id = ?")
                .bind(digest)
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
    }

    Ok(())
}

/// `(file id, display title, on-disk path)` for every unhashed EPUB file whose own
/// root is `library_path` (a merged book's file keeps the root its bytes live under).
async fn fetch_candidates(
    pool: &SqlitePool,
    library_path: &str,
) -> anyhow::Result<Vec<(i64, String, PathBuf)>> {
    let rows: Vec<(i64, String, String, String, String, String)> = sqlx::query_as(
        "SELECT bf.id, COALESCE(NULLIF(b.title, ''), b.scan_key), \
                COALESCE(bf.library_path, l.path), COALESCE(bf.path, b.path), \
                bf.filename, bf.format \
         FROM book_files bf \
         JOIN books b ON b.id = bf.book_id \
         JOIN scan_roots l ON l.id = b.library_id \
         WHERE COALESCE(bf.library_path, l.path) = ? \
           AND bf.format = 'EPUB' COLLATE NOCASE \
           AND bf.partial_md5 IS NULL \
         ORDER BY bf.id",
    )
    .bind(library_path)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, title, lib, dir, stem, fmt)| {
            let path = std::path::Path::new(&lib)
                .join(&dir)
                .join(format!("{stem}.{}", fmt.to_lowercase()));
            (id, title, path)
        })
        .collect())
}
