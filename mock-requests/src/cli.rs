//! The `mock-requests` command line: flags in, a validated [`Command`] out.

use std::path::PathBuf;

use omnibus_shared::DownloadClientKind;

/// The text `--help` prints.
pub const USAGE: &str = "\
mock-requests: a fake Prowlarr and fake download clients for Omnibus book requests

USAGE:
    mock-requests [--port <n>] [--downloads <dir>] [--test-data <dir>] [--download-secs <n>]
                  [--local | --server <origin>] [--client <kind>]

OPTIONS:
    --port <n>            port on 127.0.0.1                   [default: 0, any free port]
    --downloads <dir>     where finished downloads are written
                          [default: .claude/runtime/mock-requests/downloads]
    --test-data <dir>     where the ebook and audiobook payloads are  [default: test_data]
    --download-secs <n>   seconds a download takes to finish  [default: 30]
    --local               point this worktree's dev server at the mock (needs `just dev-up`)
    --server <origin>     point the loopback Omnibus at <origin> at the mock
    --client <kind>       the client to wire: qbittorrent, transmission, sabnzbd or nzbget
                          [default: qbittorrent; needs --local or --server]
    -h, --help            print this text

Steer it while it runs through /_mock (docs/mock-requests.md).
";

/// What the command line asks for.
#[derive(Debug, PartialEq, Eq)]
pub enum Command {
    Run(Args),
    Help,
}

/// Whose settings to point at the mock.
#[derive(Debug, PartialEq, Eq)]
pub enum Target {
    /// This worktree's dev server, from `.claude/runtime/port`.
    Local,
    /// The Omnibus at this origin.
    Server(String),
}

/// The options after flags and defaults are merged.
#[derive(Debug, PartialEq, Eq)]
pub struct Args {
    pub port: u16,
    pub downloads: PathBuf,
    pub test_data: PathBuf,
    pub download_secs: u64,
    pub target: Option<Target>,
    pub client: DownloadClientKind,
}

/// Why the command line can't be used.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum CliError {
    #[error("{0}")]
    Usage(String),
}

fn usage(why: impl Into<String>) -> CliError {
    CliError::Usage(why.into())
}

/// Parse `args` (without the program name).
pub fn parse(args: impl IntoIterator<Item = String>) -> Result<Command, CliError> {
    let mut args = args.into_iter();
    let mut run = Args {
        port: 0,
        downloads: PathBuf::from(".claude/runtime/mock-requests/downloads"),
        test_data: PathBuf::from("test_data"),
        download_secs: 30,
        target: None,
        client: DownloadClientKind::Qbittorrent,
    };
    let mut client_given = false;
    while let Some(flag) = args.next() {
        let mut value = || {
            args.next()
                .ok_or_else(|| usage(format!("{flag} needs a value")))
        };
        match flag.as_str() {
            "-h" | "--help" => return Ok(Command::Help),
            "--port" => run.port = number(&flag, &value()?)?,
            "--download-secs" => run.download_secs = number(&flag, &value()?)?,
            "--downloads" => run.downloads = value()?.into(),
            "--test-data" => run.test_data = value()?.into(),
            "--local" | "--server" => {
                if run.target.is_some() {
                    return Err(usage("--local and --server cannot be used together"));
                }
                run.target = Some(if flag == "--local" {
                    Target::Local
                } else {
                    Target::Server(value()?)
                });
            }
            "--client" => {
                client_given = true;
                run.client = client(&value()?)?;
            }
            other => return Err(usage(format!("unknown flag {other}; see --help"))),
        }
    }
    if client_given && run.target.is_none() {
        return Err(usage("--client needs --local or --server"));
    }
    Ok(Command::Run(run))
}

fn number<T: std::str::FromStr>(flag: &str, value: &str) -> Result<T, CliError> {
    value
        .parse()
        .map_err(|_| usage(format!("{flag} needs a whole number, not {value}")))
}

fn client(value: &str) -> Result<DownloadClientKind, CliError> {
    ["qbittorrent", "transmission", "sabnzbd", "nzbget"]
        .contains(&value)
        .then(|| DownloadClientKind::from_str_or_default(value))
        .ok_or_else(|| {
            usage(format!(
                "--client must be qbittorrent, transmission, sabnzbd or nzbget, not {value}"
            ))
        })
}

#[cfg(test)]
mod tests;
