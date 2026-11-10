//! `--local` / `--server`: point a running Omnibus at the mock over its REST API, so a
//! request can be made without touching Settings. It logs in as the dev seed admin, saves
//! the mock as the Prowlarr and download client connections, has the server test both, and
//! logs out. Only a loopback server is ever logged in to (the login carries the seed
//! password), no redirect is followed, and a connection that is set and not this mock's own
//! is never overwritten, since the settings read masks secrets and could not restore it.
//! `--local` also checks that the server on the published port is this checkout's, and
//! nothing is saved while a server library sits under the committed `test_data/`.

use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use omnibus_shared::{
    DownloadClientKind, Health, RequestsSettingsStatus, RequestsSettingsUpdate, Settings,
};
use reqwest::{RequestBuilder, Response, StatusCode};
use serde::{Deserialize, Serialize};

use crate::{CLIENT_PASSWORD, CLIENT_USERNAME, PROWLARR_API_KEY};

/// The env var holding the dev seed admin's `<user>:<password>`.
pub const SEED_USER_ENV: &str = "OMNIBUS_DEV_SEED_USER";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// `device_name` sent on login, so the session shows as its own device row.
const LOGIN_DEVICE_NAME: &str = "omnibus-mock-requests";

/// The longest reply body quoted in an error.
const DETAIL_LIMIT: usize = 300;

const SETTINGS: &str = "/api/admin/requests/settings";

/// Why the mock could not be wired in.
#[derive(Debug, thiserror::Error)]
pub enum WireError {
    #[error("{0}")]
    Setup(String),
    #[error(
        "book requests are off on this server: set OMNIBUS_BOOK_REQUESTS=1 and `just dev-bounce`"
    )]
    RequestsOff,
    #[error("the server already points {0} at something that is not this mock: clear it in Settings > Requests first")]
    InUse(String),
    #[error("{step} failed: {detail}")]
    Server { step: &'static str, detail: String },
}

/// This checkout's top-level folder, which a server of this checkout reports as its `repo_root`.
pub fn checkout_root() -> Result<PathBuf, WireError> {
    let git = std::process::Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .and_then(|out| String::from_utf8(out.stdout).ok());
    match git {
        Some(root) => Ok(PathBuf::from(root.trim())),
        None => std::env::current_dir().map_err(|e| WireError::Setup(e.to_string())),
    }
}

/// This checkout's dev-server origin, from the `port` file `just dev-up` publishes in
/// `runtime_dir`. A stale file can name another checkout's server, so the server on that
/// port must report `repo_root` as its folder.
pub async fn local_origin(runtime_dir: &Path, repo_root: &Path) -> Result<String, WireError> {
    let no_server =
        || WireError::Setup("no dev server is running here: run `just dev-up` first".into());
    let port = std::fs::read_to_string(runtime_dir.join("port"))
        .ok()
        .and_then(|text| text.trim().parse::<u16>().ok())
        .ok_or_else(no_server)?;
    let origin = format!("http://127.0.0.1:{port}");
    let reply = http()?
        .get(format!("{origin}/api/_health"))
        .send()
        .await
        .map_err(|_| no_server())?;
    let health: Health = reply.json().await.map_err(|_| no_server())?;
    if Path::new(&health.repo_root) != repo_root {
        return Err(WireError::Setup(format!(
            "the server on port {port} belongs to another checkout ({}): run `just dev-up` here",
            health.repo_root
        )));
    }
    Ok(origin)
}

/// Whether `url` names this machine: `localhost`, a `127.0.0.0/8` address or `::1`.
fn is_loopback(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    host == "localhost" || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

#[derive(Serialize)]
struct LoginBody<'a> {
    username: &'a str,
    password: &'a str,
    client_kind: &'static str,
    device_name: &'static str,
}

#[derive(Deserialize)]
struct LoginReply {
    token: Option<String>,
}

/// Point the Omnibus at `server` at the mock at `mock_origin`, with `client` as its download
/// client and `downloads` as the folder both sides read finished files from. Refuses when
/// the server's library sits under `test_data`, which an import would write into.
pub async fn wire(
    server: &str,
    seed: Option<&str>,
    mock_origin: &str,
    client: DownloadClientKind,
    downloads: &Path,
    test_data: &Path,
) -> Result<(), WireError> {
    let server = server.trim_end_matches('/');
    if !is_loopback(server) {
        return Err(WireError::Setup(
            "wiring only logs in to an Omnibus on this machine".into(),
        ));
    }
    let (username, password) = seed
        .and_then(|seed| seed.split_once(':'))
        .filter(|(username, _)| !username.is_empty())
        .ok_or_else(|| WireError::Setup(format!("{SEED_USER_ENV} must be <user>:<password>")))?;
    let http = http()?;
    let token = login(&http, server, username, password).await?;
    let update = update_for(mock_origin, client, downloads);
    let result = configure(&http, server, &token, &update, test_data).await;
    // Ending the session is best effort: an admin session left behind just expires.
    let _ = http
        .post(format!("{server}/api/auth/logout"))
        .bearer_auth(&token)
        .send()
        .await;
    result
}

/// A client that follows no redirect: a 307/308 would resend the seed password to wherever
/// `Location` points.
fn http() -> Result<reqwest::Client, WireError> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| failed("connect", e))
}

fn update_for(mock: &str, client: DownloadClientKind, downloads: &Path) -> RequestsSettingsUpdate {
    let downloads = downloads.to_string_lossy().into_owned();
    RequestsSettingsUpdate {
        prowlarr_url: mock.to_string(),
        prowlarr_api_key: Some(PROWLARR_API_KEY.to_string()),
        download_client_kind: client,
        download_client_url: mock.to_string(),
        download_client_username: CLIENT_USERNAME.to_string(),
        download_client_password: Some(CLIENT_PASSWORD.to_string()),
        download_client_category: String::new(),
        download_client_path_prefix: downloads.clone(),
        download_path_prefix: downloads,
    }
}

async fn login(
    http: &reqwest::Client,
    server: &str,
    username: &str,
    password: &str,
) -> Result<String, WireError> {
    let body = LoginBody {
        username,
        password,
        client_kind: "bearer",
        device_name: LOGIN_DEVICE_NAME,
    };
    let reply = checked(
        "login",
        http.post(format!("{server}/api/auth/login")).json(&body),
    )
    .await?;
    let reply: LoginReply = reply.json().await.map_err(|e| failed("login", e))?;
    reply.token.ok_or_else(|| WireError::Server {
        step: "login",
        detail: "no token in the login reply".into(),
    })
}

/// Everything after login: read, guard, save, and have the server test both connections.
async fn configure(
    http: &reqwest::Client,
    server: &str,
    token: &str,
    update: &RequestsSettingsUpdate,
    test_data: &Path,
) -> Result<(), WireError> {
    let libraries = checked(
        "read library settings",
        http.get(format!("{server}/api/settings"))
            .bearer_auth(token),
    )
    .await?;
    let libraries: Settings = libraries
        .json()
        .await
        .map_err(|e| failed("read library settings", e))?;
    guard_libraries(&libraries, test_data)?;
    let url = |path: &str| format!("{server}{SETTINGS}{path}");
    let read = http.get(url("")).bearer_auth(token).send().await;
    let read = read.map_err(|e| failed("read settings", e))?;
    if read.status() == StatusCode::NOT_FOUND {
        return Err(WireError::RequestsOff);
    }
    let read = checked_response("read settings", read).await?;
    let saved: RequestsSettingsStatus =
        read.json().await.map_err(|e| failed("read settings", e))?;
    guard(&saved)?;
    checked(
        "save settings",
        http.put(url("")).bearer_auth(token).json(update),
    )
    .await?;
    for (step, path) in [
        ("test-indexer", "/test-indexer"),
        ("test-client", "/test-client"),
    ] {
        checked(step, http.post(url(path)).bearer_auth(token)).await?;
    }
    Ok(())
}

/// Refuse when an import would land in the committed fixtures under `test_data`.
fn guard_libraries(libraries: &Settings, test_data: &Path) -> Result<(), WireError> {
    let real = |p: &Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    let root = real(test_data);
    let paths = [
        &libraries.ebook_library_path,
        &libraries.audiobook_library_path,
    ];
    for path in paths.into_iter().flatten() {
        if real(Path::new(path)).starts_with(&root) {
            return Err(WireError::Setup(format!(
                "the server's library {path} is inside the committed test_data/: an import \
                 would add files to the fixtures, so point the library elsewhere first"
            )));
        }
    }
    Ok(())
}

/// Refuse to replace a connection that is set and is not this mock's own, since the
/// settings read masks secrets and they could not be restored.
fn guard(saved: &RequestsSettingsStatus) -> Result<(), WireError> {
    let prowlarr_is_ours = saved.prowlarr_url.is_none()
        || saved.prowlarr_api_key_masked.as_deref() == Some(key_preview(PROWLARR_API_KEY).as_str());
    let client_is_ours = saved.download_client_url.is_none()
        || saved.download_client_username.as_deref() == Some(CLIENT_USERNAME);
    if !prowlarr_is_ours {
        return Err(WireError::InUse("Prowlarr".into()));
    }
    if !client_is_ours {
        return Err(WireError::InUse("the download client".into()));
    }
    Ok(())
}

/// How the settings read previews `key`: its first and last four characters (a key over 8).
fn key_preview(key: &str) -> String {
    let (head, tail) = (
        key.chars().take(4),
        key.chars().skip(key.chars().count() - 4),
    );
    format!(
        "{}\u{2026}{}",
        head.collect::<String>(),
        tail.collect::<String>()
    )
}

async fn checked(step: &'static str, request: RequestBuilder) -> Result<Response, WireError> {
    let response = request.send().await.map_err(|e| failed(step, e))?;
    checked_response(step, response).await
}

/// `response`, or a [`WireError::Server`] carrying its body when the status is not a success.
async fn checked_response(step: &'static str, response: Response) -> Result<Response, WireError> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let body: String = body.trim().chars().take(DETAIL_LIMIT).collect();
    let detail = if body.is_empty() {
        status.to_string()
    } else {
        format!("{status}: {body}")
    };
    Err(WireError::Server { step, detail })
}

/// A request that got no answer. The error's URL is dropped: it may carry credentials.
fn failed(step: &'static str, error: reqwest::Error) -> WireError {
    WireError::Server {
        step,
        detail: error.without_url().to_string(),
    }
}

#[cfg(test)]
mod tests;
