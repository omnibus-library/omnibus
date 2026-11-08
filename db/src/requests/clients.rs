//! The download client the server hands releases to and watches. [`DownloadClient`] is the
//! seam the request pipeline works against; [`client_for`] builds the one the admin chose.
//! A download is found by an id Omnibus works out from the release before the client is
//! given it and stores with the request, so a restart loses no track of it and no other
//! download can be mistaken for it. The id is 40 lowercase hex characters.

use std::future::Future;

use omnibus_shared::DownloadClientKind;

use crate::settings::RequestsConfig;

use super::ConnectionError;

pub mod infohash;
pub mod qbittorrent;
pub mod release;
pub mod transmission;

pub use qbittorrent::Qbittorrent;
pub use release::Release;
pub use transmission::Transmission;

/// How far along one download is. Every client reports in qBittorrent's vocabulary, so the
/// poller and the importer read one set of state words whichever client ran the download.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct TorrentStatus {
    /// The download's id: the info hash of a torrent.
    pub hash: String,
    /// 0.0 to 1.0.
    pub progress: f64,
    /// The qBittorrent state word, such as `downloading` or `stalledUP`.
    pub state: String,
    /// The folder the download's files sit in, as the client sees it.
    pub save_path: String,
    /// How many more seconds the client expects the download to take; qBittorrent sends
    /// 8640000 when it can't tell.
    #[serde(default)]
    pub eta: Option<i64>,
    /// The client's comma-separated tags on the download, which only a download Omnibus
    /// tagged before it tracked by hash carries.
    #[serde(default)]
    pub tags: String,
    /// When the client added the download, in Unix seconds, when it says.
    #[serde(default)]
    pub added_on: Option<i64>,
}

/// One file inside a download.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct ClientFile {
    /// The path inside the download, relative to its save folder.
    pub name: String,
    pub size: u64,
}

/// A release fetched and its id worked out, which the client has not been given yet.
pub struct Prepared<R> {
    /// The lowercase hex id the download is found by.
    pub hash: String,
    /// What the client is given: the fetched release.
    pub release: R,
}

/// The few things the request pipeline asks of a download client. Every method fails
/// with a [`ConnectionError`] the admin can read.
pub trait DownloadClient {
    /// A fetched release, as [`Self::add`] takes it.
    type Release: Send;

    /// Fetch the release `link` names and read its info hash, so the hash can be recorded
    /// before the client is given the release.
    fn prepare(
        &self,
        link: &str,
    ) -> impl Future<Output = Result<Prepared<Self::Release>, ConnectionError>> + Send;

    /// Give the client `prepared` to download, under `category` unless it is empty. It is the
    /// caller's to know the client does not already hold it.
    fn add(
        &self,
        prepared: Prepared<Self::Release>,
        category: &str,
    ) -> impl Future<Output = Result<(), ConnectionError>> + Send;

    /// The info hash of the newest download carrying exactly `tag`, for a download an earlier
    /// version of Omnibus tagged; `None` when the client has none.
    fn hash_for_tag(
        &self,
        tag: &str,
    ) -> impl Future<Output = Result<Option<String>, ConnectionError>> + Send;

    /// The download with info hash `hash`, or `None` when the client has none.
    fn status(
        &self,
        hash: &str,
    ) -> impl Future<Output = Result<Option<TorrentStatus>, ConnectionError>> + Send;

    /// The files of the download with info hash `hash`; empty when the client has none.
    fn files(
        &self,
        hash: &str,
    ) -> impl Future<Output = Result<Vec<ClientFile>, ConnectionError>> + Send;

    /// Remove the download with info hash `hash`, and its files when `delete_files`. A
    /// download that is already gone is not an error.
    fn remove(
        &self,
        hash: &str,
        delete_files: bool,
    ) -> impl Future<Output = Result<(), ConnectionError>> + Send;

    /// Check the address and login work, changing nothing.
    fn test(&self) -> impl Future<Output = Result<(), ConnectionError>> + Send;
}

/// Any one of the download clients, so [`client_for`] can return the one the admin chose.
pub enum AnyClient {
    Qbittorrent(Qbittorrent),
    Transmission(Transmission),
}

/// Run `$call` on whichever client `$any` holds.
macro_rules! on_client {
    ($any:expr, $client:ident => $call:expr) => {
        match $any {
            AnyClient::Qbittorrent($client) => $call,
            AnyClient::Transmission($client) => $call,
        }
    };
}

impl DownloadClient for AnyClient {
    type Release = Release;

    async fn prepare(&self, link: &str) -> Result<Prepared<Release>, ConnectionError> {
        on_client!(self, c => c.prepare(link).await)
    }

    async fn add(
        &self,
        prepared: Prepared<Release>,
        category: &str,
    ) -> Result<(), ConnectionError> {
        on_client!(self, c => c.add(prepared, category).await)
    }

    async fn hash_for_tag(&self, tag: &str) -> Result<Option<String>, ConnectionError> {
        on_client!(self, c => c.hash_for_tag(tag).await)
    }

    async fn status(&self, hash: &str) -> Result<Option<TorrentStatus>, ConnectionError> {
        on_client!(self, c => c.status(hash).await)
    }

    async fn files(&self, hash: &str) -> Result<Vec<ClientFile>, ConnectionError> {
        on_client!(self, c => c.files(hash).await)
    }

    async fn remove(&self, hash: &str, delete_files: bool) -> Result<(), ConnectionError> {
        on_client!(self, c => c.remove(hash, delete_files).await)
    }

    async fn test(&self) -> Result<(), ConnectionError> {
        on_client!(self, c => c.test().await)
    }
}

/// The download client `config` names, or [`ConnectionError::NotConfigured`] without an
/// address.
pub fn client_for(config: &RequestsConfig) -> Result<AnyClient, ConnectionError> {
    let url = config
        .download_client_url
        .as_deref()
        .ok_or(ConnectionError::NotConfigured)?;
    let username = config
        .download_client_username
        .as_deref()
        .unwrap_or_default();
    let password = config
        .download_client_password
        .as_deref()
        .unwrap_or_default();
    match config.download_client_kind {
        DownloadClientKind::Qbittorrent => {
            Qbittorrent::new(url, username, password).map(AnyClient::Qbittorrent)
        }
        DownloadClientKind::Transmission => {
            Transmission::new(url, username, password).map(AnyClient::Transmission)
        }
    }
}
