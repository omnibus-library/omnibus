//! Series-stacked variant of the landing page read: [`super::list_books_page`]
//! with every series that has 2+ books in the filtered set folded onto the
//! member that sorts first, plus each series' members and the viewer's
//! reading state for them.

use std::collections::{HashMap, HashSet};

use omnibus_shared::{EbookMetadata, SeriesStack, SortDir, SortKey, StackMemberState, ViewFilters};
use sqlx::{Row, SqlitePool};

use crate::books::projection::{
    backfill_creator_ids, merge_overrides_into_books, row_to_ebook, BOOK_COLUMNS,
};
use crate::books::BooksError;
use crate::metadata_overrides::sql::{effective_text_sql, override_sql, overrides_win_sql};

use super::{
    axis_sort_columns, bind_all, dir_keyword, exclude_formats_predicate, fetch_page,
    filter_predicates, placeholders, visible_book_sql, PageCursor, SqlVal,
};

/// Values per `IN (…)` list — well under SQLite's bound-parameter limit.
const IN_CHUNK: usize = 500;

/// The stacking group key: displayed series name, trimmed+lowercased; NULL
/// for none (an emptied override means no series, not the scanned name).
const GROUP_KEY: &str = concat!(
    "NULLIF(lower(trim(CASE WHEN ",
    overrides_win_sql!(),
    " AND json_type(CASE WHEN json_valid(mo.overrides) THEN mo.overrides ELSE '{}' END,",
    " '$.series') = 'text' THEN json_extract(mo.overrides, '$.series')",
    " ELSE (SELECT s.name FROM books_series_link bsl JOIN series s ON s.id = bsl.series",
    " WHERE bsl.book = b.id ORDER BY s.name LIMIT 1) END)), '')"
);

/// Member tie-break for equal series indexes: the effective *displayed*
/// title (never the sort-form `b.sort`) in dictionary order, matching the
/// client's own `dictionary_key(title)` tie-break in `sort_series_order`.
const MEMBER_TIE_KEY: &str = effective_text_sql!("$.title"; "b.title"; "dictionary");

/// One keyset page with each multi-book series folded into one row.
#[derive(Debug, Clone, PartialEq)]
pub struct StackedBookPage {
    pub books: Vec<EbookMetadata>,
    pub next: Option<PageCursor>,
    /// One per row of `books` whose series has 2+ books in the filtered set.
    pub stacks: Vec<SeriesStack>,
}

/// [`super::list_books_page`] with series folded into one stacked row; `stacks` holds members + viewer state.
#[allow(clippy::too_many_arguments)] // list_books_page's knobs plus the viewer
pub async fn list_books_page_stacked(
    pool: &SqlitePool,
    library_paths: &[&str],
    sort: SortKey,
    dir: SortDir,
    filters: &ViewFilters,
    exclude_formats: &[String],
    cursor: Option<&PageCursor>,
    limit: i64,
    viewer_id: i64,
) -> Result<StackedBookPage, BooksError> {
    let page = fetch_page(
        pool,
        library_paths,
        sort,
        dir,
        filters,
        exclude_formats,
        cursor,
        limit,
        true,
    )
    .await?;
    let stacks = if page.books.is_empty() {
        Vec::new()
    } else {
        build_stacks(
            pool,
            library_paths,
            filters,
            exclude_formats,
            &page.books,
            viewer_id,
        )
        .await?
    };
    Ok(StackedBookPage {
        books: page.books,
        next: page.next,
        stacks,
    })
}

/// ` AND b.id IN (…)` keeping each series' representative — first-sorting
/// member of a window over the *whole* filtered set, so every page agrees.
pub(super) fn representative_predicate(
    sort: SortKey,
    dir: SortDir,
    library_paths: &[&str],
    filters: &ViewFilters,
    exclude_formats: &[String],
    binds: &mut Vec<SqlVal>,
) -> String {
    let (primary, secondary) = axis_sort_columns(sort);
    let d = dir_keyword(dir);
    let order = match secondary {
        Some(sec) => format!("{primary} {d}, {sec} {d}, b.id {d}"),
        None => format!("{primary} {d}, b.id {d}"),
    };
    let visible = visible_book_sql(library_paths, binds);
    let filter_sql = filter_predicates(filters, binds);
    let exclude_sql = exclude_formats_predicate(exclude_formats, binds);
    format!(
        " AND b.id IN (
            SELECT id FROM (
                SELECT b.id AS id,
                       {GROUP_KEY} AS k,
                       ROW_NUMBER() OVER (PARTITION BY {GROUP_KEY} ORDER BY {order}) AS rn
                  FROM books b
                  JOIN scan_roots l ON l.id = b.library_id
                  LEFT JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
                 WHERE {visible}{filter_sql}{exclude_sql})
             WHERE k IS NULL OR rn = 1)"
    )
}

/// The stacks riding with `page`: members, series page, and viewer state.
async fn build_stacks(
    pool: &SqlitePool,
    library_paths: &[&str],
    filters: &ViewFilters,
    exclude_formats: &[String],
    page: &[EbookMetadata],
    viewer_id: i64,
) -> Result<Vec<SeriesStack>, BooksError> {
    let rep_ids: Vec<i64> = page.iter().map(|b| b.id).collect();
    let groups =
        fetch_member_groups(pool, library_paths, filters, exclude_formats, &rep_ids).await?;
    let reps: HashMap<i64, &EbookMetadata> = page.iter().map(|b| (b.id, b)).collect();
    let mut stacks = Vec::new();
    for members in groups.into_iter().filter(|g| g.len() >= 2) {
        let Some(rep) = members.iter().find_map(|m| reps.get(&m.id).copied()) else {
            continue;
        };
        stacks.push(SeriesStack {
            lead_uuid: rep.unique_identifier.clone().unwrap_or_default(),
            name: stack_name(rep, &members),
            series_id: rep.series_id,
            members,
            states: Vec::new(),
        });
    }
    resolve_series_ids(pool, &mut stacks).await?;
    attach_states(pool, viewer_id, &mut stacks).await?;
    Ok(stacks)
}

/// Every visible member of the page's represented series, in series order —
/// chunked by representative, so a series never spans two chunks.
async fn fetch_member_groups(
    pool: &SqlitePool,
    library_paths: &[&str],
    filters: &ViewFilters,
    exclude_formats: &[String],
    rep_ids: &[i64],
) -> Result<Vec<Vec<EbookMetadata>>, BooksError> {
    let series_index = axis_sort_columns(SortKey::Series)
        .1
        .unwrap_or("b.series_index");
    let mut keys: Vec<String> = Vec::new();
    let mut books: Vec<EbookMetadata> = Vec::new();
    for chunk in rep_ids.chunks(IN_CHUNK) {
        let mut binds: Vec<SqlVal> = Vec::new();
        let visible = visible_book_sql(library_paths, &mut binds);
        let filter_sql = filter_predicates(filters, &mut binds);
        let exclude_sql = exclude_formats_predicate(exclude_formats, &mut binds);
        let ids = placeholders(chunk.len());
        binds.extend(chunk.iter().map(|id| SqlVal::Int(*id)));
        let sql = format!(
            r"
            SELECT {BOOK_COLUMNS}, {GROUP_KEY} AS stack_key
              FROM books b
              JOIN scan_roots l ON l.id = b.library_id
              LEFT JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
             WHERE {visible}{filter_sql}{exclude_sql}
               AND {GROUP_KEY} IN (
                   SELECT {GROUP_KEY}
                     FROM books b
                     JOIN scan_roots l ON l.id = b.library_id
                     LEFT JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
                    WHERE b.id IN ({ids}))
             ORDER BY stack_key, ({series_index}) IS NULL, {series_index}, {MEMBER_TIE_KEY}, b.id
            "
        );
        let rows = bind_all(sqlx::query(&sql), &binds).fetch_all(pool).await?;
        for r in &rows {
            keys.push(r.try_get::<String, _>("stack_key")?);
            books.push(row_to_ebook(r)?);
        }
    }
    merge_overrides_into_books(pool, &mut books).await?;
    backfill_creator_ids(pool, &mut books).await?;
    Ok(group_runs(keys, books))
}

/// Split `books` into runs of equal `keys` — the query orders by key first.
fn group_runs(keys: Vec<String>, books: Vec<EbookMetadata>) -> Vec<Vec<EbookMetadata>> {
    let mut groups: Vec<Vec<EbookMetadata>> = Vec::new();
    let mut last: Option<String> = None;
    for (key, book) in keys.into_iter().zip(books) {
        if last.as_ref() != Some(&key) {
            groups.push(Vec::new());
            last = Some(key);
        }
        if let Some(group) = groups.last_mut() {
            group.push(book);
        }
    }
    groups
}

/// The name a stack shows: the representative's series, else the first member that carries one.
fn stack_name(rep: &EbookMetadata, members: &[EbookMetadata]) -> String {
    std::iter::once(rep)
        .chain(members)
        .find_map(|b| b.series.as_deref().map(str::trim).filter(|s| !s.is_empty()))
        .unwrap_or_default()
        .to_string()
}

/// Re-resolves each stack's `series_id` by displayed name — an override rename leaves the projected id stale.
async fn resolve_series_ids(
    pool: &SqlitePool,
    stacks: &mut [SeriesStack],
) -> Result<(), sqlx::Error> {
    let names: Vec<String> = stacks
        .iter()
        .map(|s| s.name.clone())
        .filter(|n| !n.is_empty())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let mut by_name: HashMap<String, i64> = HashMap::new();
    for chunk in names.chunks(IN_CHUNK) {
        let sql = format!(
            "SELECT id, name FROM series WHERE name IN ({})",
            placeholders(chunk.len())
        );
        let mut q = sqlx::query(&sql);
        for name in chunk {
            q = q.bind(name);
        }
        for r in q.fetch_all(pool).await? {
            by_name.insert(
                r.try_get::<String, _>("name")?.to_ascii_lowercase(),
                r.try_get("id")?,
            );
        }
    }
    for stack in stacks.iter_mut() {
        if let Some(id) = by_name.get(&stack.name.to_ascii_lowercase()) {
            stack.series_id = Some(*id);
        }
    }
    Ok(())
}

/// Fill every stack's `states`, one per member in member order.
async fn attach_states(
    pool: &SqlitePool,
    viewer_id: i64,
    stacks: &mut [SeriesStack],
) -> Result<(), sqlx::Error> {
    let uuids: Vec<String> = stacks
        .iter()
        .flat_map(|s| s.members.iter().filter_map(|m| m.unique_identifier.clone()))
        .collect();
    let states = member_states(pool, viewer_id, &uuids).await?;
    for stack in stacks.iter_mut() {
        stack.states = stack
            .members
            .iter()
            .filter_map(|m| m.unique_identifier.as_deref())
            .map(|uuid| {
                states
                    .get(uuid)
                    .cloned()
                    .unwrap_or_else(|| StackMemberState {
                        uuid: uuid.to_string(),
                        ..Default::default()
                    })
            })
            .collect();
    }
    Ok(())
}

/// `viewer_id`'s state for each of `uuids`: ebook percent, started, and finished.
async fn member_states(
    pool: &SqlitePool,
    viewer_id: i64,
    uuids: &[String],
) -> Result<HashMap<String, StackMemberState>, sqlx::Error> {
    let mut out: HashMap<String, StackMemberState> = HashMap::new();
    for chunk in uuids.chunks(IN_CHUNK) {
        let ph = placeholders(chunk.len());
        let sql = format!(
            "SELECT book_uuid, format, progress_percent FROM reading_progress
              WHERE user_id = ? AND book_uuid IN ({ph})"
        );
        let mut q = sqlx::query(&sql).bind(viewer_id);
        for uuid in chunk {
            q = q.bind(uuid);
        }
        for r in q.fetch_all(pool).await? {
            let uuid: String = r.try_get("book_uuid")?;
            let state = out.entry(uuid.clone()).or_insert_with(|| StackMemberState {
                uuid,
                ..Default::default()
            });
            if r.try_get::<String, _>("format")? == "epub" {
                let percent = r
                    .try_get::<Option<i64>, _>("progress_percent")?
                    .and_then(|p| u8::try_from(p.clamp(0, 100)).ok());
                state.started |= percent.is_some_and(|p| p > 0);
                state.percent = percent;
            } else {
                state.started = true;
            }
        }
        let sql = format!(
            "SELECT book_uuid, status FROM book_read_status
              WHERE user_id = ? AND book_uuid IN ({ph})"
        );
        let mut q = sqlx::query(&sql).bind(viewer_id);
        for uuid in chunk {
            q = q.bind(uuid);
        }
        for r in q.fetch_all(pool).await? {
            let uuid: String = r.try_get("book_uuid")?;
            let state = out.entry(uuid.clone()).or_insert_with(|| StackMemberState {
                uuid,
                ..Default::default()
            });
            match r.try_get::<String, _>("status")?.as_str() {
                "finished" => {
                    state.started = true;
                    state.finished = true;
                }
                "reading" => state.started = true,
                _ => {}
            }
        }
    }
    Ok(out)
}
