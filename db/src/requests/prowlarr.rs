//! Prowlarr, the indexer manager, through its v1 API: checking the connection, reading
//! which indexers are failing, and searching for a book. The API key travels in the
//! `X-Api-Key` header, never the URL, so no error or log line can carry it. A 429 from
//! Prowlarr starts a cooldown in which no call is made.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use reqwest::StatusCode;
use serde::Deserialize;

use crate::metadata_lookup::throttle::parse_retry_after;
use crate::settings::RequestsConfig;

use super::{check_status, http_client, ConnectionError, REQUEST_TIMEOUT};

const SERVICE: &str = "Prowlarr";

/// A search fans out to every indexer, so it gets longer than a status call.
const SEARCH_TIMEOUT: Duration = Duration::from_secs(30);

/// How long to leave Prowlarr alone after a 429 that names no `Retry-After`.
const DEFAULT_COOLDOWN: Duration = Duration::from_secs(10 * 60);

/// The longest a `Retry-After` is believed, so a hostile or broken value cannot park searches for good.
const MAX_COOLDOWN: Duration = Duration::from_secs(24 * 60 * 60);

/// Until when each Prowlarr (address and key) is left alone. A new key starts afresh.
static COOLDOWNS: LazyLock<Mutex<HashMap<(String, String), Instant>>> =
    LazyLock::new(Default::default);

/// A Prowlarr instance and the key to reach it. No `Debug`: it holds the key.
pub struct Prowlarr {
    http: reqwest::Client,
    base: String,
    api_key: String,
}

/// The part of `system/status` that says which app answered.
#[derive(Deserialize)]
struct SystemStatus {
    #[serde(rename = "appName")]
    app_name: String,
}

/// One indexer Prowlarr currently reports as failing.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct IndexerStatus {
    #[serde(rename = "indexerId")]
    pub indexer_id: i64,
    /// When Prowlarr will try the indexer again, as the ISO 8601 text it sent.
    #[serde(rename = "disabledTill", default)]
    pub disabled_till: Option<String>,
}

/// One search result as Prowlarr reported it. Its `Debug` hides `link`, which can carry
/// an API key.
#[derive(Clone)]
pub struct ProwlarrRelease {
    pub guid: String,
    pub title: String,
    pub size_bytes: Option<i64>,
    /// Null for sources that have no seeders, such as Usenet.
    pub seeders: Option<i64>,
    pub indexer: Option<String>,
    /// A torrent-file URL or magnet; the client fetches the file and uploads it. Server-side only.
    pub link: String,
    /// Newznab category ids; books are 7000 and up.
    pub categories: Vec<i64>,
    /// How many files the release holds, when Prowlarr says.
    pub files: Option<i64>,
}

impl std::fmt::Debug for ProwlarrRelease {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProwlarrRelease")
            .field("title", &self.title)
            .field("link", &"<hidden>")
            .finish_non_exhaustive()
    }
}

/// One result as Prowlarr's JSON has it; everything may be missing.
#[derive(Deserialize)]
struct RawRelease {
    guid: Option<String>,
    title: Option<String>,
    size: Option<i64>,
    seeders: Option<i64>,
    indexer: Option<String>,
    #[serde(rename = "downloadUrl")]
    download_url: Option<String>,
    #[serde(rename = "magnetUrl")]
    magnet_url: Option<String>,
    categories: Option<Vec<RawCategory>>,
    files: Option<i64>,
}

#[derive(Deserialize)]
struct RawCategory {
    id: i64,
}

impl RawRelease {
    /// The release, or `None` when it has no title or nothing to fetch it with.
    fn into_release(self) -> Option<ProwlarrRelease> {
        let link = self
            .download_url
            .or(self.magnet_url)
            .filter(|l| !l.is_empty())?;
        let title = self.title.filter(|t| !t.is_empty())?;
        Some(ProwlarrRelease {
            guid: self.guid.unwrap_or_else(|| link.clone()),
            title,
            size_bytes: self.size,
            seeders: self.seeders,
            indexer: self.indexer,
            link,
            categories: self
                .categories
                .unwrap_or_default()
                .iter()
                .map(|c| c.id)
                .collect(),
            files: self.files,
        })
    }
}

impl Prowlarr {
    /// A client for the instance at `base_url`, such as `http://prowlarr:9696`.
    pub fn new(base_url: &str, api_key: &str) -> Result<Self, ConnectionError> {
        Ok(Self {
            http: http_client()?,
            base: base_url.trim_end_matches('/').to_string(),
            api_key: api_key.to_string(),
        })
    }

    /// The client `config` names, or [`ConnectionError::NotConfigured`] without both an
    /// address and an API key.
    pub fn from_config(config: &RequestsConfig) -> Result<Self, ConnectionError> {
        match (&config.prowlarr_url, &config.prowlarr_api_key) {
            (Some(url), Some(key)) => Self::new(url, key),
            _ => Err(ConnectionError::NotConfigured),
        }
    }

    /// Check the address and API key work, changing nothing.
    pub async fn test(&self) -> Result<(), ConnectionError> {
        // Readarr and Lidarr answer the same path with the same header, so name the app.
        let status: SystemStatus = self.get("system/status").await?;
        if status.app_name != SERVICE {
            return Err(ConnectionError::BadUrl(SERVICE.to_string()));
        }
        Ok(())
    }

    /// The indexers Prowlarr currently reports as failing.
    pub async fn indexer_status(&self) -> Result<Vec<IndexerStatus>, ConnectionError> {
        self.get("indexerstatus").await
    }

    /// Search the book categories for `query`, such as `Dracula Bram Stoker`. Results with
    /// no title or no link to fetch them by are left out.
    pub async fn search(&self, query: &str) -> Result<Vec<ProwlarrRelease>, ConnectionError> {
        if self.cooling_down() {
            return Err(ConnectionError::RateLimited);
        }
        let params = [("query", query), ("categories", "7020"), ("type", "search")];
        let raw: Vec<RawRelease> = self.get_with("search", &params, SEARCH_TIMEOUT).await?;
        Ok(raw
            .into_iter()
            .filter_map(RawRelease::into_release)
            .collect())
    }

    fn cooldown_key(&self) -> (String, String) {
        (self.base.clone(), self.api_key.clone())
    }

    fn cooling_down(&self) -> bool {
        let map = COOLDOWNS.lock().unwrap_or_else(|e| e.into_inner());
        map.get(&self.cooldown_key())
            .is_some_and(|until| *until > Instant::now())
    }

    fn cool_down(&self, retry_after: Option<&str>) {
        let wait = parse_retry_after(retry_after)
            .unwrap_or(DEFAULT_COOLDOWN)
            .min(MAX_COOLDOWN);
        let Some(until) = Instant::now().checked_add(wait) else {
            return;
        };
        let mut map = COOLDOWNS.lock().unwrap_or_else(|e| e.into_inner());
        map.insert(self.cooldown_key(), until);
    }

    async fn get<T: serde::de::DeserializeOwned>(
        &self,
        endpoint: &str,
    ) -> Result<T, ConnectionError> {
        self.get_with(endpoint, &[], REQUEST_TIMEOUT).await
    }

    async fn get_with<T: serde::de::DeserializeOwned>(
        &self,
        endpoint: &str,
        query: &[(&str, &str)],
        timeout: Duration,
    ) -> Result<T, ConnectionError> {
        let response = self
            .http
            .get(format!("{}/api/v1/{endpoint}", self.base))
            .query(query)
            .header("X-Api-Key", &self.api_key)
            .timeout(timeout)
            .send()
            .await
            .map_err(|e| ConnectionError::from_transport(&e))?;
        if response.status() == StatusCode::TOO_MANY_REQUESTS {
            let header = response.headers().get(reqwest::header::RETRY_AFTER);
            self.cool_down(header.and_then(|v| v.to_str().ok()));
            return Err(ConnectionError::RateLimited);
        }
        check_status(response.status(), SERVICE, ConnectionError::BadApiKey)?;
        // A page that is not JSON means the address is not Prowlarr; a dropped body is a transport fault.
        response.json().await.map_err(|e| {
            if e.is_decode() {
                ConnectionError::BadUrl(SERVICE.to_string())
            } else {
                ConnectionError::from_transport(&e)
            }
        })
    }
}

#[cfg(test)]
mod tests;
