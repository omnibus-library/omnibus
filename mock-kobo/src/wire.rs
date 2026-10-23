//! The firmware's view of the wire: only the fields the device reads, shaped
//! as the server sends them. Deliberately not the server's own DTOs, so a
//! server-side shape change shows up here as a decode failure or a test.

use serde::{Deserialize, Serialize};

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
    pub image_url_quality_template: String,
}

/// One element of a `library_sync` page, externally tagged by its shape.
#[derive(Debug, Deserialize)]
pub enum SyncItem {
    NewEntitlement(Entitlement),
    ChangedEntitlement(Entitlement),
    ChangedProductMetadata(ChangedProductMetadata),
    ChangedReadingState(ChangedReadingState),
}

/// A reading-state-only sync item.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct ChangedReadingState {
    pub reading_state: ReadingState,
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
    pub reading_state: ReadingState,
}

/// Server reading state for one book, trimmed to what the device reconciles.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct ReadingState {
    pub entitlement_id: String,
    pub status_info: StatusInfo,
    pub current_bookmark: CurrentBookmark,
}

/// Where the reader is in the book's lifecycle, and when that last moved.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct StatusInfo {
    pub status: crate::reading::ReadStatus,
    #[serde(default)]
    pub last_modified: Option<String>,
}

/// The server's notion of the device's position in a book.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct CurrentBookmark {
    #[serde(default)]
    pub progress_percent: Option<i64>,
    #[serde(default)]
    pub location: Option<crate::reading::KoboSpan>,
    #[serde(default)]
    pub last_modified: Option<String>,
}

/// The ownership record; its `Id` is the book's key on the device.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct BookEntitlement {
    pub id: String,
    pub is_removed: bool,
}

/// The bibliographic fields the device shows before a download.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct BookMetadata {
    pub entitlement_id: String,
    pub title: String,
    pub description: String,
    // The server sent no `Contributors` before #2684, and the device must still read that shape.
    #[serde(default)]
    pub contributors: Vec<String>,
    pub series: Option<Series>,
    pub cover_image_id: String,
    pub download_urls: Vec<DownloadUrl>,
}

/// Where the device can fetch this book's bytes; the device follows only the first.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct DownloadUrl {
    pub url: String,
}

/// The `state` PUT reply; every sub-result must read `Success`
/// ([`crate::firmware::Quirk::StatePutResult`]).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct StateResponse {
    pub request_result: String,
    #[serde(default)]
    pub update_results: Vec<UpdateResult>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct UpdateResult {
    pub status_info_result: ResultTag,
    pub current_bookmark_result: ResultTag,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct ResultTag {
    pub result: String,
}

/// A book's series. Serialized as it arrived, so a saved device reads back.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct Series {
    pub name: String,
    pub number: Option<f64>,
    pub id: String,
}
