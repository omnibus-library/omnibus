//! A series override keeps the book's name and link in agreement and never
//! outlives itself: the projection resolves the override's series, a new
//! override or a clear prunes the links the scan did not write, and migration
//! 0105 repairs books that already carry a stale extra link.

use omnibus_shared::{MetadataOverrides, MetadataSource};

use crate::books::get_book;
use crate::discovery::{get_author, get_series};
use crate::test_support::{
    author_id_by_name, seed_discovery_fixture, series_id_by_name, uuid_by_scan_key,
};

use super::super::*;

fn with_series(name: &str) -> MetadataOverrides {
    MetadataOverrides {
        series: Some(name.into()),
        ..Default::default()
    }
}

async fn admin(pool: &sqlx::SqlitePool) -> i64 {
    crate::auth::create_user(pool, "admin", "securepassword1")
        .await
        .unwrap()
        .id
}

/// `(uuid, id)` of the discovery fixture's "Saga: Book One", scanned in Saga.
async fn saga_one(pool: &sqlx::SqlitePool) -> (String, i64) {
    let uuid = uuid_by_scan_key(pool, &crate::helpers::scan_key_for("saga1.epub")).await;
    let id = sqlx::query_scalar("SELECT id FROM books WHERE uuid = ?")
        .bind(&uuid)
        .fetch_one(pool)
        .await
        .unwrap();
    (uuid, id)
}

async fn linked_series(pool: &sqlx::SqlitePool, book_id: i64) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT s.name FROM books_series_link l JOIN series s ON s.id = l.series
          WHERE l.book = ? ORDER BY s.name",
    )
    .bind(book_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn series_override_to_a_later_sorting_series_gives_the_book_that_series_id() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = admin(&pool).await;
    let (uuid, id) = saga_one(&pool).await;

    upsert_metadata_overrides(&pool, &uuid, &with_series("Zeta Series"), false, user)
        .await
        .unwrap();

    let book = get_book(&pool, id).await.unwrap().unwrap();
    assert_eq!(book.series.as_deref(), Some("Zeta Series"));
    assert_eq!(
        book.series_id,
        Some(series_id_by_name(&pool, "Zeta Series").await)
    );
}

#[tokio::test]
async fn series_override_author_page_books_carry_the_override_series_id() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = admin(&pool).await;
    let (uuid, _) = saga_one(&pool).await;
    upsert_metadata_overrides(&pool, &uuid, &with_series("Zeta Series"), false, user)
        .await
        .unwrap();

    let author = get_author(&pool, author_id_by_name(&pool, "Ada Lovelace").await)
        .await
        .unwrap()
        .unwrap();

    let book = author
        .books
        .iter()
        .find(|b| b.title.as_deref() == Some("Saga: Book One"))
        .unwrap();
    assert_eq!(book.series.as_deref(), Some("Zeta Series"));
    assert_eq!(
        book.series_id,
        Some(series_id_by_name(&pool, "Zeta Series").await)
    );
}

#[tokio::test]
async fn series_override_replaced_twice_keeps_only_the_scanned_link_and_the_latest() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = admin(&pool).await;
    let (uuid, id) = saga_one(&pool).await;

    for name in ["Beta Series", "Gamma Series"] {
        upsert_metadata_overrides(&pool, &uuid, &with_series(name), false, user)
            .await
            .unwrap();
    }

    assert_eq!(linked_series(&pool, id).await, ["Gamma Series", "Saga"]);
}

#[tokio::test]
async fn series_override_merge_that_drops_the_series_prunes_its_link() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = admin(&pool).await;
    let (uuid, id) = saga_one(&pool).await;
    upsert_metadata_overrides(&pool, &uuid, &with_series("Zeta Series"), false, user)
        .await
        .unwrap();

    upsert_metadata_overrides(
        &pool,
        &uuid,
        &MetadataOverrides {
            title: Some("Retitled".into()),
            ..Default::default()
        },
        false,
        user,
    )
    .await
    .unwrap();

    assert_eq!(linked_series(&pool, id).await, ["Saga"]);
}

#[tokio::test]
async fn series_override_clear_restores_the_scanned_series_and_leaves_the_override_series() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = admin(&pool).await;
    let (uuid, id) = saga_one(&pool).await;
    upsert_metadata_overrides(&pool, &uuid, &with_series("Zeta Series"), false, user)
        .await
        .unwrap();
    let zeta = series_id_by_name(&pool, "Zeta Series").await;

    delete_metadata_overrides(&pool, &uuid).await.unwrap();

    let book = get_book(&pool, id).await.unwrap().unwrap();
    assert_eq!(book.series.as_deref(), Some("Saga"));
    assert_eq!(book.series_id, Some(series_id_by_name(&pool, "Saga").await));
    let zeta_books = get_series(&pool, zeta).await.unwrap().map(|s| s.books);
    assert!(zeta_books.unwrap_or_default().is_empty());
}

#[tokio::test]
async fn series_override_on_a_seriesless_book_leaves_no_link_once_cleared() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = admin(&pool).await;
    let uuid = uuid_by_scan_key(&pool, &crate::helpers::scan_key_for("standalone.epub")).await;
    let id: i64 = sqlx::query_scalar("SELECT id FROM books WHERE uuid = ?")
        .bind(&uuid)
        .fetch_one(&pool)
        .await
        .unwrap();
    upsert_metadata_overrides(&pool, &uuid, &with_series("Zeta Series"), false, user)
        .await
        .unwrap();
    assert_eq!(linked_series(&pool, id).await, ["Zeta Series"]);

    delete_metadata_overrides(&pool, &uuid).await.unwrap();

    assert!(linked_series(&pool, id).await.is_empty());
}

#[tokio::test]
async fn series_override_equal_to_the_scanned_series_never_deletes_the_scanned_link() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = admin(&pool).await;
    let (uuid, id) = saga_one(&pool).await;

    upsert_metadata_overrides(&pool, &uuid, &with_series("saga"), false, user)
        .await
        .unwrap();
    delete_metadata_overrides(&pool, &uuid).await.unwrap();

    assert_eq!(linked_series(&pool, id).await, ["Saga"]);
}

#[tokio::test]
async fn series_override_clear_keeps_a_link_the_scanned_series_was_merged_into() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = admin(&pool).await;
    let (uuid, id) = saga_one(&pool).await;
    // A cleanup merge repoints the link at the canonical row and leaves the
    // scanned name behind as an alias.
    let canonical: i64 =
        sqlx::query_scalar("INSERT INTO series (name) VALUES ('Saga Cycle') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query("UPDATE books_series_link SET series = ? WHERE book = ?")
        .bind(canonical)
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO entity_aliases (kind, alias_name, canonical_id) VALUES ('series', 'Saga', ?)",
    )
    .bind(canonical)
    .execute(&pool)
    .await
    .unwrap();
    upsert_metadata_overrides(&pool, &uuid, &with_series("Zeta Series"), false, user)
        .await
        .unwrap();

    delete_metadata_overrides(&pool, &uuid).await.unwrap();

    assert_eq!(linked_series(&pool, id).await, ["Saga Cycle"]);
}

#[tokio::test]
async fn series_override_projection_shows_the_scanned_series_when_the_root_ranks_embedded_tags_first(
) {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = admin(&pool).await;
    let (uuid, id) = saga_one(&pool).await;
    upsert_metadata_overrides(&pool, &uuid, &with_series("Zeta Series"), false, user)
        .await
        .unwrap();
    crate::settings::set_metadata_precedence(
        &pool,
        "/lib",
        &[
            MetadataSource::FolderStructure,
            MetadataSource::OmnibusOverrides,
            MetadataSource::OpfSidecar,
            MetadataSource::EmbeddedTags,
            MetadataSource::ProviderMatch,
        ],
    )
    .await
    .unwrap();

    let book = get_book(&pool, id).await.unwrap().unwrap();

    assert_eq!(book.series.as_deref(), Some("Saga"));
    assert_eq!(book.series_id, Some(series_id_by_name(&pool, "Saga").await));
}

#[tokio::test]
async fn series_override_survives_a_rescan_that_wiped_the_book_links() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = admin(&pool).await;
    let (uuid, id) = saga_one(&pool).await;
    upsert_metadata_overrides(&pool, &uuid, &with_series("Zeta Series"), false, user)
        .await
        .unwrap();
    // A changed-file rescan deletes every link row and rewrites the scanned one.
    sqlx::query("DELETE FROM books_series_link WHERE book = ? AND series <> ?")
        .bind(id)
        .bind(series_id_by_name(&pool, "Saga").await)
        .execute(&pool)
        .await
        .unwrap();

    let book = get_book(&pool, id).await.unwrap().unwrap();

    assert_eq!(book.series.as_deref(), Some("Zeta Series"));
    assert_eq!(
        book.series_id,
        Some(series_id_by_name(&pool, "Zeta Series").await)
    );
}

#[tokio::test]
async fn series_override_survives_a_changed_file_resync_that_orphans_its_only_link() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = admin(&pool).await;
    let (uuid, id) = saga_one(&pool).await;
    upsert_metadata_overrides(&pool, &uuid, &with_series("Zeta Series"), false, user)
        .await
        .unwrap();

    crate::sync::sync_books(
        &pool,
        "/lib",
        crate::sync::SyncPlan {
            changed_books: vec![crate::test_support::indexed(
                "saga1.epub",
                Some("Saga: Book One"),
                &["Ada Lovelace"],
                &[],
                Some(("Saga", "1")),
                None,
            )],
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let book = get_book(&pool, id).await.unwrap().unwrap();
    assert_eq!(book.series.as_deref(), Some("Zeta Series"));
    assert_eq!(
        book.series_id,
        Some(series_id_by_name(&pool, "Zeta Series").await)
    );
}

/// Version of `0105_series_override_link_repair.sql`.
const LINK_REPAIR_VERSION: i64 = 105;

async fn pool_before_link_repair() -> sqlx::SqlitePool {
    static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    for m in MIGRATOR.iter().filter(|m| m.version < LINK_REPAIR_VERSION) {
        sqlx::raw_sql(&m.sql).execute(&pool).await.unwrap();
    }
    pool
}

#[tokio::test]
async fn series_override_migration_0105_drops_only_the_links_that_are_neither_scanned_nor_overridden(
) {
    static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");
    let pool = pool_before_link_repair().await;
    // Tusk Love: scanned "Critical Role", a stale extra link, override "Dungeon
    // Crawler Carl". The second book has no scanned series and a stray link.
    sqlx::raw_sql(
        r#"INSERT INTO scan_roots (id, path, display_name) VALUES (1, '/lib', 'Lib');
           INSERT INTO books (id, uuid, library_id, path, title, series_sort, scan_key)
                VALUES (1, 'tusk', 1, '/lib/tusk.epub', 'Tusk Love', 'Critical Role', 'tusk.epub'),
                       (2, 'loner', 1, '/lib/loner.epub', 'Loner', NULL, 'loner.epub');
           INSERT INTO series (id, name) VALUES (1, 'Critical Role'), (2, 'Aardvark Tales'),
                                                (3, 'Dungeon Crawler Carl');
           INSERT INTO books_series_link (book, series) VALUES (1, 1), (1, 2), (1, 3), (2, 2);
           INSERT INTO users (id, username, password_hash, is_admin) VALUES (1, 'u', 'x', 1);
           INSERT INTO metadata_overrides (book_uuid, overrides, updated_by)
                VALUES ('tusk', '{"series":"Dungeon Crawler Carl"}', 1);"#,
    )
    .execute(&pool)
    .await
    .unwrap();

    let m = MIGRATOR
        .iter()
        .find(|m| m.version == LINK_REPAIR_VERSION)
        .expect("0105 must exist");
    sqlx::raw_sql(&m.sql).execute(&pool).await.unwrap();

    let kept: Vec<(i64, i64)> =
        sqlx::query_as("SELECT book, series FROM books_series_link ORDER BY book, series")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(kept, [(1, 1), (1, 3), (2, 2)]);
}

async fn apply_link_repair(pool: &sqlx::SqlitePool) {
    static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");
    let m = MIGRATOR
        .iter()
        .find(|m| m.version == LINK_REPAIR_VERSION)
        .expect("0105 must exist");
    sqlx::raw_sql(&m.sql).execute(pool).await.unwrap();
}

async fn links_of(pool: &sqlx::SqlitePool, book: i64) -> Vec<i64> {
    sqlx::query_scalar("SELECT series FROM books_series_link WHERE book = ? ORDER BY series")
        .bind(book)
        .fetch_all(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn series_override_migration_0105_survives_a_corrupt_overrides_blob() {
    let pool = pool_before_link_repair().await;
    sqlx::raw_sql(
        "INSERT INTO scan_roots (id, path, display_name) VALUES (1, '/lib', 'Lib');
         INSERT INTO books (id, uuid, library_id, path, title, series_sort, scan_key)
              VALUES (1, 'b', 1, '/lib/b.epub', 'B', 'Critical Role', 'b.epub');
         INSERT INTO series (id, name) VALUES (1, 'Critical Role'), (2, 'Stale');
         INSERT INTO books_series_link (book, series) VALUES (1, 1), (1, 2);
         INSERT INTO metadata_overrides (book_uuid, overrides) VALUES ('b', '{not json');",
    )
    .execute(&pool)
    .await
    .unwrap();

    apply_link_repair(&pool).await;

    assert_eq!(links_of(&pool, 1).await, [1]);
}

#[tokio::test]
async fn series_override_migration_0105_unstamps_a_never_scanned_book_and_keeps_only_its_overrides_link(
) {
    let pool = pool_before_link_repair().await;
    // The old boot backfill stamped `series_sort` from the override's link on a
    // physical-only book, which no scan has ever read; the stale link is a
    // series it was overridden to earlier.
    sqlx::raw_sql(
        r#"INSERT INTO scan_roots (id, path, display_name) VALUES (1, '/lib', 'Lib');
           INSERT INTO users (id, username, password_hash, is_admin) VALUES (1, 'u', 'x', 1);
           INSERT INTO books (id, uuid, library_id, path, title, series_sort, scan_key)
                VALUES (1, 'phys', 1, '', 'Physical', 'Aardvark Tales', NULL),
                       (2, 'filed', 1, '/lib/f.epub', 'Filed', 'Zeta Series', 'f.epub');
           INSERT INTO book_files (book_id, format, filename, size_bytes, mtime_epoch)
                VALUES (2, 'EPUB', 'f', 1, 1);
           INSERT INTO series (id, name) VALUES (1, 'Aardvark Tales'), (2, 'Zeta Series');
           INSERT INTO books_series_link (book, series) VALUES (1, 1), (1, 2), (2, 2);
           INSERT INTO metadata_overrides (book_uuid, overrides, updated_by)
                VALUES ('phys', '{"series":"Zeta Series"}', 1),
                       ('filed', '{"series":"Zeta Series"}', 1);"#,
    )
    .execute(&pool)
    .await
    .unwrap();

    apply_link_repair(&pool).await;

    let sort: Option<String> = sqlx::query_scalar("SELECT series_sort FROM books WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sort, None);
    assert_eq!(links_of(&pool, 1).await, [2]);
    // A filed book's scan may have read exactly the series the override names, so it stays.
    assert_eq!(links_of(&pool, 2).await, [2]);
}

#[tokio::test]
async fn series_override_clear_leaves_no_link_on_a_legacy_never_scanned_book_once_unstamped() {
    let pool = pool_before_link_repair().await;
    sqlx::raw_sql(
        r#"INSERT INTO scan_roots (id, path, display_name) VALUES (1, '/lib', 'Lib');
           INSERT INTO users (id, username, password_hash, is_admin) VALUES (1, 'u', 'x', 1);
           INSERT INTO books (id, uuid, library_id, path, title, series_sort, scan_key)
                VALUES (1, 'phys', 1, '', 'Physical', 'Zeta Series', NULL);
           INSERT INTO series (id, name) VALUES (1, 'Zeta Series');
           INSERT INTO books_series_link (book, series) VALUES (1, 1);
           INSERT INTO metadata_overrides (book_uuid, overrides, updated_by)
                VALUES ('phys', '{"series":"Zeta Series"}', 1);"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    apply_link_repair(&pool).await;

    delete_metadata_overrides(&pool, "phys").await.unwrap();

    assert!(links_of(&pool, 1).await.is_empty());
}

#[tokio::test]
async fn series_override_migration_0105_keeps_a_link_repointed_by_a_series_merge() {
    let pool = pool_before_link_repair().await;
    // "Zeta Series" was merged into "Zeta Cycle": its row is gone, aliased to the canonical one.
    sqlx::raw_sql(
        r#"INSERT INTO scan_roots (id, path, display_name) VALUES (1, '/lib', 'Lib');
           INSERT INTO books (id, uuid, library_id, path, title, series_sort, scan_key)
                VALUES (1, 'b', 1, '/lib/b.epub', 'B', 'Critical Role', 'b.epub');
           INSERT INTO series (id, name) VALUES (1, 'Critical Role'), (2, 'Zeta Cycle');
           INSERT INTO books_series_link (book, series) VALUES (1, 1), (1, 2);
           INSERT INTO entity_aliases (kind, alias_name, canonical_id) VALUES ('series', 'Zeta Series', 2);
           INSERT INTO metadata_overrides (book_uuid, overrides)
                VALUES ('b', '{"series":"Zeta Series"}');"#,
    )
    .execute(&pool)
    .await
    .unwrap();

    apply_link_repair(&pool).await;

    assert_eq!(links_of(&pool, 1).await, [1, 2]);
}

#[tokio::test]
async fn series_override_replaced_on_a_seriesless_book_keeps_only_the_latest() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = admin(&pool).await;
    let uuid = uuid_by_scan_key(&pool, &crate::helpers::scan_key_for("standalone.epub")).await;
    let id: i64 = sqlx::query_scalar("SELECT id FROM books WHERE uuid = ?")
        .bind(&uuid)
        .fetch_one(&pool)
        .await
        .unwrap();

    for name in ["Beta Series", "Gamma Series"] {
        upsert_metadata_overrides(&pool, &uuid, &with_series(name), false, user)
            .await
            .unwrap();
    }

    assert_eq!(linked_series(&pool, id).await, ["Gamma Series"]);
}

#[tokio::test]
async fn series_override_keeps_the_links_of_a_book_with_no_series_sort() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = admin(&pool).await;
    let uuid = uuid_by_scan_key(&pool, &crate::helpers::scan_key_for("standalone.epub")).await;
    let id: i64 = sqlx::query_scalar("SELECT id FROM books WHERE uuid = ?")
        .bind(&uuid)
        .fetch_one(&pool)
        .await
        .unwrap();
    // A link nothing here wrote and no override names: with no `series_sort`
    // there is no telling which link the scan wrote, so it is left alone.
    sqlx::query("INSERT INTO books_series_link (book, series) VALUES (?, ?)")
        .bind(id)
        .bind(series_id_by_name(&pool, "Pioneers").await)
        .execute(&pool)
        .await
        .unwrap();

    upsert_metadata_overrides(
        &pool,
        &uuid,
        &MetadataOverrides {
            title: Some("Retitled".into()),
            ..Default::default()
        },
        false,
        user,
    )
    .await
    .unwrap();

    assert_eq!(linked_series(&pool, id).await, ["Pioneers"]);
}

/// Merge "Zeta Series" (an override's series) into a new canonical "Zeta Cycle", as
/// a library cleanup does: the source row goes, its name becomes an alias.
async fn merge_override_series_into_zeta_cycle(pool: &sqlx::SqlitePool) -> i64 {
    let source = series_id_by_name(pool, "Zeta Series").await;
    let canonical: i64 =
        sqlx::query_scalar("INSERT INTO series (name) VALUES ('Zeta Cycle') RETURNING id")
            .fetch_one(pool)
            .await
            .unwrap();
    crate::cleanup::apply_merge_series(pool, &[source], canonical, None, None)
        .await
        .unwrap();
    canonical
}

#[tokio::test]
async fn series_override_survives_a_cleanup_merge_of_its_series_with_name_and_link_agreeing() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = admin(&pool).await;
    let (uuid, id) = saga_one(&pool).await;
    upsert_metadata_overrides(&pool, &uuid, &with_series("Zeta Series"), false, user)
        .await
        .unwrap();

    let canonical = merge_override_series_into_zeta_cycle(&pool).await;

    let book = get_book(&pool, id).await.unwrap().unwrap();
    assert_eq!(book.series_id, Some(canonical));
}
