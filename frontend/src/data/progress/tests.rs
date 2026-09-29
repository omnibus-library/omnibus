//! Mobile `recent_progress` transport tests: another reader's list is online-only and never touches the viewer's cache.
#![allow(clippy::await_holding_lock)]

use axum::extract::Query;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Json;
use omnibus_shared::{EbookMetadata, ProgressFormat, ProgressRecord};

use crate::offline::sync::test_state_lock;
use crate::offline::{cache, store, test_support::spawn_router};

use super::*;

fn stub_point(book_uuid: &str) -> ResumePoint {
    ResumePoint {
        record: ProgressRecord {
            book_uuid: book_uuid.to_string(),
            format: ProgressFormat::Epub,
            epub_cfi: None,
            audio_position_seconds: None,
            book_file_id: None,
            progress_percent: None,
            kobo_location: None,
            updated_at: 0,
            client_updated_at: 0,
            total_duration_seconds: None,
            resolved: None,
            derived_epub_cfi: None,
        },
        book: EbookMetadata::default(),
        linked: false,
        cross_format: None,
        audio_part: None,
        audio_part_count: None,
        playback_rate: None,
    }
}

/// Serve `/api/progress/recent`, answering 200 with `points` only when the
/// query carries `user_id={want}`; a 404 otherwise.
async fn spawn_recent_progress_gate(want: i64, points: Vec<ResumePoint>) -> String {
    let app = axum::Router::new().route(
        "/api/progress/recent",
        get(
            move |Query(params): Query<std::collections::HashMap<String, String>>| {
                let points = points.clone();
                async move {
                    match params.get("user_id").and_then(|v| v.parse::<i64>().ok()) {
                        Some(id) if id == want => Json(points).into_response(),
                        _ => (StatusCode::NOT_FOUND, "wrong user_id").into_response(),
                    }
                }
            },
        ),
    );
    spawn_router(app).await
}

#[tokio::test]
async fn recent_progress_for_another_reader_is_offline_and_never_touches_the_cache() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let key = cache::keys::recent_progress(3);
    let mine = vec![stub_point("mine")];
    cache::put_json(&key, &mine);
    crate::offline::sync::note_offline();

    let err = recent_progress("http://127.0.0.1:1", 3, Some(9))
        .await
        .expect_err("must fast-fail offline rather than read the cache");
    assert!(matches!(err, DataError::Offline));
    assert_eq!(cache::get_json::<Vec<ResumePoint>>(&key).await, Some(mine));

    crate::offline::sync::note_online();
}

#[tokio::test]
async fn recent_progress_for_another_reader_reads_online_and_leaves_the_viewers_cache_untouched() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let key = cache::keys::recent_progress(3);
    let mine = vec![stub_point("mine")];
    cache::put_json(&key, &mine);
    let base_url = spawn_recent_progress_gate(9, vec![stub_point("theirs")]).await;

    let got = recent_progress(&base_url, 3, Some(9))
        .await
        .expect("reads the target reader's open books");
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].record.book_uuid, "theirs");
    assert_eq!(cache::get_json::<Vec<ResumePoint>>(&key).await, Some(mine));
}
