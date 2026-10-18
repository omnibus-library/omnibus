//! Tests for the SMTP card: the Save guard that keeps a failed read from
//! overwriting the relay, and the card's first paint.

use std::rc::Rc;

use super::*;

/// Run `f` inside a live root scope, so it can create signals. Unlike a
/// component body, a panic here fails the test instead of being caught.
fn in_root_scope(f: impl FnOnce()) {
    let mut dom = VirtualDom::new(|| rsx! {});
    dom.rebuild_in_place();
    dom.in_scope(ScopeId::ROOT, f);
}

fn blank_form_event() -> FormEvent {
    Event::new(
        Rc::new(FormData::new(SerializedFormData::new(
            String::new(),
            vec![],
        ))),
        false,
    )
}

/// The card's signals as a failed read leaves them: seeded defaults, no status.
fn unloaded_card() -> (SmtpFields, SmtpIo) {
    let fields = SmtpFields {
        host: Signal::new(String::new()),
        port: Signal::new("587".to_string()),
        username: Signal::new(String::new()),
        from_email: Signal::new(String::new()),
        password: Signal::new(String::new()),
        security: Signal::new(SmtpSecurity::Starttls),
    };
    let io = SmtpIo {
        saved: Signal::new(None),
        status: Signal::new(None),
        status_failed: Signal::new(true),
        reload: Signal::new(0),
        msg: Signal::new(None),
        msg_is_error: Signal::new(false),
        in_flight: Signal::new(false),
    };
    (fields, io)
}

#[test]
fn smtp_save_refuses_to_overwrite_the_relay_before_its_settings_load() {
    in_root_scope(|| {
        let (fields, io) = unloaded_card();
        let mut save = make_smtp_save("http://127.0.0.1:0".to_string(), fields, io);
        save(blank_form_event());

        assert!(!(io.in_flight)());
        assert!((io.msg_is_error)());
        assert_eq!((io.msg)().as_deref(), Some(SMTP_NOT_LOADED));
    });
}

#[cfg(feature = "server")]
#[test]
fn smtp_config_field_holds_save_until_the_settings_load() {
    let html = crate::test_support::render_in_vdom(SmtpConfigField);
    let at = html
        .find(r#"data-testid="smtp-save""#)
        .expect("save button");
    let tag = &html[html[..at].rfind('<').unwrap()..at + html[at..].find('>').unwrap()];
    assert!(tag.contains("disabled"), "{html}");
    assert!(html.contains("Save SMTP settings"), "{html}");
}
