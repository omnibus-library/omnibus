//! A connection's provider settings as stored, secrets included, and the two crossings to the
//! wire: an input merged over the saved settings (a left-out secret keeps the saved one) and
//! the status a response carries, with every secret reduced to whether it is set. The store,
//! the routes and the test send all go through here, so the merge rule holds in one place.

use std::fmt;

use omnibus_shared::{ConnectionSettingsInput, ConnectionSettingsStatus};
use serde::{Deserialize, Serialize};

use super::ntfy::NtfySettings;
use super::NotifyError;

/// A provider's settings as stored, tagged by `kind`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConnectionSettings {
    Ntfy(NtfySettings),
}

impl ConnectionSettings {
    /// Validate `input` and merge it over `saved`: a secret left out keeps the saved one, an
    /// empty one clears it. Saved settings of another provider lend nothing.
    pub fn from_input(
        input: &ConnectionSettingsInput,
        saved: Option<&ConnectionSettings>,
    ) -> Result<Self, NotifyError> {
        match input {
            ConnectionSettingsInput::Ntfy(input) => {
                NtfySettings::from_input(input, saved.and_then(Self::as_ntfy)).map(Self::Ntfy)
            }
        }
    }

    /// The settings as a response shows them: no secret, only whether each is set.
    pub fn status(&self) -> ConnectionSettingsStatus {
        match self {
            Self::Ntfy(ntfy) => ConnectionSettingsStatus::Ntfy(ntfy.status()),
        }
    }

    /// The provider's stored name, the `kind` column.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Ntfy(_) => "ntfy",
        }
    }

    fn as_ntfy(&self) -> Option<&NtfySettings> {
        match self {
            Self::Ntfy(ntfy) => Some(ntfy),
        }
    }
}

/// A stored credential: serialised as the plain string, but its `Debug` never shows it.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Secret(String);

impl Secret {
    /// Wrap a credential.
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// The credential itself, for the request that sends it.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(<redacted>)")
    }
}
