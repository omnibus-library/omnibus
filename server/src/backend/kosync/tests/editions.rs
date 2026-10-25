//! A book holding two EPUB editions, as a merge leaves one: a KOReader names the edition it
//! holds by its digest, and a precise position only crosses between devices on the same one.

use super::*;
use crate::backend::koreader::test_support::CHAPTER_TWO;

/// The first chapter as the second edition prints it, so its file and digest differ.
const CHAPTER_ONE_REVISED: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body><p>A revised opening.</p><p>With a new paragraph.</p></body></html>"#;

/// [`seeded_book`] plus a second EPUB file of the same book, after the first by ordinal;
/// returns `(uuid, first edition's document, second edition's document)`.
async fn two_edition_book(r: &Reader) -> (String, String, String) {
    let (uuid, first, file) = seeded_book(r).await;
    let second_file = file.with_file_name("second.epub");
    std::fs::write(
        &second_file,
        db::test_support::build_test_epub(&[
            ("c1.xhtml", CHAPTER_ONE_REVISED),
            ("c2.xhtml", CHAPTER_TWO),
        ]),
    )
    .unwrap();
    let second = db::partial_md5::partial_md5(&second_file).unwrap();
    sqlx::query(
        "INSERT INTO book_files (book_id, format, filename, size_bytes, mtime_epoch, ordinal, \
                                 partial_md5) \
         SELECT book_id, 'EPUB', 'second', 4, 1, ordinal + 1, ? FROM book_files",
    )
    .bind(&second)
    .execute(&r.pool)
    .await
    .unwrap();
    (uuid, first, second)
}

async fn pull(r: &Reader, document: &str) -> Value {
    let uri = format!("/kosync/syncs/progress/{document}");
    body_json(send(r, "GET", &uri, None).await).await
}

#[tokio::test]
async fn put_syncs_progress_from_a_second_edition_stores_the_percent_without_a_cfi() {
    let r = reader().await;
    let (uuid, _first, second) = two_edition_book(&r).await;

    let res = send(
        &r,
        "PUT",
        "/kosync/syncs/progress",
        Some(push_body(&second, SECOND_PARAGRAPH_XPOINTER, 0.6378)),
    )
    .await;

    assert_eq!(res.status(), StatusCode::OK);
    let epub = web_epub(&r, &uuid).await.unwrap();
    assert_eq!((epub.epub_cfi, epub.progress_percent), (None, Some(63)));
}

#[tokio::test]
async fn get_syncs_progress_hands_a_second_edition_its_own_xpointer_back() {
    let r = reader().await;
    let (_uuid, _first, second) = two_edition_book(&r).await;
    let body = push_body(&second, SECOND_PARAGRAPH_XPOINTER, 0.6378);
    send(&r, "PUT", "/kosync/syncs/progress", Some(body)).await;

    let body = pull(&r, &second).await;

    assert_eq!(body["progress"], SECOND_PARAGRAPH_XPOINTER);
}

#[tokio::test]
async fn get_syncs_progress_answers_nothing_to_another_edition_than_the_push_came_from() {
    let r = reader().await;
    let (_uuid, first, second) = two_edition_book(&r).await;
    let body = push_body(&first, SECOND_PARAGRAPH_XPOINTER, 0.6378);
    send(&r, "PUT", "/kosync/syncs/progress", Some(body)).await;

    assert_eq!(pull(&r, &second).await, json!({}));
}

#[tokio::test]
async fn get_syncs_progress_never_hands_the_first_edition_a_second_editions_xpointer() {
    let r = reader().await;
    let (_uuid, first, second) = two_edition_book(&r).await;
    let body = push_body(&second, SECOND_PARAGRAPH_XPOINTER, 0.6378);
    send(&r, "PUT", "/kosync/syncs/progress", Some(body)).await;

    // An unmeasured book: with no CFI either, there is no position for the first edition.
    assert_eq!(pull(&r, &first).await, json!({}));
}
