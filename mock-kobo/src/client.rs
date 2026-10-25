//! The device's HTTP side: one function per request the firmware makes. Every
//! answered request is recorded for the sync report with the device's path
//! token redacted, since the token is the device's only credential.

use std::time::Duration;

use reqwest::header::{HeaderValue, HOST, IF_NONE_MATCH};
use reqwest::{RequestBuilder, Response};
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::firmware::{HARDWARE_ID_HEADER, SYNC_TOKEN_HEADER};
use crate::session::SyncFailure;

/// What stands in for the path token in anything the device reports.
const REDACTED: &str = "<token>";

/// The path segment Kobo routes carry their token under.
const KOBO_SEGMENT: &str = "/kobo/";

/// A harness safeguard, not a measured firmware timeout: a stalled server fails the test instead of hanging it.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// One request the device made and the status it got back.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RequestRecord {
    pub method: String,
    /// The URL path, with the device token redacted.
    pub path: String,
    pub status: u16,
}

/// The firmware's HTTP client for one sync, bound to its `api_endpoint`.
pub struct Client {
    http: reqwest::Client,
    api_endpoint: String,
    hardware_id: String,
    requests: Vec<RequestRecord>,
}

impl Client {
    /// A client for the device `hardware_id`, configured with `api_endpoint`.
    pub fn new(api_endpoint: &str, hardware_id: &str) -> Result<Self, SyncFailure> {
        Self::with_timeout(api_endpoint, hardware_id, REQUEST_TIMEOUT)
    }

    /// [`Client::new`] giving up on a request after `timeout` instead of [`REQUEST_TIMEOUT`].
    pub fn with_timeout(
        api_endpoint: &str,
        hardware_id: &str,
        timeout: Duration,
    ) -> Result<Self, SyncFailure> {
        // A harness choice, not measured firmware behaviour: a 3xx reaches the quirk checks as a non-2xx.
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(timeout)
            .build()
            .map_err(|e| SyncFailure::Transport(e.to_string()))?;
        Ok(Self {
            http,
            api_endpoint: api_endpoint.trim_end_matches('/').to_owned(),
            hardware_id: hardware_id.to_owned(),
            requests: Vec::new(),
        })
    }

    /// `GET v1/initialization`, the handshake.
    pub async fn initialization(&mut self) -> Result<Response, SyncFailure> {
        let url = format!("{}/v1/initialization", self.api_endpoint);
        self.send(self.http.get(url)).await
    }

    /// `POST get_tests_request`: the A/B-test fetch, which firmware POSTs.
    pub async fn get_tests(&mut self, url: &str) -> Result<Response, SyncFailure> {
        self.send(self.http.post(url)).await
    }

    /// `GET` a store path the firmware derives from `api_endpoint` itself.
    pub async fn store_path(&mut self, path: &str) -> Result<Response, SyncFailure> {
        let url = format!("{}{path}", self.api_endpoint);
        self.send(self.http.get(url)).await
    }

    /// `GET` an arbitrary `url` — a cover through the filled
    /// `image_url_quality_template`, or one book's first `DownloadUrls` entry.
    pub async fn get(&mut self, url: &str) -> Result<Response, SyncFailure> {
        self.send(self.http.get(url)).await
    }

    /// `PUT library/<book>/state`, off `api_endpoint` itself like the store paths.
    pub async fn put_state(
        &mut self,
        book: &str,
        body: &serde_json::Value,
    ) -> Result<Response, SyncFailure> {
        let url = format!("{}/v1/library/{book}/state", self.api_endpoint);
        self.send(self.http.put(url).json(body)).await
    }

    /// `POST {host}/api/v3/content/checkforchanges`, body `[]` — the device
    /// never sends its own id/etag list; the server-side watermark decides.
    pub async fn check_for_changes(&mut self, host: &str) -> Result<Response, SyncFailure> {
        let url = format!("{host}/api/v3/content/checkforchanges");
        self.send(self.http.post(url).json(&Vec::<String>::new()))
            .await
    }

    /// `GET {host}/api/v3/content/{book}/annotations`, with `If-None-Match` when given.
    pub async fn annotations(
        &mut self,
        host: &str,
        book: &str,
        if_none_match: Option<&str>,
    ) -> Result<Response, SyncFailure> {
        let url = format!("{host}/api/v3/content/{book}/annotations");
        let mut request = self.http.get(url);
        if let Some(etag) = if_none_match {
            request = request.header(IF_NONE_MATCH, etag);
        }
        self.send(request).await
    }

    /// `PATCH {host}/api/v3/content/{book}/annotations` with a device upsert/delete body.
    pub async fn patch_annotations(
        &mut self,
        host: &str,
        book: &str,
        body: &serde_json::Value,
    ) -> Result<Response, SyncFailure> {
        let url = format!("{host}/api/v3/content/{book}/annotations");
        self.send(self.http.patch(url).json(body)).await
    }

    /// `GET library_sync`: one page of the library delta, echoing the
    /// previous page's `sync_token` when there was one.
    pub async fn library_sync(
        &mut self,
        url: &str,
        sync_token: Option<&str>,
    ) -> Result<Response, SyncFailure> {
        let mut request = self.http.get(url);
        if let Some(token) = sync_token {
            request = request.header(SYNC_TOKEN_HEADER, token);
        }
        self.send(request).await
    }

    /// Decode a JSON body the device needs, as a [`SyncFailure::BadResponse`] when it can't.
    pub async fn decode<T: DeserializeOwned>(&self, response: Response) -> Result<T, SyncFailure> {
        let path = response.url().path().to_owned();
        let body = response.bytes().await.map_err(|e| self.transport(e))?;
        serde_json::from_slice(&body)
            .map_err(|e| SyncFailure::BadResponse(self.redact(&format!("{path}: {e}"))))
    }

    /// `text` with every `/kobo/<token>/` path's token masked, whichever
    /// token that is — a URL cached from an earlier sync can carry a token
    /// this client no longer holds, so this can't rely on the client's own.
    pub fn redact(&self, text: &str) -> String {
        let mut out = String::new();
        let mut rest = text;
        while let Some(start) = rest.find(KOBO_SEGMENT) {
            let after_marker = start + KOBO_SEGMENT.len();
            out.push_str(&rest[..after_marker]);
            let tail = &rest[after_marker..];
            match tail.find('/') {
                Some(end) => {
                    out.push_str(REDACTED);
                    out.push('/');
                    rest = &tail[end + 1..];
                }
                None => {
                    out.push_str(tail);
                    rest = "";
                    break;
                }
            }
        }
        out.push_str(rest);
        out
    }

    /// The requests answered so far, in order.
    pub fn into_requests(self) -> Vec<RequestRecord> {
        self.requests
    }

    async fn send(&mut self, request: RequestBuilder) -> Result<Response, SyncFailure> {
        let mut request = request
            .header(HARDWARE_ID_HEADER, &self.hardware_id)
            .build()
            .map_err(|e| self.transport(e))?;
        // The firmware drops the port ([`Quirk::PortlessHost`]), and hyper keeps a `Host` that is already set.
        if let Some(host) = request
            .url()
            .host_str()
            .and_then(|h| h.parse::<HeaderValue>().ok())
        {
            request.headers_mut().insert(HOST, host);
        }
        let method = request.method().to_string();
        let path = self.redact(request.url().path());
        let response = self
            .http
            .execute(request)
            .await
            .map_err(|e| self.transport(e))?;
        let status = response.status().as_u16();
        self.requests.push(RequestRecord {
            method,
            path,
            status,
        });
        Ok(response)
    }

    fn transport(&self, error: reqwest::Error) -> SyncFailure {
        SyncFailure::Transport(self.redact(&error.to_string()))
    }
}

#[cfg(test)]
mod tests;
