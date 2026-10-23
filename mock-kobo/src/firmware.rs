//! The firmware behaviours the fake enforces, each a named [`Quirk`] citing
//! its evidence and whether that was observed on a real device, inferred from
//! the server code and docs, or is still unverified. A failed sync names the
//! quirk that tripped, so a red test says which firmware rule broke.

use serde::Serialize;

/// One firmware behaviour the device enforces.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Quirk {
    /// No `x-kobo-apitoken` on `v1/initialization` fails the sync.
    /// Evidence: `server/src/backend/kobo/auth.rs`. Inferred.
    ApiToken,
    /// `get_tests_request` is POSTed, and a non-2xx answer fails the sync.
    /// Evidence: #1499. Observed.
    GetTestsPost,
    /// The four [`STORE_PATHS`] are fetched off `api_endpoint`, and any
    /// non-2xx fails the sync before `library_sync`. Evidence: #1499. Observed.
    StorePaths,
    /// Every request carries the device's serial as `x-kobo-deviceid`.
    /// Evidence: `server/src/backend/kobo/extractor.rs`. Observed.
    HardwareId,
    /// Every request's `Host` is its URL's host without the port.
    /// Evidence: #2756. Observed.
    PortlessHost,
    /// `library_sync` and `get_tests_request` come only from the adopted
    /// `Resources` map, never from `api_endpoint`. Evidence: #2684. Observed.
    /// The same holds for Reading Services: its host comes only from
    /// `reading_services_host`. Evidence: `server/src/backend/kobo/auth.rs`. Inferred.
    ResourcesOnly,
    /// `library_sync` pages are followed while the server says
    /// `x-kobo-sync: continue`, echoing each `x-kobo-synctoken` back; past
    /// [`MAX_SYNC_PAGES`] the sync never ends. Evidence:
    /// `docs/qa/agentic_exploration/flows/syncing_a_kobo.md`. Inferred.
    SyncPaging,
    /// Before a download, authors come from `Contributors`; `ContributorRoles`
    /// alone shows "Unknown". Evidence: #2684. Observed.
    ContributorsDisplay,
    /// `ChangedProductMetadata` refreshes a book's metadata and never
    /// re-downloads its file. Evidence: #2684. Observed.
    MetadataNoRedownload,
    /// A `ChangedEntitlement` with `IsRemoved` archives the book rather than
    /// deleting it. Evidence: `server/src/backend/kobo/dto.rs`. Inferred.
    RemovalArchives,
    /// A cover is cached per `(ImageId, width, height)` and never
    /// revalidated: a changed cover under an unchanged `CoverImageId` is
    /// never refetched. Widths observed; heights, quality and greyscale
    /// inferred. Evidence: #2684. Observed.
    CoverCache,
    /// Only a JPEG or PNG cover whose content type and magic bytes agree
    /// renders; anything else (a WebP, say) caches as undecodable and shows
    /// no cover. Evidence: #2116. Observed.
    CoverDecode,
    /// A non-2xx download, or no answer at all, leaves the book
    /// undownloaded and is retried on the next sync, whatever the policy.
    /// Evidence: #2116. Observed.
    DownloadFailure,
    /// Reading status and bookmark are reconciled against the server
    /// independently, each adopted only when stamped and strictly newer
    /// than the device's own. Evidence: `server/src/backend/kobo/dto.rs`. Observed.
    StateArbitration,
    /// A state PUT's reply must read `Success` on every sub-result, or the
    /// write is treated as failed. Evidence: `server/src/backend/kobo/dto.rs`
    /// (`StateResponse`). Inferred.
    StatePutResult,
    /// Annotations for a book the device hasn't downloaded are dropped
    /// rather than held, and the server keeps reporting the book until it is
    /// served once downloaded. Evidence: #1647. Observed.
    AnnotationsUnheld,
    /// A served `highlightColor` hex swatch maps onto the device's
    /// `Bookmark.Color` index; anything else — a CSS name, an unknown hex,
    /// or none at all — lands on yellow (`Bookmark.Color` 0). Evidence:
    /// #1629. Unverified.
    HighlightColor,
}

/// The header `v1/initialization` must carry ([`Quirk::ApiToken`]).
pub const API_TOKEN_HEADER: &str = "x-kobo-apitoken";

/// The header carrying the device serial on every request ([`Quirk::HardwareId`]).
pub const HARDWARE_ID_HEADER: &str = "x-kobo-deviceid";

/// Pages after which a still-continuing sync counts as never ending ([`Quirk::SyncPaging`]).
pub const MAX_SYNC_PAGES: usize = 50;

/// The opaque `library_sync` cursor the device echoes on the next page.
pub const SYNC_TOKEN_HEADER: &str = "x-kobo-synctoken";

/// The `library_sync` response header that asks for another page.
pub const SYNC_CONTINUE_HEADER: &str = "x-kobo-sync";

/// The store paths the firmware derives from `api_endpoint` itself.
pub const STORE_PATHS: [&str; 4] = [
    "/v1/user/profile",
    "/v1/user/loyalty/benefits",
    "/v1/products/books/subscriptions",
    "/v1/deals",
];

/// The sizes, in order, every cover is fetched at ([`Quirk::CoverCache`]).
/// Width observed (#2684); heights, quality, greyscale inferred.
pub const COVER_SIZES: [(u32, u32); 3] = [(149, 223), (400, 600), (1072, 1448)];

/// The `{Quality}` every cover request fills in. Inferred.
pub const COVER_QUALITY: u32 = 90;

/// The size whose cache entry `Book::cover` shows (the library list). Inferred.
pub const SHOWN_COVER_SIZE: (u32, u32) = (149, 223);

/// Every checkforchanges-driven and post-download annotations GET's
/// `If-None-Match`. Firmware always sends this value rather than echoing a
/// prior ETag. Evidence: `server/src/backend/kobo/reading_services.rs`. Inferred.
pub const ANNOTATIONS_IF_NONE_MATCH: &str = "W/\"0\"";
