//! The ntfy provider: its stored settings, how a client's input is checked and merged over
//! them, and the request that publishes a notice. It publishes JSON to the server's root, so
//! a title in any script arrives intact and a server under a sub-path takes the same request
//! at its own address. Reached through [`super::ConnectionSettings`] and [`super::render`].

use base64::engine::{general_purpose::STANDARD, Engine as _};
use omnibus_shared::{NtfyAuth, NtfySettingsInput, NtfySettingsStatus};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::settings::normalize_base_url;

use super::render::{Notice, Outgoing};
use super::settings::Secret;
use super::NotifyError;

const TOPIC_MAX_CHARS: usize = 64;
const MAX_TAGS: usize = 10;
const TAG_MAX_CHARS: usize = 64;
const USERNAME_MAX_BYTES: usize = 255;
const SECRET_MAX_BYTES: usize = 1024;

/// An ntfy connection as stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NtfySettings {
    /// The server's normalised address, without a trailing slash.
    pub server_url: String,
    pub topic: String,
    pub auth: NtfyCredentials,
    /// 1 (lowest) to 5 (highest).
    pub priority: u8,
    pub tags: Vec<String>,
    /// Whether a message names the book and the requester.
    pub include_details: bool,
}

/// How the server signs in to ntfy, with the credentials it signs in with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum NtfyCredentials {
    None,
    Token { token: Secret },
    Basic { username: String, password: Secret },
}

impl NtfySettings {
    /// Check `input` and merge it over `saved`, as [`super::ConnectionSettings::from_input`] does.
    pub(super) fn from_input(
        input: &NtfySettingsInput,
        saved: Option<&NtfySettings>,
    ) -> Result<Self, NotifyError> {
        let server_url =
            normalize_base_url(&input.server_url, "server url").map_err(NotifyError::Validation)?;
        if !(1..=5).contains(&input.priority) {
            return Err(invalid("priority must be from 1 to 5"));
        }
        Ok(Self {
            server_url,
            topic: valid_topic(&input.topic)?,
            auth: credentials(input, saved.map(|s| &s.auth))?,
            priority: input.priority,
            tags: valid_tags(&input.tags)?,
            include_details: input.include_details,
        })
    }

    /// The settings as a response shows them.
    pub(super) fn status(&self) -> NtfySettingsStatus {
        let (auth, username) = match &self.auth {
            NtfyCredentials::None => (NtfyAuth::None, None),
            NtfyCredentials::Token { .. } => (NtfyAuth::Token, None),
            NtfyCredentials::Basic { username, .. } => (NtfyAuth::Basic, Some(username.clone())),
        };
        NtfySettingsStatus {
            server_url: self.server_url.clone(),
            topic: self.topic.clone(),
            auth,
            username,
            token_set: matches!(self.auth, NtfyCredentials::Token { .. }),
            password_set: matches!(self.auth, NtfyCredentials::Basic { .. }),
            priority: self.priority,
            tags: self.tags.clone(),
            include_details: self.include_details,
        }
    }
}

/// The JSON publish of `notice` to `settings`' topic.
pub(super) fn render(settings: &NtfySettings, notice: &Notice) -> Outgoing {
    let mut body = Map::new();
    body.insert("topic".into(), Value::from(settings.topic.as_str()));
    body.insert("title".into(), Value::from(notice.title.as_str()));
    body.insert("message".into(), Value::from(notice.message.as_str()));
    body.insert("priority".into(), Value::from(settings.priority));
    if !settings.tags.is_empty() {
        body.insert("tags".into(), Value::from(settings.tags.clone()));
    }
    if let Some(click) = &notice.click {
        body.insert("click".into(), Value::from(click.as_str()));
    }
    let mut headers = vec![("Content-Type", "application/json".to_string())];
    let mut secrets = Vec::new();
    match &settings.auth {
        NtfyCredentials::None => {}
        NtfyCredentials::Token { token } => {
            headers.push(("Authorization", format!("Bearer {}", token.expose())));
            secrets.push(token.expose().to_string());
        }
        NtfyCredentials::Basic { username, password } => {
            let encoded = STANDARD.encode(format!("{username}:{}", password.expose()));
            headers.push(("Authorization", format!("Basic {encoded}")));
            secrets.extend([password.expose().to_string(), encoded]);
        }
    }
    Outgoing {
        method: reqwest::Method::POST,
        url: settings.server_url.clone(),
        headers,
        body: Value::Object(body).to_string(),
        secrets,
    }
}

fn invalid(reason: &str) -> NotifyError {
    NotifyError::Validation(reason.to_string())
}

/// ntfy's own topic rule: 1 to 64 of `A-Z`, `a-z`, `0-9`, `-` and `_`.
fn valid_topic(raw: &str) -> Result<String, NotifyError> {
    let topic = raw.trim();
    let allowed = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_';
    if topic.is_empty() || topic.len() > TOPIC_MAX_CHARS || !topic.chars().all(allowed) {
        return Err(invalid(
            "topic must be 1 to 64 letters, digits, hyphens or underscores",
        ));
    }
    Ok(topic.to_string())
}

/// Each tag trimmed; ntfy splits its tag list on commas, so a tag may not hold one.
fn valid_tags(raw: &[String]) -> Result<Vec<String>, NotifyError> {
    if raw.len() > MAX_TAGS {
        return Err(invalid(&format!("at most {MAX_TAGS} tags are allowed")));
    }
    raw.iter()
        .map(|tag| {
            let tag = tag.trim();
            if tag.is_empty() {
                return Err(invalid("a tag can't be blank"));
            }
            if tag.contains(',') || tag.chars().any(char::is_control) {
                return Err(invalid("a tag can't contain a comma or control characters"));
            }
            if tag.chars().count() > TAG_MAX_CHARS {
                return Err(invalid(&format!(
                    "a tag can be at most {TAG_MAX_CHARS} characters"
                )));
            }
            Ok(tag.to_string())
        })
        .collect()
}

/// The credentials `input` asks for, keeping each saved secret it leaves out. Switching
/// mode drops whatever the old mode saved.
fn credentials(
    input: &NtfySettingsInput,
    saved: Option<&NtfyCredentials>,
) -> Result<NtfyCredentials, NotifyError> {
    match input.auth {
        NtfyAuth::None => Ok(NtfyCredentials::None),
        NtfyAuth::Token => {
            let saved = match saved {
                Some(NtfyCredentials::Token { token }) => Some(token),
                _ => None,
            };
            let token = merged(input.token.as_deref().map(str::trim), saved)
                .ok_or_else(|| invalid("a token is required when auth is token"))?;
            check_secret("token", &token)?;
            Ok(NtfyCredentials::Token { token })
        }
        NtfyAuth::Basic => {
            let username = valid_username(input.username.as_deref())?;
            let saved = match saved {
                Some(NtfyCredentials::Basic { password, .. }) => Some(password),
                _ => None,
            };
            let password = merged(input.password.as_deref(), saved)
                .ok_or_else(|| invalid("a password is required when auth is basic"))?;
            check_secret("password", &password)?;
            Ok(NtfyCredentials::Basic { username, password })
        }
    }
}

/// Left out keeps `saved`, empty clears it, anything else replaces it.
fn merged(input: Option<&str>, saved: Option<&Secret>) -> Option<Secret> {
    match input {
        None => saved.cloned(),
        Some("") => None,
        Some(value) => Some(Secret::new(value)),
    }
}

/// A secret goes into a header, so it is capped and holds no control character. The
/// message names the field, never the value.
fn check_secret(field: &str, secret: &Secret) -> Result<(), NotifyError> {
    let value = secret.expose();
    if value.len() > SECRET_MAX_BYTES {
        return Err(invalid(&format!(
            "the {field} can be at most {SECRET_MAX_BYTES} bytes"
        )));
    }
    if value.chars().any(char::is_control) {
        return Err(invalid(&format!(
            "the {field} can't contain control characters"
        )));
    }
    Ok(())
}

/// Basic auth joins the username and password with a colon, so the username can't hold one.
fn valid_username(raw: Option<&str>) -> Result<String, NotifyError> {
    let username = raw.map(str::trim).unwrap_or_default();
    if username.is_empty() {
        return Err(invalid("a username is required when auth is basic"));
    }
    if username.len() > USERNAME_MAX_BYTES {
        return Err(invalid(&format!(
            "the username can be at most {USERNAME_MAX_BYTES} bytes"
        )));
    }
    if username.contains(':') || username.chars().any(char::is_control) {
        return Err(invalid(
            "the username can't contain a colon or control characters",
        ));
    }
    Ok(username.to_string())
}
