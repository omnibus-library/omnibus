//! The book-request connections: the round trip with both secrets masked, a `None`
//! secret keeping the saved one and `""` clearing it, the Prowlarr key's env fallback,
//! the kind default, an empty category meaning none,, and validation rejecting a bad write whole.

use super::super::*;
use crate::pool::init_db;
use crate::test_support::EnvVarGuard;

fn update() -> RequestsSettingsUpdate {
    RequestsSettingsUpdate {
        prowlarr_url: "http://prowlarr:9696".into(),
        prowlarr_api_key: Some("prowlarr-key-123456".into()),
        download_client_kind: DownloadClientKind::Qbittorrent,
        download_client_url: "http://qbittorrent:8080".into(),
        download_client_username: "admin".into(),
        download_client_password: Some("hunter2-hunter2".into()),
        download_client_category: "books".into(),
        download_client_path_prefix: "/downloads".into(),
        download_path_prefix: "/mnt/completed".into(),
    }
}

mod set_requests_settings {
    use super::*;

    #[tokio::test]
    async fn stores_every_field_and_masks_both_secrets() {
        let _env = EnvVarGuard::set("OMNIBUS_PROWLARR_API_KEY", None);
        let pool = init_db("sqlite::memory:").await.unwrap();
        set_requests_settings(&pool, &update()).await.unwrap();

        let status = requests_settings_status(&pool).await.unwrap();

        let expected = RequestsSettingsStatus {
            prowlarr_url: Some("http://prowlarr:9696".into()),
            prowlarr_api_key_masked: Some("prow\u{2026}3456".into()),
            prowlarr_api_key_source: "settings".into(),
            download_client_kind: DownloadClientKind::Qbittorrent,
            download_client_url: Some("http://qbittorrent:8080".into()),
            download_client_username: Some("admin".into()),
            download_client_password_masked: Some("\u{2022}\u{2022}\u{2022}\u{2022}".into()),
            download_client_category: "books".into(),
            download_client_path_prefix: Some("/downloads".into()),
            download_path_prefix: Some("/mnt/completed".into()),
        };
        assert_eq!(status, expected);
    }

    #[tokio::test]
    async fn keeps_an_empty_category_empty_rather_than_falling_back_to_a_default() {
        let _env = EnvVarGuard::set("OMNIBUS_PROWLARR_API_KEY", None);
        let pool = init_db("sqlite::memory:").await.unwrap();
        set_requests_settings(&pool, &update()).await.unwrap();
        let mut next = update();
        next.download_client_category = String::new();

        set_requests_settings(&pool, &next).await.unwrap();

        let config = effective_requests_config(&pool).await.unwrap();
        assert_eq!(config.download_client_category, "");
    }

    #[tokio::test]
    async fn keeps_saved_secrets_when_they_are_none() {
        let _env = EnvVarGuard::set("OMNIBUS_PROWLARR_API_KEY", None);
        let pool = init_db("sqlite::memory:").await.unwrap();
        set_requests_settings(&pool, &update()).await.unwrap();
        let mut next = update();
        next.download_client_url = "http://qbit2:8080".into();
        next.prowlarr_api_key = None;
        next.download_client_password = None;

        set_requests_settings(&pool, &next).await.unwrap();

        let config = effective_requests_config(&pool).await.unwrap();
        assert_eq!(
            config.download_client_url.as_deref(),
            Some("http://qbit2:8080")
        );
        assert_eq!(
            config.prowlarr_api_key.as_deref(),
            Some("prowlarr-key-123456")
        );
        assert_eq!(
            config.download_client_password.as_deref(),
            Some("hunter2-hunter2")
        );
    }

    #[tokio::test]
    async fn clears_saved_secrets_when_they_are_empty() {
        let _env = EnvVarGuard::set("OMNIBUS_PROWLARR_API_KEY", None);
        let pool = init_db("sqlite::memory:").await.unwrap();
        set_requests_settings(&pool, &update()).await.unwrap();
        let mut next = update();
        next.prowlarr_api_key = Some(String::new());
        next.download_client_password = Some(String::new());

        set_requests_settings(&pool, &next).await.unwrap();

        let status = requests_settings_status(&pool).await.unwrap();
        assert_eq!(status.prowlarr_api_key_masked, None);
        assert_eq!(status.prowlarr_api_key_source, "none");
        assert_eq!(status.download_client_password_masked, None);
    }

    #[tokio::test]
    async fn stores_a_password_exactly_as_typed_whitespace_included() {
        let _env = EnvVarGuard::set("OMNIBUS_PROWLARR_API_KEY", None);
        let pool = init_db("sqlite::memory:").await.unwrap();
        for typed in [" pw ", " "] {
            let mut next = update();
            next.download_client_password = Some(typed.into());

            set_requests_settings(&pool, &next).await.unwrap();

            let config = effective_requests_config(&pool).await.unwrap();
            assert_eq!(config.download_client_password.as_deref(), Some(typed));
        }
    }

    #[tokio::test]
    async fn reports_the_password_only_as_set_without_any_of_its_characters() {
        let _env = EnvVarGuard::set("OMNIBUS_PROWLARR_API_KEY", None);
        let pool = init_db("sqlite::memory:").await.unwrap();
        let mut next = update();
        next.download_client_password = Some("hunter2-hunter2".into());
        set_requests_settings(&pool, &next).await.unwrap();

        let status = requests_settings_status(&pool).await.unwrap();

        let masked = status.download_client_password_masked.unwrap();
        assert!(!masked.chars().any(|c| "hunter2-".contains(c)), "{masked}");
    }

    #[tokio::test]
    async fn clears_a_plain_field_when_it_is_empty() {
        let _env = EnvVarGuard::set("OMNIBUS_PROWLARR_API_KEY", None);
        let pool = init_db("sqlite::memory:").await.unwrap();
        set_requests_settings(&pool, &update()).await.unwrap();
        let mut next = update();
        next.prowlarr_url = String::new();

        set_requests_settings(&pool, &next).await.unwrap();

        let status = requests_settings_status(&pool).await.unwrap();
        assert_eq!(status.prowlarr_url, None);
    }

    mod validation {
        use super::*;

        async fn rejects_and_writes_nothing(bad: RequestsSettingsUpdate) {
            let _env = EnvVarGuard::set("OMNIBUS_PROWLARR_API_KEY", None);
            let pool = init_db("sqlite::memory:").await.unwrap();
            let before = requests_settings_status(&pool).await.unwrap();

            let err = set_requests_settings(&pool, &bad).await.unwrap_err();

            assert!(matches!(err, SettingsError::Validation(_)));
            assert_eq!(requests_settings_status(&pool).await.unwrap(), before);
        }

        #[tokio::test]
        async fn rejects_a_url_that_is_not_http() {
            let mut bad = update();
            bad.prowlarr_url = "ftp://prowlarr".into();
            rejects_and_writes_nothing(bad).await;
        }

        #[tokio::test]
        async fn rejects_a_url_with_credentials_in_it() {
            let mut bad = update();
            bad.download_client_url = "http://admin:hunter2@qbittorrent:8080".into();
            rejects_and_writes_nothing(bad).await;
        }

        #[tokio::test]
        async fn rejects_a_field_over_its_length_cap() {
            let mut bad = update();
            bad.download_client_category = "c".repeat(REQUESTS_FIELD_MAX_LEN + 1);
            rejects_and_writes_nothing(bad).await;
        }

        #[tokio::test]
        async fn rejects_a_secret_over_its_length_cap() {
            let mut bad = update();
            bad.prowlarr_api_key = Some("k".repeat(REQUESTS_SECRET_MAX_LEN + 1));
            rejects_and_writes_nothing(bad).await;
        }

        #[tokio::test]
        async fn accepts_a_field_exactly_at_its_length_cap() {
            let _env = EnvVarGuard::set("OMNIBUS_PROWLARR_API_KEY", None);
            let pool = init_db("sqlite::memory:").await.unwrap();
            let mut at_cap = update();
            at_cap.download_client_username = "u".repeat(REQUESTS_FIELD_MAX_LEN);

            set_requests_settings(&pool, &at_cap).await.unwrap();
        }
    }
}

mod requests_settings_status {
    use super::*;

    #[tokio::test]
    async fn defaults_the_kind_and_no_category_when_nothing_is_saved() {
        let _env = EnvVarGuard::set("OMNIBUS_PROWLARR_API_KEY", None);
        let pool = init_db("sqlite::memory:").await.unwrap();

        let status = requests_settings_status(&pool).await.unwrap();

        assert_eq!(status.download_client_category, "");
        assert_eq!(status.download_client_kind, DownloadClientKind::Qbittorrent);
        assert_eq!(status.prowlarr_url, None);
    }

    #[tokio::test]
    async fn reports_the_env_key_when_nothing_is_saved() {
        let _env = EnvVarGuard::set("OMNIBUS_PROWLARR_API_KEY", Some("env-prowlarr-key-9999"));
        let pool = init_db("sqlite::memory:").await.unwrap();

        let status = requests_settings_status(&pool).await.unwrap();

        assert_eq!(status.prowlarr_api_key_source, "env");
        assert_eq!(
            status.prowlarr_api_key_masked.as_deref(),
            Some("env-\u{2026}9999")
        );
    }

    #[tokio::test]
    async fn prefers_the_saved_key_over_the_env_key() {
        let _env = EnvVarGuard::set("OMNIBUS_PROWLARR_API_KEY", Some("env-prowlarr-key-9999"));
        let pool = init_db("sqlite::memory:").await.unwrap();
        set_requests_settings(&pool, &update()).await.unwrap();

        let status = requests_settings_status(&pool).await.unwrap();
        let config = effective_requests_config(&pool).await.unwrap();

        assert_eq!(status.prowlarr_api_key_source, "settings");
        assert_eq!(
            config.prowlarr_api_key.as_deref(),
            Some("prowlarr-key-123456")
        );
    }
}
