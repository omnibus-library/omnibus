//! Tests for the preference switches: what each one writes back onto the
//! cached viewer, the inline autosave status, and a refused save's revert.

use std::cell::Cell;

use dioxus::dioxus_core::NoOpMutations;

use super::*;
use crate::test_support::{provide_current_user, test_user};

type ViewerSlot = Signal<Option<Option<UserSummary>>>;

thread_local! {
    static HOST: Cell<Option<(ViewerSlot, Signal<bool>)>> = const { Cell::new(None) };
}

/// Flips Share stats once on mount, through a save the server refuses.
#[component]
fn RefusedFlip() -> Element {
    let viewer = crate::use_current_user().0;
    let state = use_signal(|| SaveState::Idle);
    use_hook(move || {
        flip_and_save(UserSetting::ShareStats, viewer, state, |_| async {
            Err(data::DataError::Http {
                status: 500,
                body: String::new(),
            })
        })
    });
    rsx! {}
}

/// Holds the viewer and shows [`RefusedFlip`] until the test hides it.
#[component]
fn SwitchHost() -> Element {
    provide_current_user(Some(Some(test_user(false, false))));
    let viewer = crate::use_current_user().0;
    let shown = use_signal(|| true);
    HOST.with(|host| host.set(Some((viewer, shown))));
    rsx! {
        if shown() {
            RefusedFlip {}
        }
    }
}

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

#[test]
fn flip_and_save_puts_the_viewer_back_when_the_switch_unmounts_before_a_refusal() {
    let mut dom = VirtualDom::new(SwitchHost);
    dom.rebuild_in_place();
    let (viewer, mut shown) = HOST.with(Cell::get).expect("host mounted");
    let share_stats = |dom: &VirtualDom| {
        dom.in_runtime(|| viewer.peek().clone().flatten().map(|user| user.share_stats))
    };
    assert_eq!(share_stats(&dom), Some(false), "the flip is optimistic");

    dom.in_runtime(|| shown.set(false));
    dom.process_events();
    dom.render_immediate(&mut NoOpMutations);
    dom.process_events();

    assert_eq!(share_stats(&dom), Some(true));
}
