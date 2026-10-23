//! The device's own state: what a reader would see in the library after a
//! sync. The firmware's rules for changing it live beside each transition.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::covers::Cover;
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
}

/// The current on-disk shape of a saved device: covers, downloads and
/// reading state. A device saved before this format upgrade loses its sync
/// token on load, so the next sync resends every book with these new fields.
pub const DEVICE_FORMAT: u32 = 1;

/// A fresh hardware id for a new device: `mock-` then 32 random hex digits.
pub fn mint_hardware_id() -> Result<String, getrandom::Error> {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes)?;
    let mut id = String::from("mock-");
    for byte in bytes {
        id.push(char::from(HEX[usize::from(byte >> 4)]));
        id.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    Ok(id)
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

    /// Apply one `library_sync` item the way the firmware does.
    pub fn apply(&mut self, item: SyncItem) {
        match item {
            SyncItem::NewEntitlement(entitlement) => {
                let id = entitlement.book_entitlement.id;
                update_download_url(&mut self.download_urls, &id, &entitlement.book_metadata);
                let book = Book::from_metadata(entitlement.book_metadata);
                self.library.insert(id, book);
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
            SyncItem::ChangedReadingState(_) => {}
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
        }
    }

    /// New metadata over the same file ([`crate::firmware::Quirk::MetadataNoRedownload`]).
    fn refresh(&mut self, metadata: BookMetadata) {
        *self = Self {
            downloaded: self.downloaded,
            archived: self.archived,
            download_problem: self.download_problem.clone(),
            ..Self::from_metadata(metadata)
        };
    }
}

#[cfg(test)]
mod tests;
