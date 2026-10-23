//! The device's own state: what a reader would see in the library after a
//! sync. The firmware's rules for changing it live beside each transition.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::covers::Cover;
use crate::wire::{BookMetadata, Series, SyncItem};

/// What the device shows for a book with no `Contributors` ([`crate::firmware::Quirk::ContributorsDisplay`]).
const UNKNOWN_AUTHOR: &str = "Unknown";

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
        }
    }

    /// Apply one `library_sync` item the way the firmware does.
    pub fn apply(&mut self, item: SyncItem) {
        match item {
            SyncItem::NewEntitlement(entitlement) => {
                let book = Book::from_metadata(entitlement.book_metadata);
                self.library.insert(entitlement.book_entitlement.id, book);
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
                if let Some(book) = self.library.get_mut(&metadata.entitlement_id) {
                    book.refresh(metadata);
                }
            }
            SyncItem::ChangedReadingState(_) => {}
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
        }
    }

    /// New metadata over the same file ([`crate::firmware::Quirk::MetadataNoRedownload`]).
    fn refresh(&mut self, metadata: BookMetadata) {
        *self = Self {
            downloaded: self.downloaded,
            archived: self.archived,
            ..Self::from_metadata(metadata)
        };
    }
}

#[cfg(test)]
mod tests;
