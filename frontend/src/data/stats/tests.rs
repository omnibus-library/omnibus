use super::*;

#[test]
fn is_not_sharing_is_true_for_a_404_and_for_the_contract_message() {
    assert!(is_not_sharing(&DataError::Http {
        status: 404,
        body: String::new(),
    }));
    assert!(is_not_sharing(&DataError::Other(
        "this reader isn't sharing their stats".to_string()
    )));
}

#[test]
fn is_not_sharing_is_false_for_every_other_failure() {
    assert!(!is_not_sharing(&DataError::Http {
        status: 500,
        body: String::new(),
    }));
    assert!(!is_not_sharing(&DataError::Other("boom".to_string())));
    assert!(!is_not_sharing(&DataError::Unauthorized));
    assert!(!is_not_sharing(&DataError::Offline));
}

// Mobile-only: the cache-bypass policy for another reader's stats, driven
// against a real loopback server per `offline::test_support`.
#[cfg(feature = "mobile")]
mod mobile {
    #![allow(clippy::await_holding_lock)]

    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    use axum::extract::Query;
    use axum::http::{StatusCode, Uri};
    use axum::response::IntoResponse;
    use axum::routing::get;
    use axum::Json;
    use omnibus_shared::HouseholdReader;

    use crate::offline::sync::test_state_lock;
    use crate::offline::{cache, store, test_support::spawn_router};

    use super::*;

    fn stub_summary(streak: i64) -> StatsSummary {
        StatsSummary {
            current_streak_days: streak,
            ..StatsSummary::default()
        }
    }

    /// Serve `/api/stats`, answering 200 with `summary` only when the query
    /// carries `user_id={want}`; a 404 otherwise.
    async fn spawn_stats_gate(want: i64, summary: StatsSummary) -> String {
        let app = axum::Router::new().route(
            "/api/stats",
            get(move |Query(params): Query<HashMap<String, String>>| {
                let summary = summary.clone();
                async move {
                    match params.get("user_id").and_then(|v| v.parse::<i64>().ok()) {
                        Some(id) if id == want => Json(summary).into_response(),
                        _ => (StatusCode::NOT_FOUND, "wrong user_id").into_response(),
                    }
                }
            }),
        );
        spawn_router(app).await
    }

    #[tokio::test]
    async fn fetch_stats_for_another_reader_is_offline_and_never_touches_the_cache() {
        store::init_global_for_tests();
        let _guard = test_state_lock().lock().unwrap();
        let key = cache::keys::stats("month");
        let mine = stub_summary(3);
        cache::put_json(&key, &mine);
        crate::offline::sync::note_offline();

        let err = fetch_stats("http://127.0.0.1:1", StatsRange::Month, Some(9))
            .await
            .expect_err("must fast-fail offline rather than read the cache");
        assert!(matches!(err, DataError::Offline));
        assert_eq!(cache::get_json::<StatsSummary>(&key).await, Some(mine));

        crate::offline::sync::note_online();
    }

    #[tokio::test]
    async fn fetch_stats_for_another_reader_reads_online_and_leaves_the_viewers_cache_untouched() {
        store::init_global_for_tests();
        let _guard = test_state_lock().lock().unwrap();
        let key = cache::keys::stats("month");
        let mine = stub_summary(3);
        cache::put_json(&key, &mine);
        let base_url = spawn_stats_gate(9, stub_summary(9)).await;

        let got = fetch_stats(&base_url, StatsRange::Month, Some(9))
            .await
            .expect("reads the target reader's summary");
        assert_eq!(got.current_streak_days, 9);
        assert_eq!(cache::get_json::<StatsSummary>(&key).await, Some(mine));
    }

    #[tokio::test]
    async fn fetch_stats_with_no_user_id_sends_no_user_id_query_param() {
        store::init_global_for_tests();
        let _guard = test_state_lock().lock().unwrap();
        let key = cache::keys::stats("month");
        if let Some(store) = store::store() {
            store.kv_delete(&key);
        }
        let seen: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let seen_clone = seen.clone();
        let app = axum::Router::new().route(
            "/api/stats",
            get(move |uri: Uri| {
                *seen_clone.lock().unwrap() = uri.query().map(str::to_string);
                async move { Json(stub_summary(1)).into_response() }
            }),
        );
        let base_url = spawn_router(app).await;

        fetch_stats(&base_url, StatsRange::Month, None)
            .await
            .expect("reads the caller's own summary");
        let query = seen.lock().unwrap().clone().unwrap_or_default();
        assert!(!query.contains("user_id"), "query was {query:?}");
        assert!(cache::get_json::<StatsSummary>(&key).await.is_some());
    }

    #[tokio::test]
    async fn household_readers_is_offline_when_known_offline() {
        crate::offline::store::init_global_for_tests();
        let _guard = test_state_lock().lock().unwrap();
        crate::offline::sync::note_offline();

        let err = household_readers("http://127.0.0.1:1")
            .await
            .expect_err("must fast-fail offline");
        assert!(matches!(err, DataError::Offline));

        crate::offline::sync::note_online();
    }

    #[tokio::test]
    async fn household_readers_reads_get_users_when_online() {
        crate::offline::store::init_global_for_tests();
        let _guard = test_state_lock().lock().unwrap();
        let readers = vec![HouseholdReader {
            id: 1,
            name: "You".to_string(),
            has_avatar: false,
            is_you: true,
        }];
        let readers_clone = readers.clone();
        let app = axum::Router::new().route(
            "/api/users",
            get(move || {
                let readers = readers_clone.clone();
                async move { Json(readers) }
            }),
        );
        let base_url = spawn_router(app).await;

        let got = household_readers(&base_url).await.expect("reads readers");
        assert_eq!(got, readers);
    }
}
