//! Wire types for the admin book-request connections: the Prowlarr indexer manager and
//! the download client. Secrets are write-only here: the update carries them in, the
//! status hands back only a masked preview.

use serde::{Deserialize, Serialize};

/// Maximum byte length of a connection URL.
pub const REQUESTS_URL_MAX_LEN: usize = 2048;

/// Maximum byte length of a download client username or category.
pub const REQUESTS_FIELD_MAX_LEN: usize = 255;

/// Maximum byte length of a folder path prefix.
pub const REQUESTS_PATH_MAX_LEN: usize = 4096;

/// Maximum byte length of the Prowlarr API key or the download client password.
pub const REQUESTS_SECRET_MAX_LEN: usize = 1024;

/// Which download client program the server talks to.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum DownloadClientKind {
    /// qBittorrent, through its Web API v2.
    #[default]
    Qbittorrent,
}

impl DownloadClientKind {
    /// Wire token used in the `settings` KV table and the REST payloads.
    pub fn as_str(self) -> &'static str {
        match self {
            DownloadClientKind::Qbittorrent => "qbittorrent",
        }
    }

    /// Parse the stored token back into the enum, defaulting to qBittorrent for any
    /// unrecognized value so a hand-edited `settings` row can't panic.
    pub fn from_str_or_default(s: &str) -> Self {
        match s {
            "qbittorrent" => DownloadClientKind::Qbittorrent,
            _ => DownloadClientKind::default(),
        }
    }
}

// Deliberately not `Debug`: it carries a plaintext API key and password that a stray
// `tracing::debug!(?req)` would log.
/// The Prowlarr and download client connections. Every field but the two secrets
/// replaces the saved value, and an empty string clears it.
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct RequestsSettingsUpdate {
    /// The Prowlarr address, such as `http://prowlarr:9696`: an `http` or `https` URL of
    /// up to 2048 bytes, without a username or password in it.
    pub prowlarr_url: String,
    /// The Prowlarr API key, up to 1024 bytes. Null or left out keeps the saved key.
    /// An empty string clears it.
    #[serde(default)]
    pub prowlarr_api_key: Option<String>,
    #[serde(default)]
    pub download_client_kind: DownloadClientKind,
    /// The download client's web address: an `http` or `https` URL of up to 2048 bytes,
    /// without a username or password in it.
    pub download_client_url: String,
    /// The download client login, up to 255 bytes.
    pub download_client_username: String,
    /// The download client password, up to 1024 bytes. Null or left out keeps the saved
    /// password. An empty string clears it.
    #[serde(default)]
    pub download_client_password: Option<String>,
    /// The category the client files Omnibus downloads under, up to 255 bytes. Empty
    /// sends no category, so the client's own defaults apply.
    pub download_client_category: String,
    /// The completed-downloads folder as the download client sees it, up to 4096 bytes.
    pub download_client_path_prefix: String,
    /// The same folder as the Omnibus server sees it, up to 4096 bytes.
    pub download_path_prefix: String,
}

/// The Prowlarr and download client connections, with both secrets masked. It never
/// carries the API key or the password itself.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct RequestsSettingsStatus {
    pub prowlarr_url: Option<String>,
    /// A masked preview of the API key, such as `abcd…wxyz`, or `••••` for a key of 8
    /// characters or fewer. Null when no key is set.
    pub prowlarr_api_key_masked: Option<String>,
    /// Where the API key in effect comes from: `settings` when saved through the API,
    /// `env` when read from `OMNIBUS_PROWLARR_API_KEY`, or `none`.
    pub prowlarr_api_key_source: String,
    pub download_client_kind: DownloadClientKind,
    pub download_client_url: Option<String>,
    pub download_client_username: Option<String>,
    /// A masked preview of the password. Null when no password is set.
    pub download_client_password_masked: Option<String>,
    /// The category downloads are filed under; empty when none is sent.
    pub download_client_category: String,
    pub download_client_path_prefix: Option<String>,
    pub download_path_prefix: Option<String>,
}
