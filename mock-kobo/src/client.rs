//! The device's HTTP side: one function per request the firmware makes. Every
//! answered request is recorded for the sync report with the device's path
//! token redacted, since the token is the device's only credential.

use reqwest::{RequestBuilder, Response};
use serde::de::DeserializeOwned;

use crate::firmware::{HARDWARE_ID_HEADER, SYNC_TOKEN_HEADER};
use crate::session::SyncFailure;

/// What stands in for the path token in anything the device reports.
const REDACTED: &str = "<token>";

/// One request the device made and the status it got back.
#[derive(Clone, Debug, PartialEq)]
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
    token: Option<String>,
    requests: Vec<RequestRecord>,
}

impl Client {
    /// A client for the device `hardware_id`, configured with `api_endpoint`.
    pub fn new(api_endpoint: &str, hardware_id: &str) -> Result<Self, SyncFailure> {
        // A 3xx is an answer, not a detour: following one would pass a moved path as 200.
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| SyncFailure::Transport(e.to_string()))?;
        Ok(Self {
            http,
            api_endpoint: api_endpoint.trim_end_matches('/').to_owned(),
            hardware_id: hardware_id.to_owned(),
            token: path_token(api_endpoint),
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

    /// `text` with the device token replaced, safe to report.
    pub fn redact(&self, text: &str) -> String {
        match &self.token {
            Some(token) => text.replace(token.as_str(), REDACTED),
            None => text.to_owned(),
        }
    }

    /// The requests answered so far, in order.
    pub fn into_requests(self) -> Vec<RequestRecord> {
        self.requests
    }

    async fn send(&mut self, request: RequestBuilder) -> Result<Response, SyncFailure> {
        let request = request
            .header(HARDWARE_ID_HEADER, &self.hardware_id)
            .build()
            .map_err(|e| self.transport(e))?;
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

/// The `<TOKEN>` in an `api_endpoint` of the form `…/kobo/<TOKEN>`.
fn path_token(api_endpoint: &str) -> Option<String> {
    let url = reqwest::Url::parse(api_endpoint).ok()?;
    let mut segments = url.path_segments()?;
    segments.find(|s| *s == "kobo")?;
    segments
        .next()
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
}
