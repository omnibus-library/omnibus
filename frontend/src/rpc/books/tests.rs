use super::{ebooks_page, merge_candidates, search_ebooks};
use omnibus_db::test_support::{indexed, seed_synced_ebook, seed_user};
use omnibus_db::Viewer;
use omnibus_shared::{
    CreateShelfRequest, FilterClause, FilterField, FilterMode, LibraryPage, Settings, ShelfKind,
    SortDir, SortKey, ViewFilters, Visibility, MAX_FILTER_CLAUSES, SEARCH_QUERY_MAX_LEN,
};

async fn configured_pool(audiobook_path: Option<&str>) -> sqlx::SqlitePool {
    let pool = omnibus_db::init_db("sqlite::memory:").await.unwrap();
    omnibus_db::set_settings(
        &pool,
        &Settings {
            ebook_library_path: Some("/ebooks".into()),
            audiobook_library_path: audiobook_path.map(Into::into),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    pool
}

#[tokio::test]
async fn ebooks_page_first_page_carries_total_but_no_facets() {
    let pool = configured_pool(None).await;
    seed_synced_ebook(&pool, "a.epub", "Alpha", "Ann Author").await;
    seed_synced_ebook(&pool, "b.epub", "Beta", "Bob Author").await;

    let first = ebooks_page(
        &pool,
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        Viewer::default(),
        &[],
        None,
        1,
        false,
    )
    .await
    .unwrap();

    assert_eq!(first.books.len(), 1);
    assert_eq!(first.books[0].title.as_deref(), Some("Alpha"));
    assert_eq!(first.total, Some(2));
    assert_eq!(first.facets, None);
    assert!(first.next_cursor.is_some());
}

#[tokio::test]
async fn ebooks_page_later_page_continues_after_cursor_and_omits_aggregates() {
    let pool = configured_pool(None).await;
    seed_synced_ebook(&pool, "a.epub", "Alpha", "Ann Author").await;
    seed_synced_ebook(&pool, "b.epub", "Beta", "Bob Author").await;

    let first = ebooks_page(
        &pool,
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        Viewer::default(),
        &[],
        None,
        1,
        false,
    )
    .await
    .unwrap();
    let cursor = first.next_cursor.expect("first page should issue a cursor");

    let second = ebooks_page(
        &pool,
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        Viewer::default(),
        &[],
        Some(&cursor),
        1,
        false,
    )
    .await
    .unwrap();

    assert_eq!(second.books.len(), 1);
    assert_eq!(second.books[0].title.as_deref(), Some("Beta"));
    assert_eq!(second.total, None, "later pages must omit the total");
}

#[tokio::test]
async fn ebooks_page_surfaces_error_for_malformed_cursor() {
    let pool = configured_pool(None).await;

    let result = ebooks_page(
        &pool,
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        Viewer::default(),
        &[],
        Some("not-a-server-issued-cursor"),
        10,
        false,
    )
    .await;

    assert!(result.is_err(), "malformed cursor must surface an error");
}

fn tag_filters(clauses: usize) -> ViewFilters {
    ViewFilters {
        clauses: (0..clauses)
            .map(|i| FilterClause {
                field: FilterField::Tag,
                mode: FilterMode::Include,
                values: vec![format!("tag-{i}")],
            })
            .collect(),
        ..Default::default()
    }
}

#[tokio::test]
async fn ebooks_page_rejects_more_than_max_filter_clauses() {
    let pool = configured_pool(None).await;

    let over = ebooks_page(
        &pool,
        SortKey::Title,
        SortDir::Asc,
        &tag_filters(MAX_FILTER_CLAUSES + 1),
        Viewer::default(),
        &[],
        None,
        10,
        false,
    )
    .await;
    let at_cap = ebooks_page(
        &pool,
        SortKey::Title,
        SortDir::Asc,
        &tag_filters(MAX_FILTER_CLAUSES),
        Viewer::default(),
        &[],
        None,
        10,
        false,
    )
    .await;

    assert!(over.is_err(), "17 clauses must be rejected");
    assert!(at_cap.is_ok(), "16 clauses must still be served");
}

#[tokio::test]
async fn merge_candidates_dedups_shared_directory_hits_and_caps_at_twenty() {
    // Both library slots pointing at one directory is the documented
    // dedup case: every hit comes back once per path, so without the
    // uuid dedup the list would double.
    let pool = configured_pool(Some("/ebooks")).await;
    for i in 0..25 {
        seed_synced_ebook(
            &pool,
            &format!("tome-{i}.epub"),
            &format!("Common Tome {i}"),
            "Prolific Author",
        )
        .await;
    }

    let out = merge_candidates(&pool, "Common").await.unwrap();

    assert_eq!(out.len(), 20, "25 deduped hits must truncate to 20");
    let mut seen = std::collections::HashSet::new();
    assert!(
        out.iter().all(|b| seen.insert(b.unique_identifier.clone())),
        "no duplicate unique_identifier may survive the dedup"
    );
}

#[tokio::test]
async fn search_ebooks_rejects_query_over_the_length_cap() {
    let pool = configured_pool(None).await;
    let oversized = "a".repeat(SEARCH_QUERY_MAX_LEN + 1);

    let result = search_ebooks(&pool, &oversized).await;

    assert!(result.is_err(), "oversized query must be rejected");
}

#[tokio::test]
async fn merge_candidates_rejects_query_over_the_length_cap() {
    let pool = configured_pool(None).await;
    let oversized = "a".repeat(SEARCH_QUERY_MAX_LEN + 1);

    let result = merge_candidates(&pool, &oversized).await;

    assert!(result.is_err(), "oversized query must be rejected");
}

#[tokio::test]
async fn ebooks_page_with_exclusion_omits_hidden_books_and_reports_hidden_count() {
    let pool = configured_pool(None).await;
    seed_synced_ebook(&pool, "comic.cbz", "Comic", "Ann Author").await;
    seed_synced_ebook(&pool, "novel.epub", "Novel", "Bob Author").await;

    let page = ebooks_page(
        &pool,
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        Viewer::default(),
        &["cbz".to_string()],
        None,
        50,
        false,
    )
    .await
    .unwrap();

    let titles: Vec<_> = page
        .books
        .iter()
        .filter_map(|b| b.title.as_deref())
        .collect();
    assert_eq!(titles, vec!["Novel"]);
    assert_eq!(page.hidden_count, Some(1));
}

#[tokio::test]
async fn ebooks_page_with_exclusion_reports_visible_total() {
    let pool = configured_pool(None).await;
    seed_synced_ebook(&pool, "comic.cbz", "Comic", "Ann Author").await;
    seed_synced_ebook(&pool, "novel.epub", "Novel", "Bob Author").await;

    let page = ebooks_page(
        &pool,
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        Viewer::default(),
        &["cbz".to_string()],
        None,
        50,
        false,
    )
    .await
    .unwrap();

    assert_eq!(page.total, Some(1), "total is the visible library size");
}

#[tokio::test]
async fn ebooks_page_without_exclusion_keeps_current_total_and_no_hidden_count() {
    let pool = configured_pool(None).await;
    seed_synced_ebook(&pool, "comic.cbz", "Comic", "Ann Author").await;
    seed_synced_ebook(&pool, "novel.epub", "Novel", "Bob Author").await;

    let page = ebooks_page(
        &pool,
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        Viewer::default(),
        &[],
        None,
        50,
        false,
    )
    .await
    .unwrap();

    assert_eq!(page.total, Some(2));
    assert_eq!(page.hidden_count, None);
}

fn filters_of(clauses: Vec<FilterClause>) -> ViewFilters {
    ViewFilters {
        clauses,
        ..Default::default()
    }
}

fn titles_of(page: &LibraryPage) -> Vec<&str> {
    page.books
        .iter()
        .filter_map(|b| b.title.as_deref())
        .collect()
}

/// A filtered first page of up to 50 books sorted by title, hiding `exclude_formats`.
async fn filtered_first_page(
    pool: &sqlx::SqlitePool,
    filters: &ViewFilters,
    exclude_formats: &[String],
) -> LibraryPage {
    ebooks_page(
        pool,
        SortKey::Title,
        SortDir::Asc,
        filters,
        Viewer::default(),
        exclude_formats,
        None,
        50,
        false,
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn ebooks_page_first_page_total_counts_only_books_matching_the_filter() {
    let pool = configured_pool(None).await;
    seed_synced_ebook(&pool, "a.epub", "Alpha", "Ann Author").await;
    seed_synced_ebook(&pool, "b.epub", "Beta", "Bob Author").await;
    seed_synced_ebook(&pool, "c.cbz", "Comic", "Ann Author").await;
    let filters = filters_of(vec![FilterClause::new(
        FilterField::Author,
        FilterMode::Exclude,
        &["Bob Author"],
    )]);

    let page = filtered_first_page(&pool, &filters, &[]).await;

    assert_eq!(titles_of(&page), vec!["Alpha", "Comic"]);
    assert_eq!(page.total, Some(2));
    assert_eq!(page.hidden_count, None);
}

#[tokio::test]
async fn ebooks_page_hidden_count_compares_under_the_same_filter() {
    let pool = configured_pool(None).await;
    seed_synced_ebook(&pool, "a.epub", "Alpha", "Ann Author").await;
    seed_synced_ebook(&pool, "b.cbz", "Bravo", "Ann Author").await;
    seed_synced_ebook(&pool, "c.cbz", "Charlie", "Bob Author").await;
    seed_synced_ebook(&pool, "d.epub", "Delta", "Bob Author").await;
    let filters = filters_of(vec![FilterClause::new(
        FilterField::Author,
        FilterMode::Include,
        &["Ann Author"],
    )]);

    let page = filtered_first_page(&pool, &filters, &["cbz".to_string()]).await;

    assert_eq!(titles_of(&page), vec!["Alpha"]);
    assert_eq!(page.total, Some(1));
    assert_eq!(
        page.hidden_count,
        Some(1),
        "only Ann's comic is hidden, not Bob's"
    );
}

#[tokio::test]
async fn ebooks_page_rejects_an_invalid_filter() {
    let pool = configured_pool(None).await;
    seed_synced_ebook(&pool, "a.epub", "Alpha", "Ann Author").await;
    let filters = filters_of(vec![FilterClause::new(
        FilterField::Shelf,
        FilterMode::Include,
        &["favourites"],
    )]);

    let result = ebooks_page(
        &pool,
        SortKey::Title,
        SortDir::Asc,
        &filters,
        Viewer::default(),
        &[],
        None,
        50,
        false,
    )
    .await;

    assert!(
        result.is_err(),
        "a non-numeric shelf value must be rejected"
    );
}

/// Index a two-book series and a standalone book under `/ebooks`.
async fn seed_series(pool: &sqlx::SqlitePool) {
    omnibus_db::replace_books(
        pool,
        "/ebooks",
        vec![
            indexed(
                "saga-1.epub",
                Some("Saga One"),
                &["Ann Author"],
                &[],
                Some(("Saga", "1")),
                None,
            ),
            indexed(
                "saga-2.epub",
                Some("Saga Two"),
                &["Ann Author"],
                &[],
                Some(("Saga", "2")),
                None,
            ),
            indexed(
                "lone.epub",
                Some("Lone Book"),
                &["Bob Author"],
                &[],
                None,
                None,
            ),
        ],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn ebooks_page_with_stacking_folds_a_series_and_carries_its_stack() {
    let pool = configured_pool(None).await;
    seed_series(&pool).await;
    let viewer = seed_user(&pool, "reader").await;

    let page = ebooks_page(
        &pool,
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        Viewer {
            user_id: viewer,
            ..Viewer::default()
        },
        &[],
        None,
        50,
        true,
    )
    .await
    .unwrap();

    let titles: Vec<_> = page
        .books
        .iter()
        .filter_map(|b| b.title.as_deref())
        .collect();
    assert_eq!(titles, vec!["Lone Book", "Saga One"]);
    assert_eq!(page.stacks.len(), 1);
    assert_eq!(page.stacks[0].members.len(), 2);
    assert_eq!(
        page.total,
        Some(3),
        "the header still counts books, not tiles"
    );
}

#[tokio::test]
async fn ebooks_page_without_stacking_lists_every_book_and_no_stacks() {
    let pool = configured_pool(None).await;
    seed_series(&pool).await;

    let page = ebooks_page(
        &pool,
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        Viewer::default(),
        &[],
        None,
        50,
        false,
    )
    .await
    .unwrap();

    assert_eq!(page.books.len(), 3);
    assert!(page.stacks.is_empty());
}

#[tokio::test]
async fn ebooks_page_shelf_clause_ignores_another_readers_private_shelf() {
    let pool = configured_pool(None).await;
    seed_series(&pool).await;
    let owner = seed_user(&pool, "owner").await;
    let outsider = seed_user(&pool, "outsider").await;
    let lone = omnibus_db::list_books(&pool, "/ebooks")
        .await
        .unwrap()
        .into_iter()
        .find(|b| b.title.as_deref() == Some("Lone Book"))
        .and_then(|b| b.unique_identifier)
        .unwrap();
    let shelf = omnibus_db::create_shelf(
        &pool,
        owner,
        &CreateShelfRequest {
            kind: ShelfKind::Manual,
            name: "Secret".into(),
            description: None,
            visibility: Visibility::Private,
            match_mode: None,
            rules: vec![],
            book_uuids: vec![lone],
        },
    )
    .await
    .unwrap()
    .id
    .to_string();
    let on_shelf = filters_of(vec![FilterClause::new(
        FilterField::Shelf,
        FilterMode::Include,
        &[&shelf],
    )]);
    let off_shelf = filters_of(vec![FilterClause::new(
        FilterField::Shelf,
        FilterMode::Exclude,
        &[&shelf],
    )]);
    let page_for = |user_id, filters: ViewFilters, stack| {
        let pool = pool.clone();
        async move {
            let viewer = Viewer {
                user_id,
                is_admin: false,
            };
            ebooks_page(
                &pool,
                SortKey::Title,
                SortDir::Asc,
                &filters,
                viewer,
                &[],
                None,
                50,
                stack,
            )
            .await
            .unwrap()
        }
    };

    for (stack, whole_library) in [
        (false, vec!["Lone Book", "Saga One", "Saga Two"]),
        (true, vec!["Lone Book", "Saga One"]),
    ] {
        let owners = page_for(owner, on_shelf.clone(), stack).await;
        let included = page_for(outsider, on_shelf.clone(), stack).await;
        let excluded = page_for(outsider, off_shelf.clone(), stack).await;

        assert_eq!(titles_of(&owners), vec!["Lone Book"], "stack={stack}");
        assert!(titles_of(&included).is_empty(), "stack={stack}");
        assert_eq!(included.total, Some(0), "stack={stack}");
        assert_eq!(titles_of(&excluded), whole_library, "stack={stack}");
        assert_eq!(excluded.total, Some(3), "stack={stack}");
    }
}

const BLURB: &str = "<p>A <b>long</b> blurb.</p>";

/// `seed_series`' books, each carrying a description.
async fn seed_described_series(pool: &sqlx::SqlitePool) {
    let described = |filename, title, series| {
        let mut book = indexed(filename, Some(title), &["Ann Author"], &[], series, None);
        book.metadata.description = Some(BLURB.into());
        book
    };
    omnibus_db::replace_books(
        pool,
        "/ebooks",
        vec![
            described("saga-1.epub", "Saga One", Some(("Saga", "1"))),
            described("saga-2.epub", "Saga Two", Some(("Saga", "2"))),
            described("lone.epub", "Lone Book", None),
        ],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn ebooks_page_rows_carry_no_description_but_the_detail_read_keeps_it() {
    let pool = configured_pool(None).await;
    seed_described_series(&pool).await;

    let page = ebooks_page(
        &pool,
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        Viewer::default(),
        &[],
        None,
        50,
        false,
    )
    .await
    .unwrap();

    assert_eq!(page.books.len(), 3);
    assert!(page.books.iter().all(|b| b.description.is_none()));
    let uuid = page.books[0].unique_identifier.as_deref().unwrap();
    let detail = omnibus_db::get_book_by_uuid(&pool, uuid)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(detail.description.as_deref(), Some(BLURB));
}

#[tokio::test]
async fn ebooks_page_with_stacking_carries_no_description_on_rows_or_members() {
    let pool = configured_pool(None).await;
    seed_described_series(&pool).await;
    let viewer = seed_user(&pool, "reader").await;

    let page = ebooks_page(
        &pool,
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        Viewer {
            user_id: viewer,
            ..Viewer::default()
        },
        &[],
        None,
        50,
        true,
    )
    .await
    .unwrap();

    assert_eq!(
        page.books.len(),
        2,
        "the series folds to one row plus the lone book"
    );
    assert!(page.books.iter().all(|b| b.description.is_none()));
    assert_eq!(page.stacks[0].members.len(), 2);
    assert!(page.stacks[0]
        .members
        .iter()
        .all(|m| m.description.is_none()));
}
