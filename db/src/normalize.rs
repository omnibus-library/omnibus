//! Title/author normalization for the cross-format auto-attach match
//! key (`books.title_norm` / `books.author_norm`). Computed at index
//! time by the sync writers and backfilled once at boot by
//! [`backfill_norm_columns`]; consumed by `sync::attach`.

// The author sort keys live in `omnibus_shared` so the sync writers here and
// the browser's client-side sorts derive one key.
pub use omnibus_shared::sort_order::{author_sort_key, creator_sort_key};
use omnibus_shared::text_fold::fold_for_match;
use sqlx::SqlitePool;

/// Errors returned by [`backfill_norm_columns`].
#[derive(Debug, thiserror::Error)]
pub enum NormalizeError {
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// Normalize a title into its match key: diacritics folded, lowercased, `&`
/// expanded to `and`, punctuation collapsed to single spaces. `None` when
/// nothing survives. Deliberately exact (no article stripping, no substring or
/// fuzzy matching) so *Dune* never matches *Dune Messiah*: a missed match costs
/// one manual merge, a false positive silently corrupts a book.
pub fn normalize_title(s: &str) -> Option<String> {
    normalize(s)
}

/// Normalize an author name into its match key. Same folding as
/// [`normalize_title`], plus a single-comma `"Last, First"` is swapped
/// to `"First Last"` first — EPUB `file_as` values and audio artist
/// tags disagree on name order.
pub fn normalize_author(s: &str) -> Option<String> {
    let parts: Vec<&str> = s.split(',').collect();
    if parts.len() == 2 {
        return normalize(&format!("{} {}", parts[1], parts[0]));
    }
    normalize(s)
}

/// Fold `s` to `[a-z0-9 ]`, expanding `&` and collapsing everything else to
/// single spaces. `&` is expanded rather than dropped so `"Mirth & Magic"` and
/// `"Mirth and Magic"` converge on one key, in every position (`R&B` becomes
/// `r and b`). `+` is deliberately not expanded: it is usually a literal part
/// of a token (`C++`, `Disney+`), so expanding it would mangle `"C++ Primer"`.
fn normalize(s: &str) -> Option<String> {
    let folded = deunicode::deunicode(s).to_lowercase();
    let mut out = String::with_capacity(folded.len());
    let mut pending_space = false;
    for c in folded.chars() {
        if c == '&' {
            if !out.is_empty() {
                out.push(' ');
            }
            out.push_str("and");
            pending_space = true;
            continue;
        }
        if c.is_ascii_alphanumeric() {
            if pending_space && !out.is_empty() {
                out.push(' ');
            }
            pending_space = false;
            out.push(c);
        } else {
            pending_space = true;
        }
    }
    Some(out).filter(|s| !s.is_empty())
}

/// One-time backfill of `books.(title_norm, author_norm)` for rows indexed
/// before the columns existed. Idempotent (only `title_norm IS NULL` rows) and
/// cheap once caught up, so it runs on every boot from `init_db`. Normalizes
/// **scanned** metadata only; override-derived keys have their own boot pass
/// (`metadata_overrides::backfill_override_norm_columns`).
pub async fn backfill_norm_columns(pool: &SqlitePool) -> Result<(), NormalizeError> {
    let rows: Vec<(i64, String, Option<String>)> = sqlx::query_as(
        "SELECT b.id, b.title, a.name
           FROM books b
           LEFT JOIN books_authors_link l ON l.book = b.id AND l.position = 0
           LEFT JOIN authors a ON a.id = l.author
          WHERE b.title_norm IS NULL",
    )
    .fetch_all(pool)
    .await?;
    if rows.is_empty() {
        return Ok(());
    }

    // `title_norm` lands as '' (not NULL) when nothing survives normalization,
    // so the `IS NULL` guard above stays idempotent. Empty strings never
    // match: the attach lookup only binds non-empty keys. `author_norm` stays
    // genuinely nullable, and a `None` here means *not derivable* — see the
    // COALESCE below.
    let updates: Vec<(i64, String, Option<String>)> = rows
        .into_iter()
        .map(|(id, title, author)| {
            (
                id,
                normalize_title(&title).unwrap_or_default(),
                author.as_deref().and_then(normalize_author),
            )
        })
        .collect();

    let mut tx = pool.begin().await?;
    for chunk in updates.chunks(NORM_UPDATE_CHUNK) {
        let values = std::iter::repeat_n("(?, ?, ?)", chunk.len())
            .collect::<Vec<_>>()
            .join(", ");
        // COALESCE, not a bare write: a NULL recomputed `author_norm` means
        // the key could not be *derived* — no position-0 link (the first
        // creator is on the `ignored_authors` blocklist, which leaves a
        // positional gap the sync writer doesn't) or a name that normalizes
        // to nothing. Overwriting a real stored key with that turns "I can't
        // tell" into "there is none", which is exactly what a migration that
        // hands this pass a `&`-titled row must not cause. Rows that legitimately
        // have no author already hold NULL, so preserving is a no-op for them.
        let sql = format!(
            "UPDATE books
                SET title_norm  = v.column2,
                    author_norm = COALESCE(v.column3, books.author_norm)
               FROM (VALUES {values}) AS v
              WHERE books.id = v.column1"
        );
        let mut q = sqlx::query(&sql);
        for (id, title_norm, author_norm) in chunk {
            q = q.bind(id).bind(title_norm).bind(author_norm);
        }
        q.execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Rows per chunk for the norm-column backfill UPDATE. Three binds per row
/// keeps a chunk under SQLite's 999-parameter cap.
const NORM_UPDATE_CHUNK: usize = 300;

/// `(book id, stored key, first author's name, first author's sort)`.
type AuthorSortRow = (i64, Option<String>, Option<String>, Option<String>);

/// Boot backfill: rewrite any `books.author_sort` that is out of step with the
/// book's first displayed author (the lowest-position link), so the Author axis
/// orders every row on one key format. Heals a given-first display name, a
/// comma-less OPF `file_as` and a key left behind when links changed, and keys
/// a linked book that has none stored. A book with no author link keeps its
/// value unless it is a comma-less key to reshape.
pub async fn backfill_author_sort(pool: &SqlitePool) -> Result<(), NormalizeError> {
    let rows: Vec<AuthorSortRow> = sqlx::query_as(
        "SELECT b.id, b.author_sort, a.name, a.sort
           FROM books b
           LEFT JOIN authors a ON a.id = (
                SELECT l.author FROM books_authors_link l
                 WHERE l.book = b.id ORDER BY l.position LIMIT 1)
          WHERE (b.author_sort IS NOT NULL AND b.author_sort <> '')
             OR a.id IS NOT NULL",
    )
    .fetch_all(pool)
    .await?;
    // No linked author passes a blank name, which keys the stored value itself.
    let updates: Vec<(i64, String)> = rows
        .into_iter()
        .filter_map(|(id, stored, name, sort)| {
            let key = match name {
                Some(name) => creator_sort_key(sort.as_deref(), &name),
                None => creator_sort_key(stored.as_deref(), ""),
            };
            (stored.as_deref() != Some(key.as_str())).then_some((id, key))
        })
        .collect();
    if updates.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await?;
    for chunk in updates.chunks(AUTHOR_SORT_UPDATE_CHUNK) {
        let values = std::iter::repeat_n("(?, ?)", chunk.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "UPDATE books
                SET author_sort = v.column2
               FROM (VALUES {values}) AS v
              WHERE books.id = v.column1"
        );
        let mut q = sqlx::query(&sql);
        for (id, key) in chunk {
            q = q.bind(id).bind(key);
        }
        q.execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Rows per chunk for the author-sort backfill UPDATE. Two binds per row keeps
/// a chunk well under SQLite's 999-parameter cap.
const AUTHOR_SORT_UPDATE_CHUNK: usize = 400;

/// Recompute `authors.name_norm` for every author and rewrite the rows whose
/// stored key disagrees. Run at boot from `init_db`. Compares rather than
/// filtering on `IS NULL`, so it fills rows that predate the column and heals a
/// stale value an `IS NULL` guard could never correct. The write is
/// unconditional because the fold is total: every name yields a key.
pub async fn backfill_author_name_norm(pool: &SqlitePool) -> Result<(), NormalizeError> {
    let rows: Vec<(i64, String, Option<String>)> =
        sqlx::query_as("SELECT id, name, name_norm FROM authors")
            .fetch_all(pool)
            .await?;

    let stale: Vec<(i64, String)> = rows
        .into_iter()
        .filter_map(|(id, name, stored)| {
            let folded = fold_for_match(&name);
            (stored.as_deref() != Some(folded.as_str())).then_some((id, folded))
        })
        .collect();
    if stale.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await?;
    for chunk in stale.chunks(AUTHOR_NAME_NORM_CHUNK) {
        let values = std::iter::repeat_n("(?, ?)", chunk.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "UPDATE authors
                SET name_norm = v.column2
               FROM (VALUES {values}) AS v
              WHERE authors.id = v.column1"
        );
        let mut q = sqlx::query(&sql);
        for (id, folded) in chunk {
            q = q.bind(id).bind(folded);
        }
        q.execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Rows per chunk for the author name-norm backfill UPDATE. Two binds per row
/// keeps a chunk well under SQLite's 999-parameter cap.
const AUTHOR_NAME_NORM_CHUNK: usize = 400;

#[cfg(test)]
mod tests;
