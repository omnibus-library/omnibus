//! Prowlarr, the indexer manager, through its v1 API. The server only checks the
//! connection and reads which indexers are failing; searching is a later step. The API
//! key travels in the `X-Api-Key` header, never the URL, so no error or log line can carry
//! it.

use serde::Deserialize;

use crate::settings::RequestsConfig;

use super::{check_status, http_client, ConnectionError, REQUEST_TIMEOUT};

const SERVICE: &str = "Prowlarr";

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

/// One search result as Prowlarr reported it. No `Debug`: `link` can carry an API key.
#[derive(Clone)]
pub struct ProwlarrRelease {
    pub guid: String,
    pub title: String,
    pub size_bytes: Option<i64>,
    /// Null for sources that have no seeders, such as Usenet.
    pub seeders: Option<i64>,
    pub indexer: Option<String>,
    /// What the download client is handed to fetch the release. Server-side only.
    pub link: String,
    /// Newznab category ids; books are 7000 and up.
    pub categories: Vec<i64>,
    /// How many files the release holds, when Prowlarr says.
    pub files: Option<i64>,
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

    async fn get<T: serde::de::DeserializeOwned>(
        &self,
        endpoint: &str,
    ) -> Result<T, ConnectionError> {
        let response = self
            .http
            .get(format!("{}/api/v1/{endpoint}", self.base))
            .header("X-Api-Key", &self.api_key)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|e| ConnectionError::from_transport(&e))?;
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
