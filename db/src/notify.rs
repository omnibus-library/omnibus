//! Notification connections: the outside services (ntfy for now) an admin points Omnibus at,
//! and the outbox that tells them when something needs a person. An event is queued in the
//! transaction that causes it, one row per enabled connection subscribed to it; the drain
//! loop the server spawns renders each row for its provider and sends it, retrying with
//! backoff, unless the event no longer needs anyone. A provider is one [`ConnectionSettings`]
//! variant and one render function in its own module; events, the outbox and [`deliver`]
//! never name one.
//!
//! Delivery is at least once: a crash after a provider accepted a message but before its
//! row was marked delivered sends that message again.
//!
//! The provider addresses are the admin's own services, often on the LAN, so like the
//! request connections these calls skip the author-photo SSRF guard; only an admin can
//! save or test one.

mod deliver;
mod enqueue;
mod event;
mod ntfy;
mod outbox;
mod render;
mod settings;
mod store;

pub use deliver::{deliver, http_client, DeliverError, SEND_TIMEOUT};
pub use enqueue::enqueue_request_needs_chooser;
pub use event::{Event, RequestNeedsChooser};
pub use ntfy::{NtfyCredentials, NtfySettings};
pub use outbox::{
    drain_due, drain_tick, kick, kicked, next_due, prune_finished, Drained, MAX_ATTEMPTS,
    RETENTION_SECS,
};
pub use render::{render, render_test, Notice, Outgoing};
pub use settings::{ConnectionSettings, Secret};
pub use store::{
    create_connection, delete_connection, get_connection, list_connections, update_connection,
    Connection, NAME_MAX_CHARS,
};

/// Why a notification connection could not be saved or read.
#[derive(Debug, thiserror::Error)]
pub enum NotifyError {
    /// The connection as given can't be saved; the message says why and never holds a secret.
    #[error("{0}")]
    Validation(String),
    #[error("no such notification connection")]
    NotFound,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

#[cfg(test)]
pub mod test_support;

#[cfg(test)]
mod tests;
