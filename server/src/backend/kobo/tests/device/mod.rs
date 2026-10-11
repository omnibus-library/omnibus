//! The fake Kobo (`omnibus-mock-kobo`) syncing against the real `kobo_router`
//! and `reading_services_router` over local TCP. The suites above check what
//! the server sends; these check what a reader would then see on the device.

mod library_sync;

use super::*;

/// The real Kobo routes on an ephemeral local port, with one enrolled device.
struct Omnibus {
    /// The `api_endpoint` the device is configured with.
    endpoint: String,
    pool: SqlitePool,
    user_id: i64,
}

async fn spawn_omnibus() -> Omnibus {
    let pool = db::init_db("sqlite::memory:").await.unwrap();
    let state = AppState::new(pool.clone());
    let app = kobo_router(state.clone()).merge(reading_services_router(state));
    let user = auth_test_support::create_user(&pool, "kobo-reader").await;
    let device = db::kobo_devices::create_device(&pool, user.id, "Mock Kobo")
        .await
        .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Omnibus {
        endpoint: format!("{base}/kobo/{}", device.token),
        pool,
        user_id: user.id,
    }
}
