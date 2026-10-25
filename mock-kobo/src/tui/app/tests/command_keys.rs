//! The single-letter command keys in `Mode::Normal`: s/r/w/q, uppercase and
//! Ctrl/Alt variants, and unmapped keys.

use super::*;

#[test]
fn on_key_returns_sync_job_when_s_pressed() {
    let mut app = App::new(None);

    assert_eq!(app.on_key(key('s'), URL), Some(Action::Run(Job::Sync)));
}

#[test]
fn on_key_returns_reset_job_when_r_pressed() {
    let mut app = App::new(None);

    assert_eq!(app.on_key(key('r'), URL), Some(Action::Run(Job::Reset)));
}

#[test]
fn on_key_returns_wire_job_when_w_pressed() {
    let mut app = App::new(None);

    assert_eq!(app.on_key(key('w'), URL), Some(Action::Run(Job::Wire)));
}

#[test]
fn on_key_returns_quit_when_q_pressed() {
    let mut app = App::new(None);

    assert_eq!(app.on_key(key('q'), URL), Some(Action::Quit));
}

#[test]
fn on_key_returns_quit_when_ctrl_c_pressed_in_any_mode() {
    let ctrl_c = with_modifiers('c', KeyModifiers::CONTROL);
    let mut normal = App::new(None);
    let mut editing_url = editing('u');

    assert_eq!(normal.on_key(ctrl_c, URL), Some(Action::Quit));
    assert_eq!(editing_url.on_key(ctrl_c, URL), Some(Action::Quit));
}

#[test]
fn on_key_accepts_uppercase_command_keys() {
    let cases = [
        ('S', Action::Run(Job::Sync)),
        ('R', Action::Run(Job::Reset)),
        ('W', Action::Run(Job::Wire)),
        ('Q', Action::Quit),
    ];
    for (c, expected) in cases {
        let mut app = App::new(None);

        let action = app.on_key(with_modifiers(c, KeyModifiers::SHIFT), URL);

        assert_eq!(action, Some(expected), "key {c}");
    }
}

#[test]
fn on_key_opens_edits_when_uppercase_u_or_t_pressed() {
    for (c, field) in [('U', Field::Url), ('T', Field::Token)] {
        let mut app = App::new(None);

        assert_eq!(app.on_key(key(c), URL), None);

        let Mode::Editing(edit) = &app.mode else {
            panic!("key {c} should open an edit");
        };
        assert_eq!(edit.field, field);
    }
}

#[test]
fn on_key_ignores_unmapped_key() {
    let mut app = App::new(None);

    assert_eq!(app.on_key(key('z'), URL), None);
    assert_eq!(app.mode, Mode::Normal);
    assert_eq!(app.status, None);
    assert!(!app.busy);
}

#[test]
fn on_key_ignores_command_letter_pressed_with_ctrl_or_alt() {
    let mut app = App::new(None);

    assert_eq!(
        app.on_key(with_modifiers('s', KeyModifiers::CONTROL), URL),
        None
    );
    assert_eq!(
        app.on_key(with_modifiers('q', KeyModifiers::ALT), URL),
        None
    );
    assert!(!app.busy);
}

#[test]
fn on_key_ignores_key_release() {
    for kind in [KeyEventKind::Release, KeyEventKind::Repeat] {
        let mut app = App::new(None);
        let event = KeyEvent { kind, ..key('s') };

        assert_eq!(app.on_key(event, URL), None, "kind {kind:?}");

        assert!(!app.busy);
    }
}

#[test]
fn new_shows_startup_notice_as_info_status() {
    let app = App::new(Some("wired to the existing device".to_owned()));

    let expected = Status::Info("wired to the existing device".to_owned());
    assert_eq!(app.status, Some(expected));
}

#[test]
fn new_has_no_status_without_a_notice() {
    let app = App::new(None);

    assert_eq!(app.status, None);
    assert_eq!(app.mode, Mode::Normal);
    assert!(!app.busy);
}
