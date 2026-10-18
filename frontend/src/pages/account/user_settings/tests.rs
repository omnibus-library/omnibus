//! Tests for the preference switches' pure parts: what each one writes back
//! onto the cached viewer, and the inline autosave status.

use super::*;
use crate::test_support::test_user;

#[test]
fn user_setting_write_is_read_back_for_every_setting() {
    for setting in [
        UserSetting::StackSeries,
        UserSetting::ScrollStops,
        UserSetting::ShareStats,
    ] {
        let mut reader = test_user(false, false);
        setting.write(&mut reader, true);
        assert!(setting.read(&reader), "{setting:?}");
        setting.write(&mut reader, false);
        assert!(!setting.read(&reader), "{setting:?}");
    }
}

#[test]
fn save_state_text_says_nothing_until_a_save_starts() {
    assert_eq!(save_state_text(SaveState::Idle), "");
}

#[test]
fn save_state_text_confirms_a_save_that_landed() {
    assert_eq!(save_state_text(SaveState::Saved), "Saved");
}

#[test]
fn save_state_text_names_the_recovery_when_a_save_fails() {
    assert_eq!(
        save_state_text(SaveState::Failed),
        "Couldn\u{2019}t save. Try again."
    );
}
