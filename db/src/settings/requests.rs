//! The book-request connections kept in `settings`: the Prowlarr address and API key, and
//! the download client's login, category and folder mapping. Stored as discrete rows so
//! saving them never triggers the scan-root reconciliation `set_settings` runs. The two
//! secrets are masked before they cross the wire; the Prowlarr key alone has an env
//! fallback, the download client password does not.

use omnibus_shared::{
    DownloadClientKind, RequestsSettingsStatus, RequestsSettingsUpdate, REQUESTS_FIELD_MAX_LEN,
    REQUESTS_PATH_MAX_LEN, REQUESTS_SECRET_MAX_LEN, REQUESTS_URL_MAX_LEN,
};
use sqlx::SqlitePool;

use super::secret_key::SecretKeySpec;
use super::{get_setting, upsert_or_clear, SettingsError};

/// What the status shows for a saved download client password.
const MASKED_PASSWORD: &str = "\u{2022}\u{2022}\u{2022}\u{2022}";

const PROWLARR_URL_KEY: &str = "prowlarr_url";
const CLIENT_KIND_KEY: &str = "download_client_kind";
const CLIENT_URL_KEY: &str = "download_client_url";
const CLIENT_USERNAME_KEY: &str = "download_client_username";
const CLIENT_PASSWORD_KEY: &str = "download_client_password";
const CLIENT_CATEGORY_KEY: &str = "download_client_category";
const CLIENT_PATH_PREFIX_KEY: &str = "download_client_path_prefix";
const DOWNLOAD_PATH_PREFIX_KEY: &str = "download_path_prefix";

/// The Prowlarr API key: settings win, then `OMNIBUS_PROWLARR_API_KEY`.
const PROWLARR_KEY: SecretKeySpec = SecretKeySpec {
    kv_key: "prowlarr_api_key",
    env_var: "OMNIBUS_PROWLARR_API_KEY",
    max_len: REQUESTS_SECRET_MAX_LEN,
    label: "prowlarr api key",
};

/// The resolved connections the server talks to Prowlarr and the download client with.
/// Server-only: it carries the raw secrets, so it never crosses the wire and has no
/// `Debug`.
#[derive(Clone)]
pub struct RequestsConfig {
    pub prowlarr_url: Option<String>,
    pub prowlarr_api_key: Option<String>,
    pub download_client_kind: DownloadClientKind,
    pub download_client_url: Option<String>,
    pub download_client_username: Option<String>,
    pub download_client_password: Option<String>,
    pub download_client_category: String,
    pub download_client_path_prefix: Option<String>,
    pub download_path_prefix: Option<String>,
}

/// `v` trimmed, or `None` when blank.
fn field(v: &str) -> Option<&str> {
    Some(v.trim()).filter(|s| !s.is_empty())
}

fn check_len(label: &str, v: &str, max: usize) -> Result<(), SettingsError> {
    if v.len() > max {
        return Err(SettingsError::Validation(format!(
            "{label} exceeds {max} bytes"
        )));
    }
    Ok(())
}

/// A blank URL is allowed (it clears the field); anything else must be an `http(s)` URL
/// with a host and no embedded login. The message never echoes the value.
fn check_url(label: &str, v: &str) -> Result<(), SettingsError> {
    let Some(v) = field(v) else { return Ok(()) };
    check_len(label, v, REQUESTS_URL_MAX_LEN)?;
    let plain_http = reqwest::Url::parse(v).is_ok_and(|u| {
        matches!(u.scheme(), "http" | "https")
            && u.host_str().is_some()
            && u.username().is_empty()
            && u.password().is_none()
    });
    if !plain_http {
        return Err(SettingsError::Validation(format!(
            "{label} must be an http(s) URL without a username or password"
        )));
    }
    Ok(())
}

fn validate(u: &RequestsSettingsUpdate) -> Result<(), SettingsError> {
    check_url("prowlarr url", &u.prowlarr_url)?;
    check_url("download client url", &u.download_client_url)?;
    for (label, value, max) in [
        (
            "download client username",
            &u.download_client_username,
            REQUESTS_FIELD_MAX_LEN,
        ),
        (
            "download client category",
            &u.download_client_category,
            REQUESTS_FIELD_MAX_LEN,
        ),
        (
            "download client path prefix",
            &u.download_client_path_prefix,
            REQUESTS_PATH_MAX_LEN,
        ),
        (
            "download path prefix",
            &u.download_path_prefix,
            REQUESTS_PATH_MAX_LEN,
        ),
    ] {
        check_len(label, value, max)?;
    }
    for (label, secret) in [
        (PROWLARR_KEY.label, &u.prowlarr_api_key),
        ("download client password", &u.download_client_password),
    ] {
        if let Some(s) = secret {
            check_len(label, s, REQUESTS_SECRET_MAX_LEN)?;
        }
    }
    Ok(())
}

/// Persist the connections from an admin request, validating every field before the
/// first write. A secret of `None` keeps the stored one and `Some("")` clears it; every
/// other field is overwritten, a blank one clearing it.
pub async fn set_requests_settings(
    pool: &SqlitePool,
    update: &RequestsSettingsUpdate,
) -> Result<(), SettingsError> {
    validate(update)?;
    let mut tx = pool.begin().await?;
    let plain = [
        (PROWLARR_URL_KEY, &update.prowlarr_url),
        (CLIENT_URL_KEY, &update.download_client_url),
        (CLIENT_USERNAME_KEY, &update.download_client_username),
        (CLIENT_CATEGORY_KEY, &update.download_client_category),
        (CLIENT_PATH_PREFIX_KEY, &update.download_client_path_prefix),
        (DOWNLOAD_PATH_PREFIX_KEY, &update.download_path_prefix),
    ];
    for (key, value) in plain {
        upsert_or_clear(&mut tx, key, field(value)).await?;
    }
    let kind = update.download_client_kind.as_str();
    upsert_or_clear(&mut tx, CLIENT_KIND_KEY, Some(kind)).await?;
    let secrets = [
        (PROWLARR_KEY.kv_key, &update.prowlarr_api_key),
        (CLIENT_PASSWORD_KEY, &update.download_client_password),
    ];
    // Secrets are stored exactly as typed; only an empty string clears one.
    for (key, value) in secrets {
        if let Some(v) = value {
            upsert_or_clear(&mut tx, key, Some(v.as_str()).filter(|s| !s.is_empty())).await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

/// The saved password as typed: unlike [`get_setting`], a whitespace-only one is kept.
async fn stored_password(pool: &SqlitePool) -> Result<Option<String>, SettingsError> {
    Ok(
        sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
            .bind(CLIENT_PASSWORD_KEY)
            .fetch_optional(pool)
            .await?,
    )
}

/// The connections the server acts on: saved values, with the Prowlarr key falling back
/// to `OMNIBUS_PROWLARR_API_KEY`. Includes raw secrets; a client must get
/// [`requests_settings_status`] instead.
pub async fn effective_requests_config(pool: &SqlitePool) -> Result<RequestsConfig, SettingsError> {
    Ok(RequestsConfig {
        prowlarr_url: get_setting(pool, PROWLARR_URL_KEY).await?,
        prowlarr_api_key: PROWLARR_KEY.effective(pool).await?,
        download_client_kind: DownloadClientKind::from_str_or_default(
            &get_setting(pool, CLIENT_KIND_KEY)
                .await?
                .unwrap_or_default(),
        ),
        download_client_url: get_setting(pool, CLIENT_URL_KEY).await?,
        download_client_username: get_setting(pool, CLIENT_USERNAME_KEY).await?,
        download_client_password: stored_password(pool).await?,
        download_client_category: get_setting(pool, CLIENT_CATEGORY_KEY)
            .await?
            .unwrap_or_default(),
        download_client_path_prefix: get_setting(pool, CLIENT_PATH_PREFIX_KEY).await?,
        download_path_prefix: get_setting(pool, DOWNLOAD_PATH_PREFIX_KEY).await?,
    })
}

/// The connections as a client may see them: both secrets masked, and the key's source
/// (`settings`, `env` or `none`) reported.
pub async fn requests_settings_status(
    pool: &SqlitePool,
) -> Result<RequestsSettingsStatus, SettingsError> {
    let config = effective_requests_config(pool).await?;
    let key = PROWLARR_KEY.status(pool).await?;
    Ok(RequestsSettingsStatus {
        prowlarr_url: config.prowlarr_url,
        prowlarr_api_key_masked: key.masked,
        prowlarr_api_key_source: key.source,
        download_client_kind: config.download_client_kind,
        download_client_url: config.download_client_url,
        download_client_username: config.download_client_username,
        // Only whether it is set: a password is typed by a person, so any part of it would give it away.
        download_client_password_masked: config
            .download_client_password
            .map(|_| MASKED_PASSWORD.to_string()),
        download_client_category: config.download_client_category,
        download_client_path_prefix: config.download_client_path_prefix,
        download_path_prefix: config.download_path_prefix,
    })
}
