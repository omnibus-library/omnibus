//! The fake Kobo (`omnibus-mock-kobo`) syncing against the real `kobo_router`
//! and `reading_services_router` over local TCP. The suites above check what
//! the server sends; these check what a reader would then see on the device.

mod annotations;
mod covers;
mod downloads;
mod library_sync;
mod reading_state;

use super::*;

/// The real Kobo routes on an ephemeral local port, with one enrolled device.
struct Omnibus {
    /// The `api_endpoint` the device is configured with.
    endpoint: String,
    /// The server's bare origin — what a second device's `api_endpoint` is built from.
    base: String,
    pool: SqlitePool,
    user_id: i64,
}

async fn spawn_omnibus() -> Omnibus {
    let pool = db::init_db("sqlite::memory:").await.unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    // The device's `Host` carries no port, so the server needs its origin listed, as an operator lists it.
    let state = AppState::new(pool.clone()).with_public_origins(std::slice::from_ref(&base));
    let app = kobo_router(state.clone()).merge(reading_services_router(state));
    let user = auth_test_support::create_user(&pool, "kobo-reader").await;
    let device = db::kobo_devices::create_device(&pool, user.id, "Mock Kobo")
        .await
        .unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Omnibus {
        endpoint: format!("{base}/kobo/{}", device.token),
        base,
        pool,
        user_id: user.id,
    }
}

/// Enrol a second `kobo_devices` row for `omnibus`'s user, returning its `{base}/kobo/{token}`.
async fn add_device(omnibus: &Omnibus, name: &str) -> String {
    let device = db::kobo_devices::create_device(&omnibus.pool, omnibus.user_id, name)
        .await
        .unwrap();
    format!("{}/kobo/{}", omnibus.base, device.token)
}
