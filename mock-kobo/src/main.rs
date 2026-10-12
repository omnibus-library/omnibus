//! The `mock-kobo` binary: parse the command line, start one device, and
//! serve its control API on loopback until killed.

use std::path::Path;
use std::sync::Arc;

use anyhow::Context;

use omnibus_mock_kobo::autowire::SEED_USER_ENV;
use omnibus_mock_kobo::cli::{self, Command, ServeArgs};
use omnibus_mock_kobo::startup::Started;
use omnibus_mock_kobo::{api, startup};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    match cli::parse(std::env::args().skip(1), |key| std::env::var(key).ok())? {
        Command::Help => {
            print!("{}", cli::USAGE);
            Ok(())
        }
        Command::Serve(args) => serve(args).await,
    }
}

/// Run one device behind its control API.
async fn serve(args: ServeArgs) -> anyhow::Result<()> {
    let seed_user = std::env::var(SEED_USER_ENV).ok();
    let runtime_dir = Path::new(cli::RUNTIME_DIR);
    let Started { control, notice } =
        startup::start(&args, seed_user.as_deref(), runtime_dir).await?;
    let listener = api::listen(args.port)
        .await
        .with_context(|| format!("cannot bind 127.0.0.1:{}", args.port))?;
    let port = listener
        .local_addr()
        .context("cannot read the control API address")?
        .port();
    println!(
        "{}",
        api::ready_line(port, &control.view().hardware_id, &args.state)
    );
    if let Some(notice) = notice {
        eprintln!("{notice}");
    }
    axum::serve(listener, api::router(Arc::new(control)))
        .await
        .context("the control API stopped")
}
