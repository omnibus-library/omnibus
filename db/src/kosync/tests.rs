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
