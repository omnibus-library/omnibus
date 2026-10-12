//! Zero-setup wiring: find this worktree's dev server, log in as the dev seed
//! admin, and reuse or create the Omnibus device a mock Kobo syncs as.

use std::path::Path;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::cli::DEFAULT_STATE_PATH;
use crate::client::REQUEST_TIMEOUT;

/// The env var holding the dev seed admin's `<user>:<password>`.
pub const SEED_USER_ENV: &str = "OMNIBUS_DEV_SEED_USER";

/// The Omnibus device name the default state file's device uses.
pub const DEVICE_NAME: &str = "Mock Kobo";

/// `device_name` sent on login, so the session shows as its own device row.
pub const LOGIN_DEVICE_NAME: &str = "omnibus-mock-kobo";

const LOGIN_STEP: &str = "POST /api/auth/login";
const LIST_STEP: &str = "POST /api/rpc/kobo/devices";
const CREATE_STEP: &str = "POST /api/rpc/kobo/devices/create";

/// "Mock Kobo" for the default state file, "Mock Kobo (<stem>)" for any other path.
pub fn device_name(state: &Path) -> String {
    if state == Path::new(DEFAULT_STATE_PATH) {
        return DEVICE_NAME.to_owned();
    }
    match state.file_stem() {
        Some(stem) => format!("{DEVICE_NAME} ({})", stem.to_string_lossy()),
        None => format!("{DEVICE_NAME} ({})", state.display()),
    }
}

/// This worktree's dev-server origin from `<runtime_dir>/port`, if one was published.
pub async fn dev_server_url(runtime_dir: &Path) -> Option<String> {
    let port = tokio::fs::read_to_string(runtime_dir.join("port"))
        .await
        .ok()?;
    let port: u16 = port.trim().parse().ok()?;
    Some(format!("http://127.0.0.1:{port}"))
}

/// The dev seed admin's credentials. No `Debug`: it holds a password.
pub struct SeedUser {
    username: String,
    password: String,
}

impl SeedUser {
    /// Parse `OMNIBUS_DEV_SEED_USER` (`<user>:<password>`, split at the first `:`).
    pub fn parse(value: Option<&str>) -> Result<SeedUser, AutoWireError> {
        let value = value
            .filter(|value| !value.is_empty())
            .ok_or(AutoWireError::NoSeedUser)?;
        match value.split_once(':') {
            Some((username, password)) if !username.is_empty() => Ok(SeedUser {
                username: username.to_owned(),
                password: password.to_owned(),
            }),
            _ => Err(AutoWireError::BadSeedUser),
        }
    }
}

/// The `POST /api/auth/login` body, asking for a bearer session.
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

#[derive(Serialize)]
struct CreateBody<'a> {
    name: &'a str,
}

/// The parts of a Kobo device row auto-wire reads.
#[derive(Deserialize)]
struct DeviceRow {
    name: String,
    token: String,
}

/// Log in at `url` as `seed`, then reuse or create the device called `name`; returns its token.
pub async fn wire(url: &str, seed: &SeedUser, name: &str) -> Result<String, AutoWireError> {
    let http = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| failed(LOGIN_STEP, error))?;
    let session = login(&http, url, seed).await?;
    let list_url = format!("{url}/api/rpc/kobo/devices");
    let devices: Vec<DeviceRow> =
        post(&http, LIST_STEP, &list_url, Some(&session), &json!({})).await?;
    if let Some(device) = devices.into_iter().find(|device| device.name == name) {
        return Ok(device.token);
    }
    let create_url = format!("{url}/api/rpc/kobo/devices/create");
    let created: DeviceRow = post(
        &http,
        CREATE_STEP,
        &create_url,
        Some(&session),
        &CreateBody { name },
    )
    .await?;
    Ok(created.token)
}

/// A bearer session token for `seed`.
async fn login(
    http: &reqwest::Client,
    url: &str,
    seed: &SeedUser,
) -> Result<String, AutoWireError> {
    let body = LoginBody {
        username: &seed.username,
        password: &seed.password,
        client_kind: "bearer",
        device_name: LOGIN_DEVICE_NAME,
    };
    let login_url = format!("{url}/api/auth/login");
    let reply: LoginReply = post(http, LOGIN_STEP, &login_url, None, &body).await?;
    reply.token.ok_or_else(|| AutoWireError::Failed {
        step: LOGIN_STEP,
        detail: "no token in the login reply".into(),
    })
}

/// `POST` a JSON `body` to `url` and read the JSON reply.
async fn post<B: Serialize, R: DeserializeOwned>(
    http: &reqwest::Client,
    step: &'static str,
    url: &str,
    bearer: Option<&str>,
    body: &B,
) -> Result<R, AutoWireError> {
    let mut request = http.post(url).json(body);
    if let Some(token) = bearer {
        request = request.bearer_auth(token);
    }
    let response = request.send().await.map_err(|error| failed(step, error))?;
    let status = response.status();
    if !status.is_success() {
        return Err(AutoWireError::Rejected {
            step,
            status: status.as_u16(),
        });
    }
    response.json().await.map_err(|error| failed(step, error))
}

/// A request that got no usable answer. The error's URL is dropped: it may carry credentials.
fn failed(step: &'static str, error: reqwest::Error) -> AutoWireError {
    let detail = error.without_url().to_string();
    AutoWireError::Failed { step, detail }
}

/// Why a device couldn't be wired automatically.
#[derive(Debug, thiserror::Error)]
pub enum AutoWireError {
    #[error("no device token: pass --token, set OMNIBUS_MOCK_KOBO_TOKEN, or set OMNIBUS_DEV_SEED_USER to auto-wire one")]
    NoSeedUser,
    #[error("OMNIBUS_DEV_SEED_USER must be <user>:<password>")]
    BadSeedUser,
    #[error("auto-wire: {step} answered {status}")]
    Rejected { step: &'static str, status: u16 },
    #[error("auto-wire: {step} failed: {detail}")]
    Failed { step: &'static str, detail: String },
}

#[cfg(test)]
mod tests;
