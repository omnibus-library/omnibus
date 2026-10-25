//! The busy gate on a running job, deferred quit, and `App::finish`.

use super::*;

#[test]
fn on_key_clears_status_when_job_starts() {
    let mut app = App::new(Some("note".to_owned()));

    app.on_key(key('s'), URL);

    assert_eq!(app.status, None);
}

#[test]
fn on_key_refuses_job_while_busy() {
    for job_key in ['s', 'r', 'w'] {
        let mut app = App::new(None);
        app.on_key(key('s'), URL);

        assert_eq!(app.on_key(key(job_key), URL), None, "key {job_key}");

        assert_eq!(app.status, Some(Status::Error(BUSY.to_owned())));
        assert!(app.busy);
    }
}

#[test]
fn on_key_keeps_edit_open_when_enter_pressed_while_busy() {
    let mut app = App::new(None);
    app.on_key(key('s'), URL);
    app.on_key(key('t'), URL);
    type_text(&mut app, "new-token");

    let action = app.on_key(code(KeyCode::Enter), URL);

    assert_eq!(action, None);
    assert_eq!(editing_buffer(&app), Some("new-token"));
    assert_eq!(app.status, Some(Status::Error(BUSY.to_owned())));
}

#[test]
fn on_key_shows_validation_error_when_invalid_entry_saved_while_busy() {
    let mut app = App::new(None);
    app.on_key(key('s'), URL);
    app.on_key(key('t'), URL);
    type_text(&mut app, "has space");

    let action = app.on_key(code(KeyCode::Enter), URL);

    assert_eq!(action, None);
    assert_eq!(editing_buffer(&app), Some("has space"));
    let message = "invalid device token: expected letters, digits, '-' and '_' only";
    assert_eq!(app.status, Some(Status::Error(message.to_owned())));
}

#[test]
fn on_key_defers_quit_while_busy() {
    let mut app = App::new(None);
    app.on_key(key('s'), URL);

    assert_eq!(app.on_key(key('q'), URL), None);

    assert_eq!(
        app.status,
        Some(Status::Info(QUIT_DEFERRED_MESSAGE.to_owned()))
    );
    assert!(app.busy);
    assert!(!app.quit_requested());
}

#[test]
fn on_key_defers_ctrl_c_while_busy() {
    let mut app = App::new(None);
    app.on_key(key('s'), URL);

    assert_eq!(app.on_key(ctrl_c(), URL), None);

    assert_eq!(
        app.status,
        Some(Status::Info(QUIT_DEFERRED_MESSAGE.to_owned()))
    );
    assert!(app.busy);
    assert!(!app.quit_requested());
}

#[test]
fn on_key_quits_on_second_press_while_busy() {
    for first in [key('q'), ctrl_c()] {
        for second in [key('q'), ctrl_c()] {
            let mut app = App::new(None);
            app.on_key(key('s'), URL);
            app.on_key(first, URL);

            assert_eq!(app.on_key(second, URL), Some(Action::Quit));
        }
    }
}

#[test]
fn finish_requests_deferred_quit() {
    let mut app = App::new(None);
    app.on_key(key('s'), URL);
    app.on_key(key('q'), URL);

    app.finish(Status::Info("sync complete".to_owned()));

    assert!(app.quit_requested());
}

#[test]
fn finish_requests_no_quit_without_deferred_quit() {
    let mut app = App::new(None);
    app.on_key(key('s'), URL);

    app.finish(Status::Info("sync complete".to_owned()));

    assert!(!app.quit_requested());
}

#[test]
fn finish_clears_busy_and_shows_status() {
    let mut app = App::new(None);
    app.on_key(key('s'), URL);

    app.finish(Status::Info("sync complete".to_owned()));

    assert!(!app.busy);
    assert_eq!(app.status, Some(Status::Info("sync complete".to_owned())));
    assert_eq!(app.on_key(key('r'), URL), Some(Action::Run(Job::Reset)));
}
