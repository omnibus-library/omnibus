//! The device's own state: what a reader would see in the library after a
//! sync. The firmware's rules for changing it live beside each transition.

use std::collections::BTreeMap;

use crate::wire::{BookMetadata, Series, SyncItem};

/// What the device shows for a book with no `Contributors` ([`crate::firmware::Quirk::ContributorsDisplay`]).
const UNKNOWN_AUTHOR: &str = "Unknown";

/// One fake Kobo.
#[derive(Clone, Debug, PartialEq)]
pub struct Device {
    /// The serial the firmware sends as `x-kobo-deviceid`.
    pub hardware_id: String,
    /// The books on the device, keyed by entitlement id.
    pub library: BTreeMap<String, Book>,
}

/// One book as the device shows it.
#[derive(Clone, Debug, PartialEq)]
pub struct Book {
    pub title: String,
    pub description: String,
    pub authors: Vec<String>,
    pub series: Option<Series>,
    /// Whether the book's file is on the device.
    pub downloaded: bool,
    /// Whether the book has moved to the device's archive.
    pub archived: bool,
}

impl Device {
    /// A device with an empty library.
    pub fn new(hardware_id: &str) -> Self {
        Self {
            hardware_id: hardware_id.to_owned(),
            library: BTreeMap::new(),
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
