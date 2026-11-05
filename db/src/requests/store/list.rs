//! The requests the Requests page and a book's history list: each with its book, who made it,
//! who cancelled it, and the versions it picked or gave up, so a row can say how far it got.

use std::collections::HashMap;

use omnibus_shared::{EbookMetadata, RequestState, RequestVersion};
use sqlx::{Row, SqlitePool};

use crate::books::{get_books_by_ids_projected, Projection};
use crate::helpers::ids_json;

use super::{row_to_request, RequestError, RequestRow};

/// The most requests one list returns.
// shortcut: no paging, newest 500 only; page it once a server holds more.
pub const LIST_LIMIT: i64 = 500;

/// Which requests [`list`] returns; a field left `None` matches every request.
#[derive(Debug, Clone, Copy, Default)]
pub struct ListFilter<'a> {
    pub book_uuid: Option<&'a str>,
    pub user_id: Option<i64>,
    pub state: Option<RequestState>,
}

/// A request as a list shows it.
#[derive(Debug, Clone)]
pub struct Listed {
    pub request: RequestRow,
    pub book: EbookMetadata,
    /// The requester's display name, or their username.
    pub requester_name: String,
    /// The same for whoever cancelled it; `None` unless cancelled, or once that account is gone.
    pub cancelled_by_name: Option<String>,
    /// The version it picked, then those it gave up.
    pub versions: Vec<RequestVersion>,
}

/// The requests `filter` matches, newest first, at most [`LIST_LIMIT`]. A request whose book
/// is gone is left out.
pub async fn list(pool: &SqlitePool, filter: ListFilter<'_>) -> Result<Vec<Listed>, RequestError> {
    let rows = sqlx::query(
        "SELECT q.*, b.id AS book_id,
                COALESCE(u.display_name, u.username) AS requester_name,
                COALESCE(c.display_name, c.username) AS cancelled_by_name
           FROM book_requests q
           JOIN books b ON b.uuid = q.book_uuid
           JOIN users u ON u.id = q.user_id
           LEFT JOIN users c ON c.id = q.cancelled_by
          WHERE (?1 IS NULL OR q.book_uuid = ?1)
            AND (?2 IS NULL OR q.user_id = ?2)
            AND (?3 IS NULL OR q.state = ?3)
          ORDER BY q.id DESC
          LIMIT ?4",
    )
    .bind(filter.book_uuid)
    .bind(filter.user_id)
    .bind(filter.state.map(RequestState::as_str))
    .bind(LIST_LIMIT)
    .fetch_all(pool)
    .await?;

    let request_ids = rows
        .iter()
        .map(|r| r.try_get("id"))
        .collect::<Result<Vec<i64>, _>>()?;
    let mut versions = kept_versions(pool, &request_ids).await?;
    let book_ids = rows
        .iter()
        .map(|r| r.try_get("book_id"))
        .collect::<Result<Vec<i64>, _>>()?;
    let books: HashMap<i64, EbookMetadata> =
        get_books_by_ids_projected(pool, &book_ids, Projection::List)
            .await?
            .into_iter()
            .map(|book| (book.id, book))
            .collect();

    let mut listed = Vec::with_capacity(rows.len());
    for row in &rows {
        let request = row_to_request(row)?;
        let Some(book) = books.get(&row.try_get::<i64, _>("book_id")?) else {
            continue;
        };
        listed.push(Listed {
            versions: versions.remove(&request.id).unwrap_or_default(),
            book: book.clone(),
            requester_name: row.try_get("requester_name")?,
            cancelled_by_name: row.try_get("cancelled_by_name")?,
            request,
        });
    }
    Ok(listed)
}

/// For each of `request_ids`, the version it picked and those it gave up.
async fn kept_versions(
    pool: &SqlitePool,
    request_ids: &[i64],
) -> Result<HashMap<i64, Vec<RequestVersion>>, RequestError> {
    let rows = sqlx::query(
        "SELECT r.request_id, r.id, r.title, r.size_bytes, r.format, r.indexer, r.seeders, r.best_match,
                r.tried
           FROM book_request_results r
           JOIN book_requests q ON q.id = r.request_id
          WHERE r.request_id IN (SELECT value FROM json_each(?1))
            AND (r.tried = 1 OR r.id = q.chosen_result_id)
          ORDER BY r.tried, r.id",
    )
    .bind(ids_json(request_ids))
    .fetch_all(pool)
    .await?;
    let mut by_request: HashMap<i64, Vec<RequestVersion>> = HashMap::new();
    for r in &rows {
        by_request
            .entry(r.try_get("request_id")?)
            .or_default()
            .push(RequestVersion {
                id: r.try_get("id")?,
                title: r.try_get("title")?,
                size_bytes: r.try_get("size_bytes")?,
                format: r.try_get("format")?,
                indexer: r.try_get("indexer")?,
                seeders: r.try_get("seeders")?,
                best_match: r.try_get::<i64, _>("best_match")? != 0,
                rejected: r.try_get::<i64, _>("tried")? != 0,
            });
    }
    Ok(by_request)
}
