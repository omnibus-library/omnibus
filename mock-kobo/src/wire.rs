//! The firmware's view of the wire: only the fields the device reads, shaped
//! as the server sends them. Deliberately not the server's own DTOs, so a
//! server-side shape change shows up here as a decode failure or a test.

use serde::Deserialize;

/// The `v1/initialization` body.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Initialization {
    pub resources: Resources,
}

/// The `Resources` map entries the device follows.
#[derive(Debug, Deserialize)]
pub struct Resources {
    pub library_sync: String,
    pub get_tests_request: String,
}

/// One element of a `library_sync` page, externally tagged by its shape.
#[derive(Debug, Deserialize)]
pub enum SyncItem {
    NewEntitlement(Entitlement),
    ChangedEntitlement(Entitlement),
    ChangedProductMetadata(ChangedProductMetadata),
}

/// Refreshed metadata for a book the device already has.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct ChangedProductMetadata {
    pub book_metadata: BookMetadata,
}

/// An entitlement: the ownership record and the book's metadata.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Entitlement {
    pub book_entitlement: BookEntitlement,
    pub book_metadata: BookMetadata,
}

/// The ownership record; its `Id` is the book's key on the device.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct BookEntitlement {
    pub id: String,
    #[serde(default)]
    pub is_removed: bool,
}

/// The bibliographic fields the device shows before a download.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct BookMetadata {
    pub entitlement_id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub contributors: Vec<String>,
    #[serde(default)]
    pub series: Option<Series>,
}

/// A book's series.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub struct Series {
    pub name: String,
    #[serde(default)]
    pub number: Option<f64>,
    pub id: String,
}
