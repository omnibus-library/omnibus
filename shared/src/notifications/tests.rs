//! The notification wire types: the defaults a client may leave out, the `kind` tag, the
//! event tokens, and the input's `Debug` keeping secrets out of logs.

use serde_json::json;

use super::*;

fn minimal_ntfy() -> serde_json::Value {
    json!({
        "kind": "ntfy",
        "server_url": "https://ntfy.example.com",
        "topic": "omnibus",
        "auth": "none",
    })
}

#[test]
fn ntfy_settings_input_fills_priority_tags_and_details_when_left_out() {
    let parsed: ConnectionSettingsInput = serde_json::from_value(minimal_ntfy()).unwrap();

    let ConnectionSettingsInput::Ntfy(ntfy) = parsed;
    assert_eq!(ntfy.priority, 3);
    assert!(ntfy.tags.is_empty());
    assert!(ntfy.include_details);
    assert_eq!(ntfy.token, None);
    assert_eq!(ntfy.password, None);
    assert_eq!(ntfy.username, None);
}

#[test]
fn notification_connection_input_is_enabled_when_enabled_is_left_out() {
    let body = json!({ "name": "Phone", "events": [], "settings": minimal_ntfy() });

    let parsed: NotificationConnectionInput = serde_json::from_value(body).unwrap();

    assert!(parsed.enabled);
}

#[test]
fn connection_settings_status_serializes_with_the_kind_tag_beside_its_fields() {
    let status = ConnectionSettingsStatus::Ntfy(NtfySettingsStatus {
        server_url: "https://ntfy.example.com".into(),
        topic: "omnibus".into(),
        auth: NtfyAuth::Token,
        username: None,
        token_set: true,
        password_set: false,
        priority: 4,
        tags: vec!["books".into()],
        include_details: false,
    });

    let value = serde_json::to_value(&status).unwrap();

    assert_eq!(value["kind"], "ntfy");
    assert_eq!(value["auth"], "token");
    assert_eq!(value["token_set"], true);
}

#[test]
fn notification_event_round_trips_its_stored_token_and_wire_name() {
    let event = NotificationEvent::RequestNeedsChooser;

    assert_eq!(NotificationEvent::from_db(event.as_str()), Some(event));
    assert_eq!(serde_json::to_value(event).unwrap(), json!(event.as_str()));
    assert_eq!(NotificationEvent::from_db("something_else"), None);
}

#[test]
fn ntfy_settings_input_debug_hides_the_token_and_password() {
    let mut body = minimal_ntfy();
    body["token"] = json!("tk_secret_token");
    body["password"] = json!("hunter2-password");
    let ConnectionSettingsInput::Ntfy(ntfy) = serde_json::from_value(body).unwrap();

    let printed = format!("{ntfy:?}");

    assert!(!printed.contains("tk_secret_token"));
    assert!(!printed.contains("hunter2-password"));
    assert!(printed.contains("<redacted>"));
}
