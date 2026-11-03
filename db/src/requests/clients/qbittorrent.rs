//! qBittorrent through its Web API v2. Each call logs in first and echoes the session
//! cookie it gets back, so the client holds no session to expire. qBittorrent names that
//! cookie `SID` or `QBT_SID_<port>` by version and settings, so every `Set-Cookie` pair is
//! echoed rather than one by name. Share limits are never sent: seeding is the admin's
//! own policy in qBittorrent.
// shortcut: one login per call; cache the cookie if the poller's cadence ever makes it matter.

use reqwest::header::{COOKIE, SET_COOKIE};
use reqwest::{RequestBuilder, Response, StatusCode};

use crate::requests::{check_status, http_client, ConnectionError, REQUEST_TIMEOUT};

use super::{ClientFile, DownloadClient, TorrentStatus};

const SERVICE: &str = "qBittorrent";

/// A qBittorrent instance and the login to reach it. No `Debug`: it holds the password.
pub struct Qbittorrent {
    http: reqwest::Client,
    base: String,
    username: String,
    password: String,
    timeout: std::time::Duration,
}

impl Qbittorrent {
    /// A client for the instance at `base_url`, such as `http://qbittorrent:8080`.
    pub fn new(base_url: &str, username: &str, password: &str) -> Result<Self, ConnectionError> {
        Ok(Self {
            http: http_client()?,
            base: base_url.trim_end_matches('/').to_string(),
            username: username.to_string(),
            password: password.to_string(),
            timeout: REQUEST_TIMEOUT,
        })
    }

    /// The same client with `timeout` bound on each request.
    pub fn with_timeout(self, timeout: std::time::Duration) -> Self {
        Self { timeout, ..self }
    }

    fn url(&self, endpoint: &str) -> String {
        format!("{}/api/v2/{endpoint}", self.base)
    }

    fn get(&self, endpoint: &str, cookie: &str) -> RequestBuilder {
        self.http.get(self.url(endpoint)).header(COOKIE, cookie)
    }

    fn post(&self, endpoint: &str, cookie: &str) -> RequestBuilder {
        self.http.post(self.url(endpoint)).header(COOKIE, cookie)
    }

    /// Log in and return the `Cookie` header value to send on later calls.
    async fn login(&self) -> Result<String, ConnectionError> {
        let form = [("username", &self.username), ("password", &self.password)];
        let request = self.http.post(self.url("auth/login")).form(&form);
        let response = self.send(request).await?;
        let cookie = cookie_header(&response);
        let body = response
            .text()
            .await
            .map_err(|e| ConnectionError::from_transport(&e))?;
        // No cookie is fine: an instance that skips auth for this host answers "Ok." without one.
        (body.trim() == "Ok.")
            .then_some(cookie)
            .ok_or(ConnectionError::BadLogin)
    }

    /// Send `request` under the timeout and return whatever status it got.
    async fn call(&self, request: RequestBuilder) -> Result<Response, ConnectionError> {
        request
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|e| ConnectionError::from_transport(&e))
    }

    /// [`Self::call`], failing on any status that is not a success.
    async fn send(&self, request: RequestBuilder) -> Result<Response, ConnectionError> {
        let response = self.call(request).await?;
        check_status(response.status(), SERVICE, ConnectionError::BadLogin)?;
        Ok(response)
    }

    /// [`Self::send`], but a 404 is `None`: a torrent addressed by hash that has vanished.
    async fn send_unless_gone(
        &self,
        request: RequestBuilder,
    ) -> Result<Option<Response>, ConnectionError> {
        let response = self.call(request).await?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        check_status(response.status(), SERVICE, ConnectionError::BadLogin)?;
        Ok(Some(response))
    }

    async fn status_with(
        &self,
        cookie: &str,
        tag: &str,
    ) -> Result<Option<TorrentStatus>, ConnectionError> {
        let response = self
            .send(self.get("torrents/info", cookie).query(&[("tag", tag)]))
            .await?;
        let found: Vec<TorrentStatus> = response
            .json()
            .await
            .map_err(|e| ConnectionError::from_transport(&e))?;
        Ok(found.into_iter().next())
    }
}

/// Every `name=value` the response sets, joined for a `Cookie` header.
fn cookie_header(response: &Response) -> String {
    let pairs: Vec<&str> = response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .filter_map(|v| v.split(';').next())
        .collect();
    pairs.join("; ")
}

impl DownloadClient for Qbittorrent {
    async fn add(&self, link: &str, category: &str, tag: &str) -> Result<(), ConnectionError> {
        let cookie = self.login().await?;
        let form = [("urls", link), ("category", category), ("tags", tag)];
        let response = self
            .send(self.post("torrents/add", &cookie).form(&form))
            .await?;
        let body = response
            .text()
            .await
            .map_err(|e| ConnectionError::from_transport(&e))?;
        // 4.x answers 200 "Fails." for a link it cannot use; trusting the status would lose the download.
        if body.trim() == "Fails." {
            return Err(ConnectionError::Rejected(format!(
                "{SERVICE} refused the download"
            )));
        }
        Ok(())
    }

    async fn status(&self, tag: &str) -> Result<Option<TorrentStatus>, ConnectionError> {
        let cookie = self.login().await?;
        self.status_with(&cookie, tag).await
    }

    async fn files(&self, tag: &str) -> Result<Vec<ClientFile>, ConnectionError> {
        let cookie = self.login().await?;
        let Some(torrent) = self.status_with(&cookie, tag).await? else {
            return Ok(Vec::new());
        };
        let request = self
            .get("torrents/files", &cookie)
            .query(&[("hash", torrent.hash.as_str())]);
        let Some(response) = self.send_unless_gone(request).await? else {
            return Ok(Vec::new());
        };
        response
            .json()
            .await
            .map_err(|e| ConnectionError::from_transport(&e))
    }

    async fn remove(&self, tag: &str, delete_files: bool) -> Result<(), ConnectionError> {
        let cookie = self.login().await?;
        let Some(torrent) = self.status_with(&cookie, tag).await? else {
            return Ok(());
        };
        let form = [
            ("hashes", torrent.hash.as_str()),
            ("deleteFiles", if delete_files { "true" } else { "false" }),
        ];
        self.send_unless_gone(self.post("torrents/delete", &cookie).form(&form))
            .await?;
        Ok(())
    }

    async fn test(&self) -> Result<(), ConnectionError> {
        let cookie = self.login().await?;
        self.send(self.get("app/version", &cookie)).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
