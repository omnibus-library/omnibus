//! `cli::parse` over the `mock-kobo serve` flags, env fallbacks, defaults and error paths.

use super::*;

fn args(list: &[&str]) -> Vec<String> {
    list.iter().map(|a| (*a).to_owned()).collect()
}

fn no_env(_: &str) -> Option<String> {
    None
}

fn env_of(pairs: &[(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
    let pairs = pairs.to_vec();
    move |key| {
        pairs
            .iter()
            .find(|(name, _)| *name == key)
            .map(|(_, value)| (*value).to_owned())
    }
}

fn serve(list: &[&str]) -> ServeArgs {
    match parse(args(list), no_env).unwrap() {
        Command::Serve(serve) => serve,
        Command::Help => panic!("expected a serve command"),
    }
}

#[test]
fn parse_reads_every_serve_flag() {
    let command = parse(
        args(&[
            "serve",
            "--url",
            "http://h:9/",
            "--token",
            "abc_-1",
            "--port",
            "8123",
            "--state",
            "x.json",
        ]),
        no_env,
    )
    .unwrap();

    assert_eq!(
        command,
        Command::Serve(ServeArgs {
            url: Some("http://h:9".into()),
            token: Some("abc_-1".into()),
            port: 8123,
            state: "x.json".into(),
        })
    );
}

#[test]
fn parse_leaves_url_and_token_unset_when_not_given() {
    let serve = serve(&["serve"]);

    assert_eq!((serve.url, serve.token), (None, None));
}

#[test]
fn parse_defaults_port_to_zero_when_unset() {
    assert_eq!(serve(&["serve"]).port, 0);
}

#[test]
fn parse_defaults_state_to_runtime_dir_when_unset() {
    assert_eq!(
        serve(&["serve"]).state,
        PathBuf::from(".claude/runtime/mock-kobo.json")
    );
}

#[test]
fn parse_trims_trailing_slash_from_url() {
    assert_eq!(
        serve(&["serve", "--url", "https://omnibus.example/"]).url,
        Some("https://omnibus.example".to_owned())
    );
}

#[test]
fn parse_falls_back_to_env_when_flags_absent() {
    let env = env_of(&[
        (URL_ENV, "http://env-host:1/"),
        (TOKEN_ENV, "env-token"),
        (STATE_ENV, "env.json"),
    ]);

    let command = parse(args(&["serve"]), env).unwrap();

    assert_eq!(
        command,
        Command::Serve(ServeArgs {
            url: Some("http://env-host:1".into()),
            token: Some("env-token".into()),
            port: 0,
            state: "env.json".into(),
        })
    );
}

#[test]
fn parse_prefers_flags_over_env() {
    let env = env_of(&[
        (URL_ENV, "http://env-host:1"),
        (TOKEN_ENV, "env-token"),
        (STATE_ENV, "env.json"),
    ]);

    let command = parse(
        args(&[
            "serve",
            "--url",
            "http://flag-host:2",
            "--token",
            "flag-token",
            "--state",
            "flag.json",
        ]),
        env,
    )
    .unwrap();

    assert_eq!(
        command,
        Command::Serve(ServeArgs {
            url: Some("http://flag-host:2".into()),
            token: Some("flag-token".into()),
            port: 0,
            state: "flag.json".into(),
        })
    );
}

#[test]
fn parse_treats_empty_env_values_as_absent() {
    let env = env_of(&[(URL_ENV, ""), (TOKEN_ENV, ""), (STATE_ENV, "")]);

    let command = parse(args(&["serve"]), env).unwrap();

    assert_eq!(
        command,
        Command::Serve(ServeArgs {
            url: None,
            token: None,
            port: 0,
            state: DEFAULT_STATE_PATH.into(),
        })
    );
}

#[test]
fn parse_returns_help_when_help_flag_given() {
    for list in [
        &["--help"][..],
        &["-h"],
        &["serve", "--url", "http://h:9", "--help"],
    ] {
        assert_eq!(parse(args(list), no_env), Ok(Command::Help), "{list:?}");
    }
}

#[test]
fn parse_returns_usage_error_when_command_missing() {
    assert_eq!(
        parse(args(&[]), no_env),
        Err(CliError::Usage("missing command".into()))
    );
}

#[test]
fn parse_returns_usage_error_for_unknown_command() {
    assert_eq!(
        parse(args(&["tui"]), no_env),
        Err(CliError::Usage("unknown command: tui".into()))
    );
}

#[test]
fn parse_returns_usage_error_for_unknown_flag() {
    assert_eq!(
        parse(args(&["serve", "--bogus", "x"]), no_env),
        Err(CliError::Usage("unknown argument: --bogus".into()))
    );
}

#[test]
fn parse_returns_usage_error_when_flag_lacks_value() {
    assert_eq!(
        parse(args(&["serve", "--url"]), no_env),
        Err(CliError::Usage("--url expects a value".into()))
    );
}

fn is_invalid(result: Result<Command, CliError>, expected: &str) -> bool {
    matches!(result, Err(CliError::Invalid { name, .. }) if name == expected)
}

#[test]
fn parse_rejects_port_that_is_not_a_number() {
    assert!(is_invalid(
        parse(args(&["serve", "--port", "abc"]), no_env),
        "port"
    ));
}

#[test]
fn parse_rejects_port_above_65535() {
    assert_eq!(serve(&["serve", "--port", "65535"]).port, 65535);
    assert!(is_invalid(
        parse(args(&["serve", "--port", "65536"]), no_env),
        "port"
    ));
}

#[test]
fn parse_rejects_url_without_http_scheme() {
    for url in ["localhost:3000", "ftp://h", "http-foo://h", ""] {
        let from_flag = parse(args(&["serve", "--url", url]), no_env);
        assert!(is_invalid(from_flag, "server URL"), "{url:?} as a flag");
    }
    let from_env = parse(args(&["serve"]), env_of(&[(URL_ENV, "localhost:3000")]));
    assert!(is_invalid(from_env, "server URL"), "as an env var");
}

fn rejects_server_urls(urls: &[&str]) {
    for url in urls {
        let from_flag = parse(args(&["serve", "--url", url]), no_env);
        assert!(is_invalid(from_flag, "server URL"), "{url:?} as a flag");
    }
}

#[test]
fn parse_rejects_url_with_path() {
    rejects_server_urls(&[
        "http://h:9/omnibus",
        "http://h:9/omnibus/",
        "http://h:9/kobo/tok",
        "http://h:9//",
    ]);
}

#[test]
fn parse_rejects_url_with_query_or_fragment() {
    rejects_server_urls(&[
        "http://h:9?x=1",
        "http://h:9/?x=1",
        "http://h:9#top",
        "http://h:9/#top",
    ]);
}

#[test]
fn parse_rejects_url_with_credentials() {
    rejects_server_urls(&["http://user:pw@h:9", "http://user@h:9", "http://:pw@h:9"]);
}

#[test]
fn parse_normalizes_url_to_its_origin() {
    assert_eq!(
        serve(&["serve", "--url", " http://H:9/ "]).url,
        Some("http://h:9".to_owned())
    );
}

#[test]
fn parse_rejects_empty_state_path() {
    let from_flag = parse(args(&["serve", "--state", ""]), no_env);

    assert!(is_invalid(from_flag, "state file"));
}

#[test]
fn parse_rejects_token_outside_url_safe_base64() {
    for token in ["a/b", "a b", "a.b", "tökén", ""] {
        let from_flag = parse(args(&["serve", "--token", token]), no_env);
        assert!(is_invalid(from_flag, "device token"), "{token:?} as a flag");
    }
    let from_env = parse(args(&["serve"]), env_of(&[(TOKEN_ENV, "a/b")]));
    assert!(is_invalid(from_env, "device token"), "as an env var");
}
