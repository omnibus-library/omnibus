//! The firmware behaviours the fake enforces, each a named [`Quirk`] citing
//! its evidence and whether that was observed on a real device, inferred from
//! the server code and docs, or is still unverified. A failed sync names the
//! quirk that tripped, so a red test says which firmware rule broke.

/// One firmware behaviour the device enforces.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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
    /// `library_sync` and `get_tests_request` come only from the adopted
    /// `Resources` map, never from `api_endpoint`. Evidence: #2684. Observed.
    ResourcesOnly,
    /// `library_sync` pages are followed while the server says
    /// `x-kobo-sync: continue`, echoing each `x-kobo-synctoken` back; past
    /// [`MAX_SYNC_PAGES`] the sync never ends. Evidence: `kobo_sync.md`. Inferred.
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
