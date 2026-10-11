//! The device's settings: `serve`'s flags (which win) or the
//! `OMNIBUS_MOCK_KOBO_*` env vars, then the state file, then this worktree's
//! dev server. The env and the published port arrive as lookups, so tests
//! never touch process-global state or the disk.

use std::path::PathBuf;

use crate::store::SavedState;

const URL_ENV: &str = "OMNIBUS_MOCK_KOBO_URL";
const TOKEN_ENV: &str = "OMNIBUS_MOCK_KOBO_TOKEN";
const STATE_ENV: &str = "OMNIBUS_MOCK_KOBO_STATE";

/// The state file when `--state` and the env are absent: gitignored and per-worktree.
pub const DEFAULT_STATE: &str = ".claude/runtime/mock-kobo.json";

/// The control API's port when `--port` is absent: "KOBO" on a phone keypad.
pub const DEFAULT_PORT: u16 = 5626;

/// The origin when nothing names one and no dev server published its port.
const FALLBACK_URL: &str = "http://127.0.0.1:3000";

/// `serve`'s settings before the state file is read.
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    /// The Omnibus origin from `--url` or the env.
    pub url: Option<String>,
    /// The origin when no flag, env var or state file names one: this
    /// worktree's dev server, else [`FALLBACK_URL`].
    pub default_url: String,
    /// The Kobo device token from `--token` or the env.
    pub token: Option<String>,
    /// The control API's port on 127.0.0.1.
    pub port: u16,
    /// The device's state file.
    pub state: PathBuf,
}

/// The Omnibus a device syncs against.
#[derive(Clone, Debug, PartialEq)]
pub struct Server {
    pub url: String,
    pub token: String,
}

impl Server {
    /// The `api_endpoint` the device is configured with.
    pub fn api_endpoint(&self) -> String {
        format!("{}/kobo/{}", self.url, self.token)
    }
}

/// Why the settings could not be assembled.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum ConfigError {
    #[error("unknown argument {0}")]
    UnknownArg(String),
    #[error("flag {0} expects a value")]
    MissingValue(String),
    #[error("--port expects a port number, got {0}")]
    BadPort(String),
    #[error("no device token: pass --token <token> or set OMNIBUS_MOCK_KOBO_TOKEN")]
    MissingToken,
}

impl Config {
    /// Assemble the settings from `serve`'s args, an env lookup, and the
    /// port this worktree's dev server published, if any.
    pub fn load<I>(
        args: I,
        env: impl Fn(&str) -> Option<String>,
        published_port: impl FnOnce() -> Option<u16>,
    ) -> Result<Self, ConfigError>
    where
        I: IntoIterator<Item = String>,
    {
        let mut url = None;
        let mut token = None;
        let mut port = None;
        let mut state = None;
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            let slot = match arg.as_str() {
                "--url" => &mut url,
                "--token" => &mut token,
                "--port" => &mut port,
                "--state" => &mut state,
                _ => return Err(ConfigError::UnknownArg(arg)),
            };
            match args.next() {
                Some(value) => *slot = Some(value),
                None => return Err(ConfigError::MissingValue(arg)),
            }
        }
        let port = match port {
            Some(port) => port.parse().map_err(|_| ConfigError::BadPort(port))?,
            None => DEFAULT_PORT,
        };
        let env = |key| env(key).filter(|value: &String| !value.is_empty());
        let default_url = published_port().map_or_else(
            || FALLBACK_URL.to_owned(),
            |p| format!("http://127.0.0.1:{p}"),
        );
        Ok(Self {
            url: url
                .or_else(|| env(URL_ENV))
                .map(|url| url.trim_end_matches('/').to_owned()),
            default_url,
            token: token.or_else(|| env(TOKEN_ENV)),
            port,
            state: state
                .or_else(|| env(STATE_ENV))
                .unwrap_or_else(|| DEFAULT_STATE.to_owned())
                .into(),
        })
    }

    /// Save the flag and env settings into `saved`, then name the server:
    /// the url from flag, env, state file, else [`Config::default_url`];
    /// the token from flag, env, else the state file.
    pub fn apply(&self, saved: &mut SavedState) -> Result<Server, ConfigError> {
        saved.url = self.url.clone().or(saved.url.take());
        saved.token = self.token.clone().or(saved.token.take());
        let token = saved.token.clone().ok_or(ConfigError::MissingToken)?;
        let url = saved
            .url
            .clone()
            .unwrap_or_else(|| self.default_url.clone());
        Ok(Server { url, token })
    }
}

#[cfg(test)]
mod tests;
