//! The `mock-requests` binary: parse the command line, bind loopback, serve the fakes
//! until killed, and say when it is ready. With `--local` or `--server` it first points that
//! Omnibus at the mock, which has to be serving by then: the server tests the connections.

use std::path::Path;

use anyhow::Context;

use omnibus_mock_requests::catalogue::Payloads;
use omnibus_mock_requests::cli::{self, Command, Target, RUNTIME_DIR};
use omnibus_mock_requests::ntfy::PATH as NTFY_PATH;
use omnibus_mock_requests::wire::ntfy::CONNECTION_NAME;
use omnibus_mock_requests::wire::{self, SEED_USER_ENV};
use omnibus_mock_requests::{router, Mock};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = match cli::parse(std::env::args().skip(1))? {
        Command::Help => {
            print!("{}", cli::USAGE);
            return Ok(());
        }
        Command::Run(args) => args,
    };
    let payloads = Payloads::find(&args.test_data)?;
    std::fs::create_dir_all(&args.downloads)
        .with_context(|| format!("cannot create {}", args.downloads.display()))?;
    let downloads = args
        .downloads
        .canonicalize()
        .context("cannot resolve the downloads folder")?;
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", args.port))
        .await
        .with_context(|| format!("cannot bind 127.0.0.1:{}", args.port))?;
    let port = listener
        .local_addr()
        .context("cannot read the address")?
        .port();
    let origin = format!("http://127.0.0.1:{port}");
    let mock = Mock::new(
        origin.clone(),
        downloads.clone(),
        payloads,
        args.download_secs,
    );
    let app = router(mock);
    let server = tokio::spawn(async move { axum::serve(listener, app).await });
    if let Some(target) = &args.target {
        let omnibus = match target {
            Target::Local => {
                let here = std::env::current_dir().context("cannot read the working folder")?;
                wire::local_origin(Path::new(RUNTIME_DIR), &here).await?
            }
            Target::Server(origin) => origin.clone(),
        };
        let seed = std::env::var(SEED_USER_ENV).ok();
        let ntfy = wire::wire(&omnibus, seed.as_deref(), &origin, args.client, &downloads).await?;
        let saved = if ntfy.created { "created" } else { "updated" };
        eprintln!("wired {omnibus} to the mock ({})", args.client.as_str());
        eprintln!(
            "wired {omnibus}'s ntfy connection \"{CONNECTION_NAME}\" (id {}, {saved}) to \
             {origin}{NTFY_PATH}; read what it sends at {origin}/_mock/ntfy",
            ntfy.id
        );
    }
    println!(
        "MOCK_REQUESTS_READY port={port} downloads={} pid={}",
        downloads.display(),
        std::process::id()
    );
    server
        .await
        .context("the server task failed")?
        .context("the server stopped")
}
