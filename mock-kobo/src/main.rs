//! The `mock-kobo` binary: parse the command line, start one device, and serve
//! its control API on loopback until killed, headless (`serve`) or under a
//! terminal UI that drives the same device (`tui`).

use std::path::Path;
use std::sync::Arc;

use anyhow::Context;

use omnibus_mock_kobo::autowire::SEED_USER_ENV;
use omnibus_mock_kobo::cli::{self, Command, ServeArgs};
use omnibus_mock_kobo::control::Control;
use omnibus_mock_kobo::startup::Started;
use omnibus_mock_kobo::{api, startup};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let seed_user = std::env::var(SEED_USER_ENV).ok();
    match cli::parse(std::env::args().skip(1), |key| std::env::var(key).ok())? {
        Command::Help => {
            print!("{}", cli::USAGE);
            Ok(())
        }
        Command::Serve(args) => serve(args, seed_user.as_deref()).await,
        #[cfg(feature = "tui")]
        Command::Tui(args) => tui(args, seed_user).await,
        #[cfg(not(feature = "tui"))]
        Command::Tui(_) => anyhow::bail!("this mock-kobo was built without the `tui` feature"),
    }
}

/// A started device with its control API bound but not yet served.
struct BroughtUp {
    control: Arc<Control>,
    notice: Option<String>,
    listener: tokio::net::TcpListener,
    port: u16,
}

/// Start the device and bind its control API, before anything is printed or drawn.
async fn bring_up(args: &ServeArgs, seed_user: Option<&str>) -> anyhow::Result<BroughtUp> {
    let runtime_dir = Path::new(cli::RUNTIME_DIR);
    let Started { control, notice } = startup::start(args, seed_user, runtime_dir).await?;
    let listener = api::listen(args.port)
        .await
        .with_context(|| format!("cannot bind 127.0.0.1:{}", args.port))?;
    let port = listener
        .local_addr()
        .context("cannot read the control API address")?
        .port();
    Ok(BroughtUp {
        control: Arc::new(control),
        notice,
        listener,
        port,
    })
}

/// Run one device behind its control API.
async fn serve(args: ServeArgs, seed_user: Option<&str>) -> anyhow::Result<()> {
    let BroughtUp {
        control,
        notice,
        listener,
        port,
    } = bring_up(&args, seed_user).await?;
    let hardware_id = control.view().hardware_id;
    println!(
        "{}",
        api::ready_line(port, &hardware_id, &args.state, std::process::id())
    );
    if let Some(notice) = notice {
        eprintln!("{notice}");
    }
    axum::serve(listener, api::router(control))
        .await
        .context("the control API stopped")
}

/// Run one device under the terminal UI while the same device serves its control API.
#[cfg(feature = "tui")]
async fn tui(args: ServeArgs, seed_user: Option<String>) -> anyhow::Result<()> {
    use omnibus_mock_kobo::autowire::device_name;
    use omnibus_mock_kobo::tui::jobs::Wiring;
    use omnibus_mock_kobo::tui::{self, Tui};

    let BroughtUp {
        control,
        notice,
        listener,
        port,
    } = bring_up(&args, seed_user.as_deref()).await?;
    let api = tokio::spawn({
        let router = api::router(Arc::clone(&control));
        async move { axum::serve(listener, router).await }
    });
    let wiring = Wiring {
        seed_user,
        device_name: device_name(&args.state),
    };
    let running = Arc::clone(&control);
    let ui = Tui {
        control,
        port,
        state: args.state,
        wiring,
        notice,
    };
    let runtime = tokio::runtime::Handle::current();
    // Terminal input blocks, so it gets its own thread rather than a runtime worker.
    let ended = tokio::task::spawn_blocking(move || tui::run(ui, runtime)).await;
    // The server has recorded what a sync delivered, so quitting must not drop it unsaved.
    if running.view().syncing {
        eprintln!("waiting for the running sync to finish…");
        running.wait_until_idle().await;
    }
    api.abort();
    ended
        .context("the terminal UI stopped unexpectedly")?
        .context("the terminal UI failed")
}
