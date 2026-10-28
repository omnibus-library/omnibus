//! `Prompt::on_key`: the startup sync-URL prompt's keys, with no terminal.

use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

use super::*;

const SYNC_URL: &str = "https://h.example/kobo/tok";

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

fn type_text(prompt: &mut Prompt, text: &str) {
    for c in text.chars() {
        prompt.on_key(key(KeyCode::Char(c)));
    }
}

#[test]
fn on_key_edits_the_buffer_with_typed_characters_and_backspace() {
    let mut prompt = Prompt::default();

    type_text(&mut prompt, "abcd");
    prompt.on_key(key(KeyCode::Backspace));

    assert_eq!(prompt.buffer, "abc");
}

#[test]
fn on_key_submits_a_valid_sync_url_on_enter() {
    let mut prompt = Prompt::default();
    type_text(&mut prompt, SYNC_URL);

    let outcome = prompt.on_key(key(KeyCode::Enter));

    assert_eq!(
        outcome,
        Some(PromptOutcome::Submit(SyncUrl {
            url: "https://h.example".into(),
            token: "tok".into(),
        }))
    );
}

#[test]
fn on_key_keeps_the_buffer_and_shows_the_error_when_enter_meets_a_malformed_url() {
    let mut prompt = Prompt::default();
    type_text(&mut prompt, "https://h.example/kobo");

    let outcome = prompt.on_key(key(KeyCode::Enter));

    assert_eq!(outcome, None);
    assert_eq!(prompt.buffer, "https://h.example/kobo");
    assert_eq!(
        prompt.error.as_deref(),
        Some("invalid sync URL: expected http(s)://<host>/kobo/<token>")
    );
}

#[test]
fn on_key_clears_the_error_once_the_buffer_is_edited() {
    let mut prompt = Prompt::default();
    type_text(&mut prompt, "nope");
    prompt.on_key(key(KeyCode::Enter));

    prompt.on_key(key(KeyCode::Backspace));

    assert_eq!(prompt.error, None);
}

#[test]
fn on_key_quits_on_esc_and_on_ctrl_c() {
    let ctrl_c = KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL);
    for quit in [key(KeyCode::Esc), ctrl_c] {
        let mut prompt = Prompt::default();
        type_text(&mut prompt, "abc");

        assert_eq!(prompt.on_key(quit), Some(PromptOutcome::Quit), "{quit:?}");
    }
}

#[test]
fn on_key_ignores_key_releases() {
    let mut prompt = Prompt::default();
    let mut release = key(KeyCode::Char('a'));
    release.kind = KeyEventKind::Release;

    assert_eq!(prompt.on_key(release), None);
    assert_eq!(prompt.buffer, "");
}
