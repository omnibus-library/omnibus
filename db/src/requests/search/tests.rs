use omnibus_shared::{RequestKind, RequestState, RequestsSettingsUpdate, StuckReason};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::physical::FilelessBook;
use crate::requests::store::{self, RequestRow};
use crate::test_support::{closed_port_url, EnvVarGuard};

use super::*;

async fn pool_with_prowlarr(url: &str) -> SqlitePool {
    pool_with_prowlarr_key(url, "indexer-key").await
}

async fn pool_with_prowlarr_key(url: &str, key: &str) -> SqlitePool {
    let pool = crate::pool::init_db("sqlite::memory:").await.unwrap();
    let update = RequestsSettingsUpdate {
        prowlarr_url: url.to_string(),
        prowlarr_api_key: Some(key.to_string()),
        download_client_kind: Default::default(),
        download_client_url: String::new(),
        download_client_username: String::new(),
        download_client_password: None,
        download_client_category: String::new(),
        download_client_path_prefix: String::new(),
        download_path_prefix: String::new(),
    };
    crate::settings::set_requests_settings(&pool, &update)
        .await
        .unwrap();
    pool
}

/// A `looking` ebook request for a fileless "Dracula" by Bram Stoker.
async fn looking_request(pool: &SqlitePool) -> i64 {
    let uuid = crate::physical::create_fileless_book(
        pool,
        FilelessBook {
            title: "Dracula".to_string(),
            authors: vec!["Bram Stoker".to_string()],
            isbn: None,
            pubdate: None,
            description: None,
            cover: None,
        },
    )
    .await
    .unwrap();
    let user = crate::test_support::seed_user(pool, "ada").await;
    store::start(pool, user, &uuid, RequestKind::Ebook, 5)
        .await
        .unwrap()
        .request
        .id
}

async fn mount_search(server: &MockServer, body: Value) {
    Mock::given(method("GET"))
        .and(path("/api/v1/search"))
        .and(header("x-api-key", "indexer-key"))
        .and(query_param("query", "Dracula Bram Stoker"))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .mount(server)
        .await;
}

async fn mount_indexer_status(server: &MockServer, body: Value) {
    Mock::given(method("GET"))
        .and(path("/api/v1/indexerstatus"))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .mount(server)
        .await;
}

fn good_release() -> Value {
    json!({
        "guid": "g1", "title": "Dracula - Bram Stoker EPUB", "size": 900000, "seeders": 12,
        "indexer": "Books", "downloadUrl": "http://prowlarr/1/download?apikey=secret",
        "categories": [{"id": 7020}],
    })
}

async fn row(pool: &SqlitePool, id: i64) -> RequestRow {
    store::get(pool, id).await.unwrap().unwrap()
}

mod run_search {
    use super::*;

    #[tokio::test]
    async fn stores_the_ranked_versions_and_moves_the_request_to_choose() {
        let server = MockServer::start().await;
        let unreadable = json!({
            "guid": "g2", "title": "Dracula - Bram Stoker MOBI", "size": 900000, "seeders": 4,
            "downloadUrl": "http://prowlarr/2/download", "categories": [{"id": 7020}],
        });
        mount_search(&server, json!([unreadable, good_release()])).await;
        let pool = pool_with_prowlarr(&server.uri()).await;
        let id = looking_request(&pool).await;

        run_search(&pool, id).await.unwrap();

        assert_eq!(row(&pool, id).await.state, RequestState::Choose);
        let shown = store::versions(&pool, id).await.unwrap();
        assert_eq!(shown.len(), 1);
        assert_eq!(shown[0].title, "Dracula - Bram Stoker EPUB");
        assert_eq!(shown[0].format.as_deref(), Some("EPUB"));
        assert!(shown[0].best_match);
        let dropped: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM book_request_results WHERE rejected = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(dropped, 1);
    }

    #[tokio::test]
    async fn gets_stuck_not_found_with_the_failing_indexers_when_no_result_survives() {
        let server = MockServer::start().await;
        mount_search(&server, json!([])).await;
        let down = json!([{"id": 1, "indexerId": 3, "disabledTill": "2030-01-01T00:00:00Z"}]);
        mount_indexer_status(&server, down).await;
        let pool = pool_with_prowlarr(&server.uri()).await;
        let id = looking_request(&pool).await;

        run_search(&pool, id).await.unwrap();

        let stuck = row(&pool, id).await;
        assert_eq!(stuck.state, RequestState::Stuck);
        assert_eq!(stuck.stuck_reason, Some(StuckReason::NotFound));
        assert_eq!(
            stuck.stuck_detail.as_deref(),
            Some("indexer 3 disabled until 2030-01-01T00:00:00Z")
        );
    }

    #[tokio::test]
    async fn leaves_the_detail_empty_when_no_indexer_is_failing() {
        let server = MockServer::start().await;
        mount_search(&server, json!([])).await;
        mount_indexer_status(&server, json!([])).await;
        let pool = pool_with_prowlarr(&server.uri()).await;
        let id = looking_request(&pool).await;

        run_search(&pool, id).await.unwrap();

        assert_eq!(row(&pool, id).await.stuck_detail, None);
    }

    #[tokio::test]
    async fn gets_stuck_search_failed_naming_the_problem_when_prowlarr_is_unreachable() {
        let pool = pool_with_prowlarr(&closed_port_url()).await;
        let id = looking_request(&pool).await;

        run_search(&pool, id).await.unwrap();

        let stuck = row(&pool, id).await;
        assert_eq!(stuck.stuck_reason, Some(StuckReason::SearchFailed));
        assert_eq!(
            stuck.stuck_detail.as_deref(),
            Some("could not connect (connection refused or failed)")
        );
    }

    #[tokio::test]
    async fn gets_stuck_search_failed_when_prowlarr_is_not_set_up() {
        let _env = EnvVarGuard::set("OMNIBUS_PROWLARR_API_KEY", None);
        let pool = crate::pool::init_db("sqlite::memory:").await.unwrap();
        let id = looking_request(&pool).await;

        run_search(&pool, id).await.unwrap();

        let stuck = row(&pool, id).await;
        assert_eq!(stuck.stuck_reason, Some(StuckReason::SearchFailed));
        assert_eq!(stuck.stuck_detail.as_deref(), Some("not set up yet"));
    }

    #[tokio::test]
    async fn makes_no_call_for_a_second_search_inside_a_rate_limit_cooldown() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/search"))
            .respond_with(ResponseTemplate::new(429).insert_header("retry-after", "600"))
            .mount(&server)
            .await;
        // Its own key: a cooldown is kept per address and key, and a later test can be
        // handed this server's port.
        let pool = pool_with_prowlarr_key(&server.uri(), "key-search-429-cooldown").await;
        let first = looking_request(&pool).await;
        run_search(&pool, first).await.unwrap();
        store::restart(&pool, first, 0).await.unwrap();

        run_search(&pool, first).await.unwrap();

        let stuck = row(&pool, first).await;
        assert_eq!(stuck.stuck_reason, Some(StuckReason::SearchFailed));
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn makes_no_call_and_leaves_a_request_that_is_no_longer_looking_as_it_is() {
        let server = MockServer::start().await;
        mount_search(&server, json!([good_release()])).await;
        let pool = pool_with_prowlarr(&server.uri()).await;
        let id = looking_request(&pool).await;
        sqlx::query("UPDATE book_requests SET state = 'chosen' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

        run_search(&pool, id).await.unwrap();

        assert_eq!(row(&pool, id).await.state, RequestState::Chosen);
        assert!(server.received_requests().await.unwrap().is_empty());
    }
}
