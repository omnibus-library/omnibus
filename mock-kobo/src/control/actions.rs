//! Device actions that talk to the server: download and remove-download.
//! Download shares the sync's busy slot and token-wire refusal, running
//! through the Task 1 runner; remove-download touches nothing but the
//! device, and is refused only while something else is running.

use std::sync::Arc;

use crate::device::DeviceError;
use crate::session::attempt_download;

use super::{acted, Acted, Control, ControlError, DeviceView};

impl Control {
    /// Download each listed book that isn't downloaded yet. A book the
    /// device doesn't hold is rejected before any request.
    pub async fn download(self: &Arc<Self>, books: Vec<String>) -> Result<Acted, ControlError> {
        if let Some(missing) = self.missing_book(&books) {
            return Err(ControlError::Device(DeviceError::UnknownBook(missing)));
        }
        let attempt = self
            .run_exchange(
                move |mut device, endpoint| async move {
                    let attempt = attempt_download(&mut device, &endpoint, &books).await;
                    (device, attempt)
                },
                |_live, _attempt| {},
            )
            .await?;
        Ok(acted(attempt, self.view()))
    }

    /// Clear a book's downloaded flag and problem; local only, no request.
    /// Refused while a sync or another action is running, like `reset`.
    pub async fn remove_download(&self, book: &str) -> Result<DeviceView, ControlError> {
        {
            let mut live = self.live();
            if live.syncing {
                return Err(ControlError::SyncInProgress);
            }
            live.saved.device.remove_download(book)?;
        }
        self.persist().await?;
        Ok(self.view())
    }

    /// The first of `books` the device's current library doesn't hold, if any.
    fn missing_book(&self, books: &[String]) -> Option<String> {
        let live = self.live();
        books
            .iter()
            .find(|id| !live.saved.device.library.contains_key(id.as_str()))
            .cloned()
    }
}

#[cfg(test)]
mod tests;
