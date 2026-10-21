//! User-configurable library paths and the `GET /api/library` response shape.
//!
//! These types straddle every client (mobile + web) and the server, so they
//! live here rather than next to the handler that produces them.

use serde::{Deserialize, Serialize};

/// Maximum byte length of a library path field.
pub const PATH_MAX_LEN: usize = 4096;

/// Minimum allowed periodic-scan interval, in hours. `scan_interval_hours`
/// is `Option<u32>` — `None` means "disabled" (today's boot-only-scan
/// behavior), so a `Some` value below this floor (including 0) is rejected
/// rather than treated as a way to disable the feature.
pub const SCAN_INTERVAL_MIN_HOURS: u32 = 1;

/// Validation failure modes for [`Settings`].
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SettingsError {
    /// One of the library-path fields exceeded [`PATH_MAX_LEN`].
    #[error("{field} exceeds {PATH_MAX_LEN} bytes")]
    PathTooLong { field: &'static str },
    /// `scan_interval_hours` was set below [`SCAN_INTERVAL_MIN_HOURS`].
    #[error("scan_interval_hours must be at least {SCAN_INTERVAL_MIN_HOURS} (omit to disable)")]
    ScanIntervalTooSmall,
    /// A metadata-precedence request named a library other than `ebook` or `audiobook`.
    #[error("library must be \"ebook\" or \"audiobook\"")]
    UnknownLibrary,
}

/// The server's library folders, and how often it rescans them.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Settings {
    pub ebook_library_path: Option<String>,
    pub audiobook_library_path: Option<String>,
    /// Hours between automatic rescans of both libraries, at least 1. When absent, the
    /// server rescans only at startup or when `POST /api/scan-library` asks it to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scan_interval_hours: Option<u32>,
}

impl Settings {
    /// Validate field lengths and the scan-interval floor. Path lengths are
    /// measured in bytes (filesystem `PATH_MAX` semantics), not Unicode
    /// scalar values.
    pub fn validate(&self) -> Result<(), SettingsError> {
        if let Some(p) = &self.ebook_library_path {
            if p.len() > PATH_MAX_LEN {
                return Err(SettingsError::PathTooLong {
                    field: "ebook_library_path",
                });
            }
        }
        if let Some(p) = &self.audiobook_library_path {
            if p.len() > PATH_MAX_LEN {
                return Err(SettingsError::PathTooLong {
                    field: "audiobook_library_path",
                });
            }
        }
        if let Some(hours) = self.scan_interval_hours {
            if hours < SCAN_INTERVAL_MIN_HOURS {
                return Err(SettingsError::ScanIntervalTooSmall);
            }
        }
        Ok(())
    }
}

// The no-op variants are skipped in the merge path; see
// `db::metadata_overrides::upsert::apply_overrides`.
/// A source of book metadata, as a library's precedence list orders them. Only
/// `embedded_tags`, the metadata inside the book file, and `omnibus_overrides`, the
/// edits made in Omnibus, supply data today. The others are stored but change nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum MetadataSource {
    FolderStructure,
    EmbeddedTags,
    OpfSidecar,
    OmnibusOverrides,
    ProviderMatch,
}

/// Precedence order that reproduces today's hardcoded "override always
/// wins" merge behavior. List order is lowest-to-highest priority — a
/// CSS-cascade-style "last wins" — so `OmnibusOverrides` ranks above
/// `EmbeddedTags` by default. This is the default value of
/// `scan_roots.metadata_precedence` (migration `0044`).
pub const DEFAULT_METADATA_PRECEDENCE: [MetadataSource; 5] = [
    MetadataSource::FolderStructure,
    MetadataSource::EmbeddedTags,
    MetadataSource::OpfSidecar,
    MetadataSource::OmnibusOverrides,
    MetadataSource::ProviderMatch,
];

/// Whether `order` is a valid precedence list: every one of the 5 known
/// sources, each exactly once (any relative order is accepted). Used to
/// reject a malformed/partial list before it's persisted.
pub fn is_valid_metadata_precedence(order: &[MetadataSource]) -> bool {
    if order.len() != DEFAULT_METADATA_PRECEDENCE.len() {
        return false;
    }
    DEFAULT_METADATA_PRECEDENCE
        .iter()
        .all(|s| order.iter().filter(|o| *o == s).count() == 1)
}

/// The configured folder of the library `library` names, `"ebook"` or `"audiobook"`; `None`
/// when that library's folder isn't set. Each transport resolves the precedence routes'
/// `library` token here, so an unknown one reads the same on both.
pub fn precedence_library_path(
    settings: &Settings,
    library: &str,
) -> Result<Option<String>, SettingsError> {
    match library {
        "ebook" => Ok(settings.ebook_library_path.clone()),
        "audiobook" => Ok(settings.audiobook_library_path.clone()),
        _ => Err(SettingsError::UnknownLibrary),
    }
}

/// Loose email plausibility check: exactly one `@`, non-empty local part, a
/// dotted domain, no whitespace, within [`crate::EMAIL_MAX_LEN`]. Not
/// RFC-complete — just enough to reject obvious typos before handing an
/// address to the SMTP layer. Shared by the SMTP `from` and Kindle-email
/// validators.
pub fn is_plausible_email(s: &str) -> bool {
    let s = s.trim();
    if s.is_empty() || s.len() > crate::EMAIL_MAX_LEN || s.contains(char::is_whitespace) {
        return false;
    }
    let mut parts = s.split('@');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(local), Some(domain), None) => {
            !local.is_empty()
                && domain.contains('.')
                && !domain.starts_with('.')
                && !domain.ends_with('.')
        }
        _ => false,
    }
}

/// How the server secures its connection to the SMTP relay.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum SmtpSecurity {
    /// Upgrade a plain connection with STARTTLS, usually on port 587.
    #[default]
    Starttls,
    /// Use TLS from the first byte, usually on port 465.
    Tls,
}

impl SmtpSecurity {
    /// Wire token used in the `settings` KV table and the REST/RPC payloads.
    pub fn as_str(self) -> &'static str {
        match self {
            SmtpSecurity::Starttls => "starttls",
            SmtpSecurity::Tls => "tls",
        }
    }

    /// Parse the stored token back into the enum, defaulting to STARTTLS for
    /// any unrecognized value so a hand-edited `settings` row can't panic.
    pub fn from_str_or_default(s: &str) -> Self {
        match s {
            "tls" => SmtpSecurity::Tls,
            _ => SmtpSecurity::Starttls,
        }
    }
}

// Deliberately not `Debug`: it carries a plaintext SMTP password that a stray
// `tracing::debug!(?req)` would log.
/// The server-wide SMTP relay that Send to Kindle emails through. Every field but
/// `password` replaces the saved value.
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SmtpConfigUpdate {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub from_email: String,
    #[serde(default)]
    pub security: SmtpSecurity,
    /// The relay password, up to 1024 bytes. Null or left out keeps the saved password.
    /// An empty string clears it.
    #[serde(default)]
    pub password: Option<String>,
}

/// The server-wide SMTP relay settings, with the password masked. It never carries the
/// password itself.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SmtpConfigStatus {
    pub configured: bool,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub from_email: Option<String>,
    pub security: SmtpSecurity,
    /// A masked preview of the password, such as `hunt…ter2`, or `••••` for a password
    /// of 8 characters or fewer. Null when no password is set.
    pub password_masked: Option<String>,
    /// Where the settings in effect come from: `settings` when saved through the API,
    /// `env` when read from the server's environment variables, or `none`.
    pub source: String,
}

/// Whether Send to Kindle can deliver. It never carries the relay's host or
/// credentials.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct KindleDelivery {
    /// The address books are sent from, which readers must add to their approved
    /// senders at Amazon. Null when no SMTP relay is set up, so nothing can be sent.
    pub sender_address: Option<String>,
}

/// Default `ebook-convert` command used when neither the settings override nor
/// `OMNIBUS_EBOOK_CONVERT_PATH` is set — resolved on `$PATH` at spawn time.
pub const DEFAULT_EBOOK_CONVERT_BIN: &str = "ebook-convert";

/// The `ebook-convert` path to save.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct EbookConvertUpdate {
    /// The path of Calibre's `ebook-convert`, up to 4096 bytes. Null or blank clears the
    /// saved path.
    pub path: Option<String>,
}

/// Whether the server can run Calibre's `ebook-convert` to convert book formats.
/// Calibre is optional. Without it, format conversion is off and nothing else is wrong.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct EbookConvertStatus {
    /// True when `path` exists and runs.
    pub available: bool,
    /// The command the server runs: a saved path, the `OMNIBUS_EBOOK_CONVERT_PATH`
    /// environment variable, or plain `ebook-convert` found on the server's `PATH`.
    pub path: String,
    /// Where `path` came from: `settings`, `env` or `path`.
    pub source: String,
}

impl Default for EbookConvertStatus {
    fn default() -> Self {
        Self {
            available: false,
            path: DEFAULT_EBOOK_CONVERT_BIN.to_string(),
            source: "path".to_string(),
        }
    }
}

/// Amazon Send-to-Kindle email size limit: Amazon rejects personal-document
/// emails over 50 MB, while the web / app uploader at [`KINDLE_WEB_UPLOAD_URL`]
/// accepts up to 200 MB. An EPUB over the email cap disables the email button
/// and points at the uploader. Decimal megabytes (50 * 10^6), matching Amazon's
/// figures and the UI copy; per-SMTP-provider caps are deliberately not modelled.
pub const KINDLE_EMAIL_MAX_BYTES: u64 = 50_000_000;

/// Upper bound of the Send-to-Kindle web / app uploader, surfaced in the UI hint
/// so the user knows the larger path exists. Decimal MB, as with the email cap.
pub const KINDLE_WEB_MAX_BYTES: u64 = 200_000_000;

/// Amazon's Send-to-Kindle web uploader. Linked from the disabled email button
/// as the fallback for oversized files.
pub const KINDLE_WEB_UPLOAD_URL: &str = "https://www.amazon.com/sendtokindle";

/// Whether an EPUB of `size_bytes` is too large to email to Kindle (strictly
/// over [`KINDLE_EMAIL_MAX_BYTES`]). Shared so the UI's disabled-button gate and
/// the worker-side send guard agree on one threshold. Base64 encoding inflates
/// the message, so a file just under the cap can still bounce and falls through
/// to the normal send-error toast.
pub fn kindle_email_oversize(size_bytes: u64) -> bool {
    size_bytes > KINDLE_EMAIL_MAX_BYTES
}

/// Where a Send to Kindle stands. `GET /api/kindle/send/status` returns it for the
/// `task_id` that `POST /api/kindle/send` gave back. Poll until `status` is no longer
/// `pending`. A `failed` status carries a `message` that says why.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum KindleSendStatus {
    Pending,
    Sent,
    Failed { message: String },
}

/// The files in one library folder, ebook or audiobook, counted by extension.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct LibrarySection {
    /// The configured folder. Null when none is set.
    pub path: Option<String>,
    pub total_files: usize,
    /// One `[extension, count]` pair per file extension Omnibus reads, in a fixed order,
    /// zeros included. Empty when no folder is set.
    pub counts_by_ext: Vec<(String, usize)>,
    /// Why the folder couldn't be read. Null when it was read.
    pub error: Option<String>,
}

/// How many ebook and audiobook files the library folders hold, from `GET /api/library`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct LibraryContents {
    pub ebooks: LibrarySection,
    pub audiobooks: LibrarySection,
}

#[cfg(test)]
mod tests;

/// Whether the server's hosted MCP endpoint at `/mcp` is on. `GET /api/settings/mcp`
/// returns it and `POST /api/settings/mcp` takes it.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct McpStatus {
    pub enabled: bool,
}
