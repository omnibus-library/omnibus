//! Contract tests: the `/_mock` control API steers what the server's own clients see.

use omnibus_db::requests::clients::Qbittorrent;
use omnibus_db::requests::prowlarr::Prowlarr;
use omnibus_db::requests::ConnectionError;
use omnibus_shared::{ReleaseProtocol, RequestKind};
use serde_json::{json, Value};

use crate::test_support::{add_epub, control, control_reply, spawn, Running};
use crate::{CLIENT_PASSWORD, CLIENT_USERNAME, PROWLARR_API_KEY};

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

    let reply = control_reply(&mock, "/_mock/search", json!({"mode": "empty"})).await;

    assert!(reply.status().is_success());
    assert_eq!(search(&mock).await.unwrap(), 0);
    assert_eq!(view(&mock).await["search"], "empty");
}

#[tokio::test]
async fn search_mode_fail_makes_the_search_a_rejection_the_server_does_not_retry() {
    let mock = spawn().await;
    control(&mock, "/_mock/search", json!({"mode": "fail"})).await;

    let err = search(&mock).await.unwrap_err();

    assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
}

#[tokio::test]
async fn search_mode_results_restores_the_catalogue() {
    let mock = spawn().await;
    control(&mock, "/_mock/search", json!({"mode": "empty"})).await;

    control(&mock, "/_mock/search", json!({"mode": "results"})).await;

    assert_eq!(search(&mock).await.unwrap(), 4);
}

#[tokio::test]
async fn search_mode_answers_a_client_error_for_an_unknown_mode() {
    let mock = spawn().await;

    let reply = control_reply(&mock, "/_mock/search", json!({"mode": "sideways"})).await;

    assert!(reply.status().is_client_error(), "{}", reply.status());
}

#[tokio::test]
async fn downloads_settings_apply_to_a_download_already_added_and_to_later_ones() {
    let mock = spawn().await;
    let qbit = Qbittorrent::new(&mock.origin, CLIENT_USERNAME, CLIENT_PASSWORD).unwrap();
    let (first, _) = add_epub(&mock, &qbit, ReleaseProtocol::Torrent).await;

    let reply = control_reply(
        &mock,
        "/_mock/downloads",
        json!({"outcome": "fail", "secs": 5}),
    )
    .await;
    let (second, _) = add_epub(&mock, &qbit, ReleaseProtocol::Torrent).await;

    assert!(reply.status().is_success());
    let seen = view(&mock).await;
    assert_eq!(seen["outcome"], "fail");
    assert_eq!(seen["secs"], 5);
    let rows = seen["downloads"].as_array().unwrap();
    for id in [first, second] {
        let row = rows.iter().find(|r| r["id"] == id).unwrap();
        assert_eq!(row["outcome"], "fail");
        assert_eq!(row["client"], "qbittorrent");
        assert!(row["progress"].as_f64().unwrap() < 0.01);
    }
}

#[tokio::test]
async fn downloads_settings_keep_what_the_body_leaves_out() {
    let mock = spawn().await;
    control(&mock, "/_mock/downloads", json!({"secs": 7})).await;

    control(&mock, "/_mock/downloads", json!({"outcome": "stall"})).await;

    let seen = view(&mock).await;
    assert_eq!(
        (seen["outcome"].as_str(), seen["secs"].as_u64()),
        (Some("stall"), Some(7))
    );
}

#[tokio::test]
async fn downloads_settings_answer_a_client_error_for_a_bad_body() {
    let mock = spawn().await;

    for body in [
        json!({"outcome": "sideways"}),
        json!({"secs": "soon"}),
        json!({"outcom": "fail"}),
    ] {
        let reply = control_reply(&mock, "/_mock/downloads", body.clone()).await;

        assert!(
            reply.status().is_client_error(),
            "{body}: {}",
            reply.status()
        );
    }
}
