//! The `GET /api/_health` response: liveness and build details for a running server.

use serde::{Deserialize, Serialize};

/// A running server's liveness and build details.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Health {
    /// Always `omnibus`, which tells this server apart from another program on the port.
    pub app: String,
    /// Always `ok`.
    pub status: String,
    /// When this server process started, in Unix milliseconds. It changes on every restart,
    /// so a new value means a rebuilt server is up.
    pub build_id: String,
    /// The directory the server runs from. Development tooling uses it to tell the servers of
    /// two checkouts apart.
    pub repo_root: String,
    /// The release, such as `v0.9.3`, or `dev` for a local build.
    pub version: String,
    /// The server's clock in Unix seconds, so a client can measure how far its own clock is off.
    pub time: i64,
}
