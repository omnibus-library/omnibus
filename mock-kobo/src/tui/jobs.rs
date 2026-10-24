//! Running a TUI job against the device: each [`Job`] the key handler asks for
//! becomes calls on `Control` and `autowire`, and a [`Status`] saying how it went.
//! The only place the TUI waits on the network, so the loop runs it off the
//! draw thread. Wiring, its loopback-only guard and device naming stay in `autowire`.

use std::fmt::Display;
use std::sync::Arc;

use crate::annotations::NewHighlight;
use crate::autowire::{self, AutoWireError, SeedUser};
use crate::control::{Acted, Control, ControlError, LastSync, Retarget, Retargeted, RESET_MESSAGE};
use crate::device::DeviceError;
use crate::downloads::DownloadPolicy;
use crate::kepub::Kepub;
use crate::reading::{KoboSpan, Percent};
use crate::tui::app::{Job, Status};

/// What `w` needs to wire a token: the dev seed admin and the device's Omnibus name.
pub struct Wiring {
    /// `OMNIBUS_DEV_SEED_USER` as read at startup.
    pub seed_user: Option<String>,
    /// `autowire::device_name` of the state file.
    pub device_name: String,
}

/// Run `job` against `control` to its end; how the status line reports it.
pub async fn perform(control: &Arc<Control>, wiring: &Wiring, job: Job) -> Status {
    match job {
        Job::Sync => sync(control).await,
        Job::Reset => reset(control).await,
        Job::SetUrl(url) => set_url(control, wiring, &url).await,
        Job::SetToken(token) => set_token(control, token).await,
        Job::Wire => wire(control, wiring).await,
        Job::Download(book) => download(control, book).await,
        Job::Read {
            book,
            percent,
            location,
        } => read(control, book, percent, location).await,
        Job::Finish(book) => finish(control, book).await,
        Job::RemoveDownload(book) => remove_download(control, book).await,
        Job::Highlight { book, highlight } => make_highlight(control, book, highlight).await,
        Job::DeleteHighlight { book, highlight } => {
            delete_highlight(control, book, highlight).await
        }
    }
}

async fn make_highlight(control: &Arc<Control>, book: String, highlight: NewHighlight) -> Status {
    acted_status("annotation sent", control.highlight(book, highlight).await)
}

/// Delete `book`'s named highlight (the reader's list names it by id).
async fn delete_highlight(control: &Arc<Control>, book: String, highlight: String) -> Status {
    acted_status(
        "annotation sent",
        control.delete_highlight(book, highlight).await,
    )
}

async fn download(control: &Arc<Control>, book: String) -> Status {
    acted_status("downloaded", control.download(vec![book]).await)
}

async fn read(
    control: &Arc<Control>,
    book: String,
    percent: Percent,
    location: Option<KoboSpan>,
) -> Status {
    acted_status("state sent", control.read(book, percent, location).await)
}

/// Load `book`'s downloaded KEPUB for the reader. `NotDownloaded` means
/// metadata-only (`Ok(None)`), not an error; any other refusal or an
/// unreadable file becomes its message.
pub fn load_book(control: &Control, book: &str) -> Result<Option<Kepub>, String> {
    match control.book_file(book) {
        Ok(path) => Kepub::open(&path)
            .map(Some)
            .map_err(|error| error.to_string()),
        Err(DeviceError::NotDownloaded(_)) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

async fn finish(control: &Arc<Control>, book: String) -> Status {
    acted_status("state sent", control.finish(book).await)
}

/// How an [`Acted`] result reports on the status line, under `ok_label` for a success.
fn acted_status(ok_label: &str, result: Result<Acted, ControlError>) -> Status {
    match result {
        Ok(Acted::Done(_)) => Status::Info(ok_label.to_owned()),
        Ok(Acted::Failed { message, .. }) => Status::Error(message),
        Err(error) => failure(error),
    }
}

async fn remove_download(control: &Control, book: String) -> Status {
    match control.remove_download(&book).await {
        Ok(_) => Status::Info("removed".to_owned()),
        Err(error) => failure(error),
    }
}

async fn sync(control: &Arc<Control>) -> Status {
    match control.sync(DownloadPolicy::None).await {
        Ok(LastSync::Synced { .. }) => Status::Info("sync complete".to_owned()),
        Ok(LastSync::Failed { message, .. }) => Status::Error(message),
        Err(error) => failure(error),
    }
}

async fn reset(control: &Control) -> Status {
    match control.reset().await {
        Ok(_) => Status::Info(RESET_MESSAGE.to_owned()),
        Err(error) => failure(error),
    }
}

async fn set_token(control: &Control, token: String) -> Status {
    match control.retarget(Retarget::Token(token)).await {
        Ok(_) => Status::Info("token saved".to_owned()),
        Err(error) => failure(error),
    }
}

/// Point the device at `url`; a token auto-wired for another server is wired again for this one.
/// A failed re-wire keeps the new URL and the old token, and says so.
async fn set_url(control: &Control, wiring: &Wiring, url: &str) -> Status {
    let retargeted = match control.retarget(Retarget::Url(url.to_owned())).await {
        Ok(retargeted) => retargeted,
        Err(error) => return failure(error),
    };
    if !retargeted.needs_wire {
        return Status::Info(format!("now syncing against {url}"));
    }
    match wire(control, wiring).await {
        Status::Info(wired) => Status::Info(format!("now syncing against {url}; {wired}")),
        Status::Error(error) => Status::Error(format!(
            "now syncing against {url}, but its token was wired for another server: {error}"
        )),
    }
}

/// Wire a token for the device's current URL and keep it, with the URL it was minted against.
/// Turned away before any request while a sync runs, since the token could not be saved.
async fn wire(control: &Control, wiring: &Wiring) -> Status {
    let view = control.view();
    if view.syncing {
        return failure(ControlError::SyncInProgress);
    }
    let url = view.url;
    let seed = match SeedUser::parse(wiring.seed_user.as_deref()) {
        Ok(seed) => seed,
        Err(error) => return wire_failure(error),
    };
    let wired = match autowire::wire(&url, &seed, &wiring.device_name).await {
        Ok(wired) => wired,
        Err(error) => return wire_failure(error),
    };
    let to = Retarget::Wired {
        token: wired.token,
        url,
    };
    let saved = control.retarget(to).await;
    wired_status(saved, &wiring.device_name, wired.reused)
}

/// How saving a freshly wired token went.
fn wired_status(
    saved: Result<Retargeted, ControlError>,
    device_name: &str,
    reused: bool,
) -> Status {
    match saved {
        Ok(_) => Status::Info(wired_message(device_name, reused)),
        Err(ControlError::SyncInProgress) => Status::Error(format!(
            "wired \"{device_name}\", but a sync started before its token could be saved; \
             press w again when it finishes"
        )),
        Err(error) => failure(error),
    }
}

fn wired_message(device_name: &str, reused: bool) -> String {
    if reused {
        format!(
            "wired to the existing Omnibus device \"{device_name}\"; press r before the next \
             sync for a full resend"
        )
    } else {
        format!("wired to the new Omnibus device \"{device_name}\"")
    }
}

/// A wiring failure in the TUI's terms: its fix is `t`, not a command-line flag.
fn wire_failure(error: AutoWireError) -> Status {
    match error {
        AutoWireError::NotLocal { url } => Status::Error(format!(
            "auto-wire only logs in to a local dev server, not {url}: press t to enter a token"
        )),
        AutoWireError::NoSeedUser => Status::Error(
            "can't auto-wire: OMNIBUS_DEV_SEED_USER is not set; press t to enter a token"
                .to_owned(),
        ),
        other => failure(other),
    }
}

fn failure(error: impl Display) -> Status {
    Status::Error(error.to_string())
}

#[cfg(test)]
mod tests;
