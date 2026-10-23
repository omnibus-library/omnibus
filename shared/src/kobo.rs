//! Wire types for the per-device sync auth surface (Kobo and KOReader). A
//! `KoboDeviceView` is the re-displayable projection of a `kobo_devices` row
//! the Settings card renders — it deliberately carries the raw token so the
//! endpoint URL can be shown again (AC2). The token never leaves the owning
//! user's own authenticated response.

use serde::{Deserialize, Serialize};

/// Maximum length, in characters, of a user-supplied Kobo device label.
pub const KOBO_DEVICE_NAME_MAX_LEN: usize = 100;

/// Which kind of reader a registered device is. A token only authenticates the routes of
/// its own kind.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum DeviceKind {
    /// A Kobo e-reader, synced over `/kobo/{token}/…`.
    #[default]
    Kobo,
    /// A KOReader install.
    Koreader,
}

impl DeviceKind {
    /// The lowercase name stored in the `kobo_devices.kind` column and sent on the wire.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Kobo => "kobo",
            Self::Koreader => "koreader",
        }
    }
}

/// A Kobo or KOReader registered to your account. Its `token` is the secret that
/// authenticates the device; for a Kobo it is the sync address's path segment,
/// `/kobo/{token}/…`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct KoboDeviceView {
    /// The device's id, which the regenerate and delete routes take.
    pub id: i64,
    /// The label you gave it.
    pub name: String,
    /// Which kind of reader this is.
    pub kind: DeviceKind,
    /// The device's secret. Treat it like a password: anyone holding it can sync as you.
    pub token: String,
    /// When it was registered, in Unix seconds.
    pub created_at: i64,
    /// When the device last synced, in Unix seconds.
    pub last_seen_at: i64,
}

/// The label and kind for a new device.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CreateKoboDevice {
    /// A label of 1 to 100 characters once trimmed, such as "Clara HD".
    pub name: String,
    /// Which kind of device to register. Defaults to a Kobo when omitted.
    #[serde(default)]
    pub kind: DeviceKind,
}

/// What a refused device name is told, naming the limit.
pub fn kobo_device_name_message() -> String {
    format!("enter a device name (1–{KOBO_DEVICE_NAME_MAX_LEN} characters)")
}

/// `true` once a trimmed device name is empty or exceeds
/// [`KOBO_DEVICE_NAME_MAX_LEN`]. Shared by the RPC boundary and any client
/// pre-check so both reject the same inputs.
pub fn kobo_device_name_invalid(name: &str) -> bool {
    let trimmed = name.trim();
    trimmed.is_empty() || trimmed.chars().count() > KOBO_DEVICE_NAME_MAX_LEN
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kobo_device_name_message_names_the_limit() {
        assert_eq!(
            kobo_device_name_message(),
            "enter a device name (1–100 characters)"
        );
    }

    #[test]
    fn kobo_device_name_invalid_accepts_a_reasonable_label() {
        assert!(!kobo_device_name_invalid("Kobo Clara"));
    }

    #[test]
    fn kobo_device_name_invalid_rejects_an_empty_name() {
        assert!(kobo_device_name_invalid(""));
    }

    #[test]
    fn kobo_device_name_invalid_rejects_a_whitespace_only_name() {
        assert!(kobo_device_name_invalid("   \t\n  "));
    }

    #[test]
    fn kobo_device_name_invalid_rejects_a_name_over_the_max_length() {
        let name = "x".repeat(KOBO_DEVICE_NAME_MAX_LEN + 1);
        assert!(kobo_device_name_invalid(&name));
    }

    #[test]
    fn kobo_device_name_invalid_accepts_a_name_exactly_at_the_max_length() {
        let name = "x".repeat(KOBO_DEVICE_NAME_MAX_LEN);
        assert!(!kobo_device_name_invalid(&name));
    }

    #[test]
    fn kobo_device_name_invalid_counts_characters_not_bytes() {
        // 60 two-byte characters are 120 bytes but within the limit; 101 are not.
        assert!(!kobo_device_name_invalid(&"é".repeat(60)));
        assert!(kobo_device_name_invalid(
            &"é".repeat(KOBO_DEVICE_NAME_MAX_LEN + 1)
        ));
    }

    #[test]
    fn kobo_device_name_invalid_trims_surrounding_whitespace_before_checking_length() {
        // Padding that would push the raw length over the cap should not
        // matter once trimmed.
        let padded = format!("  {}  ", "x".repeat(KOBO_DEVICE_NAME_MAX_LEN));
        assert!(!kobo_device_name_invalid(&padded));
    }
}
