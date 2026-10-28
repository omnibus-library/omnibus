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
    mock-kobo tui   [--sync-url <url> | --local | --url <origin> --token <token>]
                    [--port <n>] [--state <path>]

serve runs the device headless; tui runs it in a terminal UI and serves the same API.

OPTIONS (each flag wins over its env var, for both commands):
    --url <origin>    Omnibus origin to sync against        [env: OMNIBUS_MOCK_KOBO_URL]
    --token <token>   the device's path token               [env: OMNIBUS_MOCK_KOBO_TOKEN]
    --state <path>    the device's JSON state file          [env: OMNIBUS_MOCK_KOBO_STATE]
    --port <n>        control API port on 127.0.0.1         [default: 0, any free port]
    -h, --help        print this text

TUI-ONLY OPTIONS:
    --sync-url <url>  the device's sync URL, https://<host>/kobo/<token> (Omnibus
                      Settings > Devices); stands in for --url and --token
    --local           follow this worktree's dev server and wire a token for it

KEYS IN THE TUI:
    up/down select book    Enter open      d download    p read to a percent
    f mark finished        x remove download             s sync
    r reset                u edit URL      t edit token   w wire a token
    q quit

IN THE READER:
    left/right page (crosses chapters)     [/] jump to a chapter's first page
    up/down move the cursor word by word   v start a word selection
    h highlights list                      Esc close (sends the page's position)

WHILE SELECTING A WORD RANGE:
    left/right extend the selection        1-4 highlight in yellow/pink/blue/green
    n type a note                          Esc cancel the selection

IN THE HIGHLIGHTS LIST:
    up/down move the selected row          x delete the selected highlight
    Esc back to the page

TUI WITHOUT --local:
    Unless a token is given (--token or its env var) or the --state file holds one,
    it asks for the device's sync URL before anything is sent. --url needs --token.

TUI --local:
    The device follows this worktree's dev server (.claude/runtime/port, else
    http://localhost:3000). With no token it logs in as OMNIBUS_DEV_SEED_USER
    (<user>:<password>) and reuses or creates the device named \"Mock Kobo\".

STATE:
    serve keeps its state in .claude/runtime/mock-kobo.json unless --state names
    another. tui starts as a new device in a scratch dir it removes on exit; --state
    keeps one across launches.
";

/// What the command line asks for.
#[derive(Debug, PartialEq, Eq)]
pub enum Command {
    /// Run one headless device behind its control API.
    Serve(ServeArgs),
    /// Run one device under a terminal UI, serving the same control API.
    Tui(TuiArgs),
    /// Print the usage text.
    Help,
}

/// The `serve` and `tui` options after flags, env vars and defaults are merged.
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

/// `tui`'s options: `serve`'s, plus whether a state file was named and how the device is first pointed.
#[derive(Debug, PartialEq, Eq)]
pub struct TuiArgs {
    pub serve: ServeArgs,
    /// `--state` or `OMNIBUS_MOCK_KOBO_STATE` was given; otherwise the run uses a scratch state.
    pub state_given: bool,
    /// `--local`: follow this worktree's dev server and auto-wire.
    pub local: bool,
}

impl TuiArgs {
    /// Whether the TUI must ask for a sync URL: no token is given, none is saved
    /// in the named state file, and `--local` won't wire one.
    pub fn needs_prompt(&self, saved_token: bool) -> bool {
        !self.local && self.serve.token.is_none() && !saved_token
    }
}

/// Why the command line can't be used.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum CliError {
    /// The command line doesn't fit the usage text.
    #[error("{0}")]
    Usage(String),
    /// A value that can't be used; `name` is "server URL", "sync URL", "device token", "state file" or "port".
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
        "tui" => parse_tui(flags, env).map(Command::Tui),
        other => Err(CliError::Usage(format!("unknown command: {other}"))),
    }
}

/// `tui`'s flags: `--sync-url` and `--local` on top of the ones `serve` shares.
fn parse_tui(flags: &[String], env: impl Fn(&str) -> Option<String>) -> Result<TuiArgs, CliError> {
    let mut shared = Vec::new();
    let mut sync_url = None;
    let mut local = false;
    let mut target_flag_given = false;
    let mut url_flag_given = false;
    let mut flags = flags.iter();
    while let Some(flag) = flags.next() {
        match flag.as_str() {
            "--local" => local = true,
            "--sync-url" => match flags.next() {
                Some(value) => sync_url = Some(value.clone()),
                None => return Err(CliError::Usage("--sync-url expects a value".into())),
            },
            _ => {
                target_flag_given |= matches!(flag.as_str(), "--url" | "--token");
                url_flag_given |= flag == "--url";
                shared.push(flag.clone());
                shared.extend(flags.next().cloned());
            }
        }
    }
    if sync_url.is_some() && (target_flag_given || local) {
        return Err(CliError::Usage(
            "--sync-url cannot be combined with --url, --token or --local".into(),
        ));
    }
    let mut serve = parse_serve(&shared, &env)?;
    if url_flag_given && serve.token.is_none() && !local {
        return Err(CliError::Usage(
            "--url needs --token or --local: otherwise the sync URL prompt replaces it".into(),
        ));
    }
    if let Some(sync_url) = sync_url {
        let SyncUrl { url, token } = valid_sync_url(sync_url)?;
        serve.url = Some(url);
        serve.token = Some(token);
    }
    let state_given = shared.iter().any(|flag| flag == "--state")
        || env(STATE_ENV).is_some_and(|value| !value.is_empty());
    Ok(TuiArgs {
        serve,
        state_given,
        local,
    })
}

/// The flags `serve` and `tui` share, each falling back to its env var and then its default.
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

/// A device's sync URL split into the origin to sync against and the path token.
#[derive(Debug, PartialEq, Eq)]
pub struct SyncUrl {
    pub url: String,
    pub token: String,
}

/// The origin and token of `url`, if it is exactly `http(s)://<host>/kobo/<token>`.
pub fn valid_sync_url(url: String) -> Result<SyncUrl, CliError> {
    let invalid = || CliError::Invalid {
        name: "sync URL",
        reason: "expected http(s)://<host>/kobo/<token>".into(),
    };
    let parsed = reqwest::Url::parse(&url)
        .ok()
        .filter(|parsed| matches!(parsed.scheme(), "http" | "https"))
        .filter(|parsed| {
            parsed.query().is_none()
                && parsed.fragment().is_none()
                && parsed.username().is_empty()
                && parsed.password().is_none()
        })
        .ok_or_else(invalid)?;
    let mut segments: Vec<&str> = parsed.path_segments().ok_or_else(invalid)?.collect();
    if segments.last() == Some(&"") {
        segments.pop();
    }
    match segments[..] {
        ["kobo", token] if !token.is_empty() => Ok(SyncUrl {
            url: parsed.origin().ascii_serialization(),
            token: valid_token(token.to_owned())?,
        }),
        _ => Err(invalid()),
    }
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
