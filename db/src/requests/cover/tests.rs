use sqlx::SqlitePool;

use omnibus_shared::RequestKind;

use crate::requests::store::{self, RequestRow};
use crate::requests::test_support::{seed_picked, update};
use crate::test_support::{solid_color_png, CoversTempDir};
use crate::{create_fileless_book, write_override_cover, FilelessBook, FilelessCover};

use super::*;

async fn pool() -> SqlitePool {
    crate::pool::init_db("sqlite::memory:").await.unwrap()
}

/// A fileless book titled `title` whose cover, when it has one, is a PNG of `size` pixels.
async fn book(pool: &SqlitePool, title: &str, size: Option<(u32, u32)>) -> String {
    let book = FilelessBook {
        title: title.to_string(),
        authors: vec!["Frank Herbert".to_string()],
        isbn: None,
        pubdate: None,
        description: None,
        cover: size.map(|(w, h)| FilelessCover {
            mime: "image/png".to_string(),
            bytes: solid_color_png(10, 10, 200, w, h),
        }),
    };
    create_fileless_book(pool, book).await.unwrap()
}

/// A ready request for a book with a cover of `current` pixels, whose download was scanned in
/// as a book with a cover of `candidate` pixels (none when the download had no cover).
async fn ready_request(
    pool: &SqlitePool,
    current: (u32, u32),
    candidate: Option<(u32, u32)>,
) -> RequestRow {
    let wished = book(pool, "Dune", Some(current)).await;
    let downloaded = book(pool, "Dune (download)", candidate).await;
    let id = seed_picked(pool, "ada", &wished, RequestKind::Ebook, "ready").await;
    update(pool, id, &format!("cover_candidate = '{downloaded}'")).await;
    store::get(pool, id).await.unwrap().unwrap()
}

mod offer {
    use super::*;

    #[tokio::test]
    async fn returns_both_sizes_when_the_download_cover_has_more_pixels() {
        let _covers = CoversTempDir::new("cover_offer_larger");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), Some((40, 60))).await;

        let offered = offer(&pool, &row).await.unwrap();

        let expected = CoverOffer {
            width: 40,
            height: 60,
            current_width: 20,
            current_height: 30,
        };
        assert_eq!(offered, Some(expected));
    }

    #[tokio::test]
    async fn returns_none_when_the_download_cover_has_the_same_pixel_area() {
        let _covers = CoversTempDir::new("cover_offer_equal");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), Some((30, 20))).await;

        assert_eq!(offer(&pool, &row).await.unwrap(), None);
    }

    #[tokio::test]
    async fn returns_none_when_the_download_had_no_cover() {
        let _covers = CoversTempDir::new("cover_offer_no_cover");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), None).await;

        assert_eq!(offer(&pool, &row).await.unwrap(), None);
    }

    #[tokio::test]
    async fn returns_none_when_the_request_is_not_ready() {
        let _covers = CoversTempDir::new("cover_offer_not_ready");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), Some((40, 60))).await;
        update(&pool, row.id, "state = 'stuck'").await;
        let row = store::get(&pool, row.id).await.unwrap().unwrap();

        assert_eq!(offer(&pool, &row).await.unwrap(), None);
    }

    #[tokio::test]
    async fn returns_none_when_no_candidate_is_recorded() {
        let _covers = CoversTempDir::new("cover_offer_settled");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), Some((40, 60))).await;
        update(&pool, row.id, "cover_candidate = NULL").await;
        let row = store::get(&pool, row.id).await.unwrap().unwrap();

        assert_eq!(offer(&pool, &row).await.unwrap(), None);
    }

    #[tokio::test]
    async fn compares_against_an_uploaded_cover_when_the_book_has_one() {
        let _covers = CoversTempDir::new("cover_offer_override");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), Some((40, 60))).await;
        let upload = solid_color_png(200, 10, 10, 80, 120);
        write_override_cover(&row.book_uuid, "image/png", &upload).unwrap();
        sqlx::query("INSERT INTO metadata_overrides (book_uuid, has_cover_override) VALUES (?, 1)")
            .bind(&row.book_uuid)
            .execute(&pool)
            .await
            .unwrap();

        assert_eq!(offer(&pool, &row).await.unwrap(), None);
    }
}

mod settle {
    use super::*;

    #[tokio::test]
    async fn clears_the_candidate_it_was_given() {
        let _covers = CoversTempDir::new("cover_settle");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), Some((40, 60))).await;
        let candidate = row.cover_candidate.clone().unwrap();

        settle(&pool, row.id, &candidate).await.unwrap();

        let after = store::get(&pool, row.id).await.unwrap().unwrap();
        assert_eq!(after.cover_candidate, None);
    }

    #[tokio::test]
    async fn refuses_with_wrong_state_once_the_candidate_is_gone() {
        let _covers = CoversTempDir::new("cover_settle_twice");
        let pool = pool().await;
        let row = ready_request(&pool, (20, 30), Some((40, 60))).await;
        let candidate = row.cover_candidate.clone().unwrap();
        settle(&pool, row.id, &candidate).await.unwrap();

        let again = settle(&pool, row.id, &candidate).await;

        assert!(matches!(again, Err(RequestError::WrongState)));
    }
}
