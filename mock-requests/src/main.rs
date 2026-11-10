//! The `mock-requests` binary: parse the command line, bind loopback, serve the fakes
//! until killed, and say when it is ready.

use anyhow::Context;

use omnibus_mock_requests::catalogue::Payloads;
use omnibus_mock_requests::cli::{self, Command};
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
    let mock = Mock::new(
        format!("http://127.0.0.1:{port}"),
        downloads.clone(),
        payloads,
        args.download_secs,
    );
    let app = router(mock);
    let server = tokio::spawn(async move { axum::serve(listener, app).await });
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
