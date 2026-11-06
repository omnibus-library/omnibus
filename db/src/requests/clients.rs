//! The download client the server hands releases to and watches. [`DownloadClient`] is the
//! seam the request pipeline works against; [`client_for`] builds the one the admin chose.
//! Torrents are found by tag, never by hash, so a restart loses no track of them. A tag is
//! `omnibus-<uuid>`, minted once per hand-off and stored with the request, so it is unique
//! beyond this database; a download the client says it added before the request existed
//! is never the request's.

use std::future::Future;

use omnibus_shared::DownloadClientKind;

use crate::settings::RequestsConfig;

use super::ConnectionError;

pub mod qbittorrent;

pub use qbittorrent::Qbittorrent;

/// How far along one download is.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct TorrentStatus {
    pub hash: String,
    /// 0.0 to 1.0.
    pub progress: f64,
    /// The client's own state word, such as `downloading` or `stalledUP`.
    pub state: String,
    /// The folder the download's files sit in, as the client sees it.
    pub save_path: String,
    /// How many more seconds the client expects the download to take; qBittorrent sends
    /// 8640000 when it can't tell.
    #[serde(default)]
    pub eta: Option<i64>,
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

/// The few things the request pipeline asks of a download client. Every method fails
/// with a [`ConnectionError`] the admin can read.
pub trait DownloadClient {
    /// Start downloading `link` under `category`, marked with `tag`.
    fn add(
        &self,
        link: &str,
        category: &str,
        tag: &str,
    ) -> impl Future<Output = Result<(), ConnectionError>> + Send;

    /// The download marked `tag`, or `None` when the client has none. One the client added
    /// before `not_before` (Unix seconds) is not it: the request did not exist yet.
    fn status(
        &self,
        tag: &str,
        not_before: i64,
    ) -> impl Future<Output = Result<Option<TorrentStatus>, ConnectionError>> + Send;

    /// The files of the download [`Self::status`] finds for `tag`; empty when there is none.
    fn files(
        &self,
        tag: &str,
        not_before: i64,
    ) -> impl Future<Output = Result<Vec<ClientFile>, ConnectionError>> + Send;

    /// Remove the download [`Self::status`] finds for `tag`, and its files when
    /// `delete_files`. A download that is already gone is not an error.
    fn remove(
        &self,
        tag: &str,
        not_before: i64,
        delete_files: bool,
    ) -> impl Future<Output = Result<(), ConnectionError>> + Send;

    /// Check the address and login work, changing nothing.
    fn test(&self) -> impl Future<Output = Result<(), ConnectionError>> + Send;
}

/// The download client `config` names, or [`ConnectionError::NotConfigured`] without an
/// address.
pub fn client_for(config: &RequestsConfig) -> Result<impl DownloadClient, ConnectionError> {
    let url = config
        .download_client_url
        .as_deref()
        .ok_or(ConnectionError::NotConfigured)?;
    match config.download_client_kind {
        DownloadClientKind::Qbittorrent => Qbittorrent::new(
            url,
            config
                .download_client_username
                .as_deref()
                .unwrap_or_default(),
            config
                .download_client_password
                .as_deref()
                .unwrap_or_default(),
        ),
    }
}
