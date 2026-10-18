//! Session signing-key secret.

use sqlx::SqlitePool;

use super::{AuthError, AuthResult};

const SESSION_KEY_NAME: &str = "session_signing_key";
const SESSION_KEY_LEN: usize = 64; // 512 bits — tower-sessions key size

/// Returns the session signing key, creating and persisting a fresh random one
/// on first call. It signs image download links, so rotating it kills every
/// outstanding link.
pub async fn load_or_create_session_key(pool: &SqlitePool) -> AuthResult<Vec<u8>> {
    if let Some(bytes) = get_session_key(pool).await? {
        return Ok(bytes);
    }
    let mut key = vec![0u8; SESSION_KEY_LEN];
    getrandom::fill(&mut key)
        .map_err(|e| AuthError::Crypto(format!("CSPRNG byte generation failed: {e}")))?;
    insert_session_key_if_absent(pool, &key).await
}

/// Store `key` unless a row already exists, then return the stored key. A
/// concurrent first caller may have won the insert, and every caller must sign
/// with one key.
async fn insert_session_key_if_absent(pool: &SqlitePool, key: &[u8]) -> AuthResult<Vec<u8>> {
    sqlx::query("INSERT INTO secrets (name, value) VALUES (?, ?) ON CONFLICT(name) DO NOTHING")
        .bind(SESSION_KEY_NAME)
        .bind(key)
        .execute(pool)
        .await?;
    let stored = sqlx::query_scalar("SELECT value FROM secrets WHERE name = ?")
        .bind(SESSION_KEY_NAME)
        .fetch_one(pool)
        .await?;
    Ok(stored)
}

/// Retrieve the session signing key from the database, returning `None` if it has not been set yet.
pub async fn get_session_key(pool: &SqlitePool) -> AuthResult<Option<Vec<u8>>> {
    let v: Option<Vec<u8>> = sqlx::query_scalar("SELECT value FROM secrets WHERE name = ?")
        .bind(SESSION_KEY_NAME)
        .fetch_optional(pool)
        .await?;
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::test_support::pool;

    #[tokio::test]
    async fn session_key_is_created_and_stable() {
        let p = pool().await;
        let k1 = load_or_create_session_key(&p).await.unwrap();
        let k2 = load_or_create_session_key(&p).await.unwrap();
        assert_eq!(k1, k2);
        assert_eq!(k1.len(), SESSION_KEY_LEN);
    }

    #[tokio::test]
    async fn load_or_create_session_key_never_replaces_a_key_another_caller_stored() {
        let p = pool().await;
        let stored = vec![7u8; SESSION_KEY_LEN];
        insert_session_key_if_absent(&p, &stored).await.unwrap();

        // The state a concurrent first caller leaves behind between our read and our write.
        let returned = insert_session_key_if_absent(&p, &[9u8; SESSION_KEY_LEN])
            .await
            .unwrap();

        assert_eq!(returned, stored);
        assert_eq!(get_session_key(&p).await.unwrap(), Some(stored));
    }
}
