//! The `mock-kobo` binary. `serve` runs one fake Kobo headless: its state in
//! a JSON file, driven over a control API on 127.0.0.1 until killed.

use std::net::Ipv4Addr;
use std::sync::Arc;

use anyhow::Context;
use tokio::net::TcpListener;
use tokio::sync::Mutex;

use omnibus_mock_kobo::config::Config;
use omnibus_mock_kobo::control::router;
use omnibus_mock_kobo::host::DeviceHost;
use omnibus_mock_kobo::store::DeviceStore;

/// Where `just dev-up` and `just serve` publish this worktree's dev-server port.
const DEV_PORT_FILE: &str = ".claude/runtime/port";

const USAGE: &str = "\
mock-kobo — a fake Kobo e-reader that syncs against an Omnibus

USAGE:
  mock-kobo serve [--url <origin>] [--token <token>] [--port <n>] [--state <path>]

  --url    OMNIBUS_MOCK_KOBO_URL    else the saved url, else this worktree's dev
                                    server (.claude/runtime/port), else :3000
  --token  OMNIBUS_MOCK_KOBO_TOKEN  else the saved token
  --state  OMNIBUS_MOCK_KOBO_STATE  default .claude/runtime/mock-kobo.json
  --port                            control API port on 127.0.0.1, default 5626

A --url or --token (flag or env) is saved for the next start.
Control API: POST /actions/sync, GET /device, GET /requests, PUT /reset
";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let command = args.next();
    let rest: Vec<String> = args.collect();
    let wants_help = rest.iter().any(|a| a == "--help" || a == "-h");
    match command.as_deref() {
        Some("serve") if !wants_help => serve(rest).await,
        Some("serve" | "--help" | "-h") => {
            eprint!("{USAGE}");
            Ok(())
        }
        _ => anyhow::bail!("expected a command\n\n{USAGE}"),
    }
}

/// Open the device, save the flag and env settings into it, and answer the control API.
async fn serve(args: Vec<String>) -> anyhow::Result<()> {
    let config = Config::load(args, |key| std::env::var(key).ok(), published_dev_port)?;
    let mut store = DeviceStore::open(&config.state, new_hardware_id)?;
    let server = config.apply(store.state_mut())?;
    store.save()?;
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, config.port))
        .await
        .with_context(|| format!("binding the control API to 127.0.0.1:{}", config.port))?;
    eprintln!(
        "mock-kobo {} syncing against {}; control API on http://{}",
        store.state().device.hardware_id,
        server.url,
        listener.local_addr()?,
    );
    let host = Arc::new(Mutex::new(DeviceHost::new(store, server)));
    axum::serve(listener, router(host)).await?;
    Ok(())
}

/// The port this worktree's dev server published, read from the repo root `just` runs in.
fn published_dev_port() -> Option<u16> {
    std::fs::read_to_string(DEV_PORT_FILE)
        .ok()?
        .trim()
        .parse()
        .ok()
}

/// A random serial for a device with no state file yet.
fn new_hardware_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}
