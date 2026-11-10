//! The command line: its defaults, each flag, and what it refuses.

use super::*;

fn parse_all(args: &[&str]) -> Result<Command, CliError> {
    parse(args.iter().map(|a| a.to_string()))
}

fn run(args: &[&str]) -> Args {
    match parse_all(args).unwrap() {
        Command::Run(args) => args,
        Command::Help => panic!("asked for help"),
    }
}

#[test]
fn parse_gives_the_defaults_with_no_flags() {
    let args = run(&[]);

    assert_eq!(
        args,
        Args {
            port: 0,
            downloads: ".claude/runtime/mock-requests/downloads".into(),
            test_data: "test_data".into(),
            download_secs: 30,
            target: None,
            client: DownloadClientKind::Qbittorrent,
        }
    );
}

#[test]
fn parse_accepts_each_flag() {
    let args = run(&[
        "--port",
        "4000",
        "--downloads",
        "/d",
        "--test-data",
        "/t",
        "--download-secs",
        "5",
        "--server",
        "http://127.0.0.1:3000",
        "--client",
        "nzbget",
    ]);

    assert_eq!(args.port, 4000);
    assert_eq!(args.downloads, PathBuf::from("/d"));
    assert_eq!(args.test_data, PathBuf::from("/t"));
    assert_eq!(args.download_secs, 5);
    assert_eq!(
        args.target,
        Some(Target::Server("http://127.0.0.1:3000".into()))
    );
    assert_eq!(args.client, DownloadClientKind::Nzbget);
}

#[test]
fn parse_accepts_local_and_help() {
    assert_eq!(run(&["--local"]).target, Some(Target::Local));
    assert_eq!(parse_all(&["--help"]).unwrap(), Command::Help);
}

#[test]
fn parse_refuses_what_it_cannot_use() {
    let bad: &[&[&str]] = &[
        &["--nope"],
        &["--port"],
        &["--port", "many"],
        &["--local", "--server", "http://127.0.0.1:1"],
        &["--client", "sabnzbd"],
        &["--local", "--client", "deluge"],
    ];
    for args in bad {
        assert!(
            matches!(parse_all(args), Err(CliError::Usage(_))),
            "{args:?} was accepted"
        );
    }
}

#[test]
fn parse_accepts_each_download_client_kind() {
    for kind in ["qbittorrent", "transmission", "sabnzbd", "nzbget"] {
        let args = run(&["--local", "--client", kind]);

        assert_eq!(args.client.as_str(), kind);
    }
}
