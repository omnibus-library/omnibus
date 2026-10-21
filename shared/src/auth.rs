//! Auth wire types shared between the server and both clients.
//!
//! Used by `/api/auth/{login,register,me}` and the mobile bearer-token flow.
//! `LoginRequest` / `RegisterRequest` deliberately do not derive `Debug` so a
//! stray `tracing::debug!(?req)` cannot leak plaintext passwords.

use serde::{Deserialize, Serialize};

// A safe projection of a `users` row: no password field ever crosses the wire.
/// A user account: who it is, what it may do, and its saved preferences. It never
/// carries a password.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct UserSummary {
    pub id: i64,
    pub username: String,
    pub is_admin: bool,
    pub can_upload: bool,
    pub can_edit: bool,
    pub can_download: bool,
    /// The address Send to Kindle emails books to. Null when the user hasn't set one.
    #[serde(default)]
    pub kindle_email: Option<String>,
    /// The name other users see. When null, clients show `username`, which stays the
    /// sign-in name.
    #[serde(default)]
    pub display_name: Option<String>,
    /// Whether the user has uploaded an avatar. When true, `GET /api/users/{id}/avatar`
    /// serves it. When false, clients show a monogram.
    #[serde(default)]
    pub has_avatar: bool,
    /// The formats the user hides from their library view, as lowercase names such as
    /// `cbz`. Pass them as `exclude_formats` on `GET /api/ebooks`. An empty list hides
    /// nothing.
    #[serde(default)]
    pub hidden_formats: Vec<String>,
    /// Whether a book's detail page stops at each section as the user scrolls. False,
    /// the default, scrolls the page in one piece.
    #[serde(default)]
    pub book_detail_scroll_stops: bool,
    /// Whether the user's library grid shows each series as one tile.
    #[serde(default)]
    pub stack_series: bool,
    /// Whether other readers on this server may see the user's reading stats. True by
    /// default.
    #[serde(default = "share_stats_default")]
    pub share_stats: bool,
}

/// Serde default for [`UserSummary::share_stats`]; a bare `#[serde(default)]`
/// would decode `false`.
fn share_stats_default() -> bool {
    true
}

impl UserSummary {
    /// The name to show for this user: their display name when set, else the
    /// username. Every user-facing surface should render this, never
    /// [`Self::username`] on its own.
    pub fn display(&self) -> &str {
        self.display_name.as_deref().unwrap_or(&self.username)
    }
}

/// A reader on this server, as `GET /api/users` lists them.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct HouseholdReader {
    /// The user's id. Pass it as `user_id` to the stats routes.
    pub id: i64,
    /// The reader's display name, or their username when they have none.
    pub name: String,
    /// Whether `GET /api/users/{id}/avatar` has an image to serve.
    pub has_avatar: bool,
    /// True for the signed-in user, who always comes first.
    pub is_you: bool,
}

// There is no role enum: the UI presents `is_admin` as an "Administrator"
// permission implying the other three, while storage keeps four flags.
/// The four permission flags that say what a user may do. The server stores each flag
/// separately. Most checks let an admin through, but a few read the flag itself, such as
/// `can_download` for downloads.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct UserPermissions {
    pub is_admin: bool,
    pub can_upload: bool,
    pub can_edit: bool,
    pub can_download: bool,
}

// The admin table's projection of a `users` row: `UserSummary` plus the
// created time and locked state, without bloating the sign-in summary.
/// A user account in the admin user list, `GET /api/admin/users`. It never carries a
/// password.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AdminUserRow {
    pub id: i64,
    pub username: String,
    pub is_admin: bool,
    pub can_upload: bool,
    pub can_edit: bool,
    pub can_download: bool,
    #[serde(default)]
    pub kindle_email: Option<String>,
    /// The name other users see. Null when the user hasn't set one.
    #[serde(default)]
    pub display_name: Option<String>,
    /// When the account was created, in Unix seconds.
    pub created_at: i64,
    /// True while too many wrong passwords keep the account locked.
    /// `POST /api/admin/users/{id}/unlock` unlocks it.
    pub locked: bool,
}

// Deliberately not `Debug`: it holds a plaintext password (see `LoginRequest`).
/// A new account for `POST /api/admin/users` to create.
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CreateUserRequest {
    pub username: String,
    pub password: String,
    pub permissions: UserPermissions,
}

// Deliberately not `Debug`: it holds a plaintext password (see `LoginRequest`).
/// The new password `POST /api/admin/users/{id}/password` sets.
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SetPasswordRequest {
    pub password: String,
}

// Deliberately not `Debug`: it holds plaintext passwords (see `LoginRequest`).
/// The passwords `POST /api/auth/password` takes.
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ChangePasswordRequest {
    /// Your password now, to prove it is you.
    pub current_password: String,
    /// The password to switch to. It must meet the same rules as at sign-up.
    pub new_password: String,
}

/// Stands in for a session whose holder can't be named — one minted before
/// migration `0088`, or a caller that sent no `User-Agent`. Lives beside the
/// wire type rather than beside the labelling logic in `server::auth` because
/// [`SessionView::client`]'s serde default needs it too, and one literal can't
/// drift from itself.
pub const UNKNOWN_CLIENT: &str = "Unknown client";

/// Serde default for [`SessionView::client`]. A bare `#[serde(default)]` would
/// decode a payload without the field to `""` — a blank cell in the UI, and a
/// contradiction of the field's own contract.
fn unknown_client() -> String {
    UNKNOWN_CLIENT.to_string()
}

/// A signed-in session, as its owner or an admin sees it. It carries enough to name and
/// end the session, never its token. `GET /api/auth/sessions` and
/// `GET /api/admin/users/{id}/sessions` return it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SessionView {
    pub id: i64,
    #[serde(default)]
    pub device_id: Option<i64>,
    /// `cookie` for a browser session, `bearer` for a token session.
    pub kind: String,
    // Derived server-side so the raw `User-Agent` never reaches a page; falls back
    // to `UNKNOWN_CLIENT` for a session minted before migration `0088`.
    /// A readable name for the client that holds the session. It is the device name a
    /// native client registered, such as "Seamus's iPhone", or a label built from the
    /// browser's `User-Agent`, such as "Firefox on macOS". It is "Unknown client" when
    /// neither is known.
    #[serde(default = "unknown_client")]
    pub client: String,
    pub created_at: i64,
    pub last_used_at: i64,
    pub expires_at: i64,
    /// True for the session this request signed in with. Only `GET /api/auth/sessions`
    /// sets it. The admin listing always returns false, even for the admin's own
    /// session. `DELETE /api/auth/sessions/{id}` refuses to end the current session
    /// with a 400.
    #[serde(default)]
    pub is_current: bool,
}

/// A registered device, as its owner or an admin sees it.
/// `GET /api/admin/users/{id}/devices` lists them.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct DeviceView {
    pub id: i64,
    pub name: String,
    pub client_kind: String,
    #[serde(default)]
    pub client_version: Option<String>,
    pub created_at: i64,
    pub last_seen_at: i64,
}

/// Whether new users can create their own accounts with `POST /api/auth/register`.
/// `GET /api/auth/registration` returns it and `POST /api/settings/registration` takes it.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct RegistrationStatus {
    pub enabled: bool,
}

// Deliberately not `Debug`: it holds a plaintext password, and a stray
// `tracing::debug!(?req)` would write it to logs.
/// The credentials `POST /api/auth/login` checks.
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
    /// The kind of client signing in. `ios`, `android` or `bearer` gets a bearer token in
    /// the response body instead of a session cookie. Sent with `device_name`, it also
    /// registers the device.
    #[serde(default)]
    pub client_kind: Option<String>,
    #[serde(default)]
    pub device_name: Option<String>,
    #[serde(default)]
    pub client_version: Option<String>,
}

// Deliberately not `Debug`: it holds a plaintext password (see `LoginRequest`).
/// A new account for `POST /api/auth/register`, with the same client fields as
/// `LoginRequest`.
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub client_kind: Option<String>,
    #[serde(default)]
    pub device_name: Option<String>,
    #[serde(default)]
    pub client_version: Option<String>,
}

/// The signed-in user, from `POST /api/auth/login` or `POST /api/auth/register`. `token`
/// is present only for a bearer session. A cookie session comes in the `Set-Cookie`
/// header instead.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct LoginResponse {
    pub user: UserSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

/// An API token, as `GET /api/auth/api-tokens` lists it. It never carries the secret,
/// which only `CreateApiTokenResponse` shows.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ApiTokenView {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    /// When the token last authenticated a request, in Unix seconds. Null until its
    /// first use.
    #[serde(default)]
    pub last_used_at: Option<i64>,
    /// The token's last 4 characters, for showing it as `omni_…xxxx`. Null for tokens
    /// created before Omnibus recorded them.
    #[serde(default)]
    pub suffix: Option<String>,
}

/// A name for a new API token, 1 to 100 characters.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CreateApiTokenRequest {
    pub name: String,
}

/// A new name for an API token, 1 to 100 characters.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct RenameApiTokenRequest {
    pub name: String,
}

// Deliberately not `Debug`, same as `LoginRequest`: a stray
// `tracing::debug!(?resp)` must not leak a long-lived credential.
/// A new API token. `secret` is the raw `omni_…` token, and this is the only response
/// that shows it. The server keeps only a hash, so a lost secret can't be recovered.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CreateApiTokenResponse {
    pub token: ApiTokenView,
    pub secret: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    // Payloads from a pre-0068 server lack `hidden_formats`; the serde
    // default must keep them decoding (old cached `/me` bodies included).
    #[test]
    fn user_summary_deserializes_payload_missing_hidden_formats() {
        let v: UserSummary = serde_json::from_str(
            r#"{"id":1,"username":"alice","is_admin":false,
                "can_upload":false,"can_edit":false,"can_download":true}"#,
        )
        .unwrap();
        assert!(v.hidden_formats.is_empty());
    }

    // Same contract one migration later: a pre-0092 payload (or a cached
    // `/me` body from one) has no `book_detail_scroll_stops`, and must decode
    // to the off default rather than failing.
    #[test]
    fn user_summary_deserializes_payload_missing_book_detail_scroll_stops() {
        let v: UserSummary = serde_json::from_str(
            r#"{"id":1,"username":"alice","is_admin":false,
                "can_upload":false,"can_edit":false,"can_download":true}"#,
        )
        .unwrap();
        assert!(!v.book_detail_scroll_stops);
    }

    #[test]
    fn user_summary_deserializes_payload_missing_stack_series() {
        let v: UserSummary = serde_json::from_str(
            r#"{"id":1,"username":"alice","is_admin":false,
                "can_upload":false,"can_edit":false,"can_download":true}"#,
        )
        .unwrap();
        assert!(!v.stack_series);
    }

    // A pre-0099 payload (or a cached `/me` body from one) has no
    // `share_stats`, and must decode to the on default rather than off —
    // the opposite of every other preference here, since a pre-existing
    // reader must arrive still sharing.
    #[test]
    fn user_summary_deserializes_payload_missing_share_stats_as_on() {
        let v: UserSummary = serde_json::from_str(
            r#"{"id":1,"username":"alice","is_admin":false,
                "can_upload":false,"can_edit":false,"can_download":true}"#,
        )
        .unwrap();
        assert!(v.share_stats);
    }

    // Payloads from a pre-0088 server lack `client`. The default must name the
    // absence rather than leaving `""`, which would render a blank cell where
    // the field's contract promises a client name.
    #[test]
    fn session_view_deserializes_payload_missing_client_as_unknown() {
        let v: SessionView = serde_json::from_str(
            r#"{"id":1,"kind":"cookie","created_at":0,
                "last_used_at":0,"expires_at":0}"#,
        )
        .unwrap();
        assert_eq!(v.client, UNKNOWN_CLIENT);
    }
}
