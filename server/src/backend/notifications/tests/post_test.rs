//! The test send against a local ntfy stand-in: what it sends, the secret it fills in from
//! a saved connection, and how a provider's refusal comes back.

use super::*;

#[tokio::test]
async fn post_test_answers_204_when_the_provider_accepts_an_unsaved_draft() {
    let (app, _, pool) = fixture().await;
    let token = admin_token(&pool).await;
    let server = ntfy_answering(ResponseTemplate::new(200)).await;
    let body = json!({ "settings": with_token(&server.uri(), Some(TOKEN)) });

    let (status, _) = call(&app, &token, "POST", TEST, Some(body)).await;

    assert_eq!(status, StatusCode::NO_CONTENT);
    let received = server.received_requests().await.unwrap();
    let sent: Value = serde_json::from_slice(&received[0].body).unwrap();
    assert_eq!(sent["title"], "Test notification from Omnibus");
    assert_eq!(authorizations(&server).await, [format!("Bearer {TOKEN}")]);
}

#[tokio::test]
async fn post_test_answers_502_with_a_sentence_for_the_providers_refusal() {
    let cases = [
        (
            401,
            "ntfy refused the sign-in. Check the access token, or the username and password.",
        ),
        (
            500,
            "The ntfy server had a problem and couldn't take the message (HTTP 500).",
        ),
    ];
    for (code, sentence) in cases {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let server = ntfy_answering(ResponseTemplate::new(code).set_body_string("disk full")).await;
        let body = json!({ "settings": ntfy(&server.uri()) });

        let (status, text) = call(&app, &token, "POST", TEST, Some(body)).await;

        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_eq!(text, sentence);
    }
}

#[tokio::test]
async fn post_test_answers_502_with_a_sentence_when_nothing_listens() {
    let (app, _, pool) = fixture().await;
    let token = admin_token(&pool).await;
    let body = json!({ "settings": ntfy(&omnibus_db::test_support::closed_port_url()) });

    let (status, text) = call(&app, &token, "POST", TEST, Some(body)).await;

    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(
        text,
        "Couldn't connect to the ntfy server. Check the server URL and that the server is running."
    );
}

#[tokio::test]
async fn post_test_answers_502_without_the_token_a_provider_echoes() {
    let (app, _, pool) = fixture().await;
    let token = admin_token(&pool).await;
    let server = MockServer::start().await;
    Mock::given(wiremock::matchers::method("POST"))
        .respond_with(|request: &Request| {
            let auth = request
                .headers
                .get("authorization")
                .and_then(|v| v.to_str().ok());
            ResponseTemplate::new(403)
                .set_body_string(format!("refused {}", auth.unwrap_or_default()))
        })
        .mount(&server)
        .await;
    let body = json!({ "settings": with_token(&server.uri(), Some(TOKEN)) });

    let (status, text) = call(&app, &token, "POST", TEST, Some(body)).await;

    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert!(!text.contains(TOKEN), "{text}");
    assert_eq!(
            text,
            "ntfy didn't let this sign-in post to the topic. Check that the token or account can write to it."
        );
}

#[tokio::test]
async fn post_test_answers_422_and_sends_nothing_when_a_saved_secret_would_go_elsewhere() {
    let (app, _, pool) = fixture().await;
    let token = admin_token(&pool).await;
    let saved = ntfy_answering(ResponseTemplate::new(200)).await;
    let elsewhere = ntfy_answering(ResponseTemplate::new(200)).await;
    let token_id = create(
        &app,
        &token,
        connection("Token", with_token(&saved.uri(), Some(TOKEN))),
    )
    .await
    .id;
    let basic_id = create(
        &app,
        &token,
        connection("Basic", with_basic(&saved.uri(), Some(PASSWORD))),
    )
    .await
    .id;

    let tests = [
        (
            json!({ "id": token_id, "settings": with_token(&elsewhere.uri(), None) }),
            "enter the token again: the server URL changed",
        ),
        (
            json!({ "id": basic_id, "settings": with_basic(&elsewhere.uri(), None) }),
            "enter the password again: the server URL or username changed",
        ),
    ];
    for (body, expected) in tests {
        let (status, text) = call(&app, &token, "POST", TEST, Some(body)).await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(text, expected);
    }
    assert!(elsewhere.received_requests().await.unwrap().is_empty());
    assert!(saved.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn post_test_answers_404_for_an_unknown_saved_connection() {
    let (app, _, pool) = fixture().await;
    let token = admin_token(&pool).await;
    let body = json!({ "id": 42, "settings": ntfy("http://127.0.0.1:9") });

    let (status, _) = call(&app, &token, "POST", TEST, Some(body)).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn post_test_answers_422_for_an_unsaved_draft_missing_its_token() {
    let (app, _, pool) = fixture().await;
    let token = admin_token(&pool).await;
    let body = json!({ "settings": with_token("http://127.0.0.1:9", None) });

    let (status, text) = call(&app, &token, "POST", TEST, Some(body)).await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(text, "a token is required when auth is token");
}
