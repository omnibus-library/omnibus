//! The connection CRUD routes: create, replace, switch and delete, with their 422s and 404s,
//! secrets that never come back out, and the on/off value a save leaves alone.

use super::*;

mod create_connection {
    use super::*;

    #[tokio::test]
    async fn create_connection_answers_201_without_the_secret_it_saved() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let body = connection(
            "Phone",
            with_token("https://ntfy.example.com/", Some(TOKEN)),
        );

        let (status, text) = call(&app, &token, "POST", CONNECTIONS, Some(body)).await;

        assert_eq!(status, StatusCode::CREATED);
        assert!(!text.contains(TOKEN), "{text}");
        let created: NotificationConnection = serde_json::from_str(&text).unwrap();
        assert_eq!(created.name, "Phone");
        assert!(created.enabled);
        assert_eq!(status_of(&created).server_url, "https://ntfy.example.com");
        assert!(status_of(&created).token_set);
    }

    #[tokio::test]
    async fn create_connection_turns_it_on_when_enabled_is_left_out_and_honours_a_sent_value() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let mut sent_off = connection("Off", ntfy("https://ntfy.example.com"));
        sent_off["enabled"] = json!(false);

        let left_out = create(
            &app,
            &token,
            connection("On", ntfy("https://ntfy.example.com")),
        )
        .await;
        let off = create(&app, &token, sent_off).await;

        assert!(left_out.enabled);
        assert!(!off.enabled);
    }

    #[tokio::test]
    async fn create_connection_answers_422_with_the_reason_for_invalid_settings() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let body = connection("Phone", with_token("https://ntfy.example.com", None));

        let (status, text) = call(&app, &token, "POST", CONNECTIONS, Some(body)).await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(text, "a token is required when auth is token");
    }

    #[tokio::test]
    async fn create_connection_answers_422_for_a_blank_name() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let body = connection("  ", ntfy("https://ntfy.example.com"));

        let (status, text) = call(&app, &token, "POST", CONNECTIONS, Some(body)).await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(text.contains("name"), "{text}");
    }

    #[tokio::test]
    async fn create_connection_answers_422_for_an_unknown_provider() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let body = connection("Phone", json!({ "kind": "pigeon" }));

        let (status, _) = call(&app, &token, "POST", CONNECTIONS, Some(body)).await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    }
}

mod update_connection {
    use super::*;

    /// Save connection `id` as the admin with `enabled` set, or left out when `None`.
    async fn put(
        app: &Router,
        token: &str,
        id: i64,
        enabled: Option<bool>,
    ) -> NotificationConnection {
        let mut body = connection("Renamed", ntfy("https://ntfy.example.com"));
        if let Some(enabled) = enabled {
            body["enabled"] = json!(enabled);
        }
        let (status, text) = call(
            app,
            token,
            "PUT",
            &format!("{CONNECTIONS}/{id}"),
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{text}");
        serde_json::from_str(&text).unwrap()
    }

    #[tokio::test]
    async fn update_connection_keeps_the_saved_on_off_value_when_enabled_is_left_out() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let on = create(
            &app,
            &token,
            connection("On", ntfy("https://ntfy.example.com")),
        )
        .await
        .id;
        let off = create(
            &app,
            &token,
            connection("Off", ntfy("https://ntfy.example.com")),
        )
        .await
        .id;
        let patch = Some(json!({ "enabled": false }));
        call(
            &app,
            &token,
            "PATCH",
            &format!("{CONNECTIONS}/{off}"),
            patch,
        )
        .await;

        let kept_on = put(&app, &token, on, None).await;
        let kept_off = put(&app, &token, off, None).await;

        assert!(kept_on.enabled);
        assert!(!kept_off.enabled);
        let listed: NotificationConnections = body_json(
            app.clone()
                .oneshot(request("GET", CONNECTIONS, Some(&token), None))
                .await
                .unwrap(),
        )
        .await;
        let enabled: Vec<(i64, bool)> = listed
            .connections
            .iter()
            .map(|c| (c.id, c.enabled))
            .collect();
        assert_eq!(enabled, [(on, true), (off, false)]);
    }

    #[tokio::test]
    async fn update_connection_applies_an_enabled_value_that_is_sent() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let id = create(
            &app,
            &token,
            connection("Phone", ntfy("https://ntfy.example.com")),
        )
        .await
        .id;

        let off = put(&app, &token, id, Some(false)).await;
        let on = put(&app, &token, id, Some(true)).await;

        assert!(!off.enabled);
        assert!(on.enabled);
    }

    #[tokio::test]
    async fn update_connection_keeps_a_token_left_out_and_returns_none_of_it() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let server = ntfy_answering(ResponseTemplate::new(200)).await;
        let id = create(
            &app,
            &token,
            connection("Phone", with_token(&server.uri(), Some(TOKEN))),
        )
        .await
        .id;
        let uri = format!("{CONNECTIONS}/{id}");

        let (status, text) = call(
            &app,
            &token,
            "PUT",
            &uri,
            Some(connection("Renamed", with_token(&server.uri(), None))),
        )
        .await;
        let test = json!({ "id": id, "settings": with_token(&server.uri(), None) });
        let (sent, _) = call(&app, &token, "POST", TEST, Some(test)).await;

        assert_eq!(status, StatusCode::OK);
        assert!(!text.contains(TOKEN), "{text}");
        let updated: NotificationConnection = serde_json::from_str(&text).unwrap();
        assert_eq!(updated.name, "Renamed");
        assert!(status_of(&updated).token_set);
        assert_eq!(sent, StatusCode::NO_CONTENT);
        assert_eq!(authorizations(&server).await, [format!("Bearer {TOKEN}")]);
    }

    #[tokio::test]
    async fn update_connection_replaces_the_password_with_a_new_one() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let server = ntfy_answering(ResponseTemplate::new(200)).await;
        let id = create(
            &app,
            &token,
            connection("Phone", with_basic(&server.uri(), Some(PASSWORD))),
        )
        .await
        .id;

        let (status, _) = call(
            &app,
            &token,
            "PUT",
            &format!("{CONNECTIONS}/{id}"),
            Some(connection(
                "Phone",
                with_basic(&server.uri(), Some("new-pw")),
            )),
        )
        .await;
        let test = json!({ "id": id, "settings": with_basic(&server.uri(), None) });
        call(&app, &token, "POST", TEST, Some(test)).await;

        assert_eq!(status, StatusCode::OK);
        // base64("ada:new-pw")
        assert_eq!(authorizations(&server).await, ["Basic YWRhOm5ldy1wdw=="]);
    }

    #[tokio::test]
    async fn update_connection_answers_422_when_the_server_url_changes_without_the_token() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let saved = ntfy_answering(ResponseTemplate::new(200)).await;
        let elsewhere = ntfy_answering(ResponseTemplate::new(200)).await;
        let id = create(
            &app,
            &token,
            connection("Phone", with_token(&saved.uri(), Some(TOKEN))),
        )
        .await
        .id;

        let (status, text) = call(
            &app,
            &token,
            "PUT",
            &format!("{CONNECTIONS}/{id}"),
            Some(connection("Phone", with_token(&elsewhere.uri(), None))),
        )
        .await;
        let test = json!({ "id": id, "settings": with_token(&saved.uri(), None) });
        call(&app, &token, "POST", TEST, Some(test)).await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(text, "enter the token again: the server URL changed");
        assert!(elsewhere.received_requests().await.unwrap().is_empty());
        // Nothing was saved: the token still goes to its own server.
        assert_eq!(authorizations(&saved).await, [format!("Bearer {TOKEN}")]);
    }

    #[tokio::test]
    async fn update_connection_answers_422_when_an_empty_token_clears_the_only_one() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let id = create(
            &app,
            &token,
            connection("Phone", with_token("http://127.0.0.1:9", Some(TOKEN))),
        )
        .await
        .id;

        let (status, text) = call(
            &app,
            &token,
            "PUT",
            &format!("{CONNECTIONS}/{id}"),
            Some(connection(
                "Phone",
                with_token("http://127.0.0.1:9", Some("")),
            )),
        )
        .await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(text, "a token is required when auth is token");
    }

    #[tokio::test]
    async fn update_connection_answers_404_for_an_unknown_id() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let (status, _) = call(
            &app,
            &token,
            "PUT",
            &format!("{CONNECTIONS}/42"),
            Some(connection("Phone", ntfy("http://127.0.0.1:9"))),
        )
        .await;

        assert_eq!(status, StatusCode::NOT_FOUND);
    }
}

mod set_connection_enabled {
    use super::*;

    #[tokio::test]
    async fn set_connection_enabled_answers_200_with_the_whole_connection_and_no_secret() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let created = create(
            &app,
            &token,
            connection("Phone", with_token("http://127.0.0.1:9", Some(TOKEN))),
        )
        .await;
        let uri = format!("{CONNECTIONS}/{}", created.id);

        let (status, text) = call(
            &app,
            &token,
            "PATCH",
            &uri,
            Some(json!({ "enabled": false })),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert!(!text.contains(TOKEN), "{text}");
        let switched: NotificationConnection = serde_json::from_str(&text).unwrap();
        assert!(!switched.enabled);
        assert_eq!(switched.name, created.name);
        assert_eq!(switched.events, created.events);
        assert_eq!(switched.settings, created.settings);
        assert!(status_of(&switched).token_set);
        assert_eq!(switched.last_delivery, None);
    }

    #[tokio::test]
    async fn set_connection_enabled_answers_404_for_an_unknown_id() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let (status, _) = call(
            &app,
            &token,
            "PATCH",
            &format!("{CONNECTIONS}/42"),
            Some(json!({ "enabled": true })),
        )
        .await;

        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn set_connection_enabled_answers_422_for_a_body_that_is_not_just_a_bool_enabled() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let id = create(
            &app,
            &token,
            connection("Phone", ntfy("http://127.0.0.1:9")),
        )
        .await
        .id;
        let uri = format!("{CONNECTIONS}/{id}");

        for body in [
            json!({}),
            json!({ "enabled": "yes" }),
            json!({ "enabled": true, "name": "x" }),
        ] {
            let (status, _) = call(&app, &token, "PATCH", &uri, Some(body.clone())).await;
            assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        }
        let (_, text) = call(&app, &token, "GET", CONNECTIONS, None).await;
        let listed: NotificationConnections = serde_json::from_str(&text).unwrap();
        assert!(listed.connections[0].enabled);
        assert_eq!(listed.connections[0].name, "Phone");
    }
}

mod delete_connection {
    use super::*;

    #[tokio::test]
    async fn delete_connection_answers_204_and_the_connection_is_gone() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let id = create(
            &app,
            &token,
            connection("Phone", ntfy("http://127.0.0.1:9")),
        )
        .await
        .id;

        let (status, _) = call(&app, &token, "DELETE", &format!("{CONNECTIONS}/{id}"), None).await;
        let (_, text) = call(&app, &token, "GET", CONNECTIONS, None).await;

        assert_eq!(status, StatusCode::NO_CONTENT);
        let listed: NotificationConnections = serde_json::from_str(&text).unwrap();
        assert!(listed.connections.is_empty());
    }

    #[tokio::test]
    async fn delete_connection_answers_404_for_an_unknown_id() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let (status, _) = call(&app, &token, "DELETE", &format!("{CONNECTIONS}/42"), None).await;

        assert_eq!(status, StatusCode::NOT_FOUND);
    }
}
