use std::path::PathBuf;

use omnibus_shared::RequestKind;
use sqlx::SqlitePool;

use crate::auth::test_support::pool;
use crate::requests::store::{self, RequestRow};
use crate::requests::test_support::{seed_picked, update};
use crate::test_support::{
    assemble_test_epub, book_with_png_cover, solid_color_png, CoversTempDir,
};
use crate::write_override_cover;

use super::*;

/// A `ready` request for a book whose cover is `current` pixels, with `candidate` (when given)
/// kept as its candidate file.
async fn ready_request(
    pool: &SqlitePool,
    current: (u32, u32),
    candidate: Option<Vec<u8>>,
) -> RequestRow {
    let wished = book_with_png_cover(pool, "Dune", "Frank Herbert", Some(current)).await;
    let id = seed_picked(pool, "ada", &wished, RequestKind::Ebook, "ready").await;
    if let Some(bytes) = candidate {
        crate::covers::write_cover_file(&candidate_name(id), "image/png", &bytes).unwrap();
        update(
            pool,
            id,
            &format!("cover_candidate = '{}'", candidate_name(id)),
        )
        .await;
    }
    store::get(pool, id).await.unwrap().unwrap()
}

fn png(width: u32, height: u32) -> Vec<u8> {
    solid_color_png(200, 10, 10, width, height)
}

/// An EPUB in a scratch folder whose declared cover is `cover` (none when `None`).
fn epub_with(dir: &tempfile::TempDir, cover: Option<Vec<u8>>) -> PathBuf {
    let manifest =
        r#"<item id="cv" href="cover.png" media-type="image/png" properties="cover-image"/>"#;
    let bytes = match cover {
        Some(cover) => assemble_test_epub(
            &[("c1.xhtml", "<p>hi</p>")],
            manifest,
            "",
            &[("cover.png", cover)],
        ),
        None => assemble_test_epub(&[("c1.xhtml", "<p>hi</p>")], "", "", &[]),
    };
    let path = dir.path().join("dune.epub");
    std::fs::write(&path, bytes).unwrap();
    path
}

async fn candidate_of(pool: &SqlitePool, id: i64) -> Option<String> {
    store::get(pool, id).await.unwrap().unwrap().cover_candidate
}

mod offer {
    use super::*;

    #[tokio::test]
    async fn returns_both_sizes_and_the_cover_when_the_candidate_has_more_pixels() {
        let _covers = CoversTempDir::new("cover_offer_larger");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), Some(png(40, 60))).await;

        let offered = offer(&pool, &row).await.unwrap().unwrap();

        let sizes = CoverOffer {
            width: 40,
            height: 60,
            current_width: 20,
            current_height: 30,
        };
        assert_eq!(offered.sizes, sizes);
        assert_eq!(offered.mime, "image/png");
        assert_eq!(offered.bytes, png(40, 60));
    }

    #[tokio::test]
    async fn returns_none_when_the_candidate_has_the_same_pixel_area() {
        let _covers = CoversTempDir::new("cover_offer_equal");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), Some(png(30, 20))).await;

        assert_eq!(offer(&pool, &row).await.unwrap(), None);
    }

    #[tokio::test]
    async fn returns_none_when_the_candidate_file_is_gone() {
        let _covers = CoversTempDir::new("cover_offer_no_file");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), None).await;
        update(&pool, row.id, "cover_candidate = 'request-1'").await;
        let row = store::get(&pool, row.id).await.unwrap().unwrap();

        assert_eq!(offer(&pool, &row).await.unwrap(), None);
    }

    #[tokio::test]
    async fn returns_none_when_the_request_is_not_ready() {
        let _covers = CoversTempDir::new("cover_offer_not_ready");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), Some(png(40, 60))).await;
        update(&pool, row.id, "state = 'stuck'").await;
        let row = store::get(&pool, row.id).await.unwrap().unwrap();

        assert_eq!(offer(&pool, &row).await.unwrap(), None);
    }

    #[tokio::test]
    async fn returns_none_when_no_candidate_is_recorded() {
        let _covers = CoversTempDir::new("cover_offer_settled");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), Some(png(40, 60))).await;
        update(&pool, row.id, "cover_candidate = NULL").await;
        let row = store::get(&pool, row.id).await.unwrap().unwrap();

        assert_eq!(offer(&pool, &row).await.unwrap(), None);
    }

    #[tokio::test]
    async fn returns_none_when_the_candidate_is_not_an_image() {
        let _covers = CoversTempDir::new("cover_offer_not_image");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), Some(b"not an image at all".to_vec())).await;

        assert_eq!(offer(&pool, &row).await.unwrap(), None);
    }

    #[tokio::test]
    async fn returns_none_when_the_candidate_is_over_the_size_cap() {
        let _covers = CoversTempDir::new("cover_offer_oversized");
        let pool = pool().await;
        let mut oversized = png(40, 60);
        oversized.resize(MAX_IMAGE_BYTES + 1, 0);
        let row = ready_request(&pool, (20, 30), Some(oversized)).await;

        assert_eq!(offer(&pool, &row).await.unwrap(), None);
    }

    #[tokio::test]
    async fn compares_against_an_uploaded_cover_when_the_book_has_one() {
        let _covers = CoversTempDir::new("cover_offer_override");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), Some(png(40, 60))).await;
        write_override_cover(&row.book_uuid, "image/png", &png(80, 120)).unwrap();
        sqlx::query("INSERT INTO metadata_overrides (book_uuid, has_cover_override) VALUES (?, 1)")
            .bind(&row.book_uuid)
            .execute(&pool)
            .await
            .unwrap();

        assert_eq!(offer(&pool, &row).await.unwrap(), None);
    }

    #[tokio::test]
    async fn propagates_db_error_when_pool_is_closed() {
        let _covers = CoversTempDir::new("cover_offer_closed");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), Some(png(40, 60))).await;
        pool.close().await;

        let result = offer(&pool, &row).await;

        assert!(matches!(result, Err(RequestError::Books(_))));
    }
}

mod record_candidate {
    use super::*;

    #[tokio::test]
    async fn keeps_the_epubs_larger_cover_as_a_request_owned_file() {
        let _covers = CoversTempDir::new("cover_record_larger");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), None).await;
        let dir = tempfile::tempdir().unwrap();
        let epub = epub_with(&dir, Some(png(40, 60)));

        record_candidate(&pool, row.id, &epub, &row.book_uuid)
            .await
            .unwrap();

        let name = candidate_of(&pool, row.id).await.unwrap();
        assert_eq!(name, format!("request-{}", row.id));
        let (_, kept) = crate::covers::find_cover_file(&name).unwrap();
        assert_eq!(kept, png(40, 60));
    }

    #[tokio::test]
    async fn records_nothing_when_the_epub_has_no_cover() {
        let _covers = CoversTempDir::new("cover_record_none");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), None).await;
        let dir = tempfile::tempdir().unwrap();
        let epub = epub_with(&dir, None);

        record_candidate(&pool, row.id, &epub, &row.book_uuid)
            .await
            .unwrap();

        assert_eq!(candidate_of(&pool, row.id).await, None);
    }

    #[tokio::test]
    async fn records_nothing_when_the_cover_is_not_larger_than_the_books() {
        let _covers = CoversTempDir::new("cover_record_equal");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), None).await;
        let dir = tempfile::tempdir().unwrap();
        let epub = epub_with(&dir, Some(png(30, 20)));

        record_candidate(&pool, row.id, &epub, &row.book_uuid)
            .await
            .unwrap();

        assert_eq!(candidate_of(&pool, row.id).await, None);
        assert!(crate::covers::find_cover_file(&candidate_name(row.id)).is_none());
    }

    #[tokio::test]
    async fn propagates_db_error_when_pool_is_closed() {
        let _covers = CoversTempDir::new("cover_record_closed");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), None).await;
        let dir = tempfile::tempdir().unwrap();
        let epub = epub_with(&dir, Some(png(40, 60)));
        pool.close().await;

        let result = record_candidate(&pool, row.id, &epub, &row.book_uuid).await;

        assert!(matches!(result, Err(RequestError::Books(_))));
    }
}

mod settle {
    use super::*;

    #[tokio::test]
    async fn clears_the_candidate_it_was_given() {
        let _covers = CoversTempDir::new("cover_settle");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), Some(png(40, 60))).await;
        let candidate = row.cover_candidate.clone().unwrap();

        settle(&pool, row.id, &candidate).await.unwrap();

        assert_eq!(candidate_of(&pool, row.id).await, None);
    }

    #[tokio::test]
    async fn refuses_with_wrong_state_once_the_candidate_is_gone() {
        let _covers = CoversTempDir::new("cover_settle_twice");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), Some(png(40, 60))).await;
        let candidate = row.cover_candidate.clone().unwrap();
        settle(&pool, row.id, &candidate).await.unwrap();

        let again = settle(&pool, row.id, &candidate).await;

        assert!(matches!(again, Err(RequestError::WrongState)));
    }

    #[tokio::test]
    async fn propagates_db_error_when_pool_is_closed() {
        let _covers = CoversTempDir::new("cover_settle_closed");
        let pool = pool().await;
        pool.close().await;

        let result = settle(&pool, 1, "request-1").await;

        assert!(matches!(result, Err(RequestError::Db(_))));
    }
}

mod discard {
    use super::*;

    #[tokio::test]
    async fn deletes_the_candidate_file() {
        let _covers = CoversTempDir::new("cover_discard");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), Some(png(40, 60))).await;

        discard(row.id).await;

        assert!(crate::covers::find_cover_file(&candidate_name(row.id)).is_none());
    }
}
