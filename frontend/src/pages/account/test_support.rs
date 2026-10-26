//! Test builders shared by the Kobo and KOReader card tests.

use omnibus_shared::{DeviceKind, KoboDeviceView};

/// A device of `kind` as the list answers it: unsynced, named "Libra", token `tok123`.
pub(super) fn device_view(kind: DeviceKind) -> KoboDeviceView {
    KoboDeviceView {
        id: 1,
        name: "Libra".to_string(),
        kind,
        token: "tok123".to_string(),
        created_at: 0,
        last_seen_at: 0,
        last_sync_at: None,
        last_sync_error: None,
        kosync_login: None,
    }
}
