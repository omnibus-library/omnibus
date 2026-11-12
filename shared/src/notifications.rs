//! Wire types for notification connections: the outside services (ntfy for now) the server
//! tells when something needs a person, the events each is sent, and the test send. A
//! connection's secrets go in and never come back out: a response says whether one is set.
//! The settings are tagged by `kind`, so another provider is another variant.

use std::fmt;

use serde::{Deserialize, Serialize};

/// Something the server can send a notification about.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum NotificationEvent {
    /// A book request found versions to choose from, and the reader who asked may not pick
    /// one, so someone who may has to.
    RequestNeedsChooser,
}

impl NotificationEvent {
    /// The stored token, the same as the wire name.
    pub fn as_str(self) -> &'static str {
        match self {
            NotificationEvent::RequestNeedsChooser => "request_needs_chooser",
        }
    }

    /// Parse a stored token; `None` for one this build doesn't know.
    pub fn from_db(s: &str) -> Option<Self> {
        match s {
            "request_needs_chooser" => Some(NotificationEvent::RequestNeedsChooser),
            _ => None,
        }
    }
}

/// How the server signs in to an ntfy server.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum NtfyAuth {
    /// No sign-in, for a topic anyone may publish to.
    None,
    /// An access token, sent as a bearer token.
    Token,
    /// A username and password.
    Basic,
}

/// A connection's provider settings as a client sends them. `kind` names the provider.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConnectionSettingsInput {
    /// An ntfy server and topic.
    Ntfy(NtfySettingsInput),
}

/// The settings of an ntfy connection, as a client sends them.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct NtfySettingsInput {
    /// The ntfy server's address, such as `https://ntfy.sh`, or `https://example.com/ntfy`
    /// for one served under a sub-path. It must not carry a login, query or fragment. A
    /// trailing slash after a sub-path is kept, for a proxy that expects one.
    pub server_url: String,
    /// The topic to publish to: 1 to 64 letters, digits, `-` or `_`.
    pub topic: String,
    pub auth: NtfyAuth,
    /// The username to sign in with. Required when `auth` is `basic`; ignored otherwise.
    #[serde(default)]
    pub username: Option<String>,
    /// The access token, used when `auth` is `token`. Null or left out keeps the saved
    /// token, but only while `server_url` is unchanged; an empty string clears it.
    #[serde(default)]
    pub token: Option<String>,
    /// The password, used when `auth` is `basic`. Null or left out keeps the saved
    /// password, but only while `server_url` and `username` are unchanged; an empty string
    /// clears it.
    #[serde(default)]
    pub password: Option<String>,
    /// The message priority, from 1 (lowest) to 5 (highest). 3, ntfy's default, when left out.
    #[serde(default = "default_priority")]
    #[cfg_attr(feature = "openapi", schema(minimum = 1, maximum = 5, default = 3))]
    pub priority: u8,
    /// Tags ntfy shows on the message; a tag naming an emoji shows as that emoji. Each is
    /// non-blank and has no comma.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Whether a message names the book and who asked for it. Off, it says only that
    /// something needs attention, for a topic others can read. True when left out.
    #[serde(default = "default_true")]
    pub include_details: bool,
}

// Hand-written so a stray `{:?}` can't log the token or password.
impl fmt::Debug for NtfySettingsInput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let redacted = |secret: &Option<String>| secret.as_ref().map(|_| "<redacted>");
        f.debug_struct("NtfySettingsInput")
            .field("server_url", &self.server_url)
            .field("topic", &self.topic)
            .field("auth", &self.auth)
            .field("username", &self.username)
            .field("token", &redacted(&self.token))
            .field("password", &redacted(&self.password))
            .field("priority", &self.priority)
            .field("tags", &self.tags)
            .field("include_details", &self.include_details)
            .finish()
    }
}

fn default_priority() -> u8 {
    3
}

fn default_true() -> bool {
    true
}

/// A connection's provider settings as the server returns them, with no secret in them.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConnectionSettingsStatus {
    /// An ntfy server and topic.
    Ntfy(NtfySettingsStatus),
}

/// The settings of an ntfy connection as the server returns them: whether a token or
/// password is saved, never its value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct NtfySettingsStatus {
    /// The ntfy server's address: no trailing slash, unless one was given after a sub-path.
    pub server_url: String,
    pub topic: String,
    pub auth: NtfyAuth,
    /// The username, when `auth` is `basic`.
    pub username: Option<String>,
    /// Whether a token is saved.
    pub token_set: bool,
    /// Whether a password is saved.
    pub password_set: bool,
    /// The message priority, from 1 (lowest) to 5 (highest).
    pub priority: u8,
    pub tags: Vec<String>,
    /// Whether a message names the book and who asked for it.
    pub include_details: bool,
}

/// A notification connection to create, or what to replace a saved one with.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct NotificationConnectionInput {
    /// A name to tell the connection by, 1 to 100 characters once trimmed.
    pub name: String,
    /// Whether the connection sends anything. True when left out.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// The events the connection is sent. May be empty; a repeated event counts once. An
    /// event the server doesn't offer now is saved, and sent once it does.
    pub events: Vec<NotificationEvent>,
    pub settings: ConnectionSettingsInput,
}

/// Switches a notification connection on or off. It carries nothing else, so a switch
/// can't undo another admin's edit of the connection's other fields.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct NotificationConnectionEnabled {
    /// True to send the connection's notifications, false to send none.
    pub enabled: bool,
}

/// How the most recent notification a connection finished with went.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct NotificationLastDelivery {
    /// When it was delivered or given up on, in Unix seconds.
    pub at: i64,
    /// True when the provider accepted it; false when it was given up on.
    pub ok: bool,
    /// A plain sentence saying why it was given up on, such as that the provider refused the
    /// sign-in, to show as it is. Null when `ok`.
    pub error: Option<String>,
}

/// A saved notification connection.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct NotificationConnection {
    pub id: i64,
    pub name: String,
    pub enabled: bool,
    pub events: Vec<NotificationEvent>,
    pub settings: ConnectionSettingsStatus,
    /// How its most recent finished notification went; null when none has finished yet.
    pub last_delivery: Option<NotificationLastDelivery>,
}

/// Every notification connection, sorted by name, and the events the server offers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct NotificationConnections {
    pub connections: Vec<NotificationConnection>,
    /// The events a connection can be sent on this server now. `request_needs_chooser`
    /// is listed only while book requests are on.
    pub available_events: Vec<NotificationEvent>,
}

/// Settings to send a test notification with.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct NotificationTest {
    /// A saved connection whose token or password fills in one `settings` leaves out, as
    /// saving would: only while the server URL, and for a password the username, are
    /// unchanged. Null for a connection not saved yet.
    #[serde(default)]
    pub id: Option<i64>,
    pub settings: ConnectionSettingsInput,
}

#[cfg(test)]
mod tests;
