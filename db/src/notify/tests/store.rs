//! The connection store: create, get, update and delete with their checks, the secret kept
//! across an update, the list's order and last delivery, and the cascade to the outbox.

use omnibus_shared::{ConnectionSettingsStatus, NotificationConnectionInput, NotificationEvent};

use super::super::test_support::{
    connection_input, deliveries, ntfy_input, ntfy_of, save_connection, token_input,
};
use super::*;

const URL: &str = "https://ntfy.example.com";
const EVENTS: &[NotificationEvent] = &[NotificationEvent::RequestNeedsChooser];

fn token_set(connection: &omnibus_shared::NotificationConnection) -> bool {
    let ConnectionSettingsStatus::Ntfy(status) = &connection.settings;
    status.token_set
}

async fn saved_token(pool: &SqlitePool, id: i64) -> Option<String> {
    match &ntfy_of(&get_connection(pool, id).await.unwrap().settings).auth {
        NtfyCredentials::Token { token } => Some(token.expose().to_string()),
        _ => None,
    }
}

async fn connection_count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM notification_connections")
        .fetch_one(pool)
        .await
        .unwrap()
}

/// A finished outbox row for connection `id`.
async fn finished(pool: &SqlitePool, id: i64, state: &str, at: i64, error: Option<&str>) {
    sqlx::query(
        "INSERT INTO notification_deliveries
            (connection_id, event, payload, state, finished_at, last_error)
         VALUES (?, 'request_needs_chooser', '{}', ?, ?, ?)",
    )
    .bind(id)
    .bind(state)
    .bind(at)
    .bind(error)
    .execute(pool)
    .await
    .unwrap();
}

mod create_connection {
    use super::*;

    #[tokio::test]
    async fn create_connection_saves_the_secret_and_returns_it_masked() {
        let pool = pool().await;
        let input = connection_input(" Phone ", token_input(URL, Some("tk_secret")));

        let created = create_connection(&pool, &input).await.unwrap();

        assert_eq!(created.name, "Phone");
        assert!(created.enabled);
        assert!(token_set(&created));
        assert_eq!(created.last_delivery, None);
        assert!(!serde_json::to_string(&created)
            .unwrap()
            .contains("tk_secret"));
        assert_eq!(
            saved_token(&pool, created.id).await.as_deref(),
            Some("tk_secret")
        );
    }

    #[tokio::test]
    async fn create_connection_counts_a_repeated_event_once() {
        let pool = pool().await;
        let input = NotificationConnectionInput {
            events: vec![NotificationEvent::RequestNeedsChooser; 3],
            ..connection_input("Phone", ntfy_input(URL))
        };

        let created = create_connection(&pool, &input).await.unwrap();

        assert_eq!(created.events, [NotificationEvent::RequestNeedsChooser]);
    }

    #[tokio::test]
    async fn create_connection_refuses_a_blank_or_overlong_name_and_saves_nothing() {
        let pool = pool().await;
        for name in ["   ", &"n".repeat(NAME_MAX_CHARS + 1)] {
            let input = connection_input(name, ntfy_input(URL));

            let result = create_connection(&pool, &input).await;

            assert!(
                matches!(result, Err(NotifyError::Validation(_))),
                "{name:?}"
            );
        }
        assert_eq!(connection_count(&pool).await, 0);
    }

    #[tokio::test]
    async fn create_connection_refuses_invalid_settings() {
        let pool = pool().await;
        let input = connection_input("Phone", token_input(URL, None));

        let result = create_connection(&pool, &input).await;

        assert!(matches!(result, Err(NotifyError::Validation(_))));
    }
}

mod get_connection {
    use super::*;

    #[tokio::test]
    async fn get_connection_returns_the_stored_settings() {
        let pool = pool().await;
        let id = save_connection(&pool, "Phone", URL, false, EVENTS).await;

        let connection = get_connection(&pool, id).await.unwrap();

        assert_eq!(connection.name, "Phone");
        assert!(!connection.enabled);
        assert_eq!(connection.events, EVENTS);
        assert_eq!(ntfy_of(&connection.settings).server_url, URL);
    }

    #[tokio::test]
    async fn get_connection_answers_not_found_for_an_unknown_id() {
        let pool = pool().await;

        assert!(matches!(
            get_connection(&pool, 42).await,
            Err(NotifyError::NotFound)
        ));
    }
}

mod update_connection {
    use super::*;

    async fn with_token(pool: &SqlitePool) -> i64 {
        let input = connection_input("Phone", token_input(URL, Some("tk_saved")));
        create_connection(pool, &input).await.unwrap().id
    }

    #[tokio::test]
    async fn update_connection_replaces_the_fields_and_keeps_a_token_left_out() {
        let pool = pool().await;
        let id = with_token(&pool).await;
        let input = NotificationConnectionInput {
            enabled: false,
            events: Vec::new(),
            ..connection_input("Tablet", token_input(URL, None))
        };

        let updated = update_connection(&pool, id, &input).await.unwrap();

        assert_eq!(updated.name, "Tablet");
        assert!(!updated.enabled);
        assert!(updated.events.is_empty());
        assert!(token_set(&updated));
        assert_eq!(saved_token(&pool, id).await.as_deref(), Some("tk_saved"));
    }

    #[tokio::test]
    async fn update_connection_replaces_the_token_with_a_new_one() {
        let pool = pool().await;
        let id = with_token(&pool).await;
        let input = connection_input("Phone", token_input(URL, Some("tk_new")));

        update_connection(&pool, id, &input).await.unwrap();

        assert_eq!(saved_token(&pool, id).await.as_deref(), Some("tk_new"));
    }

    #[tokio::test]
    async fn update_connection_refuses_an_invalid_change_and_keeps_the_saved_row() {
        let pool = pool().await;
        let id = with_token(&pool).await;
        let input = connection_input("Renamed", token_input(URL, Some("")));

        let result = update_connection(&pool, id, &input).await;

        assert!(matches!(result, Err(NotifyError::Validation(_))));
        let kept = get_connection(&pool, id).await.unwrap();
        assert_eq!(kept.name, "Phone");
        assert_eq!(saved_token(&pool, id).await.as_deref(), Some("tk_saved"));
    }

    #[tokio::test]
    async fn update_connection_answers_not_found_for_an_unknown_id() {
        let pool = pool().await;
        let input = connection_input("Phone", ntfy_input(URL));

        let result = update_connection(&pool, 42, &input).await;

        assert!(matches!(result, Err(NotifyError::NotFound)));
    }

    #[tokio::test]
    async fn update_connection_returns_the_last_delivery() {
        let pool = pool().await;
        let id = with_token(&pool).await;
        finished(&pool, id, "delivered", 100, None).await;
        let input = connection_input("Phone", token_input(URL, None));

        let updated = update_connection(&pool, id, &input).await.unwrap();

        let last = updated.last_delivery.unwrap();
        assert_eq!((last.at, last.ok), (100, true));
    }
}

mod delete_connection {
    use super::*;

    #[tokio::test]
    async fn delete_connection_removes_it_and_every_notification_for_it() {
        let pool = pool().await;
        let id = save_connection(&pool, "Phone", URL, true, EVENTS).await;
        let other = save_connection(&pool, "Tablet", URL, true, EVENTS).await;
        finished(&pool, id, "delivered", 100, None).await;
        finished(&pool, other, "delivered", 100, None).await;

        delete_connection(&pool, id).await.unwrap();

        assert!(matches!(
            get_connection(&pool, id).await,
            Err(NotifyError::NotFound)
        ));
        let left: Vec<i64> = deliveries(&pool)
            .await
            .iter()
            .map(|d| d.connection_id)
            .collect();
        assert_eq!(left, [other]);
    }

    #[tokio::test]
    async fn delete_connection_answers_not_found_for_an_unknown_id() {
        let pool = pool().await;

        assert!(matches!(
            delete_connection(&pool, 42).await,
            Err(NotifyError::NotFound)
        ));
    }
}

mod list_connections {
    use super::*;

    #[tokio::test]
    async fn list_connections_sorts_by_name_and_shows_the_latest_finished_delivery() {
        let pool = pool().await;
        let phone = save_connection(&pool, "phone", URL, true, EVENTS).await;
        let attic = save_connection(&pool, "Attic", URL, true, EVENTS).await;
        finished(&pool, phone, "delivered", 100, None).await;
        finished(&pool, phone, "failed", 200, Some("the server answered 401")).await;
        sqlx::query(
            "INSERT INTO notification_deliveries (connection_id, event, payload, state)
             VALUES (?, 'request_needs_chooser', '{}', 'queued')",
        )
        .bind(phone)
        .execute(&pool)
        .await
        .unwrap();

        let listed = list_connections(&pool).await.unwrap();

        let ids: Vec<i64> = listed.iter().map(|c| c.id).collect();
        assert_eq!(ids, [attic, phone]);
        assert_eq!(listed[0].last_delivery, None);
        let last = listed[1].last_delivery.clone().unwrap();
        assert_eq!(last.at, 200);
        assert!(!last.ok);
        assert_eq!(last.error.as_deref(), Some("the server answered 401"));
    }

    #[tokio::test]
    async fn list_connections_never_carries_a_secret() {
        let pool = pool().await;
        let input = connection_input("Phone", token_input(URL, Some("tk_secret")));
        create_connection(&pool, &input).await.unwrap();

        let listed = list_connections(&pool).await.unwrap();

        assert!(token_set(&listed[0]));
        assert!(!serde_json::to_string(&listed)
            .unwrap()
            .contains("tk_secret"));
    }

    #[tokio::test]
    async fn list_connections_skips_an_event_name_this_build_does_not_know() {
        let pool = pool().await;
        let id = save_connection(&pool, "Phone", URL, true, EVENTS).await;
        sqlx::query(
            "UPDATE notification_connections
                SET events = '[\"request_needs_chooser\", \"from_the_future\"]' WHERE id = ?",
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();

        let listed = list_connections(&pool).await.unwrap();

        assert_eq!(listed[0].events, EVENTS);
    }

    #[tokio::test]
    async fn list_connections_leaves_out_a_row_it_cannot_read() {
        let pool = pool().await;
        let kept = save_connection(&pool, "Kept", URL, true, EVENTS).await;
        for (name, settings) in [
            ("Later build", r#"{"kind":"pigeon","loft":"north"}"#),
            ("Hand edit", r#"{"kind":"ntfy","token":"tk_secret""#),
        ] {
            let id = save_connection(&pool, name, URL, true, EVENTS).await;
            sqlx::query("UPDATE notification_connections SET settings = ? WHERE id = ?")
                .bind(settings)
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();
        }

        let listed = list_connections(&pool).await.unwrap();

        let ids: Vec<i64> = listed.iter().map(|c| c.id).collect();
        assert_eq!(ids, [kept]);
    }

    #[tokio::test]
    async fn get_connection_reports_unreadable_settings_without_quoting_them() {
        let pool = pool().await;
        let id = save_connection(&pool, "Phone", URL, true, EVENTS).await;
        sqlx::query("UPDATE notification_connections SET settings = ? WHERE id = ?")
            .bind(r#"{"kind":"ntfy","token":"tk_secret""#)
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

        let error = get_connection(&pool, id).await.unwrap_err();

        assert!(matches!(error, NotifyError::Db(_)));
        assert!(!error.to_string().contains("tk_secret"), "{error}");
    }
}

mod db_errors {
    use super::*;

    #[tokio::test]
    async fn every_store_call_propagates_a_db_error_when_the_pool_is_closed() {
        let pool = pool().await;
        pool.close().await;
        let input = connection_input("Phone", ntfy_input(URL));

        assert!(matches!(
            list_connections(&pool).await,
            Err(NotifyError::Db(_))
        ));
        assert!(matches!(
            get_connection(&pool, 1).await,
            Err(NotifyError::Db(_))
        ));
        assert!(matches!(
            create_connection(&pool, &input).await,
            Err(NotifyError::Db(_))
        ));
        assert!(matches!(
            update_connection(&pool, 1, &input).await,
            Err(NotifyError::Db(_))
        ));
        assert!(matches!(
            delete_connection(&pool, 1).await,
            Err(NotifyError::Db(_))
        ));
    }
}
