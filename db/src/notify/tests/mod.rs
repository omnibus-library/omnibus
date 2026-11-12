//! Tests for notification connections, by topic: the settings merge, ntfy's rendering,
//! delivery against a local server, the outbox and the connection store. The fixtures they
//! share are here and in `notify::test_support`.

use sqlx::SqlitePool;
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

mod deliver;
mod ntfy;
mod outbox;
mod settings;
mod store;

async fn pool() -> SqlitePool {
    crate::pool::init_db("sqlite::memory:").await.unwrap()
}

/// A local ntfy stand-in answering every publish with `response`.
async fn ntfy_answering(response: ResponseTemplate) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(wiremock::matchers::method("POST"))
        .respond_with(response)
        .mount(&server)
        .await;
    server
}

/// A client for the tests to send with.
fn client() -> reqwest::Client {
    http_client().unwrap()
}
