//! What a KOReader progress-sync request names: the book behind a partial MD5 document id.
//! Called by the `/kosync` routes; digests come from `book_files.partial_md5` (original
//! files) and `book_export_digests` (override-baked downloads).

use std::{collections::BTreeSet, path::Path};

use anyhow::Context;
use md5::{Digest, Md5};
use sqlx::SqlitePool;

use crate::{auth::hash_token, books::resolve_canonical_book_uuid, partial_md5::partial_md5};

/// Letters and digits that survive a read-aloud and an e-reader keyboard: no `i`, `l`, `o`, `0`, `1`.
const PASSWORD_ALPHABET: &[u8; 31] = b"abcdefghjkmnpqrstuvwxyz23456789";
const PASSWORD_LEN: usize = 20;

/// The book a KOReader partial MD5 names: an original EPUB file or a served bake. `None` when
/// no file matches or the digest matches more than one book (never guess).
pub async fn resolve_document(pool: &SqlitePool, digest: &str) -> anyhow::Result<Option<String>> {
    let candidates: Vec<String> = sqlx::query_scalar(
        "SELECT b.uuid FROM book_files bf JOIN books b ON b.id = bf.book_id \
         WHERE bf.partial_md5 = ?1 AND bf.format = 'EPUB' COLLATE NOCASE \
         UNION \
         SELECT book_uuid FROM book_export_digests WHERE partial_md5 = ?1",
    )
    .bind(digest)
    .fetch_all(pool)
    .await?;
    // A bake recorded before a merge may still name the merged-away uuid.
    let mut books = BTreeSet::new();
    for uuid in candidates {
        books.extend(resolve_canonical_book_uuid(pool, &uuid).await?);
    }
    Ok(if books.len() == 1 {
        books.pop_first()
    } else {
        None
    })
}

/// Remember the partial MD5 of the baked EPUB at `path` as `book_uuid`'s, so a device that
/// downloaded this bake keeps resolving after the next override edit replaces the file.
pub async fn record_export_digest(
    pool: &SqlitePool,
    book_uuid: &str,
    path: &Path,
) -> anyhow::Result<()> {
    let path = path.to_path_buf();
    let digest = tokio::task::spawn_blocking(move || partial_md5(&path))
        .await
        .context("hash task join failed")?
        .context("hash baked epub")?;
    sqlx::query(
        "INSERT OR IGNORE INTO book_export_digests (partial_md5, book_uuid, created_at) \
         VALUES (?, ?, strftime('%s', 'now'))",
    )
    .bind(digest)
    .bind(book_uuid)
    .execute(pool)
    .await?;
    Ok(())
}

/// A new kosync password for `user_id`, shown as `xxxxx-xxxxx-xxxxx-xxxxx` (~99 bits). Only the
/// SHA-256 of its MD5 is stored, and generating again replaces it. Hashing is not Argon2 because the
/// secret is server-generated and high-entropy, and it is checked on every sync request.
pub async fn generate_kosync_password(pool: &SqlitePool, user_id: i64) -> anyhow::Result<String> {
    let password = random_password()?;
    let updated = sqlx::query("UPDATE users SET kosync_key_hash = ? WHERE id = ?")
        .bind(hash_token(&md5_hex(&password)))
        .bind(user_id)
        .execute(pool)
        .await?;
    anyhow::ensure!(updated.rows_affected() == 1, "user {user_id} not found");
    Ok(password)
}

/// Whether `user_id` has generated a kosync password.
pub async fn kosync_configured(pool: &SqlitePool, user_id: i64) -> anyhow::Result<bool> {
    let configured: Option<bool> =
        sqlx::query_scalar("SELECT kosync_key_hash IS NOT NULL FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    Ok(configured.unwrap_or(false))
}

/// The user id whose username (case-insensitive) and kosync key match; `None` otherwise.
/// `md5_hex` is the `x-auth-key` a KOReader sends: the MD5 of the password, in either case.
pub async fn verify_kosync_key(
    pool: &SqlitePool,
    username: &str,
    md5_hex: &str,
) -> anyhow::Result<Option<i64>> {
    Ok(sqlx::query_scalar(
        "SELECT id FROM users WHERE username = ? COLLATE NOCASE AND kosync_key_hash = ?",
    )
    .bind(username)
    .bind(hash_token(&md5_hex.to_ascii_lowercase()))
    .fetch_optional(pool)
    .await?)
}

fn md5_hex(text: &str) -> String {
    format!("{:x}", Md5::digest(text.as_bytes()))
}

fn random_password() -> anyhow::Result<String> {
    let mut chars = Vec::with_capacity(PASSWORD_LEN);
    while chars.len() < PASSWORD_LEN {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|e| anyhow::anyhow!("CSPRNG failed: {e}"))?;
        // 248 = 8 * 31: bytes at or above it are dropped so every letter is equally likely.
        chars.extend(
            bytes
                .iter()
                .filter(|b| **b < 248)
                .map(|b| PASSWORD_ALPHABET[usize::from(*b) % 31] as char),
        );
    }
    chars.truncate(PASSWORD_LEN);
    Ok(chars
        .chunks(5)
        .map(|group| group.iter().collect::<String>())
        .collect::<Vec<_>>()
        .join("-"))
}

#[cfg(test)]
mod tests;
