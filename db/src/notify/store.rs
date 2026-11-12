//! Rows of `notification_connections`: the admin routes' create, read, update and delete,
//! and the list each connection shows with how its last finished notification went. Every
//! write is checked here first, and an update merges over the saved row in one write
//! transaction, so a secret left out is kept even when two saves race.

use omnibus_shared::{
    NotificationConnection, NotificationConnectionInput, NotificationEvent,
    NotificationLastDelivery,
};
use sqlx::{sqlite::SqliteRow, Row, SqliteConnection, SqlitePool};

use super::settings::ConnectionSettings;
use super::NotifyError;

/// The longest a connection's name may be, in characters, once trimmed.
pub const NAME_MAX_CHARS: usize = 100;

const NOW: &str = "strftime('%s', 'now')";

/// The most recent finished delivery of connection `c.id`, for the list's left join.
const LAST_FINISHED: &str = "(SELECT d.id FROM notification_deliveries d
                               WHERE d.connection_id = c.id AND d.state IN ('delivered', 'failed')
                               ORDER BY d.finished_at DESC, d.id DESC LIMIT 1)";

/// A connection as stored, secrets included.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Connection {
    pub id: i64,
    pub name: String,
    pub enabled: bool,
    pub events: Vec<NotificationEvent>,
    pub settings: ConnectionSettings,
}

/// A checked input, ready to write.
struct Draft {
    name: String,
    enabled: bool,
    events: Vec<NotificationEvent>,
    settings: ConnectionSettings,
}

impl Draft {
    /// Check `input` and merge its settings over `saved`.
    fn new(
        input: &NotificationConnectionInput,
        saved: Option<&ConnectionSettings>,
    ) -> Result<Self, NotifyError> {
        let name = input.name.trim();
        if name.is_empty() || name.chars().count() > NAME_MAX_CHARS {
            return Err(NotifyError::Validation(format!(
                "the name must be 1 to {NAME_MAX_CHARS} characters"
            )));
        }
        let mut events = Vec::with_capacity(input.events.len());
        for event in &input.events {
            if !events.contains(event) {
                events.push(*event);
            }
        }
        Ok(Self {
            name: name.to_string(),
            enabled: input.enabled,
            events,
            settings: ConnectionSettings::from_input(&input.settings, saved)?,
        })
    }

    fn settings_json(&self) -> Result<String, NotifyError> {
        serde_json::to_string(&self.settings).map_err(|e| sqlx::Error::Encode(e.into()).into())
    }

    fn events_json(&self) -> String {
        let names: Vec<&str> = self.events.iter().map(|e| e.as_str()).collect();
        serde_json::Value::from(names).to_string()
    }
}

/// Every connection, sorted by name, each with how its last finished notification went.
pub async fn list_connections(
    pool: &SqlitePool,
) -> Result<Vec<NotificationConnection>, NotifyError> {
    let rows = sqlx::query(&format!(
        "SELECT c.id, c.name, c.enabled, c.events, c.settings,
                d.finished_at, d.state AS last_state, d.last_error
           FROM notification_connections c
           LEFT JOIN notification_deliveries d ON d.id = {LAST_FINISHED}
          ORDER BY c.name COLLATE NOCASE, c.id"
    ))
    .fetch_all(pool)
    .await?;
    rows.iter().map(row_to_wire).collect()
}

/// The connection with this id, secrets included; [`NotifyError::NotFound`] when none has it.
pub async fn get_connection(pool: &SqlitePool, id: i64) -> Result<Connection, NotifyError> {
    let mut conn = pool.acquire().await?;
    load(&mut conn, id).await
}

/// Check `input` and save it as a new connection.
pub async fn create_connection(
    pool: &SqlitePool,
    input: &NotificationConnectionInput,
) -> Result<NotificationConnection, NotifyError> {
    let draft = Draft::new(input, None)?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO notification_connections (name, kind, settings, events, enabled)
         VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(&draft.name)
    .bind(draft.settings.kind())
    .bind(draft.settings_json()?)
    .bind(draft.events_json())
    .bind(draft.enabled)
    .fetch_one(pool)
    .await?;
    Ok(wire(id, draft, None))
}

/// Replace connection `id` with `input`, keeping each saved secret it leaves out.
/// [`NotifyError::NotFound`] when no connection has that id.
pub async fn update_connection(
    pool: &SqlitePool,
    id: i64,
    input: &NotificationConnectionInput,
) -> Result<NotificationConnection, NotifyError> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let saved = load(&mut tx, id).await?;
    let draft = Draft::new(input, Some(&saved.settings))?;
    sqlx::query(&format!(
        "UPDATE notification_connections
            SET name = ?, kind = ?, settings = ?, events = ?, enabled = ?, updated_at = {NOW}
          WHERE id = ?"
    ))
    .bind(&draft.name)
    .bind(draft.settings.kind())
    .bind(draft.settings_json()?)
    .bind(draft.events_json())
    .bind(draft.enabled)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    let last = last_delivery(&mut tx, id).await?;
    tx.commit().await?;
    Ok(wire(id, draft, last))
}

/// Delete connection `id` and every notification queued or sent for it.
/// [`NotifyError::NotFound`] when no connection has that id.
pub async fn delete_connection(pool: &SqlitePool, id: i64) -> Result<(), NotifyError> {
    let deleted = sqlx::query("DELETE FROM notification_connections WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(NotifyError::NotFound);
    }
    Ok(())
}

async fn load(conn: &mut SqliteConnection, id: i64) -> Result<Connection, NotifyError> {
    let row = sqlx::query(
        "SELECT id, name, enabled, events, settings FROM notification_connections WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(NotifyError::NotFound)?;
    row_to_connection(&row)
}

async fn last_delivery(
    conn: &mut SqliteConnection,
    id: i64,
) -> Result<Option<NotificationLastDelivery>, NotifyError> {
    let row = sqlx::query(&format!(
        "SELECT d.finished_at, d.state AS last_state, d.last_error
           FROM notification_connections c
           JOIN notification_deliveries d ON d.id = {LAST_FINISHED}
          WHERE c.id = ?"
    ))
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(row.as_ref().map(row_to_last).transpose()?.flatten())
}

fn row_to_connection(row: &SqliteRow) -> Result<Connection, NotifyError> {
    let id: i64 = row.try_get("id")?;
    let settings: String = row.try_get("settings")?;
    // The serde error can quote the JSON, and the JSON holds the secrets.
    let settings = serde_json::from_str(&settings).map_err(|_| {
        sqlx::Error::Decode(
            format!("notification_connections.settings of connection {id} is unreadable").into(),
        )
    })?;
    Ok(Connection {
        id,
        name: row.try_get("name")?,
        enabled: row.try_get::<i64, _>("enabled")? != 0,
        events: parse_events(&row.try_get::<String, _>("events")?),
        settings,
    })
}

/// The stored event names this build knows; one from a later build is skipped, not an error.
fn parse_events(json: &str) -> Vec<NotificationEvent> {
    serde_json::from_str::<Vec<String>>(json)
        .unwrap_or_default()
        .iter()
        .filter_map(|name| NotificationEvent::from_db(name))
        .collect()
}

fn row_to_last(row: &SqliteRow) -> Result<Option<NotificationLastDelivery>, sqlx::Error> {
    let Some(at) = row.try_get::<Option<i64>, _>("finished_at")? else {
        return Ok(None);
    };
    Ok(Some(NotificationLastDelivery {
        at,
        ok: row.try_get::<Option<String>, _>("last_state")?.as_deref() == Some("delivered"),
        error: row.try_get("last_error")?,
    }))
}

fn row_to_wire(row: &SqliteRow) -> Result<NotificationConnection, NotifyError> {
    let connection = row_to_connection(row)?;
    let last = row_to_last(row)?;
    Ok(NotificationConnection {
        id: connection.id,
        name: connection.name,
        enabled: connection.enabled,
        events: connection.events,
        settings: connection.settings.status(),
        last_delivery: last,
    })
}

fn wire(id: i64, draft: Draft, last: Option<NotificationLastDelivery>) -> NotificationConnection {
    NotificationConnection {
        id,
        name: draft.name,
        enabled: draft.enabled,
        events: draft.events,
        settings: draft.settings.status(),
        last_delivery: last,
    }
}
