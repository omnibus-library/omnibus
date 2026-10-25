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

/// Seed `uuid-1` with the committed reader fixture pair as one book: its
/// source EPUB on disk (so `attempt_download` has real bytes to serve) and
/// its kepubify output pre-populated in the KEPUB cache (so no real
/// kepubify binary is needed — `just test` runs in the shell that has
/// none). Returns the book's uuid and the env guard pinning the cache
/// directory and a nonexistent kepubify path for the test's lifetime.
async fn seed_reader_book(pool: &SqlitePool) -> (String, db::test_support::EnvVarGuard) {
    let lib = db::test_support::make_test_dir("reader_book");
    let (book_id, uuid) = db::test_support::seed_epub_book_at(pool, &lib).await;
    let fixture_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../test_data/kepub");
    std::fs::copy(
        fixture_dir.join("reader.epub"),
        lib.join("sub").join("book.epub"),
    )
    .unwrap();
    let kepub_dir = lib.join("kepub");
    std::fs::create_dir_all(&kepub_dir).unwrap();
    std::fs::write(
        kepub_dir.join(format!("{book_id}.kepub.epub")),
        std::fs::read(fixture_dir.join("reader.kepub.epub")).unwrap(),
    )
    .unwrap();
    let guard =
        db::test_support::EnvVarGuard::set_os("OMNIBUS_KEPUB_DIR", Some(kepub_dir.as_os_str()))
            .also_set("OMNIBUS_KEPUBIFY_PATH", Some("/no/such/kepubify"));
    (uuid, guard)
}
