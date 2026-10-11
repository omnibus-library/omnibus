//! Coalesce keys, temp-id remapping, and progress coalescing in the queue.

use omnibus_shared::{HighlightColor, ProgressFormat, ProgressUpdate};

use super::*;

fn progress_update(uuid: &str) -> ProgressUpdate {
    ProgressUpdate {
        book_uuid: uuid.to_string(),
        format: ProgressFormat::Epub,
        epub_cfi: Some("epubcfi(/6/4!/4/2/1:0)".into()),
        audio_position_seconds: None,
        progress_percent: None,
        kobo_location: None,
        book_file_id: None,
        client_updated_at: None,
    }
}

#[test]
fn coalesce_keys_group_upserts_and_keep_partial_patches_distinct() {
    let progress = Op::SaveProgress {
        update: progress_update("u1"),
        captured_at: 1,
    };
    assert_eq!(progress.coalesce_key().as_deref(), Some("prog:u1:epub"));

    let set = Op::SetRating {
        update: omnibus_shared::RatingUpdate {
            book_uuid: "u1".into(),
            stars: 4.0,
        },
    };
    let clear = Op::ClearRating { uuid: "u1".into() };
    // Set-then-clear (or vice versa) must collapse to the latest intent.
    assert_eq!(set.coalesce_key(), clear.coalesce_key());

    // Partial shelf patches must never coalesce — a rename followed by a
    // visibility change are two independent steps.
    let shelf_patch = Op::UpdateShelf {
        id: 3,
        req: omnibus_shared::UpdateShelfRequest {
            name: Some("New".into()),
            description: None,
            visibility: None,
            match_mode: None,
            rules: None,
            sync_to_kobo: None,
        },
    };
    assert_eq!(shelf_patch.coalesce_key(), None);
}

#[test]
fn remap_id_rewrites_only_matching_references() {
    let mut edit = Op::UpdateHighlightColor {
        id: -3,
        book_uuid: "u1".into(),
        color: HighlightColor::Blue,
    };
    assert!(edit.remap_id(-3, 42));
    assert!(matches!(edit, Op::UpdateHighlightColor { id: 42, .. }));
    assert!(!edit.remap_id(-3, 99));

    let mut add = Op::AddShelfBooks {
        shelf_id: -5,
        book_uuids: vec!["u1".into()],
    };
    assert!(add.remap_id(-5, 7));
    assert!(matches!(add, Op::AddShelfBooks { shelf_id: 7, .. }));

    // Creates never remap (they *produce* the id).
    let mut create = Op::CreateHighlight {
        temp_id: -3,
        input: CreateHighlight {
            client_id: None,
            book_uuid: "u1".into(),
            epub_cfi_range: "epubcfi(/6/4!/4/2,/1:0,/1:5)".into(),
            color: HighlightColor::Amber,
            text: None,
        },
    };
    assert!(!create.remap_id(-3, 42));
}

#[tokio::test]
async fn progress_coalesces_per_book_and_format_in_the_queue() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;

    queue_save_progress(&progress_update("book-a"))
        .await
        .expect("q1");
    queue_save_progress(&progress_update("book-b"))
        .await
        .expect("q2");
    let mut newer = progress_update("book-a");
    newer.epub_cfi = Some("epubcfi(/6/12!/4/8/3:7)".into());
    queue_save_progress(&newer).await.expect("q3");

    let st = store::store().expect("store");
    let ops = st.ops_list().await;
    assert_eq!(ops.len(), 2, "same (book, format) coalesces");
    let last: Op = serde_json::from_str(&ops[1].payload).expect("op");
    match last {
        Op::SaveProgress { update, .. } => {
            assert_eq!(update.book_uuid, "book-a");
            assert_eq!(update.epub_cfi.as_deref(), Some("epubcfi(/6/12!/4/8/3:7)"));
        }
        other => panic!("expected SaveProgress, got {other:?}"),
    }
    clear_ops().await;
}
