//! Fixtures the KOReader route tests share: a router with one KOReader device on a
//! fresh in-memory DB.

use axum::Router;
use omnibus_db as db;
use omnibus_shared::DeviceKind;
use sqlx::SqlitePool;

use super::koreader_router;
use crate::auth::test_support as auth_test_support;
use crate::backend::AppState;

/// A KOReader router, its pool, the device's token and the owning user's id.
pub(super) async fn fixture() -> (Router, SqlitePool, String, i64) {
    let pool = db::init_db("sqlite::memory:").await.unwrap();
    let app = koreader_router(AppState::new(pool.clone()));
    let user = auth_test_support::create_user(&pool, "ko-reader").await;
    let device =
        db::kobo_devices::create_device(&pool, user.id, "Test KOReader", DeviceKind::Koreader)
            .await
            .unwrap();
    (app, pool, device.token, user.id)
}

/// An EPUB book whose file on disk holds `spine` (`(href, xhtml)` pairs, in order); returns
/// its uuid and the file's path. The library directory is a fresh temp dir.
pub(in crate::backend) async fn seed_epub_book(
    pool: &SqlitePool,
    spine: &[(&str, &str)],
) -> (String, std::path::PathBuf) {
    let lib = db::test_support::make_test_dir("koreader_state");
    let (_, uuid) = db::test_support::seed_epub_book_at(pool, &lib).await;
    let file = lib.join("sub").join("book.epub");
    std::fs::write(&file, db::test_support::build_test_epub(spine)).unwrap();
    (uuid, file)
}
