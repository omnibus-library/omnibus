//! The `mock-kobo` command line: flags and env vars in, a validated [`Command`] out.

use std::path::PathBuf;

/// The env var behind `--url`.
pub const URL_ENV: &str = "OMNIBUS_MOCK_KOBO_URL";

/// The env var behind `--token`.
pub const TOKEN_ENV: &str = "OMNIBUS_MOCK_KOBO_TOKEN";

/// The env var behind `--state`.
pub const STATE_ENV: &str = "OMNIBUS_MOCK_KOBO_STATE";

/// Where `just dev-up` / `just serve` publish this worktree's dev-server port.
pub const RUNTIME_DIR: &str = ".claude/runtime";

/// The state file a device uses when none is named.
pub const DEFAULT_STATE_PATH: &str = ".claude/runtime/mock-kobo.json";

/// The text `--help` prints.
pub const USAGE: &str = "\
mock-kobo: a fake Kobo e-reader that syncs against Omnibus

USAGE:
    mock-kobo serve [--url <origin>] [--token <token>] [--port <n>] [--state <path>]

OPTIONS (each flag wins over its env var):
    --url <origin>    Omnibus origin to sync against        [env: OMNIBUS_MOCK_KOBO_URL]
    --token <token>   the device's path token               [env: OMNIBUS_MOCK_KOBO_TOKEN]
    --state <path>    the device's JSON state file          [env: OMNIBUS_MOCK_KOBO_STATE]
    --port <n>        control API port on 127.0.0.1         [default: 0, any free port]
    -h, --help        print this text

WITH NO ARGUMENTS:
    The device follows this worktree's dev server (.claude/runtime/port, else
    http://127.0.0.1:3000). With no token it logs in as OMNIBUS_DEV_SEED_USER
    (<user>:<password>) and reuses or creates the device named \"Mock Kobo\".
    A new state file reusing an existing device syncs only changes until #2743.
    The state file defaults to .claude/runtime/mock-kobo.json.
";

/// What the command line asks for.
#[derive(Debug, PartialEq, Eq)]
pub enum Command {
    /// Run one headless device behind its control API.
    Serve(ServeArgs),
    /// Print the usage text.
    Help,
}

/// The `serve` options after flags, env vars and defaults are merged.
#[derive(Debug, PartialEq, Eq)]
pub struct ServeArgs {
    /// `--url` or `OMNIBUS_MOCK_KOBO_URL`, validated and reduced to its origin.
    pub url: Option<String>,
    /// `--token` or `OMNIBUS_MOCK_KOBO_TOKEN`, validated.
    pub token: Option<String>,
    /// The control API port; 0 asks the OS for a free one.
    pub port: u16,
    /// `--state`, else `OMNIBUS_MOCK_KOBO_STATE`, else `DEFAULT_STATE_PATH`.
    pub state: PathBuf,
}

/// Why the command line can't be used.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum CliError {
    /// The command line doesn't fit the usage text.
    #[error("{0}")]
    Usage(String),
    /// A value that can't be used; `name` is "server URL", "device token", "state file" or "port".
    #[error("invalid {name}: {reason}")]
    Invalid { name: &'static str, reason: String },
}

/// Parse the arguments after the binary name, reading env vars only through `env`.
pub fn parse<I>(args: I, env: impl Fn(&str) -> Option<String>) -> Result<Command, CliError>
where
    I: IntoIterator<Item = String>,
{
    let args: Vec<String> = args.into_iter().collect();
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        return Ok(Command::Help);
    }
    let Some((command, flags)) = args.split_first() else {
        return Err(CliError::Usage("missing command".into()));
    };
    match command.as_str() {
        "serve" => parse_serve(flags, env).map(Command::Serve),
        other => Err(CliError::Usage(format!("unknown command: {other}"))),
    }
}

/// The `serve` flags, each falling back to its env var and then its default.
fn parse_serve(
    flags: &[String],
    env: impl Fn(&str) -> Option<String>,
) -> Result<ServeArgs, CliError> {
    let mut url = None;
    let mut token = None;
    let mut port = None;
    let mut state = None;
    let mut flags = flags.iter();
    while let Some(flag) = flags.next() {
        let slot = match flag.as_str() {
            "--url" => &mut url,
            "--token" => &mut token,
            "--port" => &mut port,
            "--state" => &mut state,
            _ => return Err(CliError::Usage(format!("unknown argument: {flag}"))),
        };
        match flags.next() {
            Some(value) => *slot = Some(value.clone()),
            None => return Err(CliError::Usage(format!("{flag} expects a value"))),
        }
    }
    let or_env = |flag_value: Option<String>, key: &str| {
        flag_value.or_else(|| env(key).filter(|value| !value.is_empty()))
    };
    Ok(ServeArgs {
        url: or_env(url, URL_ENV).map(valid_url).transpose()?,
        token: or_env(token, TOKEN_ENV).map(valid_token).transpose()?,
        port: port.map_or(Ok(0), valid_port)?,
        state: or_env(state, STATE_ENV)
            .map(valid_state)
            .transpose()?
            .unwrap_or_else(|| PathBuf::from(DEFAULT_STATE_PATH)),
    })
}

/// The origin of `url`, if it is a bare http(s) origin: no path, query, fragment or credentials.
pub fn valid_url(url: String) -> Result<String, CliError> {
    let invalid = |reason: &str| CliError::Invalid {
        name: "server URL",
        reason: reason.into(),
    };
    let parsed = reqwest::Url::parse(&url)
        .ok()
        .filter(|parsed| matches!(parsed.scheme(), "http" | "https"))
        .ok_or_else(|| invalid("expected an http:// or https:// URL"))?;
    let bare = parsed.path() == "/"
        && parsed.query().is_none()
        && parsed.fragment().is_none()
        && parsed.username().is_empty()
        && parsed.password().is_none();
    if !bare {
        return Err(invalid("expected an origin like http://host:port"));
    }
    Ok(parsed.origin().ascii_serialization())
}

/// `token` if it is made only of the URL-safe base64 characters Omnibus issues.
pub fn valid_token(token: String) -> Result<String, CliError> {
    let url_safe = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_';
    if !token.is_empty() && token.chars().all(url_safe) {
        return Ok(token);
    }
    Err(CliError::Invalid {
        name: "device token",
        reason: "expected letters, digits, '-' and '_' only".into(),
    })
}

/// `state` as a path, if it names one.
fn valid_state(state: String) -> Result<PathBuf, CliError> {
    if state.is_empty() {
        return Err(CliError::Invalid {
            name: "state file",
            reason: "expected a file path".into(),
        });
    }
    Ok(PathBuf::from(state))
}

fn valid_port(port: String) -> Result<u16, CliError> {
    port.parse()
        .map_err(|error: std::num::ParseIntError| CliError::Invalid {
            name: "port",
            reason: error.to_string(),
        })
}

#[cfg(test)]
mod tests;
