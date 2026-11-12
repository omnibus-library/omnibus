//! The notification half of `--local` / `--server`: save an ntfy connection on the server
//! that publishes to this mock's fake ntfy and is sent the requests that need a version
//! picked, then have the server send it a test. Runs in [`super::wire`]'s session, after
//! the request connections; a failure here is reported, never fatal to them. The mock's own
//! connection is told by its name, a loopback address ending in `/ntfy` and a saved token,
//! and is updated in place on a later run; a connection of that name that is not the mock's
//! is never touched. It signs in with [`NTFY_TOKEN`], sent on every save, so the server's
//! token path runs end to end and a new port never strands the saved token.

use omnibus_shared::{
    ConnectionSettingsInput, ConnectionSettingsStatus, NotificationConnection,
    NotificationConnectionInput, NotificationConnections, NotificationEvent, NotificationTest,
    NtfyAuth, NtfySettingsInput,
};

use crate::ntfy::PATH;
use crate::NTFY_TOKEN;

use super::{checked, failed, is_loopback, WireError};

/// The name the mock's ntfy connection is saved under.
pub const CONNECTION_NAME: &str = "Mock ntfy";

/// The topic the mock's connection publishes to.
pub const TOPIC: &str = "omnibus-requests";

/// Above ntfy's default, so a recorded message shows the priority was sent.
const PRIORITY: u8 = 4;

/// ntfy shows the `books` tag as an emoji.
const TAGS: [&str; 1] = ["books"];

const CONNECTIONS: &str = "/api/admin/notifications/connections";
const TEST: &str = "/api/admin/notifications/test";

/// The ntfy connection wiring left on the server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NtfyWired {
    /// The connection's id on the server.
    pub id: i64,
    /// False when an earlier wiring's connection was updated instead.
    pub created: bool,
}

/// Save the mock's ntfy connection on `server`, pointed at `mock_origin`, and have the
/// server test it.
pub(super) async fn wire(
    http: &reqwest::Client,
    server: &str,
    token: &str,
    mock_origin: &str,
) -> Result<NtfyWired, WireError> {
    let step = "read notification connections";
    let list = http
        .get(format!("{server}{CONNECTIONS}"))
        .bearer_auth(token);
    let reply = checked(step, list).await?;
    let saved: NotificationConnections = reply.json().await.map_err(|e| failed(step, e))?;
    let existing = ours(&saved.connections)?;
    let save = match existing {
        Some(id) => http.put(format!("{server}{CONNECTIONS}/{id}")),
        None => http.post(format!("{server}{CONNECTIONS}")),
    };
    let input = input_for(mock_origin);
    let step = "save the ntfy connection";
    let reply = checked(step, save.bearer_auth(token).json(&input)).await?;
    let connection: NotificationConnection = reply.json().await.map_err(|e| failed(step, e))?;
    let test = NotificationTest {
        id: Some(connection.id),
        settings: input.settings,
    };
    let send = http.post(format!("{server}{TEST}")).bearer_auth(token);
    checked("test-ntfy", send.json(&test)).await?;
    Ok(NtfyWired {
        id: connection.id,
        created: existing.is_none(),
    })
}

/// The id of the connection an earlier wiring saved, if any. Refuses when the connections
/// of the mock's name are all someone else's, or when more than one looks like the mock's,
/// since which one to keep is not the mock's to decide.
fn ours(connections: &[NotificationConnection]) -> Result<Option<i64>, WireError> {
    let named: Vec<_> = connections
        .iter()
        .filter(|c| c.name == CONNECTION_NAME)
        .collect();
    if named.is_empty() {
        return Ok(None);
    }
    let mine: Vec<i64> = named
        .iter()
        .filter(|c| is_the_mocks(&c.settings))
        .map(|c| c.id)
        .collect();
    match mine[..] {
        [] => Err(WireError::NotificationNameTaken(CONNECTION_NAME)),
        [id] => Ok(Some(id)),
        _ => Err(WireError::NotificationNameRepeated(CONNECTION_NAME)),
    }
}

/// Whether `settings` are the mock's own: a fake ntfy on this machine, signed in with a
/// saved token, as the request wiring checks the saved login.
fn is_the_mocks(settings: &ConnectionSettingsStatus) -> bool {
    let ConnectionSettingsStatus::Ntfy(ntfy) = settings;
    ntfy.auth == NtfyAuth::Token
        && ntfy.token_set
        && is_loopback(&ntfy.server_url)
        && reqwest::Url::parse(&ntfy.server_url)
            .is_ok_and(|url| url.path().trim_end_matches('/').ends_with(PATH))
}

/// The connection the mock saves: its fake ntfy, signed in with [`NTFY_TOKEN`].
fn input_for(mock_origin: &str) -> NotificationConnectionInput {
    NotificationConnectionInput {
        name: CONNECTION_NAME.to_string(),
        enabled: true,
        events: vec![NotificationEvent::RequestNeedsChooser],
        settings: ConnectionSettingsInput::Ntfy(NtfySettingsInput {
            server_url: format!("{}{PATH}", mock_origin.trim_end_matches('/')),
            topic: TOPIC.to_string(),
            auth: NtfyAuth::Token,
            username: None,
            token: Some(NTFY_TOKEN.to_string()),
            password: None,
            priority: PRIORITY,
            tags: TAGS.map(String::from).to_vec(),
            include_details: true,
        }),
    }
}

#[cfg(test)]
mod tests;
