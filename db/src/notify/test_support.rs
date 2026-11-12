//! Fixtures for the notification tests here and in `requests`: ntfy inputs in each sign-in
//! mode, a saved connection pointed at a test server, and the outbox rows read back whole.

use omnibus_shared::{
    ConnectionSettingsInput, NotificationConnectionInput, NotificationEvent, NtfyAuth,
    NtfySettingsInput,
};
use sqlx::{Row, SqlitePool};

use super::{create_connection, ConnectionSettings, NtfySettings};

/// ntfy settings with no sign-in, publishing to topic `omnibus` on `server_url`.
pub fn ntfy_input(server_url: &str) -> NtfySettingsInput {
    NtfySettingsInput {
        server_url: server_url.to_string(),
        topic: "omnibus".to_string(),
        auth: NtfyAuth::None,
        username: None,
        token: None,
        password: None,
        priority: 3,
        tags: Vec::new(),
        include_details: true,
    }
}

/// [`ntfy_input`] signing in with `token`.
pub fn token_input(server_url: &str, token: Option<&str>) -> NtfySettingsInput {
    NtfySettingsInput {
        auth: NtfyAuth::Token,
        token: token.map(str::to_string),
        ..ntfy_input(server_url)
    }
}

/// [`ntfy_input`] signing in as `username` with `password`.
pub fn basic_input(
    server_url: &str,
    username: Option<&str>,
    password: Option<&str>,
) -> NtfySettingsInput {
    NtfySettingsInput {
        auth: NtfyAuth::Basic,
        username: username.map(str::to_string),
        password: password.map(str::to_string),
        ..ntfy_input(server_url)
    }
}

/// An enabled connection named `name`, subscribed to the request event.
pub fn connection_input(name: &str, settings: NtfySettingsInput) -> NotificationConnectionInput {
    NotificationConnectionInput {
        name: name.to_string(),
        enabled: true,
        events: vec![NotificationEvent::RequestNeedsChooser],
        settings: ConnectionSettingsInput::Ntfy(settings),
    }
}

/// The stored settings a fresh save of `input` makes.
pub fn stored(input: NtfySettingsInput) -> ConnectionSettings {
    ConnectionSettings::from_input(&ConnectionSettingsInput::Ntfy(input), None).unwrap()
}

/// The ntfy settings inside `settings`.
pub fn ntfy_of(settings: &ConnectionSettings) -> &NtfySettings {
    let ConnectionSettings::Ntfy(ntfy) = settings;
    ntfy
}

/// Save a connection named `name` publishing to `server_url`, `enabled` or not and
/// subscribed to `events`. Returns its id.
pub async fn save_connection(
    pool: &SqlitePool,
    name: &str,
    server_url: &str,
    enabled: bool,
    events: &[NotificationEvent],
) -> i64 {
    let input = NotificationConnectionInput {
        enabled,
        events: events.to_vec(),
        ..connection_input(name, ntfy_input(server_url))
    };
    create_connection(pool, &input).await.unwrap().id
}

/// One outbox row as stored.
#[derive(Debug, Clone, PartialEq)]
pub struct Delivery {
    pub id: i64,
    pub connection_id: i64,
    pub event: String,
    pub payload: serde_json::Value,
    pub state: String,
    pub attempts: i64,
    pub next_attempt_at: i64,
    pub last_error: Option<String>,
    pub finished_at: Option<i64>,
}

/// Every outbox row, oldest first.
pub async fn deliveries(pool: &SqlitePool) -> Vec<Delivery> {
    let rows = sqlx::query(
        "SELECT id, connection_id, event, payload, state, attempts, next_attempt_at, last_error,
                finished_at
           FROM notification_deliveries ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    rows.iter()
        .map(|r| Delivery {
            id: r.get("id"),
            connection_id: r.get("connection_id"),
            event: r.get("event"),
            payload: serde_json::from_str(r.get("payload")).unwrap(),
            state: r.get("state"),
            attempts: r.get("attempts"),
            next_attempt_at: r.get("next_attempt_at"),
            last_error: r.get("last_error"),
            finished_at: r.get("finished_at"),
        })
        .collect()
}
