//! `POST /actions/*` route replies, over real TCP: sync's download policy,
//! download, remove-download, read and finish.

use super::*;

#[tokio::test]
async fn post_actions_sync_downloads_every_book_when_the_body_asks_for_all() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/sync"))
        .json(&json!({ "download": "all" }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = reqwest::get(format!("{base}/device"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body["details"]["library"]["book-1"]["downloaded"], true);
}

#[tokio::test]
async fn post_actions_sync_returns_invalid_request_for_an_unreadable_body() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/sync"))
        .json(&json!({ "download": "not-a-real-policy" }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "invalid_request");
}

#[tokio::test]
async fn get_device_never_carries_the_token_of_a_download_url() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    reqwest::Client::new()
        .post(format!("{base}/actions/sync"))
        .json(&json!({ "download": "all" }))
        .send()
        .await
        .unwrap();

    let body: Value = reqwest::get(format!("{base}/device"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert!(!body.to_string().contains(STUB_TOKEN));
}

#[tokio::test]
async fn post_actions_download_returns_downloaded_reply_with_the_device() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    reqwest::Client::new()
        .post(format!("{base}/actions/sync"))
        .send()
        .await
        .unwrap();

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/download"))
        .json(&json!({ "books": ["book-1"] }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "downloaded");
    assert_eq!(body["details"]["library"]["book-1"]["downloaded"], true);
}

#[tokio::test]
async fn post_actions_download_returns_download_failed_with_the_quirk_when_the_download_answers_404(
) {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        download_status: StatusCode::NOT_FOUND,
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    reqwest::Client::new()
        .post(format!("{base}/actions/sync"))
        .send()
        .await
        .unwrap();

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/download"))
        .json(&json!({ "books": ["book-1"] }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "download_failed");
    assert_eq!(body["details"]["quirk"], "DownloadFailure");
}

#[tokio::test]
async fn post_actions_download_returns_unknown_book_for_a_book_the_device_lacks() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/download"))
        .json(&json!({ "books": ["book-1"] }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "unknown_book");
}

#[tokio::test]
async fn post_actions_download_returns_invalid_request_for_an_empty_book_list() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/download"))
        .json(&json!({ "books": [] }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "invalid_request");
}

#[tokio::test]
async fn post_actions_remove_download_returns_download_removed_reply() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    let client = reqwest::Client::new();
    client
        .post(format!("{base}/actions/sync"))
        .send()
        .await
        .unwrap();
    client
        .post(format!("{base}/actions/download"))
        .json(&json!({ "books": ["book-1"] }))
        .send()
        .await
        .unwrap();

    let response = client
        .post(format!("{base}/actions/remove-download"))
        .json(&json!({ "book": "book-1" }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "download_removed");
    assert_eq!(body["details"]["library"]["book-1"]["downloaded"], false);
}

#[tokio::test]
async fn post_actions_read_returns_state_sent_reply() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    let client = reqwest::Client::new();
    client
        .post(format!("{base}/actions/sync"))
        .json(&json!({ "download": "all" }))
        .send()
        .await
        .unwrap();

    let response = client
        .post(format!("{base}/actions/read"))
        .json(&json!({ "book": "book-1", "percent": 42 }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "state_sent");
    assert_eq!(
        body["details"]["library"]["book-1"]["reading"]["status"],
        "Reading"
    );
}

#[tokio::test]
async fn post_actions_read_returns_invalid_request_for_a_percent_over_100() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/read"))
        .json(&json!({ "book": "book-1", "percent": 101 }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "invalid_request");
}

#[tokio::test]
async fn post_actions_read_returns_not_downloaded_for_an_undownloaded_book() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    reqwest::Client::new()
        .post(format!("{base}/actions/sync"))
        .send()
        .await
        .unwrap();

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/read"))
        .json(&json!({ "book": "book-1", "percent": 42 }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "not_downloaded");
}

#[tokio::test]
async fn post_actions_read_returns_state_failed_with_the_quirk_when_a_sub_result_is_not_success() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        state_reply: Some(json!({
            "RequestResult": "Success",
            "UpdateResults": [{
                "StatusInfoResult": { "Result": "Success" },
                "CurrentBookmarkResult": { "Result": "Conflict" },
            }],
        })),
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    let client = reqwest::Client::new();
    client
        .post(format!("{base}/actions/sync"))
        .json(&json!({ "download": "all" }))
        .send()
        .await
        .unwrap();

    let response = client
        .post(format!("{base}/actions/read"))
        .json(&json!({ "book": "book-1", "percent": 42 }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "state_failed");
    assert_eq!(body["details"]["quirk"], "StatePutResult");
}

#[tokio::test]
async fn post_actions_finish_returns_state_sent_reply() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    reqwest::Client::new()
        .post(format!("{base}/actions/sync"))
        .send()
        .await
        .unwrap();

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/finish"))
        .json(&json!({ "book": "book-1" }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "state_sent");
    assert_eq!(
        body["details"]["library"]["book-1"]["reading"]["status"],
        "Finished"
    );
}
