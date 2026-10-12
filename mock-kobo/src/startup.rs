//! Starting a device: merge the command line, the state file and the dev
//! server into one target, auto-wire a token if none is known, and save.

use std::path::Path;

use crate::autowire::{self, AutoWireError, SeedUser};
use crate::cli::ServeArgs;
use crate::control::Control;
use crate::device::{mint_hardware_id, Device};
use crate::state::{self, SavedState, StateError};

/// Where a device syncs when nothing else names a server.
pub const DEFAULT_URL: &str = "http://127.0.0.1:3000";

/// Where the device points before any auto-wire.
#[derive(Debug, PartialEq, Eq)]
pub struct Target {
    /// The origin to sync against this run.
    pub url: String,
    /// The origin to save: only one given now or saved before.
    pub pinned_url: Option<String>,
    /// The token given now or saved before; `None` means auto-wire.
    pub token: Option<String>,
}

/// Merge the command line, the saved state and the discovered dev server.
/// A given value beats a saved one; with no URL pinned the dev server, then
/// [`DEFAULT_URL`], is followed afresh on every start.
pub fn resolve_target(
    args: &ServeArgs,
    saved: Option<&SavedState>,
    dev_server: Option<String>,
) -> Target {
    let pinned_url = args
        .url
        .clone()
        .or_else(|| saved.and_then(|saved| saved.url.clone()));
    let url = pinned_url
        .clone()
        .or(dev_server)
        .unwrap_or_else(|| DEFAULT_URL.to_owned());
    let token = args
        .token
        .clone()
        .or_else(|| saved.map(|saved| saved.token.clone()));
    Target {
        url,
        pinned_url,
        token,
    }
}

/// Why a device couldn't be started.
#[derive(Debug, thiserror::Error)]
pub enum StartError {
    #[error(transparent)]
    State(#[from] StateError),
    #[error(transparent)]
    AutoWire(#[from] AutoWireError),
    #[error("cannot mint a hardware id: {0}")]
    HardwareId(String),
}

/// Load the state file, resolve the target, auto-wire if no token is known,
/// mint a hardware id for a new device, save, and return the running device.
pub async fn start(
    args: &ServeArgs,
    seed_user: Option<&str>,
    runtime_dir: &Path,
) -> Result<Control, StartError> {
    let saved = state::load(&args.state).await?;
    let dev_server = autowire::dev_server_url(runtime_dir).await;
    let target = resolve_target(args, saved.as_ref(), dev_server);
    let token = match target.token {
        Some(token) => token,
        None => {
            let seed = SeedUser::parse(seed_user)?;
            autowire::wire(&target.url, &seed, &autowire::device_name(&args.state)).await?
        }
    };
    let device = match saved {
        Some(saved) => saved.device,
        None => new_device()?,
    };
    let saved = SavedState {
        url: target.pinned_url,
        token,
        device,
    };
    state::save(&args.state, &saved).await?;
    Ok(Control::new(saved, target.url, args.state.clone()))
}

/// A device with a freshly minted hardware id.
fn new_device() -> Result<Device, StartError> {
    let hardware_id =
        mint_hardware_id().map_err(|error| StartError::HardwareId(error.to_string()))?;
    Ok(Device::new(&hardware_id))
}

#[cfg(test)]
mod tests;
