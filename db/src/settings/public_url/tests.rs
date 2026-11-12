//! Unit tests for the `public_url` settings row: `normalize_public_url`'s
//! accepted shapes and each rejection, `normalize_base_url`'s label, the
//! get/set pair, the settings → `OMNIBUS_PUBLIC_URL` resolution, with the
//! env var pinned via `EnvVarGuard`, and the gate that keeps an invalid env
//! var to one warning.

use crate::pool::init_db;
use crate::test_support::EnvVarGuard;

use super::*;

const ENV: &str = "OMNIBUS_PUBLIC_URL";

fn rejection(raw: &str) -> String {
    match normalize_public_url(raw) {
        Err(SettingsError::Validation(message)) => message,
        other => panic!("expected a validation error for {raw:?}, got {other:?}"),
    }
}

#[test]
fn normalize_public_url_accepts_a_plain_https_url() {
    assert_eq!(
        normalize_public_url("https://books.example.com").unwrap(),
        "https://books.example.com"
    );
}

#[test]
fn normalize_public_url_keeps_a_non_default_port() {
    assert_eq!(
        normalize_public_url("http://192.168.1.65:3000").unwrap(),
        "http://192.168.1.65:3000"
    );
}

#[test]
fn normalize_public_url_keeps_a_sub_path_prefix() {
    assert_eq!(
        normalize_public_url("https://example.org/omnibus").unwrap(),
        "https://example.org/omnibus"
    );
}

#[test]
fn normalize_public_url_drops_trailing_slashes() {
    assert_eq!(
        normalize_public_url("https://books.example.com/").unwrap(),
        "https://books.example.com"
    );
    assert_eq!(
        normalize_public_url("https://example.org/omnibus//").unwrap(),
        "https://example.org/omnibus"
    );
}

#[test]
fn normalize_public_url_trims_surrounding_whitespace() {
    assert_eq!(
        normalize_public_url("  https://books.example.com/ \n").unwrap(),
        "https://books.example.com"
    );
}

#[test]
fn normalize_public_url_lowercases_the_host_and_drops_a_default_port() {
    assert_eq!(
        normalize_public_url("HTTPS://Books.Example.COM:443/Omnibus").unwrap(),
        "https://books.example.com/Omnibus"
    );
}

#[test]
fn normalize_public_url_rejects_a_relative_url() {
    assert_eq!(
        rejection("books.example.com/omnibus"),
        "public url must be an absolute URL, such as https://books.example.com"
    );
}

#[test]
fn normalize_public_url_rejects_a_non_http_scheme() {
    assert_eq!(
        rejection("ftp://books.example.com"),
        "public url must start with http:// or https://"
    );
}

#[test]
fn normalize_public_url_rejects_a_url_without_a_host() {
    assert_eq!(rejection("https://"), "public url must include a host name");
}

#[test]
fn normalize_public_url_rejects_a_url_that_does_not_parse() {
    assert_eq!(
        rejection("https://books.example.com:99999"),
        "public url is not a valid URL"
    );
}

#[test]
fn normalize_public_url_rejects_a_username_and_password() {
    assert_eq!(
        rejection("https://admin:hunter2@books.example.com"),
        "public url must not include a username or password"
    );
}

#[test]
fn normalize_public_url_rejects_a_query() {
    assert_eq!(
        rejection("https://books.example.com/?ref=mail"),
        "public url must not include a query string"
    );
}

#[test]
fn normalize_public_url_rejects_a_fragment() {
    assert_eq!(
        rejection("https://books.example.com/#top"),
        "public url must not include a fragment"
    );
}

#[test]
fn normalize_public_url_rejects_a_url_over_the_length_cap() {
    let too_long = format!(
        "https://books.example.com/{}",
        "a".repeat(PUBLIC_URL_MAX_LEN)
    );
    assert_eq!(rejection(&too_long), "public url exceeds 2048 bytes");
}

#[test]
fn normalize_public_url_rejects_a_url_that_percent_encoding_grows_past_the_cap() {
    let grows = format!("https://books.example.com/{}", "é".repeat(700));
    assert!(grows.len() <= PUBLIC_URL_MAX_LEN);
    assert_eq!(rejection(&grows), "public url exceeds 2048 bytes");
}

#[test]
fn normalize_public_url_returns_an_already_normalised_url_unchanged() {
    let once = normalize_public_url("https://books.example.com/caf é/").unwrap();
    assert_eq!(normalize_public_url(&once).unwrap(), once);
}

#[test]
fn normalize_base_url_keeps_a_sub_path_and_drops_the_trailing_slash() {
    assert_eq!(
        normalize_base_url("http://127.0.0.1:9999/ntfy/", "server url").unwrap(),
        "http://127.0.0.1:9999/ntfy"
    );
}

#[test]
fn normalize_base_url_names_the_address_by_its_label_when_it_refuses_one() {
    let message = normalize_base_url("ntfy.example.com", "server url").unwrap_err();

    assert!(
        message.starts_with("server url must be an absolute URL"),
        "{message}"
    );
}

#[tokio::test]
async fn get_public_url_returns_none_when_nothing_is_saved() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    assert_eq!(get_public_url(&pool).await.unwrap(), None);
}

#[tokio::test]
async fn set_public_url_saves_the_normalised_url() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    set_public_url(&pool, Some(" https://Books.Example.com/omnibus/ "))
        .await
        .unwrap();
    assert_eq!(
        get_public_url(&pool).await.unwrap().as_deref(),
        Some("https://books.example.com/omnibus")
    );
}

#[tokio::test]
async fn set_public_url_replaces_a_saved_url() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    set_public_url(&pool, Some("https://old.example.com"))
        .await
        .unwrap();
    set_public_url(&pool, Some("https://new.example.com"))
        .await
        .unwrap();
    assert_eq!(
        get_public_url(&pool).await.unwrap().as_deref(),
        Some("https://new.example.com")
    );
}

#[tokio::test]
async fn set_public_url_clears_the_row_when_given_none() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    set_public_url(&pool, Some("https://books.example.com"))
        .await
        .unwrap();
    set_public_url(&pool, None).await.unwrap();
    assert_eq!(get_public_url(&pool).await.unwrap(), None);
}

#[tokio::test]
async fn set_public_url_clears_the_row_when_given_a_blank_value() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    set_public_url(&pool, Some("https://books.example.com"))
        .await
        .unwrap();
    set_public_url(&pool, Some("   ")).await.unwrap();
    assert_eq!(get_public_url(&pool).await.unwrap(), None);
}

#[tokio::test]
async fn set_public_url_leaves_the_saved_url_untouched_when_the_new_one_is_invalid() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    set_public_url(&pool, Some("https://books.example.com"))
        .await
        .unwrap();
    let err = set_public_url(&pool, Some("https://books.example.com/?x=1"))
        .await
        .unwrap_err();
    assert!(matches!(err, SettingsError::Validation(_)));
    assert_eq!(
        get_public_url(&pool).await.unwrap().as_deref(),
        Some("https://books.example.com")
    );
}

#[tokio::test]
async fn set_public_url_propagates_a_db_error_when_the_pool_is_closed() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    pool.close().await;
    let err = set_public_url(&pool, Some("https://books.example.com"))
        .await
        .unwrap_err();
    assert!(matches!(err, SettingsError::Db(_)));
}

#[tokio::test]
async fn effective_public_url_returns_none_when_nothing_is_configured() {
    let _guard = EnvVarGuard::set(ENV, None);
    let pool = init_db("sqlite::memory:").await.unwrap();
    assert_eq!(effective_public_url(&pool).await.unwrap(), None);
}

#[tokio::test]
async fn effective_public_url_uses_the_normalised_env_var_when_nothing_is_saved() {
    let _guard = EnvVarGuard::set(ENV, Some("https://env.example.com/"));
    let pool = init_db("sqlite::memory:").await.unwrap();
    assert_eq!(
        effective_public_url(&pool).await.unwrap().as_deref(),
        Some("https://env.example.com")
    );
}

#[tokio::test]
async fn effective_public_url_prefers_the_saved_url_over_the_env_var() {
    let _guard = EnvVarGuard::set(ENV, Some("https://env.example.com"));
    let pool = init_db("sqlite::memory:").await.unwrap();
    set_public_url(&pool, Some("https://settings.example.com"))
        .await
        .unwrap();
    assert_eq!(
        effective_public_url(&pool).await.unwrap().as_deref(),
        Some("https://settings.example.com")
    );
}

#[tokio::test]
async fn effective_public_url_ignores_an_invalid_env_var() {
    let _guard = EnvVarGuard::set(ENV, Some("books.example.com"));
    let pool = init_db("sqlite::memory:").await.unwrap();
    assert_eq!(effective_public_url(&pool).await.unwrap(), None);
}

#[tokio::test]
async fn effective_public_url_propagates_a_db_error_when_the_pool_is_closed() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    pool.close().await;
    let err = effective_public_url(&pool).await.unwrap_err();
    assert!(matches!(err, SettingsError::Db(_)));
}

#[tokio::test]
async fn public_url_status_reports_none_when_nothing_is_configured() {
    let _guard = EnvVarGuard::set(ENV, None);
    let pool = init_db("sqlite::memory:").await.unwrap();
    let status = public_url_status(&pool).await.unwrap();
    assert_eq!(status.url, None);
    assert_eq!(status.source, PublicUrlSource::None);
}

#[tokio::test]
async fn public_url_status_reports_env_when_only_the_env_var_is_set() {
    let _guard = EnvVarGuard::set(ENV, Some("https://env.example.com"));
    let pool = init_db("sqlite::memory:").await.unwrap();
    let status = public_url_status(&pool).await.unwrap();
    assert_eq!(status.url.as_deref(), Some("https://env.example.com"));
    assert_eq!(status.source, PublicUrlSource::Env);
}

#[tokio::test]
async fn public_url_status_reports_settings_when_a_url_is_saved() {
    let _guard = EnvVarGuard::set(ENV, Some("https://env.example.com"));
    let pool = init_db("sqlite::memory:").await.unwrap();
    set_public_url(&pool, Some("https://settings.example.com"))
        .await
        .unwrap();
    let status = public_url_status(&pool).await.unwrap();
    assert_eq!(status.url.as_deref(), Some("https://settings.example.com"));
    assert_eq!(status.source, PublicUrlSource::Settings);
}

#[tokio::test]
async fn public_url_status_propagates_a_db_error_when_the_pool_is_closed() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    pool.close().await;
    let err = public_url_status(&pool).await.unwrap_err();
    assert!(matches!(err, SettingsError::Db(_)));
}

#[tokio::test]
async fn seed_public_url_from_env_writes_the_normalised_env_value_when_nothing_is_saved() {
    let _guard = EnvVarGuard::set(ENV, Some("https://env.example.com/omnibus/"));
    let pool = init_db("sqlite::memory:").await.unwrap();
    seed_public_url_from_env(&pool).await.unwrap();
    assert_eq!(
        get_public_url(&pool).await.unwrap().as_deref(),
        Some("https://env.example.com/omnibus")
    );
}

#[tokio::test]
async fn seed_public_url_from_env_leaves_a_saved_url_intact() {
    let _guard = EnvVarGuard::set(ENV, Some("https://env.example.com"));
    let pool = init_db("sqlite::memory:").await.unwrap();
    set_public_url(&pool, Some("https://settings.example.com"))
        .await
        .unwrap();
    seed_public_url_from_env(&pool).await.unwrap();
    assert_eq!(
        get_public_url(&pool).await.unwrap().as_deref(),
        Some("https://settings.example.com")
    );
}

#[tokio::test]
async fn seed_public_url_from_env_skips_an_invalid_env_value_without_failing() {
    let _guard = EnvVarGuard::set(ENV, Some("ftp://env.example.com"));
    let pool = init_db("sqlite::memory:").await.unwrap();
    seed_public_url_from_env(&pool).await.unwrap();
    assert_eq!(get_public_url(&pool).await.unwrap(), None);
}

#[tokio::test]
async fn seed_public_url_from_env_is_a_no_op_when_the_env_var_is_unset() {
    let _guard = EnvVarGuard::set(ENV, None);
    let pool = init_db("sqlite::memory:").await.unwrap();
    seed_public_url_from_env(&pool).await.unwrap();
    assert_eq!(get_public_url(&pool).await.unwrap(), None);
}

#[tokio::test]
async fn seed_public_url_from_env_propagates_a_db_error_when_the_pool_is_closed() {
    let _guard = EnvVarGuard::set(ENV, Some("https://env.example.com"));
    let pool = init_db("sqlite::memory:").await.unwrap();
    pool.close().await;
    let err = seed_public_url_from_env(&pool).await.unwrap_err();
    assert!(matches!(err, SettingsError::Db(_)));
}

#[test]
fn warn_once_should_warn_returns_true_the_first_time_a_value_is_seen() {
    let gate = WarnOnce::new();
    assert!(gate.should_warn("books.example.com"));
}

#[test]
fn warn_once_should_warn_returns_false_for_a_repeat_of_the_last_value() {
    let gate = WarnOnce::new();
    gate.should_warn("books.example.com");
    assert!(!gate.should_warn("books.example.com"));
}

#[test]
fn warn_once_should_warn_returns_true_for_a_different_value() {
    let gate = WarnOnce::new();
    gate.should_warn("books.example.com");
    assert!(gate.should_warn("ftp://books.example.com"));
}

#[test]
fn warn_once_should_warn_returns_true_for_an_earlier_value_after_a_different_one() {
    let gate = WarnOnce::new();
    gate.should_warn("books.example.com");
    gate.should_warn("ftp://books.example.com");
    assert!(gate.should_warn("books.example.com"));
}

#[test]
fn warn_once_should_warn_returns_true_when_the_lock_is_poisoned() {
    let gate = WarnOnce::new();
    gate.should_warn("books.example.com");
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _held = gate.last.lock().unwrap();
        panic!("poison the lock");
    }));
    assert!(gate.last.is_poisoned());
    assert!(gate.should_warn("books.example.com"));
}
