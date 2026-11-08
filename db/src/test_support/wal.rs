//! File-backed WAL pools and a contending writer, for the tests of code that
//! must wait out another writer instead of failing with a locked database.
//! In-memory databases have no WAL, so these need a real file.

use std::path::Path;
use std::time::Duration;

use sqlx::SqlitePool;
use tokio::task::JoinHandle;

/// How long [`hold_write_lock`] holds the lock, under the pool's 5s `busy_timeout`.
// shortcut: the writer's wait inside SQLite's busy handler cannot be observed, so
// this cap stands in for a signal; a runner that reaches the contended write after
// it passes vacuously. Upgrade to a busy-handler hook if that ever flakes green.
const WRITE_LOCK_GRACE: Duration = Duration::from_secs(3);

/// `sqlite://` URL of an `omnibus.db` file under `dir`.
pub fn file_db_url(dir: &Path) -> String {
    format!("sqlite://{}?mode=rwc", dir.join("omnibus.db").display())
}

/// Close `pool` and open the same file again, so no connection has opened the
/// FTS5 tables yet, as after a restart.
pub async fn reopen_file_pool(pool: SqlitePool, url: &str) -> SqlitePool {
    pool.close().await;
    crate::pool::init_db(url).await.expect("reopen file pool")
}

/// Take the write lock on a second pooled connection, standing in for the write
/// an import has in flight; it is held when this returns. The lock is released
/// by a real write's commit after [`WRITE_LOCK_GRACE`], which also advances the
/// snapshot a deferred reader holds. Await the handle after the contended call.
/// A writer that read before it wrote fails at once; one that took the lock up
/// front waits it out. Needs a `books` row, whose write it commits.
pub async fn hold_write_lock(pool: &SqlitePool) -> JoinHandle<()> {
    let mut tx = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .expect("take the write lock");
    sqlx::query("UPDATE books SET title = title")
        .execute(&mut *tx)
        .await
        .expect("write under the lock");
    tokio::spawn(async move {
        tokio::time::sleep(WRITE_LOCK_GRACE).await;
        tx.commit().await.expect("release the write lock");
    })
}
