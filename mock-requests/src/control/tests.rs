//! Contract tests: the `/_mock` control API steers what the server's own clients see.

use std::time::Duration;

use omnibus_db::notify::DeliverError;
use omnibus_db::requests::clients::Qbittorrent;
use omnibus_db::requests::prowlarr::Prowlarr;
use omnibus_db::requests::ConnectionError;
use omnibus_shared::{NtfyAuth, ReleaseProtocol, RequestKind};
use serde_json::{json, Value};

use crate::test_support::{
    add_epub, control, control_reply, ntfy_record, ntfy_settings, send_sample, spawn, Running,
};
use crate::{CLIENT_PASSWORD, CLIENT_USERNAME, NTFY_TOKEN, PROWLARR_API_KEY};

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

    control(&mock, "/_mock/search", json!({"mode": "empty"})).await;

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

    control(
        &mock,
        "/_mock/downloads",
        json!({"outcome": "fail", "secs": 5}),
    )
    .await;
    let (second, _) = add_epub(&mock, &qbit, ReleaseProtocol::Torrent).await;

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

/// Send the sample notification to the fake ntfy, signed in with its token.
async fn publish(mock: &Running) -> Result<(), DeliverError> {
    send_sample(&ntfy_settings(mock, NtfyAuth::Token, NTFY_TOKEN)).await
}

/// The statuses the fake ntfy answered, oldest first.
async fn statuses(mock: &Running) -> Vec<u64> {
    let record = ntfy_record(mock).await;
    let messages = record["messages"].as_array().unwrap();
    messages
        .iter()
        .map(|m| m["status"].as_u64().unwrap())
        .collect()
}

#[tokio::test]
async fn ntfy_server_error_makes_a_publish_one_the_server_retries() {
    let mock = spawn().await;
    control(&mock, "/_mock/ntfy", json!({"fail": "server_error"})).await;

    let err = publish(&mock).await.unwrap_err();

    assert!(
        matches!(err, DeliverError::Retry { after: None, .. }),
        "{err:?}"
    );
    assert_eq!(statuses(&mock).await, [500]);
}

#[tokio::test]
async fn ntfy_rate_limited_makes_a_publish_one_the_server_retries_after_the_seconds_set() {
    let mock = spawn().await;
    control(
        &mock,
        "/_mock/ntfy",
        json!({"fail": "rate_limited", "retry_after": 42}),
    )
    .await;

    let err = publish(&mock).await.unwrap_err();

    assert!(
        matches!(err, DeliverError::Retry { after: Some(after), .. } if after == Duration::from_secs(42)),
        "{err:?}"
    );
    assert_eq!(statuses(&mock).await, [429]);
}

#[tokio::test]
async fn ntfy_unauthorized_refuses_even_the_right_token_and_the_server_gives_up() {
    let mock = spawn().await;
    control(&mock, "/_mock/ntfy", json!({"fail": "unauthorized"})).await;

    let err = publish(&mock).await.unwrap_err();

    assert!(matches!(err, DeliverError::Permanent { .. }), "{err:?}");
    let got = ntfy_record(&mock).await["messages"][0].clone();
    assert_eq!(
        (&got["status"], &got["auth"]["matched"]),
        (&json!(401), &json!(true))
    );
}

#[tokio::test]
async fn ntfy_times_fails_only_that_many_publishes_then_answers_normally() {
    let mock = spawn().await;
    control(
        &mock,
        "/_mock/ntfy",
        json!({"fail": "server_error", "times": 2}),
    )
    .await;

    for _ in 0..2 {
        publish(&mock).await.unwrap_err();
    }
    publish(&mock).await.unwrap();

    assert_eq!(statuses(&mock).await, [500, 500, 200]);
    let record = ntfy_record(&mock).await;
    assert_eq!(
        (&record["fail"], &record["times"]),
        (&Value::Null, &Value::Null)
    );
}

#[tokio::test]
async fn ntfy_failure_without_times_holds_until_it_is_reset() {
    let mock = spawn().await;
    control(&mock, "/_mock/ntfy", json!({"fail": "rate_limited"})).await;
    for _ in 0..3 {
        publish(&mock).await.unwrap_err();
    }

    control(&mock, "/_mock/ntfy", json!({"fail": null})).await;

    publish(&mock).await.unwrap();
    assert_eq!(statuses(&mock).await, [429, 429, 429, 200]);
}

#[tokio::test]
async fn ntfy_delete_clears_the_record_and_keeps_the_failure() {
    let mock = spawn().await;
    publish(&mock).await.unwrap();
    control(&mock, "/_mock/ntfy", json!({"fail": "server_error"})).await;

    let reply = reqwest::Client::new()
        .delete(format!("{}/_mock/ntfy", mock.origin))
        .send()
        .await
        .unwrap();

    assert!(reply.status().is_success(), "{}", reply.status());
    let record = ntfy_record(&mock).await;
    assert_eq!(record["messages"], json!([]));
    assert_eq!(record["fail"], "server_error");
}

#[tokio::test]
async fn ntfy_settings_answer_a_client_error_for_a_bad_body() {
    let mock = spawn().await;

    for body in [
        json!({"fail": "sideways"}),
        json!({"fail": "server_error", "times": 0}),
        json!({"fail": "server_error", "retry_after": "soon"}),
        json!({"fial": null}),
    ] {
        let reply = control_reply(&mock, "/_mock/ntfy", body.clone()).await;

        assert!(
            reply.status().is_client_error(),
            "{body}: {}",
            reply.status()
        );
    }
}

#[tokio::test]
async fn ntfy_settings_refuse_a_body_they_would_ignore_and_change_nothing() {
    let mock = spawn().await;
    control(&mock, "/_mock/ntfy", json!({"fail": "server_error"})).await;

    for body in [
        json!({}),
        json!({"times": 2}),
        json!({"retry_after": 5}),
        json!({"fail": null, "times": 2}),
    ] {
        let reply = control_reply(&mock, "/_mock/ntfy", body.clone()).await;

        assert_eq!(reply.status(), 422, "{body}");
        let says = reply.text().await.unwrap();
        assert!(says.contains("fail"), "{body}: {says}");
    }
    assert_eq!(ntfy_record(&mock).await["fail"], "server_error");
}

#[tokio::test]
async fn ntfy_settings_replace_the_whole_failure_rather_than_merging() {
    let mock = spawn().await;
    control(
        &mock,
        "/_mock/ntfy",
        json!({"fail": "rate_limited", "times": 3, "retry_after": 5}),
    )
    .await;

    control(&mock, "/_mock/ntfy", json!({"fail": "server_error"})).await;

    let record = ntfy_record(&mock).await;
    assert_eq!(
        (&record["fail"], &record["times"], &record["retry_after"]),
        (&json!("server_error"), &Value::Null, &Value::Null)
    );
}

#[tokio::test]
async fn view_shows_the_ntfy_failure_and_how_many_publishes_were_kept() {
    let mock = spawn().await;
    publish(&mock).await.unwrap();

    control(
        &mock,
        "/_mock/ntfy",
        json!({"fail": "rate_limited", "times": 3, "retry_after": 5}),
    )
    .await;

    assert_eq!(
        view(&mock).await["ntfy"],
        json!({"fail": "rate_limited", "times": 3, "retry_after": 5, "received": 1})
    );
}
