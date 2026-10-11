//! `Config` from flags, an env lookup and a published-port lookup: what wins, and each malformed command line.

use std::path::PathBuf;

use crate::device::Device;
use crate::store::SavedState;

use super::*;

fn args(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

fn no_env(_: &str) -> Option<String> {
    None
}

fn no_dev_server() -> Option<u16> {
    None
}

/// A device that has never been pointed at a server.
fn fresh_state() -> SavedState {
    SavedState {
        url: None,
        token: None,
        device: Device::new("HW-1"),
    }
}

#[test]
fn config_load_prefers_url_flag_over_env() {
    let env = |key: &str| (key == "OMNIBUS_MOCK_KOBO_URL").then(|| "http://env:3000".to_owned());

    let config = Config::load(args(&["--url", "http://flag:4000"]), env, no_dev_server).unwrap();

    assert_eq!(config.url.as_deref(), Some("http://flag:4000"));
}

#[test]
fn config_apply_falls_back_to_published_dev_port_when_no_url_given() {
    let config = Config::load(args(&["--token", "t"]), no_env, || Some(3417)).unwrap();

    let server = config.apply(&mut fresh_state()).unwrap();

    assert_eq!(server.url, "http://127.0.0.1:3417");
}

#[test]
fn config_apply_prefers_token_flag_over_saved_token() {
    let config = Config::load(args(&["--token", "flag-token"]), no_env, no_dev_server).unwrap();
    let mut saved = fresh_state();
    saved.token = Some("saved-token".into());

    let server = config.apply(&mut saved).unwrap();

    assert_eq!(
        (server.token.as_str(), saved.token.as_deref()),
        ("flag-token", Some("flag-token"))
    );
}

#[test]
fn config_apply_fails_when_no_token_given_or_saved() {
    let config = Config::load(args(&[]), no_env, no_dev_server).unwrap();

    let failure = config.apply(&mut fresh_state()).unwrap_err();

    assert_eq!(failure, ConfigError::MissingToken);
}

#[test]
fn config_load_rejects_unknown_flag() {
    let failure = Config::load(args(&["--nope", "x"]), no_env, no_dev_server).unwrap_err();

    assert_eq!(failure, ConfigError::UnknownArg("--nope".into()));
}

#[test]
fn config_load_rejects_flag_without_value() {
    let failure = Config::load(args(&["--token"]), no_env, no_dev_server).unwrap_err();

    assert_eq!(failure, ConfigError::MissingValue("--token".into()));
}

#[test]
fn config_load_rejects_port_that_is_not_a_number() {
    let failure = Config::load(args(&["--port", "kobo"]), no_env, no_dev_server).unwrap_err();

    assert_eq!(failure, ConfigError::BadPort("kobo".into()));
}

#[test]
fn config_load_uses_documented_defaults_when_nothing_given() {
    let config = Config::load(args(&[]), no_env, no_dev_server).unwrap();

    assert_eq!(
        (config.port, config.state, config.default_url.as_str()),
        (
            5626,
            PathBuf::from(".claude/runtime/mock-kobo.json"),
            "http://127.0.0.1:3000"
        )
    );
}

#[test]
fn config_load_reads_url_token_and_state_from_env_when_no_flags() {
    let env = |key: &str| match key {
        "OMNIBUS_MOCK_KOBO_URL" => Some("http://env:3000".to_owned()),
        "OMNIBUS_MOCK_KOBO_TOKEN" => Some("env-token".to_owned()),
        "OMNIBUS_MOCK_KOBO_STATE" => Some("/tmp/env-kobo.json".to_owned()),
        _ => None,
    };

    let config = Config::load(args(&[]), env, no_dev_server).unwrap();

    assert_eq!(
        (config.url.as_deref(), config.token.as_deref(), config.state),
        (
            Some("http://env:3000"),
            Some("env-token"),
            PathBuf::from("/tmp/env-kobo.json")
        )
    );
}

#[test]
fn config_load_treats_empty_env_value_as_unset() {
    let env = |key: &str| (key == "OMNIBUS_MOCK_KOBO_URL").then(String::new);

    let config = Config::load(args(&[]), env, no_dev_server).unwrap();

    assert_eq!(config.url, None);
}

#[test]
fn config_load_trims_trailing_slash_from_url() {
    let config =
        Config::load(args(&["--url", "http://flag:4000/"]), no_env, no_dev_server).unwrap();

    assert_eq!(config.url.as_deref(), Some("http://flag:4000"));
}

#[test]
fn config_apply_prefers_saved_url_over_published_dev_port() {
    let config = Config::load(args(&["--token", "t"]), no_env, || Some(3417)).unwrap();
    let mut saved = fresh_state();
    saved.url = Some("http://saved:4000".into());

    let server = config.apply(&mut saved).unwrap();

    assert_eq!(server.url, "http://saved:4000");
}
