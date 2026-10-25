//! The device's own state: what a reader would see in the library after a
//! sync. The firmware's rules for changing it live beside each transition.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::annotations::{Annotation, NewHighlight};
use crate::covers::Cover;
use crate::reading::{Bookmark, KoboSpan, Percent, ReadStatus, Reading};
use crate::wire::{BookMetadata, Series, SyncItem};

/// What the device shows for a book with no `Contributors` ([`crate::firmware::Quirk::ContributorsDisplay`]).
const UNKNOWN_AUTHOR: &str = "Unknown";

/// Why a device action naming a book couldn't be carried out.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum DeviceError {
    #[error("the device holds no book {0}")]
    UnknownBook(String),
    #[error("{0} is not downloaded; download it first")]
    NotDownloaded(String),
    #[error("the book holds no highlight {0}")]
    UnknownHighlight(String),
}

/// The current on-disk shape of a saved device: covers, downloads and
/// reading state. A device saved before this format upgrade loses its sync
/// token on load, so the next sync resends every book with these new fields.
pub const DEVICE_FORMAT: u32 = 1;

/// Hex-encode `bytes`, lowercase, two characters per byte. Shared by
/// [`mint_hardware_id`] and `annotations::mint_id`.
pub(crate) fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(char::from(HEX[usize::from(byte >> 4)]));
        out.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    out
}

/// A fresh hardware id for a new device: `mock-` then 32 random hex digits.
pub fn mint_hardware_id() -> Result<String, getrandom::Error> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes)?;
    Ok(format!("mock-{}", hex_encode(&bytes)))
}

/// One fake Kobo.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Device {
    /// The serial the firmware sends as `x-kobo-deviceid`.
    pub hardware_id: String,
    /// The books on the device, keyed by entitlement id.
    pub library: BTreeMap<String, Book>,
    /// The last `x-kobo-synctoken` the server sent, which the device echoes on its next sync.
    pub sync_token: Option<String>,
    /// The on-disk format this device was last saved under; `0` for a file
    /// saved before covers, downloads and reading state ([`DEVICE_FORMAT`]).
    #[serde(default)]
    pub format: u32,
    /// Decoded covers, keyed `"{CoverImageId}@{width}x{height}"`, never revalidated.
    #[serde(default)]
    pub covers: BTreeMap<String, Cover>,
    /// Each book's first `DownloadUrls` entry, keyed by entitlement id.
    /// Holds the device token baked into the URL, so this never appears in the control API's device view.
    #[serde(default)]
    pub download_urls: BTreeMap<String, String>,
    /// The bare origin Reading Services is served at, kept from the last
    /// sync's `Resources.reading_services_host`; `None` before the first sync.
    #[serde(default)]
    pub reading_services_host: Option<String>,
    /// Where downloaded books are written, one `<id>.kepub.epub` each;
    /// `None` keeps no bytes. `Control::new` sets it beside the state file;
    /// never saved, since it is a path derived from where this process runs.
    #[serde(skip)]
    pub storage: Option<PathBuf>,
}

/// One book as the device shows it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Book {
    pub title: String,
    pub description: String,
    pub authors: Vec<String>,
    pub series: Option<Series>,
    /// Whether the book's file is on the device.
    pub downloaded: bool,
    /// Whether the book has moved to the device's archive.
    pub archived: bool,
    /// The server's current `CoverImageId` for this book.
    #[serde(default)]
    pub cover_image_id: String,
    /// The decoded cover at [`crate::firmware::SHOWN_COVER_SIZE`], once fetched.
    #[serde(default)]
    pub cover: Option<Cover>,
    /// Why the last download attempt failed, redacted; `None` once it succeeds.
    #[serde(default)]
    pub download_problem: Option<String>,
    /// Reconciled against the server independently of everything else above.
    #[serde(default)]
    pub reading: Reading,
    /// The book's annotations, replaced wholesale by the server's served set
    /// once this book is held and downloaded ([`Device::receive_annotations`]).
    #[serde(default)]
    pub annotations: Vec<Annotation>,
    /// How many annotations the server offered this book while it was held
    /// but not downloaded, and so were dropped rather than kept
    /// ([`crate::firmware::Quirk::AnnotationsUnheld`]).
    #[serde(default)]
    pub dropped_annotations: usize,
}

impl Device {
    /// A device with an empty library.
    pub fn new(hardware_id: &str) -> Self {
        Self {
            hardware_id: hardware_id.to_owned(),
            library: BTreeMap::new(),
            sync_token: None,
            format: DEVICE_FORMAT,
            covers: BTreeMap::new(),
            download_urls: BTreeMap::new(),
            reading_services_host: None,
            storage: None,
        }
    }

    /// `<storage>/<id>.kepub.epub`; `None` without storage, or for an id
    /// that isn't `[A-Za-z0-9_-]+` ([`crate::annotations::is_safe_id`]).
    pub fn book_file(&self, id: &str) -> Option<PathBuf> {
        let dir = self.storage.as_ref()?;
        if !crate::annotations::is_safe_id(id) {
            return None;
        }
        Some(dir.join(format!("{id}.kepub.epub")))
    }

    /// Drop what was learned about the server this device last talked to:
    /// always `reading_services_host` (the next sync re-learns it from
    /// `v1/initialization`), and when the token changed or a cached download
    /// URL is not under `url`, also `sync_token` and `download_urls`, so the
    /// next sync is a full resync that re-delivers every URL. Shared by
    /// `Control::retarget` and `startup::start`.
    pub fn forget_server(&mut self, token_changed: bool, url: &str) {
        self.reading_services_host = None;
        let under_url = format!("{url}/");
        if token_changed
            || self
                .download_urls
                .values()
                .any(|u| !u.starts_with(&under_url))
        {
            self.sync_token = None;
            self.download_urls.clear();
        }
    }

    /// Clear a book's downloaded flag and problem, locally — no request.
    pub fn remove_download(&mut self, book: &str) -> Result<(), DeviceError> {
        let book = self
            .library
            .get_mut(book)
            .ok_or_else(|| DeviceError::UnknownBook(book.to_owned()))?;
        book.downloaded = false;
        book.download_problem = None;
        Ok(())
    }

    /// Stamp `book`'s status `Reading` and its bookmark, both at `now`. Needs a downloaded book.
    pub fn read(
        &mut self,
        id: &str,
        percent: Percent,
        location: Option<KoboSpan>,
        now: i64,
    ) -> Result<(), DeviceError> {
        let book = self
            .library
            .get_mut(id)
            .ok_or_else(|| DeviceError::UnknownBook(id.to_owned()))?;
        if !book.downloaded {
            return Err(DeviceError::NotDownloaded(id.to_owned()));
        }
        book.reading.status = ReadStatus::Reading;
        book.reading.status_modified = Some(now);
        book.reading.bookmark = Some(Bookmark {
            percent: Some(percent),
            location,
            modified: now,
        });
        Ok(())
    }

    /// Stamp `book`'s status `Finished` at `now`. The book need not be downloaded.
    pub fn finish(&mut self, book: &str, now: i64) -> Result<(), DeviceError> {
        let book = self
            .library
            .get_mut(book)
            .ok_or_else(|| DeviceError::UnknownBook(book.to_owned()))?;
        book.reading.status = ReadStatus::Finished;
        book.reading.status_modified = Some(now);
        Ok(())
    }

    /// Apply `book`'s served annotation set:
    /// - held and downloaded: replaced wholesale, in served order, and
    ///   `dropped_annotations` resets to 0;
    /// - held but not downloaded: untouched, and `dropped_annotations`
    ///   becomes the served count ([`crate::firmware::Quirk::AnnotationsUnheld`]);
    /// - not held: a no-op.
    pub fn receive_annotations(&mut self, book: &str, served: Vec<Annotation>) {
        let Some(book) = self.library.get_mut(book) else {
            return;
        };
        if book.downloaded {
            book.annotations = served;
            book.dropped_annotations = 0;
        } else {
            book.dropped_annotations = served.len();
        }
    }

    /// Add a highlight the device just made, under `id`. Needs the book held
    /// and downloaded, because the firmware highlights only inside an open book.
    pub fn highlight(
        &mut self,
        book_id: &str,
        id: String,
        new: NewHighlight,
    ) -> Result<(), DeviceError> {
        let book = self
            .library
            .get_mut(book_id)
            .ok_or_else(|| DeviceError::UnknownBook(book_id.to_owned()))?;
        if !book.downloaded {
            return Err(DeviceError::NotDownloaded(book_id.to_owned()));
        }
        book.annotations.push(Annotation {
            id,
            text: new.text,
            note: new.note.filter(|n| !n.trim().is_empty()),
            color: new.color,
            location: crate::annotations::location_json(new.location.as_ref()),
        });
        Ok(())
    }

    /// Remove a highlight the device holds, by its id.
    pub fn delete_highlight(&mut self, book: &str, id: &str) -> Result<(), DeviceError> {
        let book = self
            .library
            .get_mut(book)
            .ok_or_else(|| DeviceError::UnknownBook(book.to_owned()))?;
        let before = book.annotations.len();
        book.annotations.retain(|a| a.id != id);
        if book.annotations.len() == before {
            return Err(DeviceError::UnknownHighlight(id.to_owned()));
        }
        Ok(())
    }

    /// Apply one `library_sync` item the way the firmware does.
    pub fn apply(&mut self, item: SyncItem) {
        match item {
            SyncItem::NewEntitlement(entitlement) => {
                let id = entitlement.book_entitlement.id.clone();
                update_download_url(&mut self.download_urls, &id, &entitlement.book_metadata);
                // The server resends every held book as a `NewEntitlement` on
                // a full resync, and re-adding a synced shelf re-announces an
                // archived one the same way: a book the device already holds
                // keeps its local downloaded flag, problem and cover, and
                // reconciles reading state instead of starting it over.
                match self.library.get_mut(&id) {
                    Some(book) => {
                        book.refresh(entitlement.book_metadata);
                        book.archived = false;
                        book.reading.apply(&entitlement.reading_state);
                    }
                    None => {
                        let mut book = Book::from_metadata(entitlement.book_metadata);
                        book.reading.apply(&entitlement.reading_state);
                        self.library.insert(id, book);
                    }
                }
            }
            SyncItem::ChangedEntitlement(entitlement)
                if entitlement.book_entitlement.is_removed =>
            {
                if let Some(book) = self.library.get_mut(&entitlement.book_entitlement.id) {
                    book.archived = true;
                }
            }
            SyncItem::ChangedEntitlement(_) => {}
            SyncItem::ChangedProductMetadata(changed) => {
                let metadata = changed.book_metadata;
                let id = metadata.entitlement_id.clone();
                update_download_url(&mut self.download_urls, &id, &metadata);
                if let Some(book) = self.library.get_mut(&id) {
                    book.refresh(metadata);
                }
            }
            SyncItem::ChangedReadingState(changed) => {
                let id = &changed.reading_state.entitlement_id;
                if let Some(book) = self.library.get_mut(id) {
                    book.reading.apply(&changed.reading_state);
                }
            }
        }
    }
}

/// Keep `urls[id]` current with `metadata`'s first `DownloadUrls` entry, if it has one.
fn update_download_url(urls: &mut BTreeMap<String, String>, id: &str, metadata: &BookMetadata) {
    match metadata.download_urls.first() {
        Some(first) => {
            urls.insert(id.to_owned(), first.url.clone());
        }
        None => {
            urls.remove(id);
        }
    }
}

fn shown_authors(contributors: Vec<String>) -> Vec<String> {
    if contributors.is_empty() {
        return vec![UNKNOWN_AUTHOR.to_owned()];
    }
    contributors
}

impl Book {
    /// A book the device has metadata for but has not downloaded.
    fn from_metadata(metadata: BookMetadata) -> Self {
        Self {
            title: metadata.title,
            description: metadata.description,
            authors: shown_authors(metadata.contributors),
            series: metadata.series,
            downloaded: false,
            archived: false,
            cover_image_id: metadata.cover_image_id,
            cover: None,
            download_problem: None,
            reading: Reading::default(),
            annotations: Vec::new(),
            dropped_annotations: 0,
        }
    }

    /// New metadata over the same file ([`crate::firmware::Quirk::MetadataNoRedownload`]).
    /// Keeps the cached cover too: the cover pass only replaces it after a
    /// sync completes, so a sync that fails after this refresh must not
    /// drop a cover the cache still holds. Keeps the device's annotations
    /// and drop count the same way: a replayed `NewEntitlement` or a
    /// metadata-only change must not wipe highlights already held.
    fn refresh(&mut self, metadata: BookMetadata) {
        *self = Self {
            downloaded: self.downloaded,
            archived: self.archived,
            download_problem: self.download_problem.clone(),
            reading: self.reading.clone(),
            cover: self.cover,
            annotations: self.annotations.clone(),
            dropped_annotations: self.dropped_annotations,
            ..Self::from_metadata(metadata)
        };
    }
}

#[cfg(test)]
mod tests;
