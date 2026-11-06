//! qBittorrent through its Web API v2. Each call logs in first and echoes the session
//! cookie it gets back, so the client holds no session to expire. qBittorrent names that
//! cookie `SID` or `QBT_SID_<port>` by version and settings, so every `Set-Cookie` pair is
//! echoed rather than one by name. A release link is fetched here and uploaded as a file:
//! qBittorrent may have no route to Prowlarr, and the link carries the API key. Share
//! limits are never sent: seeding is the admin's own policy in qBittorrent. A torrent is
//! addressed by its info hash alone (`hashes=`); nothing is tagged, and a category is sent
//! only when one is set.
// shortcut: one login per call; cache the cookie if the poller's cadence ever makes it matter.

use reqwest::header::{COOKIE, LOCATION, SET_COOKIE};
use reqwest::multipart::{Form, Part};
use reqwest::{RequestBuilder, Response, StatusCode, Url};

use crate::requests::{check_status, http_client, ConnectionError, REQUEST_TIMEOUT};

use super::infohash;
use super::{Added, ClientFile, DownloadClient, TorrentStatus};

const SERVICE: &str = "qBittorrent";

/// A torrent file is kilobytes; anything past this is not one.
pub const MAX_TORRENT_BYTES: usize = 4 * 1024 * 1024;

/// How many redirects a release link may take before it is given up on.
const MAX_HOPS: usize = 3;

/// What `torrents/add` is given: a magnet as `urls`, or the fetched torrent file.
enum Release {
    Magnet(String),
    File(Vec<u8>),
}

fn rejected(why: &str) -> ConnectionError {
    ConnectionError::Rejected(format!("the release link {why}"))
}

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
        // 5.2 answers 204 with no body; "Fails." is the only refusal that comes with a 2xx.
        (body.trim() == "Ok." || body.trim().is_empty())
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

    /// Resolve `link` to what the client is given, following up to [`MAX_HOPS`] redirects
    /// ourselves since [`http_client`] follows none. Errors never echo the link: it carries
    /// the Prowlarr API key.
    async fn fetch_release(&self, link: &str) -> Result<Release, ConnectionError> {
        let mut url = Url::parse(link).map_err(|_| rejected("is not a URL"))?;
        for _ in 0..=MAX_HOPS {
            if url.scheme() == "magnet" {
                return Ok(Release::Magnet(url.into()));
            }
            let response = self.call(self.http.get(url.clone())).await?;
            let status = response.status();
            if status.is_redirection() {
                let location = response
                    .headers()
                    .get(LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|l| url.join(l).ok())
                    .ok_or_else(|| rejected("redirected nowhere"))?;
                url = location;
                continue;
            }
            if !status.is_success() {
                return Err(rejected(&format!("answered {status}")));
            }
            if response.content_length().unwrap_or(0) as usize > MAX_TORRENT_BYTES {
                return Err(rejected("is too large to be a torrent file"));
            }
            let bytes = response
                .bytes()
                .await
                .map_err(|e| ConnectionError::from_transport(&e))?;
            if bytes.len() > MAX_TORRENT_BYTES {
                return Err(rejected("is too large to be a torrent file"));
            }
            return Ok(Release::File(bytes.to_vec()));
        }
        Err(rejected("redirected too many times"))
    }

    /// The download with info hash `hash`. The client is asked for that hash alone; the
    /// check on the answer is for a client that ignores the filter.
    async fn status_with(
        &self,
        cookie: &str,
        hash: &str,
    ) -> Result<Option<TorrentStatus>, ConnectionError> {
        let response = self
            .send(self.get("torrents/info", cookie).query(&[("hashes", hash)]))
            .await?;
        let found: Vec<TorrentStatus> = response
            .json()
            .await
            .map_err(|e| ConnectionError::from_transport(&e))?;
        Ok(found.into_iter().find(|t| t.hash == hash))
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

/// The part of a 5.x `torrents/add` answer that says whether the link was taken.
#[derive(serde::Deserialize)]
struct AddOutcome {
    failure_count: u32,
}

impl DownloadClient for Qbittorrent {
    /// `Ok` means qBittorrent has the torrent or accepted it; 5.x adds asynchronously, so it
    /// may still be pending, and `status` can answer `None` for a while.
    async fn add(&self, link: &str, category: &str) -> Result<Added, ConnectionError> {
        let release = self.fetch_release(link).await?;
        let hash = match &release {
            Release::Magnet(magnet) => infohash::from_magnet(magnet),
            Release::File(bytes) => infohash::from_torrent(bytes),
        }
        .map_err(|e| rejected(&e.to_string()))?;
        let cookie = self.login().await?;
        let adopt = Added {
            hash: hash.clone(),
            adopted: true,
        };
        if self.status_with(&cookie, &hash).await?.is_some() {
            return Ok(adopt);
        }
        let request = match release {
            Release::Magnet(magnet) => {
                let mut form = vec![("urls", magnet.as_str())];
                if !category.is_empty() {
                    form.push(("category", category));
                }
                self.post("torrents/add", &cookie).form(&form)
            }
            Release::File(bytes) => {
                let file = Part::bytes(bytes)
                    .file_name(format!("{hash}.torrent"))
                    .mime_str("application/x-bittorrent")
                    .map_err(|e| ConnectionError::from_transport(&e))?;
                let mut form = Form::new().part("torrents", file);
                if !category.is_empty() {
                    form = form.text("category", category.to_string());
                }
                self.post("torrents/add", &cookie).multipart(form)
            }
        };
        let response = self.send(request).await?;
        let body = response
            .text()
            .await
            .map_err(|e| ConnectionError::from_transport(&e))?;
        // 5.x answers 202 with JSON counts; 4.x answers 200 "Ok." or "Fails." (a 200 for a link it cannot use).
        let refused = if body.trim_start().starts_with('{') {
            serde_json::from_str::<AddOutcome>(&body).is_ok_and(|o| o.failure_count > 0)
        } else {
            body.trim() == "Fails."
        };
        if !refused {
            return Ok(Added {
                adopted: false,
                ..adopt
            });
        }
        // A client says no to a torrent it already holds, such as one added a moment ago.
        if self.status_with(&cookie, &hash).await?.is_some() {
            return Ok(adopt);
        }
        Err(ConnectionError::Rejected(format!(
            "{SERVICE} did not accept the torrent"
        )))
    }

    async fn status(&self, hash: &str) -> Result<Option<TorrentStatus>, ConnectionError> {
        let cookie = self.login().await?;
        self.status_with(&cookie, hash).await
    }

    async fn files(&self, hash: &str) -> Result<Vec<ClientFile>, ConnectionError> {
        let cookie = self.login().await?;
        let Some(torrent) = self.status_with(&cookie, hash).await? else {
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

    async fn remove(&self, hash: &str, delete_files: bool) -> Result<(), ConnectionError> {
        let cookie = self.login().await?;
        let Some(torrent) = self.status_with(&cookie, hash).await? else {
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
