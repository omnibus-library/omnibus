//! Prowlarr, the indexer manager, through its v1 API. The server only checks the
//! connection and reads which indexers are failing; searching is a later step. The API
//! key travels in the `X-Api-Key` header, never the URL, so no error or log line can carry
//! it.

use std::time::Duration;

use serde::Deserialize;

use super::{http_client, ConnectionError};
use crate::settings::RequestsConfig;

const SERVICE: &str = "Prowlarr";

/// Bound on each request, so a dead server cannot hold a worker.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// A Prowlarr instance and the key to reach it. No `Debug`: it holds the key.
pub struct Prowlarr {
    http: reqwest::Client,
    base: String,
    api_key: String,
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
        // A wrong address often answers 200 with a web page, so the body must be JSON too.
        self.get::<serde_json::Value>("system/status")
            .await
            .map(drop)
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
        let bad_url = || ConnectionError::BadUrl(SERVICE.to_string());
        match response.status() {
            reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN => {
                Err(ConnectionError::BadApiKey)
            }
            reqwest::StatusCode::NOT_FOUND => Err(bad_url()),
            s if !s.is_success() => {
                Err(ConnectionError::Rejected(format!("{SERVICE} answered {s}")))
            }
            _ => response.json().await.map_err(|_| bad_url()),
        }
    }
}

#[cfg(test)]
mod tests;
