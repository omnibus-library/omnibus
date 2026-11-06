//! The requests the Requests page and a book's history list: each with its book, who made it,
//! who cancelled it, and the versions it picked or gave up, so a row can say how far it got.

use std::collections::HashMap;

use omnibus_shared::{EbookMetadata, RequestState, RequestVersion};
use sqlx::{QueryBuilder, Row, Sqlite, SqliteConnection, SqlitePool};

use crate::books::{get_books_by_ids_projected, Projection};
use crate::helpers::ids_json;

use super::{row_to_request, row_to_version, RequestError, RequestRow};

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

/// Appends the query behind [`list`] to `query`.
pub fn push_select<'a>(query: &mut QueryBuilder<'a, Sqlite>, filter: ListFilter<'a>) {
    query.push(
        "SELECT q.*, b.id AS book_id,
                COALESCE(u.display_name, u.username) AS requester_name,
                COALESCE(c.display_name, c.username) AS cancelled_by_name
           FROM book_requests q
           JOIN books b ON b.uuid = q.book_uuid
           JOIN users u ON u.id = q.user_id
           LEFT JOIN users c ON c.id = q.cancelled_by
          WHERE 1 = 1",
    );
    // Only the filters set, so the planner can take the book or reader index.
    if let Some(uuid) = filter.book_uuid {
        query.push(" AND q.book_uuid = ").push_bind(uuid);
    }
    if let Some(user) = filter.user_id {
        query.push(" AND q.user_id = ").push_bind(user);
    }
    if let Some(state) = filter.state {
        query.push(" AND q.state = ").push_bind(state.as_str());
    }
    query.push(" ORDER BY q.id DESC LIMIT ");
    query.push_bind(LIST_LIMIT);
}

/// The requests `filter` matches, newest first, at most [`LIST_LIMIT`]. A request whose book
/// is gone is left out.
pub async fn list(pool: &SqlitePool, filter: ListFilter<'_>) -> Result<Vec<Listed>, RequestError> {
    let mut query = QueryBuilder::new("");
    push_select(&mut query, filter);
    // One read transaction, so a row and its versions come from the same snapshot.
    let mut tx = pool.begin().await?;
    let rows = query.build().fetch_all(&mut *tx).await?;

    let request_ids = rows
        .iter()
        .map(|r| r.try_get("id"))
        .collect::<Result<Vec<i64>, _>>()?;
    let mut versions = kept_versions(&mut tx, &request_ids).await?;
    tx.commit().await?;
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
    conn: &mut SqliteConnection,
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
    .fetch_all(conn)
    .await?;
    let mut by_request: HashMap<i64, Vec<RequestVersion>> = HashMap::new();
    for r in &rows {
        by_request
            .entry(r.try_get("request_id")?)
            .or_default()
            .push(row_to_version(r)?);
    }
    Ok(by_request)
}
