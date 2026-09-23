//! Dictionary order on the text axes: accents ignored with the plain spelling
//! first on a tie, every author keyed surname-first whatever form it arrived
//! in (scanned or typed into the editor), and a keyset walk across those keys
//! that neither skips nor repeats a row.

use omnibus_shared::{SortDir, SortKey, ViewFilters};
use sqlx::SqlitePool;

use super::super::*;
use super::{ids, insert_book, insert_lib, titles};
use crate::pool::init_db;

/// Insert a book whose scanned `author_sort` is `author_sort`.
async fn insert_by(pool: &SqlitePool, lib: i64, title: &str, author_sort: &str) -> i64 {
    let id = insert_book(pool, lib, title, Some(title), None, None).await;
    sqlx::query("UPDATE books SET author_sort = ? WHERE id = ?")
        .bind(author_sort)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    id
}

/// Re-attribute `book_id` through the editor, as a display name only.
async fn override_author(pool: &SqlitePool, book_id: i64, name: &str) {
    let json = serde_json::json!({ "creators": [{ "name": name }] });
    set_overrides(pool, book_id, json).await;
}

/// Write `json` as `book_id`'s override row.
async fn set_overrides(pool: &SqlitePool, book_id: i64, json: serde_json::Value) {
    let uuid: String = sqlx::query_scalar("SELECT uuid FROM books WHERE id = ?")
        .bind(book_id)
        .fetch_one(pool)
        .await
        .unwrap();
    let json = json.to_string();
    sqlx::query("INSERT INTO metadata_overrides (book_uuid, overrides) VALUES (?, ?)")
        .bind(uuid)
        .bind(json)
        .execute(pool)
        .await
        .unwrap();
}

async fn page(
    pool: &SqlitePool,
    sort: SortKey,
    dir: SortDir,
    cursor: Option<&PageCursor>,
    limit: i64,
) -> BookPage {
    list_books_page(
        pool,
        &["/lib"],
        sort,
        dir,
        &ViewFilters::default(),
        &[],
        cursor,
        limit,
    )
    .await
    .unwrap()
}

/// Walk every page of `sort`/`dir` two rows at a time.
async fn walk(pool: &SqlitePool, sort: SortKey, dir: SortDir) -> Vec<i64> {
    let mut all = Vec::new();
    let mut cursor = None;
    loop {
        let p = page(pool, sort, dir, cursor.as_ref(), 2).await;
        all.extend(ids(&p));
        match p.next {
            Some(next) => cursor = Some(next),
            None => return all,
        }
    }
}

/// The #2451 library: five surnames around `Pérez`, plus the tie the plain
/// spelling must win. `Perry` was re-attributed in the editor as a display
/// name, and `Pettichord` as a display name over a scan that keyed it under B.
async fn seed_p_group(pool: &SqlitePool) -> Vec<i64> {
    let lib = insert_lib(pool, "/lib").await;
    let polk = insert_by(pool, lib, "polk", "Polk, Sarah").await;
    let galdos = insert_by(pool, lib, "galdos", "Pérez Galdós, Benito").await;
    let perry = insert_by(pool, lib, "perry", "Scanned, Someone").await;
    override_author(pool, perry, "Anne Perry").await;
    let accented = insert_by(pool, lib, "accented", "Pérez, Ana").await;
    let pettichord = insert_by(pool, lib, "pettichord", "Bret, Pettichord").await;
    override_author(pool, pettichord, "Bret Pettichord").await;
    let plain = insert_by(pool, lib, "plain", "Perez, Ana").await;
    vec![plain, accented, galdos, perry, pettichord, polk]
}

#[tokio::test]
async fn list_books_page_orders_authors_in_dictionary_order() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let expected = seed_p_group(&pool).await;

    let asc = page(&pool, SortKey::Author, SortDir::Asc, None, 50).await;
    assert_eq!(ids(&asc), expected, "{:?}", titles(&asc));

    let desc = page(&pool, SortKey::Author, SortDir::Desc, None, 50).await;
    let mut reversed = expected;
    reversed.reverse();
    assert_eq!(ids(&desc), reversed, "{:?}", titles(&desc));
}

#[tokio::test]
async fn list_books_page_files_an_edited_display_name_beside_its_scanned_key() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    let martian = insert_by(&pool, lib, "martian", "Weir, Andy").await;
    let vonnegut = insert_by(&pool, lib, "vonnegut", "Vonnegut, Kurt").await;
    let wolfe = insert_by(&pool, lib, "wolfe", "Wolfe, Gene").await;
    // Scanned under A; the editor's display name must re-key it under W.
    let hail_mary = insert_by(&pool, lib, "hail mary", "Anonymous, A.").await;
    override_author(&pool, hail_mary, "Andy Weir").await;

    let got = ids(&page(&pool, SortKey::Author, SortDir::Asc, None, 50).await);
    let weir: Vec<_> = got
        .iter()
        .copied()
        .filter(|id| [martian, hail_mary].contains(id))
        .collect();
    assert_eq!(got.first(), Some(&vonnegut));
    assert_eq!(got.last(), Some(&wolfe));
    assert_eq!(
        weir.len(),
        2,
        "both Weir books sit between Vonnegut and Wolfe"
    );
}

#[tokio::test]
async fn list_books_page_walks_dictionary_keys_across_pages_without_skips_or_repeats() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let expected = seed_p_group(&pool).await;

    assert_eq!(walk(&pool, SortKey::Author, SortDir::Asc).await, expected);
    let mut reversed = expected;
    reversed.reverse();
    assert_eq!(walk(&pool, SortKey::Author, SortDir::Desc).await, reversed);
}

#[tokio::test]
async fn list_books_page_orders_titles_in_dictionary_order() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    let ezra = insert_book(&pool, lib, "Ezra", Some("Ezra"), None, None).await;
    let ete = insert_book(&pool, lib, "Été", Some("Été"), None, None).await;
    let espresso = insert_book(&pool, lib, "espresso", Some("espresso"), None, None).await;

    let got = ids(&page(&pool, SortKey::Title, SortDir::Asc, None, 50).await);
    assert_eq!(got, vec![espresso, ete, ezra]);
}

/// A creators override that empties the list shows the book with no author,
/// so it files with the authorless books (NULLs first ascending, last
/// descending) — not under the scanned author it hides. An override without a
/// `creators` key still sorts by the scan.
#[tokio::test]
async fn list_books_page_files_an_emptied_creators_override_as_authorless() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    let emptied = insert_by(&pool, lib, "emptied", "Zulu, Zed").await;
    set_overrides(&pool, emptied, serde_json::json!({ "creators": [] })).await;
    let mango = insert_by(&pool, lib, "mango", "Mango, Mia").await;
    let retitled = insert_by(&pool, lib, "retitled", "Oak, Olive").await;
    set_overrides(&pool, retitled, serde_json::json!({ "title": "Renamed" })).await;
    let authorless = insert_book(&pool, lib, "authorless", Some("authorless"), None, None).await;

    let asc = vec![emptied, authorless, mango, retitled];
    assert_eq!(walk(&pool, SortKey::Author, SortDir::Asc).await, asc);
    let desc = vec![retitled, mango, authorless, emptied];
    assert_eq!(walk(&pool, SortKey::Author, SortDir::Desc).await, desc);
}
