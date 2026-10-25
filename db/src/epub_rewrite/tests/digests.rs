//! The fingerprint of each served file, bake or original: `rewritten_epub_path`
//! records it so a KOReader that downloaded the file resolves to its book.

use std::path::PathBuf;

use omnibus_shared::MetadataOverrides;

use crate::ebook::test_support::fixture;
use crate::kosync::{resolve_document, KosyncDocument};
use crate::partial_md5::partial_md5;
use crate::test_support::EnvVarGuard;

/// A seeded book with a title override saved, ready to bake: `(pool, uuid, id)`.
async fn overridden_book(title: &str) -> (sqlx::SqlitePool, String, i64) {
    let pool = crate::pool::init_db("sqlite::memory:").await.unwrap();
    let user_id = crate::auth::create_user(&pool, "admin", "securepassword1")
        .await
        .unwrap()
        .id;
    let uuid =
        crate::test_support::seed_synced_ebook(&pool, "wok.epub", "Original", "Author").await;
    let id = crate::resolve_book_id_by_uuid(&pool, &uuid)
        .await
        .unwrap()
        .unwrap();
    set_title(&pool, &uuid, user_id, title).await;
    (pool, uuid, id)
}

async fn set_title(pool: &sqlx::SqlitePool, uuid: &str, user_id: i64, title: &str) {
    let overrides = MetadataOverrides {
        title: Some(title.into()),
        ..Default::default()
    };
    crate::upsert_metadata_overrides(pool, uuid, &overrides, false, user_id)
        .await
        .unwrap();
}

/// Put the fixture where book `id`'s EPUB file lives, under the library dir `dir`.
async fn place_source(pool: &sqlx::SqlitePool, id: i64, dir: &std::path::Path) -> PathBuf {
    sqlx::query("UPDATE scan_roots SET path = ?")
        .bind(dir.to_str().unwrap())
        .execute(pool)
        .await
        .unwrap();
    let source = crate::book_file_path(pool, id, "EPUB")
        .await
        .unwrap()
        .unwrap();
    std::fs::create_dir_all(source.parent().unwrap()).unwrap();
    std::fs::copy(fixture("alpha.epub"), &source).unwrap();
    source
}

#[tokio::test]
async fn rewritten_epub_path_records_the_bakes_partial_md5() {
    let export = tempfile::tempdir().unwrap();
    let _env = EnvVarGuard::set_os("OMNIBUS_EXPORT_EPUB_DIR", Some(export.path().as_os_str()));
    let (pool, uuid, id) = overridden_book("Stormlight #1").await;
    let library = tempfile::tempdir().unwrap();
    let source = place_source(&pool, id, library.path()).await;

    let baked = super::super::rewritten_epub_path(&pool, id, &source)
        .await
        .unwrap()
        .expect("override present, so a bake");

    let digest = partial_md5(&baked).unwrap();
    let source_file: i64 = sqlx::query_scalar("SELECT id FROM book_files")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        resolve_document(&pool, &digest).await.unwrap(),
        Some(KosyncDocument {
            book_uuid: uuid,
            book_file_id: Some(source_file)
        }),
        "the bake names the edition it was made from"
    );
}

#[tokio::test]
async fn rewritten_epub_path_keeps_resolving_an_older_bake_after_another_override_edit() {
    let export = tempfile::tempdir().unwrap();
    let _env = EnvVarGuard::set_os("OMNIBUS_EXPORT_EPUB_DIR", Some(export.path().as_os_str()));
    let (pool, uuid, id) = overridden_book("First Title").await;
    let src = fixture("alpha.epub");
    let first = super::super::rewritten_epub_path(&pool, id, &src)
        .await
        .unwrap()
        .unwrap();
    let first_digest = partial_md5(&first).unwrap();

    let user_id: i64 = sqlx::query_scalar("SELECT id FROM users")
        .fetch_one(&pool)
        .await
        .unwrap();
    set_title(&pool, &uuid, user_id, "A Much Longer Second Title").await;
    let second = super::super::rewritten_epub_path(&pool, id, &src)
        .await
        .unwrap()
        .unwrap();
    let second_digest = partial_md5(&second).unwrap();

    assert_ne!(first_digest, second_digest, "the edit must change the bake");
    for digest in [first_digest, second_digest] {
        assert_eq!(
            resolve_document(&pool, &digest)
                .await
                .unwrap()
                .map(|document| document.book_uuid),
            Some(uuid.clone())
        );
    }
}

#[tokio::test]
async fn rewritten_epub_path_records_the_served_originals_partial_md5_for_a_book_without_overrides()
{
    // The file's own digest waits on a backfill, and a device may download before it runs.
    let export = tempfile::tempdir().unwrap();
    let _env = EnvVarGuard::set_os("OMNIBUS_EXPORT_EPUB_DIR", Some(export.path().as_os_str()));
    let pool = crate::pool::init_db("sqlite::memory:").await.unwrap();
    let uuid = crate::test_support::seed_synced_ebook(&pool, "wok.epub", "Plain", "Author").await;
    let id = crate::resolve_book_id_by_uuid(&pool, &uuid)
        .await
        .unwrap()
        .unwrap();
    let source = fixture("alpha.epub");

    let served = super::super::rewritten_epub_path(&pool, id, &source)
        .await
        .unwrap();

    assert_eq!(served, None, "no override, so the original is served");
    let digest = partial_md5(&source).unwrap();
    assert_eq!(
        resolve_document(&pool, &digest)
            .await
            .unwrap()
            .map(|document| document.book_uuid),
        Some(uuid)
    );
}

#[tokio::test]
async fn rewritten_epub_path_still_returns_the_bake_when_recording_its_digest_fails() {
    let export = tempfile::tempdir().unwrap();
    let _env = EnvVarGuard::set_os("OMNIBUS_EXPORT_EPUB_DIR", Some(export.path().as_os_str()));
    let (pool, _uuid, id) = overridden_book("Stormlight #1").await;
    sqlx::query("DROP TABLE book_export_digests")
        .execute(&pool)
        .await
        .unwrap();

    let baked = super::super::rewritten_epub_path(&pool, id, &fixture("alpha.epub"))
        .await
        .unwrap();

    assert!(baked.is_some_and(|p| p.exists()));
}
