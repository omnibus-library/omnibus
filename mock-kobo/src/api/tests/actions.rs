//! `POST /actions/*` route replies, over real TCP: sync's download policy,
//! download, remove-download, read, finish, highlight, delete-highlight,
//! read-to and highlight-words.

use crate::test_support::{device_holding, reader_stub, READER_EPUB, READER_KEPUB};

use super::*;

fn span_location() -> Value {
    json!({
        "chapter": "OEBPS/ch1.xhtml",
        "start_span": "kobo.1.2",
        "start_char": 3,
        "end_span": "kobo.1.4",
        "end_char": 9,
    })
}

/// `/actions/sync` then `/actions/download` on `base`'s one "book-1".
async fn synced_and_downloaded(base: &str) {
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
}

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
    let client = reqwest::Client::new();

    let unknown_value = client
        .post(format!("{base}/actions/sync"))
        .json(&json!({ "download": "not-a-real-policy" }))
        .send()
        .await
        .unwrap();
    let misspelt_key = client
        .post(format!("{base}/actions/sync"))
        .json(&json!({ "downlaod": "all" }))
        .send()
        .await
        .unwrap();
    let non_json = client
        .post(format!("{base}/actions/sync"))
        .body("not json")
        .send()
        .await
        .unwrap();
    let wrong_type = client
        .post(format!("{base}/actions/sync"))
        .json(&json!({ "download": 5 }))
        .send()
        .await
        .unwrap();

    for response in [unknown_value, misspelt_key, non_json, wrong_type] {
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body: Value = response.json().await.unwrap();
        assert_eq!(body["code"], "invalid_request");
    }
    assert!(stub.paths().is_empty(), "no request reached the stub");
}

#[tokio::test]
async fn post_actions_sync_downloads_only_the_listed_book() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([
            new_entitlement("book-1", "Dune"),
            new_entitlement("book-2", "Dune Messiah"),
        ])],
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/sync"))
        .json(&json!({ "download": ["book-1"] }))
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
    assert_eq!(body["details"]["library"]["book-2"]["downloaded"], false);
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
async fn post_actions_download_returns_not_synced_before_any_sync() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let device = device_holding("book-1", "Dune");
    let base = serve(stub_control_with(&stub, device, dir.path().join("kobo.json"))).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/download"))
        .json(&json!({ "books": ["book-1"] }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "not_synced");
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

#[tokio::test]
async fn post_actions_highlight_returns_annotation_sent_reply() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    synced_and_downloaded(&base).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/highlight"))
        .json(&json!({
            "book": "book-1",
            "text": "a passage",
            "color": "blue",
            "location": span_location(),
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "annotation_sent");
    let highlights = &body["details"]["library"]["book-1"]["annotations"];
    assert_eq!(highlights[0]["color"], "blue");
    assert_eq!(highlights[0]["text"], "a passage");
}

#[tokio::test]
async fn post_actions_highlight_returns_invalid_request_for_an_unknown_colour() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    synced_and_downloaded(&base).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/highlight"))
        .json(&json!({
            "book": "book-1",
            "text": "a passage",
            "color": "purple",
            "location": span_location(),
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "invalid_request");
}

#[tokio::test]
async fn post_actions_highlight_returns_invalid_request_for_empty_text() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    synced_and_downloaded(&base).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/highlight"))
        .json(&json!({
            "book": "book-1",
            "text": "",
            "color": "blue",
            "location": span_location(),
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "invalid_request");
}

#[tokio::test]
async fn post_actions_highlight_returns_invalid_request_for_whitespace_only_text() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    synced_and_downloaded(&base).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/highlight"))
        .json(&json!({
            "book": "book-1",
            "text": "   ",
            "color": "blue",
            "location": span_location(),
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "invalid_request");
}

#[tokio::test]
async fn post_actions_highlight_returns_not_synced_before_any_sync() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let mut device = device_holding("book-1", "Dune");
    device.library.get_mut("book-1").unwrap().downloaded = true;
    let base = serve(stub_control_with(
        &stub,
        device,
        dir.path().join("kobo.json"),
    ))
    .await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/highlight"))
        .json(&json!({
            "book": "book-1",
            "text": "a passage",
            "color": "blue",
            "location": span_location(),
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "not_synced");
}

#[tokio::test]
async fn post_actions_highlight_returns_not_downloaded_for_an_undownloaded_book() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    reqwest::Client::new()
        .post(format!("{base}/actions/sync"))
        .send()
        .await
        .unwrap();

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/highlight"))
        .json(&json!({
            "book": "book-1",
            "text": "a passage",
            "color": "blue",
            "location": span_location(),
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "not_downloaded");
}

#[tokio::test]
async fn post_actions_highlight_returns_annotation_failed_when_the_patch_answers_500() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        patch_status: StatusCode::INTERNAL_SERVER_ERROR,
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    synced_and_downloaded(&base).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/highlight"))
        .json(&json!({
            "book": "book-1",
            "text": "a passage",
            "color": "blue",
            "location": span_location(),
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "annotation_failed");
}

#[tokio::test]
async fn post_actions_delete_highlight_returns_annotation_sent_reply() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    synced_and_downloaded(&base).await;
    let client = reqwest::Client::new();
    let highlighted: Value = client
        .post(format!("{base}/actions/highlight"))
        .json(&json!({
            "book": "book-1",
            "text": "a passage",
            "color": "blue",
            "location": span_location(),
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let highlight_id = highlighted["details"]["library"]["book-1"]["annotations"][0]["id"]
        .as_str()
        .unwrap();

    let response = client
        .post(format!("{base}/actions/delete-highlight"))
        .json(&json!({ "book": "book-1", "highlight": highlight_id }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "annotation_sent");
    assert!(body["details"]["library"]["book-1"]["annotations"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn post_actions_delete_highlight_returns_unknown_highlight_for_an_id_the_book_lacks() {
    let stub = spawn_stub(dune_stub()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    synced_and_downloaded(&base).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/delete-highlight"))
        .json(&json!({ "book": "book-1", "highlight": "nope" }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "unknown_highlight");
}

#[tokio::test]
async fn post_actions_read_to_returns_state_sent_reply() {
    let stub = spawn_stub(reader_stub(READER_KEPUB)).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    synced_and_downloaded(&base).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/read-to"))
        .json(&json!({ "book": "book-1", "passage": "Paul and Jessica walked" }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "state_sent");
}

#[tokio::test]
async fn post_actions_read_to_returns_invalid_request_for_an_empty_passage() {
    let stub = spawn_stub(reader_stub(READER_KEPUB)).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/read-to"))
        .json(&json!({ "book": "book-1", "passage": "   " }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "invalid_request");
}

#[tokio::test]
async fn post_actions_read_to_returns_passage_not_found_for_words_the_book_lacks() {
    let stub = spawn_stub(reader_stub(READER_KEPUB)).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    synced_and_downloaded(&base).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/read-to"))
        .json(&json!({ "book": "book-1", "passage": "words that are not in the book" }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "passage_not_found");
}

#[tokio::test]
async fn post_actions_read_to_returns_no_kobo_spans_for_a_plain_epub() {
    let stub = spawn_stub(reader_stub(READER_EPUB)).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    synced_and_downloaded(&base).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/read-to"))
        .json(&json!({ "book": "book-1", "passage": "Paul and Jessica walked" }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "no_kobo_spans");
}

#[tokio::test]
async fn post_actions_read_to_returns_book_unreadable_for_a_missing_file() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let mut device = device_holding("book-1", "Reader Fixture");
    device.library.get_mut("book-1").unwrap().downloaded = true;
    let base = serve(stub_control_with(
        &stub,
        device,
        dir.path().join("kobo.json"),
    ))
    .await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/read-to"))
        .json(&json!({ "book": "book-1", "passage": "whatever" }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "book_unreadable");
}

#[tokio::test]
async fn post_actions_highlight_words_returns_annotation_sent_reply() {
    let stub = spawn_stub(reader_stub(READER_KEPUB)).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    synced_and_downloaded(&base).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/highlight-words"))
        .json(&json!({ "book": "book-1", "passage": "Paul and Jessica walked", "color": "blue" }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "annotation_sent");
}

#[tokio::test]
async fn post_actions_highlight_words_returns_invalid_request_for_an_unknown_colour() {
    let stub = spawn_stub(reader_stub(READER_KEPUB)).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    synced_and_downloaded(&base).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/highlight-words"))
        .json(&json!({
            "book": "book-1",
            "passage": "Paul and Jessica walked",
            "color": "purple",
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "invalid_request");
}
