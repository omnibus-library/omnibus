//! The kosync data layer: resolving a KOReader document digest to a book, and the per-reader
//! password behind the `/kosync` routes.

use super::*;
use crate::pool::init_db;
use crate::test_support::seed_synced_ebook;

const DIGEST_A: &str = "0123456789abcdef0123456789abcdef";
const DIGEST_B: &str = "fedcba9876543210fedcba9876543210";

/// Index an EPUB through the real write path and give its file `digest`.
async fn seed_hashed_epub(pool: &SqlitePool, filename: &str, digest: &str) -> String {
    let uuid = seed_synced_ebook(pool, filename, filename, "Ann").await;
    sqlx::query(
        "UPDATE book_files SET partial_md5 = ? \
         WHERE book_id = (SELECT id FROM books WHERE uuid = ?)",
    )
    .bind(digest)
    .bind(&uuid)
    .execute(pool)
    .await
    .unwrap();
    uuid
}

async fn record_digest(pool: &SqlitePool, digest: &str, uuid: &str) {
    sqlx::query(
        "INSERT INTO book_export_digests (partial_md5, book_uuid, created_at) VALUES (?, ?, 1)",
    )
    .bind(digest)
    .bind(uuid)
    .execute(pool)
    .await
    .unwrap();
}

mod record_export_digest {
    use super::*;

    #[tokio::test]
    async fn keeps_one_row_when_the_same_bake_is_recorded_again() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let uuid = seed_hashed_epub(&pool, "a.epub", DIGEST_A).await;
        let dir = tempfile::tempdir().unwrap();
        let bake = dir.path().join("bake.epub");
        std::fs::write(&bake, b"baked bytes").unwrap();

        record_export_digest(&pool, &uuid, &bake).await.unwrap();
        record_export_digest(&pool, &uuid, &bake).await.unwrap();

        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM book_export_digests")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rows, 1);
    }
}

mod resolve_document {
    use super::*;

    #[tokio::test]
    async fn finds_a_book_by_its_original_file() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let uuid = seed_hashed_epub(&pool, "a.epub", DIGEST_A).await;
        seed_hashed_epub(&pool, "b.epub", DIGEST_B).await;

        assert_eq!(resolve_document(&pool, DIGEST_A).await.unwrap(), Some(uuid));
    }

    #[tokio::test]
    async fn returns_none_for_an_unknown_digest() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        seed_hashed_epub(&pool, "a.epub", DIGEST_A).await;

        assert_eq!(resolve_document(&pool, DIGEST_B).await.unwrap(), None);
    }

    #[tokio::test]
    async fn returns_none_when_two_books_share_a_digest() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        seed_hashed_epub(&pool, "a.epub", DIGEST_A).await;
        seed_hashed_epub(&pool, "b.epub", DIGEST_A).await;

        assert_eq!(resolve_document(&pool, DIGEST_A).await.unwrap(), None);
    }

    #[tokio::test]
    async fn ignores_a_file_that_is_not_an_epub() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        seed_hashed_epub(&pool, "a.epub", DIGEST_A).await;
        sqlx::query("UPDATE book_files SET format = 'PDF' WHERE partial_md5 = ?")
            .bind(DIGEST_A)
            .execute(&pool)
            .await
            .unwrap();

        assert_eq!(resolve_document(&pool, DIGEST_A).await.unwrap(), None);
    }

    #[tokio::test]
    async fn finds_a_book_by_a_digest_recorded_for_its_bake() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let uuid = seed_hashed_epub(&pool, "a.epub", DIGEST_A).await;
        record_digest(&pool, DIGEST_B, &uuid).await;

        assert_eq!(resolve_document(&pool, DIGEST_B).await.unwrap(), Some(uuid));
    }

    #[tokio::test]
    async fn returns_none_when_two_books_baked_to_the_same_digest() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let a = seed_hashed_epub(&pool, "a.epub", DIGEST_A).await;
        let b = seed_hashed_epub(&pool, "b.epub", "b".repeat(32).as_str()).await;
        record_digest(&pool, DIGEST_B, &a).await;
        record_digest(&pool, DIGEST_B, &b).await;

        assert_eq!(resolve_document(&pool, DIGEST_B).await.unwrap(), None);
    }

    #[tokio::test]
    async fn resolves_a_bake_recorded_under_a_merged_away_uuid_to_the_survivor() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let survivor = seed_hashed_epub(&pool, "a.epub", DIGEST_A).await;
        let loser = seed_hashed_epub(&pool, "b.epub", "b".repeat(32).as_str()).await;
        crate::merge::merge_books(&pool, &loser, &survivor, None)
            .await
            .unwrap();
        record_digest(&pool, DIGEST_B, &loser).await;

        assert_eq!(
            resolve_document(&pool, DIGEST_B).await.unwrap(),
            Some(survivor)
        );
    }

    #[tokio::test]
    async fn resolves_a_merged_away_book_to_its_survivor() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let survivor = seed_hashed_epub(&pool, "a.epub", DIGEST_A).await;
        let loser = seed_hashed_epub(&pool, "b.epub", DIGEST_B).await;
        crate::merge::merge_books(&pool, &loser, &survivor, None)
            .await
            .unwrap();

        assert_eq!(
            resolve_document(&pool, DIGEST_B).await.unwrap(),
            Some(survivor)
        );
    }
}

mod credentials {
    use md5::{Digest, Md5};

    use super::*;

    fn md5_hex(text: &str) -> String {
        format!("{:x}", Md5::digest(text.as_bytes()))
    }

    async fn user(pool: &SqlitePool, name: &str) -> i64 {
        crate::auth::create_user(pool, name, "securepassword1")
            .await
            .unwrap()
            .id
    }

    async fn reader_with_password(pool: &SqlitePool, name: &str) -> (i64, String) {
        let id = user(pool, name).await;
        (id, generate_kosync_password(pool, id).await.unwrap())
    }

    mod generate_kosync_password {
        use super::*;

        #[tokio::test]
        async fn returns_a_grouped_password() {
            let pool = init_db("sqlite::memory:").await.unwrap();
            let id = user(&pool, "ada").await;

            let password = generate_kosync_password(&pool, id).await.unwrap();

            let shape = regex::Regex::new(r"^[a-hjkmnp-z2-9]{5}(-[a-hjkmnp-z2-9]{5}){3}$").unwrap();
            assert!(shape.is_match(&password), "{password}");
        }

        #[tokio::test]
        async fn stores_neither_the_password_nor_its_md5() {
            let pool = init_db("sqlite::memory:").await.unwrap();
            let (id, password) = reader_with_password(&pool, "ada").await;

            let stored: Vec<u8> =
                sqlx::query_scalar("SELECT kosync_key_hash FROM users WHERE id = ?")
                    .bind(id)
                    .fetch_one(&pool)
                    .await
                    .unwrap();

            assert_eq!(stored.len(), 32);
            assert_ne!(stored, password.as_bytes());
            assert_ne!(stored, md5_hex(&password).as_bytes());
        }

        #[tokio::test]
        async fn errors_for_an_unknown_user() {
            let pool = init_db("sqlite::memory:").await.unwrap();

            assert!(generate_kosync_password(&pool, 999).await.is_err());
        }
    }

    mod kosync_configured {
        use super::*;

        #[tokio::test]
        async fn turns_true_once_a_password_is_generated() {
            let pool = init_db("sqlite::memory:").await.unwrap();
            let id = user(&pool, "ada").await;
            assert!(!kosync_configured(&pool, id).await.unwrap());

            generate_kosync_password(&pool, id).await.unwrap();

            assert!(kosync_configured(&pool, id).await.unwrap());
        }
    }

    mod verify_kosync_key {
        use super::*;

        #[tokio::test]
        async fn accepts_the_md5_of_the_password() {
            let pool = init_db("sqlite::memory:").await.unwrap();
            let (id, password) = reader_with_password(&pool, "ada").await;

            let found = verify_kosync_key(&pool, "ada", &md5_hex(&password)).await;

            assert_eq!(found.unwrap(), Some(id));
        }

        #[tokio::test]
        async fn accepts_uppercase_hex_and_a_differently_cased_username() {
            let pool = init_db("sqlite::memory:").await.unwrap();
            let (id, password) = reader_with_password(&pool, "ada").await;

            let found = verify_kosync_key(&pool, "ADA", &md5_hex(&password).to_uppercase()).await;

            assert_eq!(found.unwrap(), Some(id));
        }

        #[tokio::test]
        async fn rejects_a_wrong_key() {
            let pool = init_db("sqlite::memory:").await.unwrap();
            reader_with_password(&pool, "ada").await;

            let found = verify_kosync_key(&pool, "ada", &md5_hex("wrong")).await;

            assert_eq!(found.unwrap(), None);
        }

        #[tokio::test]
        async fn rejects_an_unknown_user() {
            let pool = init_db("sqlite::memory:").await.unwrap();
            let (_, password) = reader_with_password(&pool, "ada").await;

            let found = verify_kosync_key(&pool, "grace", &md5_hex(&password)).await;

            assert_eq!(found.unwrap(), None);
        }

        #[tokio::test]
        async fn rejects_the_old_password_after_generating_again() {
            let pool = init_db("sqlite::memory:").await.unwrap();
            let (id, old) = reader_with_password(&pool, "ada").await;

            let new = generate_kosync_password(&pool, id).await.unwrap();

            assert_eq!(
                verify_kosync_key(&pool, "ada", &md5_hex(&old))
                    .await
                    .unwrap(),
                None
            );
            assert_eq!(
                verify_kosync_key(&pool, "ada", &md5_hex(&new))
                    .await
                    .unwrap(),
                Some(id)
            );
        }

        #[tokio::test]
        async fn rejects_a_user_who_never_generated_one() {
            let pool = init_db("sqlite::memory:").await.unwrap();
            user(&pool, "ada").await;

            let found = verify_kosync_key(&pool, "ada", &md5_hex("anything")).await;

            assert_eq!(found.unwrap(), None);
        }
    }
}
