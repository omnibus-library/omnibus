//! Wire types for the KOReader progress-sync password: whether a reader has one, and the
//! one-time reveal of a freshly generated one.

use serde::{Deserialize, Serialize};

/// Whether you have generated a KOReader progress-sync password.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct KosyncStatus {
    /// `true` once a password exists; it is not retrievable, only replaceable.
    pub configured: bool,
}

/// A freshly generated progress-sync password, shown once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct KosyncPassword {
    /// The username to enter in KOReader's Progress sync login.
    pub username: String,
    /// The new password. It replaces any earlier one, which stops working at once.
    pub password: String,
}
