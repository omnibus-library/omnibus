use omnibus_db::requests::prowlarr::Prowlarr;
use omnibus_db::requests::ConnectionError;
use omnibus_shared::RequestKind;
use serde_json::{json, Value};

use crate::test_support::{spawn, Running};
use crate::PROWLARR_API_KEY;

async fn put(mock: &Running, path: &str, body: Value) -> reqwest::Response {
    reqwest::Client::new()
        .put(format!("{}{path}", mock.origin))
        .json(&body)
        .send()
        .await
        .unwrap()
}

async fn view(mock: &Running) -> Value {
    reqwest::get(format!("{}/_mock", mock.origin))
        .await
        .unwrap()
        .json()
        .await
        .unwrap()
}

async fn search(mock: &Running) -> Result<usize, ConnectionError> {
    let client = Prowlarr::new(&mock.origin, PROWLARR_API_KEY).unwrap();
    client
        .search("Dracula", RequestKind::Ebook)
        .await
        .map(|r| r.len())
}

#[tokio::test]
async fn search_mode_empty_makes_the_search_find_nothing() {
    let mock = spawn().await;

    let reply = put(&mock, "/_mock/search", json!({"mode": "empty"})).await;

    assert!(reply.status().is_success());
    assert_eq!(search(&mock).await.unwrap(), 0);
    assert_eq!(view(&mock).await["search"], "empty");
}

#[tokio::test]
async fn search_mode_fail_makes_the_search_a_rejection_the_server_does_not_retry() {
    let mock = spawn().await;
    put(&mock, "/_mock/search", json!({"mode": "fail"})).await;

    let err = search(&mock).await.unwrap_err();

    assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
}

#[tokio::test]
async fn search_mode_results_restores_the_catalogue() {
    let mock = spawn().await;
    put(&mock, "/_mock/search", json!({"mode": "empty"})).await;

    put(&mock, "/_mock/search", json!({"mode": "results"})).await;

    assert_eq!(search(&mock).await.unwrap(), 4);
}

#[tokio::test]
async fn search_mode_answers_a_client_error_for_an_unknown_mode() {
    let mock = spawn().await;

    let reply = put(&mock, "/_mock/search", json!({"mode": "sideways"})).await;

    assert!(reply.status().is_client_error(), "{}", reply.status());
}
