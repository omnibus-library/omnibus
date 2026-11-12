//! The admin-set public server URL: the address readers reach Omnibus at, for
//! links the server sends outside the app. One KV row with the
//! seed-from-env-then-settings-wins precedence the SMTP config and the Calibre
//! path use; the admin Settings routes read and write it, and senders read
//! [`effective_public_url`]. Distinct from `OMNIBUS_PUBLIC_ORIGIN`, the origin
//! allowlist `auth::origin_check` reads. Every value is normalised before it is
//! saved or used, so a link can append a path without doubling a slash.

use omnibus_shared::{PublicUrlSource, PublicUrlStatus, PUBLIC_URL_MAX_LEN};
use sqlx::SqlitePool;
use url::{ParseError, Url};

use super::{get_setting, non_empty_env, SettingsError};

/// `settings` KV key for the public URL. Stored directly (not via the
/// [`super::Settings`] struct) so saving it never triggers the scan-root
/// reconciliation `set_settings` runs.
const PUBLIC_URL_KEY: &str = "public_url";

/// Env var consulted when no URL is saved, and seeded from at boot.
const PUBLIC_URL_ENV: &str = "OMNIBUS_PUBLIC_URL";

/// Validate a public URL and return its normalised form: trimmed, lower-cased
/// scheme and host, default port and trailing slashes dropped. Rejects anything
/// but an absolute `http(s)` URL with a host and no userinfo, query or fragment
/// with [`SettingsError::Validation`]; the message never echoes the value.
pub fn normalize_public_url(raw: &str) -> Result<String, SettingsError> {
    let raw = raw.trim();
    if raw.len() > PUBLIC_URL_MAX_LEN {
        return Err(invalid(&format!("exceeds {PUBLIC_URL_MAX_LEN} bytes")));
    }
    // http(s) URLs are "special" to the parser, which refuses one without a
    // host as `EmptyHost`, so no host check is needed after it.
    let url = Url::parse(raw).map_err(|e| match e {
        ParseError::RelativeUrlWithoutBase => {
            invalid("must be an absolute URL, such as https://books.example.com")
        }
        ParseError::EmptyHost => invalid("must include a host name"),
        _ => invalid("is not a valid URL"),
    })?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(invalid("must start with http:// or https://"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(invalid("must not include a username or password"));
    }
    if url.query().is_some() {
        return Err(invalid("must not include a query string"));
    }
    if url.fragment().is_some() {
        return Err(invalid("must not include a fragment"));
    }
    // An http(s) URL always has a host and a `/`-rooted path, so trimming
    // slashes stops at the host.
    let normalized = url.as_str().trim_end_matches('/');
    // Parsing percent-encodes, so a value under the cap can grow past it.
    if normalized.len() > PUBLIC_URL_MAX_LEN {
        return Err(invalid(&format!("exceeds {PUBLIC_URL_MAX_LEN} bytes")));
    }
    Ok(normalized.to_string())
}

fn invalid(reason: &str) -> SettingsError {
    SettingsError::Validation(format!("public url {reason}"))
}

/// Read the saved public URL, or `None` when unset/blank. Ignores the env var.
pub async fn get_public_url(pool: &SqlitePool) -> Result<Option<String>, SettingsError> {
    Ok(get_setting(pool, PUBLIC_URL_KEY)
        .await?
        .map(|s| s.trim().to_string()))
}

/// Save the public URL in its normalised form, or clear it when `None`/blank.
/// An invalid URL is refused with [`SettingsError::Validation`] before any
/// write, leaving the saved value as it was.
pub async fn set_public_url(pool: &SqlitePool, url: Option<&str>) -> Result<(), SettingsError> {
    let normalized = url
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(normalize_public_url)
        .transpose()?;
    match normalized {
        Some(url) => {
            sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
                .bind(PUBLIC_URL_KEY)
                .bind(url)
                .execute(pool)
                .await?;
        }
        None => {
            sqlx::query("DELETE FROM settings WHERE key = ?")
                .bind(PUBLIC_URL_KEY)
                .execute(pool)
                .await?;
        }
    }
    Ok(())
}

/// The public URL links should be built from: the saved one wins, then a valid
/// `OMNIBUS_PUBLIC_URL`. `None` means no link can be built.
pub async fn effective_public_url(pool: &SqlitePool) -> Result<Option<String>, SettingsError> {
    Ok(resolve(pool).await?.map(|(url, _)| url))
}

/// The public URL in effect and where it came from, for the admin Settings card.
pub async fn public_url_status(pool: &SqlitePool) -> Result<PublicUrlStatus, SettingsError> {
    Ok(match resolve(pool).await? {
        Some((url, source)) => PublicUrlStatus {
            url: Some(url),
            source,
        },
        None => PublicUrlStatus {
            url: None,
            source: PublicUrlSource::None,
        },
    })
}

/// Boot hook: seed the public URL from `OMNIBUS_PUBLIC_URL` **only** when none
/// is saved, so the env var works out of the box without clobbering a URL set
/// through Settings (settings wins). An invalid env value is logged and skipped
/// rather than failing the boot.
pub async fn seed_public_url_from_env(pool: &SqlitePool) -> Result<(), SettingsError> {
    if get_public_url(pool).await?.is_some() {
        return Ok(());
    }
    if let Some(from_env) = public_url_from_env() {
        set_public_url(pool, Some(&from_env)).await?;
    }
    Ok(())
}

async fn resolve(pool: &SqlitePool) -> Result<Option<(String, PublicUrlSource)>, SettingsError> {
    if let Some(saved) = get_public_url(pool).await? {
        return Ok(Some((saved, PublicUrlSource::Settings)));
    }
    Ok(public_url_from_env().map(|url| (url, PublicUrlSource::Env)))
}

/// `OMNIBUS_PUBLIC_URL` normalised, or `None` when it is unset or invalid.
fn public_url_from_env() -> Option<String> {
    let raw = non_empty_env(PUBLIC_URL_ENV)?;
    match normalize_public_url(&raw) {
        Ok(url) => Some(url),
        Err(error) => {
            tracing::warn!(%error, "ignoring OMNIBUS_PUBLIC_URL: not a usable public URL");
            None
        }
    }
}

#[cfg(test)]
mod tests;
