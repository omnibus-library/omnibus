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
