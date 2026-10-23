//! Device actions that talk to the server: download, remove-download, read,
//! finish, highlight and delete-highlight. All but remove-download share the
//! sync's busy slot and token-wire refusal, running through
//! `Control::run_exchange`; remove-download touches nothing but the device,
//! and is refused only while something else is running.

use std::sync::Arc;

use crate::annotations::{self, NewHighlight};
use crate::device::DeviceError;
use crate::reading::{KoboSpan, Percent};
use crate::session::{
    attempt_annotation, attempt_download, attempt_state, AnnotationSent, Attempt, StateSent,
    SyncFailure,
};

use super::{acted, Acted, Control, ControlError, DeviceView};

/// `time::OffsetDateTime::now_utc().unix_timestamp()`, read once at this boundary.
fn now() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}

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

    /// Clear a book's downloaded flag and problem, and delete its file
    /// from storage; local only, no request. Refused while a sync or
    /// another action is running, like `reset`.
    pub async fn remove_download(&self, book: &str) -> Result<DeviceView, ControlError> {
        let file = {
            let mut live = self.live();
            if live.syncing {
                return Err(ControlError::SyncInProgress);
            }
            let file = live.saved.device.book_file(book);
            live.saved.device.remove_download(book)?;
            file
        };
        if let Some(file) = file {
            super::remove_file_best_effort(&file).await?;
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

    /// Stamp `book` `Reading` at `percent` and send it. The device check
    /// runs before any request; a refused action changes nothing and saves
    /// nothing. A failed PUT keeps the device's change and is not retried.
    pub async fn read(
        self: &Arc<Self>,
        book: String,
        percent: Percent,
        location: Option<KoboSpan>,
    ) -> Result<Acted, ControlError> {
        self.check_downloaded(&book)?;
        let now = now();
        let attempt = self
            .run_exchange(
                move |mut device, endpoint| async move {
                    if let Err(error) = device.read(&book, percent, location, now) {
                        return (
                            device,
                            Attempt {
                                requests: Vec::new(),
                                outcome: Err(SyncFailure::Rejected(error.to_string())),
                            },
                        );
                    }
                    let attempt =
                        attempt_state(&mut device, &endpoint, &book, StateSent::Read).await;
                    (device, attempt)
                },
                |_live, _attempt| {},
            )
            .await?;
        Ok(acted(attempt, self.view()))
    }

    /// Stamp `book` `Finished` and send it. The book need not be downloaded.
    pub async fn finish(self: &Arc<Self>, book: String) -> Result<Acted, ControlError> {
        self.check_held(&book)?;
        let now = now();
        let attempt = self
            .run_exchange(
                move |mut device, endpoint| async move {
                    if let Err(error) = device.finish(&book, now) {
                        return (
                            device,
                            Attempt {
                                requests: Vec::new(),
                                outcome: Err(SyncFailure::Rejected(error.to_string())),
                            },
                        );
                    }
                    let attempt =
                        attempt_state(&mut device, &endpoint, &book, StateSent::Finish).await;
                    (device, attempt)
                },
                |_live, _attempt| {},
            )
            .await?;
        Ok(acted(attempt, self.view()))
    }

    /// Make a highlight on `book` and send it. The device check (held,
    /// downloaded) and the id mint both run before any request; a failed
    /// mint answers `Failed` the same way. A failed PATCH keeps the
    /// highlight on the device and is not retried — until the book's next
    /// served set replaces it wholesale (see `firmware::Quirk::AnnotationsUnheld`'s
    /// doc), a server that never ingested it may keep offering the same set
    /// back, silently dropping the unsent highlight.
    pub async fn highlight(
        self: &Arc<Self>,
        book: String,
        new: NewHighlight,
    ) -> Result<Acted, ControlError> {
        self.check_downloaded(&book)?;
        self.check_synced()?;
        let id = match annotations::mint_id() {
            Ok(id) => id,
            Err(error) => {
                return Ok(Acted::Failed {
                    quirk: None,
                    message: format!("could not mint a highlight id: {error}"),
                })
            }
        };
        let now = now();
        let attempt = self
            .run_exchange(
                move |mut device, endpoint| async move {
                    if let Err(error) = device.highlight(&book, id.clone(), new) {
                        return (
                            device,
                            Attempt {
                                requests: Vec::new(),
                                outcome: Err(SyncFailure::Rejected(error.to_string())),
                            },
                        );
                    }
                    let attempt = attempt_annotation(
                        &mut device,
                        &endpoint,
                        &book,
                        AnnotationSent::Upsert(id),
                        now,
                    )
                    .await;
                    (device, attempt)
                },
                |_live, _attempt| {},
            )
            .await?;
        Ok(acted(attempt, self.view()))
    }

    /// Remove a highlight and send the delete. The device check (held,
    /// holds the highlight) runs before any request. A failed PATCH keeps
    /// the local delete and is not retried.
    pub async fn delete_highlight(
        self: &Arc<Self>,
        book: String,
        highlight: String,
    ) -> Result<Acted, ControlError> {
        self.check_holds_highlight(&book, &highlight)?;
        self.check_synced()?;
        let now = now();
        let attempt = self
            .run_exchange(
                move |mut device, endpoint| async move {
                    if let Err(error) = device.delete_highlight(&book, &highlight) {
                        return (
                            device,
                            Attempt {
                                requests: Vec::new(),
                                outcome: Err(SyncFailure::Rejected(error.to_string())),
                            },
                        );
                    }
                    let attempt = attempt_annotation(
                        &mut device,
                        &endpoint,
                        &book,
                        AnnotationSent::Delete(highlight),
                        now,
                    )
                    .await;
                    (device, attempt)
                },
                |_live, _attempt| {},
            )
            .await?;
        Ok(acted(attempt, self.view()))
    }

    /// `book` must be held and downloaded, checked before any request.
    fn check_downloaded(&self, book: &str) -> Result<(), ControlError> {
        let live = self.live();
        match live.saved.device.library.get(book) {
            None => Err(ControlError::Device(DeviceError::UnknownBook(
                book.to_owned(),
            ))),
            Some(b) if !b.downloaded => Err(ControlError::Device(DeviceError::NotDownloaded(
                book.to_owned(),
            ))),
            Some(_) => Ok(()),
        }
    }

    /// The device must have synced at least once since it started — a
    /// highlight or delete needs a `reading_services_host` to send to,
    /// learned from `v1/initialization`, checked before any request.
    fn check_synced(&self) -> Result<(), ControlError> {
        if self.live().saved.device.reading_services_host.is_none() {
            return Err(ControlError::NotSynced);
        }
        Ok(())
    }

    /// `book` must be held, checked before any request.
    fn check_held(&self, book: &str) -> Result<(), ControlError> {
        let live = self.live();
        if live.saved.device.library.contains_key(book) {
            Ok(())
        } else {
            Err(ControlError::Device(DeviceError::UnknownBook(
                book.to_owned(),
            )))
        }
    }

    /// `book` must be held and hold `highlight`, checked before any request.
    fn check_holds_highlight(&self, book: &str, highlight: &str) -> Result<(), ControlError> {
        let live = self.live();
        match live.saved.device.library.get(book) {
            None => Err(ControlError::Device(DeviceError::UnknownBook(
                book.to_owned(),
            ))),
            Some(b) if !b.annotations.iter().any(|a| a.id == highlight) => Err(
                ControlError::Device(DeviceError::UnknownHighlight(highlight.to_owned())),
            ),
            Some(_) => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests;
