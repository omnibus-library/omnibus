//! Physical ownership data-layer tests, split to mirror the production
//! modules: physical copies, the per-user wishlist, fileless book creation
//! and removal, and the Physical pseudo-root promotion. Fixtures used by
//! more than one of those suites live here.

mod copies;
mod fileless;
mod promote;
mod remove;
mod wishlist;

use sqlx::SqlitePool;

async fn pool() -> SqlitePool {
    crate::pool::init_db("sqlite::memory:").await.unwrap()
}

async fn seed_user(pool: &SqlitePool, username: &str) -> i64 {
    // Insert directly: `create_user` gates all but the first registration on the
    // registration-enabled setting, and these tests only need user rows for FKs.
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO users (username, password_hash) VALUES (?1, 'x') RETURNING id",
    )
    .bind(username)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn count(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(sql)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Point the cover cache and the journal-image store at `dir` — one guard,
/// since every env guard takes the same process-wide lock.
fn image_env(dir: &std::path::Path) -> crate::test_support::EnvVarGuard {
    crate::test_support::EnvVarGuard::set_os("OMNIBUS_COVERS_DIR", Some(dir.as_os_str()))
        .also_set_os("OMNIBUS_JOURNAL_IMAGES_DIR", Some(dir.as_os_str()))
}

/// Give `user` a review of `uuid` whose notes embed a fresh journal image, and
/// return the image's name.
async fn seed_review_image(pool: &SqlitePool, user: i64, uuid: &str) -> String {
    let name = crate::journal_images::write_journal_image("image/png", b"x").unwrap();
    sqlx::query("INSERT INTO reviews (user_id, book_uuid, notes_md) VALUES (?, ?, ?)")
        .bind(user)
        .bind(uuid)
        .bind(format!(
            "![img]({}{name})",
            crate::journals::markdown::IMAGE_URL_PREFIX
        ))
        .execute(pool)
        .await
        .unwrap();
    name
}
