//! The matching ladder and check-in write composition.
//!
//! The scan flow is supervised: `CloseMatch` is a confirmation screen, never
//! auto-applied, so a wrong suggestion costs a tap while a missed one costs a
//! duplicate physical-only book. The fuzzy rung therefore offers every matching row
//! and is looser than the unattended `normalize`/`sync::attach` path, whose strict
//! guard exists because a false positive there silently corrupts a book. A print
//! edition's barcode ISBN differs from the ebook's, so the norm rung is the only
//! bridge between a scanned copy and an existing ebook.

use omnibus_shared::isbn::{normalize_isbn, IsbnError};
use omnibus_shared::metadata_lookup::ExternalBookMeta;
use omnibus_shared::physical::{PhysicalCopy, WishlistSource};
use omnibus_shared::scan::{ScanBook, ScanOutcome};
use sqlx::{Row, SqlitePool};

use crate::author_photos::{fetch_remote_image_with, RemoteImageConfig};
use crate::metadata_lookup::{
    openlibrary_enrich, provider_cover_image_config, search_provider_by_isbn, MetadataLookupConfig,
    MetadataLookupError,
};
use crate::normalize::{normalize_author, normalize_title};
use crate::physical::{
    add_physical_copy, add_wishlist_entry, create_fileless_book, get_wishlist_entry, FilelessBook,
    FilelessCover, PhysicalError,
};

use super::projection::{row_to_scan_book, scan_book_cols, LIVE_BOOK};

/// How many library rows one close match may offer the reader to choose from.
/// An EPUB and the audiobook the indexer never attached to it is the case the
/// picker exists for; a predicate that sprays past a handful is a pathological
/// match, so the list is capped rather than shipped whole.
pub(super) const MAX_CLOSE_MATCH_CANDIDATES: usize = 5;

/// Errors from the scan flow.
#[derive(Debug, thiserror::Error)]
pub enum ScanError {
    /// The input ISBN failed validation (length, chars, or check digit).
    #[error(transparent)]
    Isbn(#[from] IsbnError),
    /// A metadata provider was unreachable or unparseable.
    #[error(transparent)]
    Lookup(#[from] MetadataLookupError),
    /// A physical/wishlist write failed.
    #[error(transparent)]
    Physical(#[from] PhysicalError),
    /// `wishlist_add` was called with neither a `book_uuid` nor `meta`.
    #[error("wishlist add requires a book_uuid or meta")]
    MissingWishlistTarget,
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
}

/// Resolve a scanned/typed ISBN down the matching ladder: a bad ISBN is
/// [`ScanError::Isbn`]; an exact `book_identifiers` hit is `AlreadyOwned` /
/// `OnWishlist` / `InLibraryUnowned`; otherwise an online lookup, where a
/// normalized (title, author) hit is a `CloseMatch` (never auto-resolved), else
/// `NotInLibrary`, and a provider miss is `Unresolved`. `user_id` scopes `OnWishlist`.
pub async fn resolve_scan(
    pool: &SqlitePool,
    user_id: i64,
    raw_isbn: &str,
    config: &MetadataLookupConfig,
) -> Result<ScanOutcome, ScanError> {
    let isbn13 = normalize_isbn(raw_isbn)?;

    if let Some(book) = find_book_by_isbn(pool, &isbn13).await? {
        return library_outcome(pool, user_id, book).await;
    }

    match search_provider_by_isbn(config, &isbn13).await? {
        Some(meta) => match find_book_by_norm(pool, &meta).await? {
            Some((book, others)) => Ok(ScanOutcome::CloseMatch {
                book,
                others,
                scanned: meta,
            }),
            None => Ok(ScanOutcome::NotInLibrary { online: meta }),
        },
        None => Ok(ScanOutcome::Unresolved),
    }
}

/// Resolve a picked title-search candidate down the same ladder as
/// [`resolve_scan`], minus the provider ISBN lookup (the metadata is already in
/// hand, and a re-lookup could miss on a flaky provider and turn a surfaced book
/// into "unresolved"). Series / first-publish enrichment still runs, since
/// search results don't carry those fields.
pub async fn resolve_meta(
    pool: &SqlitePool,
    user_id: i64,
    meta: &ExternalBookMeta,
    config: &MetadataLookupConfig,
) -> Result<ScanOutcome, ScanError> {
    // `meta` is untrusted wire input, so its ISBN is canonicalized once here
    // and the raw string never leaves this function: it reaches neither SQL
    // nor — since enrichment interpolates it into a provider URL path — an
    // outbound request. `None` means it didn't validate, which skips both.
    let isbn13 = canonical_isbn(meta);

    if let Some(isbn13) = &isbn13 {
        if let Some(book) = find_book_by_isbn(pool, isbn13).await? {
            return library_outcome(pool, user_id, book).await;
        }
    }

    let mut meta = meta.clone();
    if let Some(isbn13) = &isbn13 {
        let enrichment = openlibrary_enrich(config, isbn13).await;
        meta.series = meta.series.or(enrichment.series);
        meta.first_publish_year = meta.first_publish_year.or(enrichment.first_publish_year);
    }

    match find_book_by_norm(pool, &meta).await? {
        Some((book, others)) => Ok(ScanOutcome::CloseMatch {
            book,
            others,
            scanned: meta,
        }),
        None => Ok(ScanOutcome::NotInLibrary { online: meta }),
    }
}

/// Map an exact-identifier library hit onto its outcome: physically owned,
/// wishlisted by this caller, or in the library digitally only.
async fn library_outcome(
    pool: &SqlitePool,
    user_id: i64,
    book: ScanBook,
) -> Result<ScanOutcome, ScanError> {
    if book.has_physical {
        return Ok(ScanOutcome::AlreadyOwned { book });
    }
    // Checking in a copy clears every user's wishlist entry for the book, so a book
    // with a physical copy is never also wishlisted; this only bites without one.
    let on_wishlist = get_wishlist_entry(pool, user_id, &book.uuid)
        .await?
        .is_some();
    Ok(if on_wishlist {
        ScanOutcome::OnWishlist { book }
    } else {
        ScanOutcome::InLibraryUnowned { book }
    })
}

/// Check in a physical copy of a library book, canonicalizing the scanned ISBN
/// before it is stored. Returns the inserted copy. The client-supplied ISBN is
/// folded to the 13-digit form [`find_book_by_isbn`] compares against, so a copy
/// filed under an ISBN-10 isn't invisible to its own re-scan. An ISBN that
/// doesn't validate is dropped rather than stored (as [`add_physical_only`] does).
pub async fn check_in_copy(
    pool: &SqlitePool,
    book_uuid: &str,
    isbn: Option<&str>,
    added_by_user_id: Option<i64>,
    note: Option<&str>,
) -> Result<PhysicalCopy, ScanError> {
    let isbn = isbn.and_then(|raw| normalize_isbn(raw).ok());
    Ok(add_physical_copy(pool, book_uuid, isbn.as_deref(), added_by_user_id, note).await?)
}

/// Add a physical-only book from resolved external metadata: mint a fileless
/// book (cover fetched now, not at lookup time) and check in its first copy.
/// Returns the new book's uuid.
pub async fn add_physical_only(
    pool: &SqlitePool,
    meta: &ExternalBookMeta,
    note: Option<&str>,
    added_by_user_id: Option<i64>,
) -> Result<String, ScanError> {
    add_physical_only_with(
        pool,
        meta,
        note,
        added_by_user_id,
        &provider_cover_image_config(false),
    )
    .await
}

/// [`add_physical_only`] with an injectable cover-fetch config.
///
/// `pub(crate)` deliberately: the only reason to pass anything other than
/// [`provider_cover_image_config`] is a test pointing the fetch at a loopback
/// `wiremock` origin, and that config relaxes the SSRF address gate.
pub(crate) async fn add_physical_only_with(
    pool: &SqlitePool,
    meta: &ExternalBookMeta,
    note: Option<&str>,
    added_by_user_id: Option<i64>,
    image_config: &RemoteImageConfig,
) -> Result<String, ScanError> {
    let uuid = create_fileless_from_meta(pool, meta, image_config).await?;
    // Store the canonical ISBN per copy (meta arrives over the wire — untrusted).
    let isbn = canonical_isbn(meta);
    add_physical_copy(pool, &uuid, isbn.as_deref(), added_by_user_id, note).await?;
    Ok(uuid)
}

/// Add a book to a user's physical wishlist — an existing library book
/// (`book_uuid`) or a new fileless book from `meta`. `book_uuid` takes
/// precedence when both are supplied. Returns the book's uuid.
pub async fn wishlist_add(
    pool: &SqlitePool,
    user_id: i64,
    book_uuid: Option<&str>,
    meta: Option<&ExternalBookMeta>,
    source: WishlistSource,
) -> Result<String, ScanError> {
    wishlist_add_with(
        pool,
        user_id,
        book_uuid,
        meta,
        source,
        &provider_cover_image_config(false),
    )
    .await
}

/// [`wishlist_add`] with an injectable cover-fetch config — `pub(crate)` on the
/// same terms as [`add_physical_only_with`].
pub(crate) async fn wishlist_add_with(
    pool: &SqlitePool,
    user_id: i64,
    book_uuid: Option<&str>,
    meta: Option<&ExternalBookMeta>,
    source: WishlistSource,
    image_config: &RemoteImageConfig,
) -> Result<String, ScanError> {
    let uuid = match (book_uuid, meta) {
        (Some(uuid), _) => uuid.to_string(),
        (None, Some(meta)) => create_fileless_from_meta(pool, meta, image_config).await?,
        (None, None) => return Err(ScanError::MissingWishlistTarget),
    };
    let entry = add_wishlist_entry(pool, user_id, &uuid, source).await?;
    Ok(entry.book_uuid)
}

/// Mint a fileless book from external metadata, fetching its cover now. `meta`
/// crosses the HTTP boundary, so its `cover_url` is client-controlled and
/// `image_config` constrains the fetch: production callers pass
/// [`provider_cover_image_config`]`(false)` (HTTPS, provider hosts, SSRF gate,
/// size cap, bounded redirects Open Library needs). The ISBN is re-canonicalized.
async fn create_fileless_from_meta(
    pool: &SqlitePool,
    meta: &ExternalBookMeta,
    image_config: &RemoteImageConfig,
) -> Result<String, ScanError> {
    let cover = match &meta.cover_url {
        Some(url) => match fetch_remote_image_with(url, image_config).await {
            Ok((mime, bytes)) => Some(FilelessCover { mime, bytes }),
            // Non-fatal — a missing cover must not fail the check-in — but
            // logged: a cover the reader watched render on the check-in card
            // and then lost is otherwise invisible to the operator.
            Err(e) => {
                tracing::warn!(url, error = %e, "cover fetch failed; minting book without it");
                None
            }
        },
        None => None,
    };
    let uuid = create_fileless_book(
        pool,
        FilelessBook {
            title: meta.title.clone(),
            authors: meta.authors.clone(),
            isbn: canonical_isbn(meta),
            pubdate: meta.year.clone(),
            description: meta.description.clone(),
            cover,
        },
    )
    .await?;
    Ok(uuid)
}

/// Canonicalize `meta.isbn13` (untrusted wire input) to a 13-digit ISBN, or
/// `None` if it doesn't validate — better to store no identifier than a bad one.
fn canonical_isbn(meta: &ExternalBookMeta) -> Option<String> {
    normalize_isbn(&meta.isbn13).ok()
}

/// Exact-identifier rung: the book carrying this ISBN in `book_identifiers`, or
/// failing that the book a physical copy carrying it was checked in against. The
/// identifier arm is gated on [`LIVE_BOOK`]: a row on no reader surface is not a
/// book the reader "already has". The copies arm ranks after it, so a book that
/// genuinely publishes the ISBN wins.
async fn find_book_by_isbn(
    pool: &SqlitePool,
    isbn13: &str,
) -> Result<Option<ScanBook>, sqlx::Error> {
    // No caller on this rung reads `isbn`, so skip the correlated subquery.
    let cols = scan_book_cols(true, false);
    // OPF identifiers are stored losslessly (free-form scheme, hyphens/spaces), so match
    // any `%isbn%` scheme with separators stripped. The copies arm makes a hand-linked
    // print barcode stick; it needs no `LIVE_BOOK` gate, since a copy makes a row live.
    let row = sqlx::query(&format!(
        "SELECT {cols}, 0 AS rung
           FROM books b
           JOIN book_identifiers bi ON bi.book_id = b.id
           LEFT JOIN scan_roots l ON l.id = b.library_id
           LEFT JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
          WHERE bi.scheme LIKE '%isbn%'
            AND REPLACE(REPLACE(bi.value, '-', ''), ' ', '') = ?1
            AND {LIVE_BOOK}
         UNION ALL
         SELECT {cols}, 1 AS rung
           FROM books b
           JOIN physical_copies c ON c.book_uuid = b.uuid
           LEFT JOIN scan_roots l ON l.id = b.library_id
           LEFT JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
          WHERE REPLACE(REPLACE(c.isbn, '-', ''), ' ', '') = ?1
          ORDER BY rung LIMIT 1"
    ))
    .bind(isbn13)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(row_to_scan_book))
}

/// Fuzzy rung: the library books whose effective (override-aware) normalized
/// title and author match the resolved metadata, as `(first, rest)` so a hit is
/// non-empty by construction; `None` when nothing matched. Three passes, each run
/// only when the one before found nothing: exact, subtitle-tolerant (title
/// prefix), then [`query_loose_candidates`]. No provider author skips to pass 3.
async fn find_book_by_norm(
    pool: &SqlitePool,
    meta: &ExternalBookMeta,
) -> Result<Option<(ScanBook, Vec<ScanBook>)>, sqlx::Error> {
    let Some(title_norm) = normalize_title(&meta.title) else {
        return Ok(None);
    };
    let author_norm = meta.authors.first().and_then(|a| normalize_author(a));

    // Pass 3 drops a leading article and relaxes the author to `authors_compatible`:
    // print editions disagree on both ("Room with a View", "E. M." vs "Edward Morgan"),
    // defeating passes 1 and 2. With no author it matches on title alone.
    let mut candidates = Vec::new();
    if let Some(author_norm) = &author_norm {
        candidates = query_norm_candidates(pool, &title_norm, author_norm, false).await?;
        if candidates.is_empty() {
            candidates = query_norm_candidates(pool, &title_norm, author_norm, true).await?;
        }
    }
    if candidates.is_empty() {
        candidates = query_loose_candidates(pool, &title_norm, author_norm.as_deref()).await?;
    }
    let mut candidates = candidates.into_iter();
    Ok(candidates.next().map(|first| (first, candidates.collect())))
}

/// Pass 3 of the norm rung: match on the article-stripped title and filter the
/// rows down with [`authors_compatible`] rather than an SQL equality. Rows lead
/// with an exact stripped-title match, ahead of word-boundary prefix matches. The
/// cap to [`MAX_CLOSE_MATCH_CANDIDATES`] applies after the author filter, so a
/// rejected row can't consume a slot the real match needed.
async fn query_loose_candidates(
    pool: &SqlitePool,
    title_norm: &str,
    author_norm: Option<&str>,
) -> Result<Vec<ScanBook>, sqlx::Error> {
    let title_bare = strip_leading_article(title_norm);
    let last_name = author_norm.map(|a| split_name(a).1);
    // Same word-boundary reasoning as `query_norm_candidates`: norm strings are
    // `[a-z0-9 ]` only, so neither bound value carries a LIKE wildcard.
    let pred = |title: &str, author: &str| {
        let bare = bare_title_sql(title);
        let title_pred =
            format!("({bare} = ?1 OR {bare} LIKE ?1 || ' %' OR ?1 LIKE {bare} || ' %')");
        // Last-token equality is the selective half of `authors_compatible`, so
        // it runs in SQL — the fetch window is bounded, and leaving the whole
        // author test to Rust lets a shelf of same-title strangers fill that
        // window and crowd the real match out of it. `IS NULL` keeps a library
        // book with no author key in play, matching the helper's "can't tell".
        let author_pred = match author_norm {
            Some(_) => format!("({author} IS NULL OR {author} = ?2 OR {author} LIKE '% ' || ?2)"),
            None => "1".to_string(),
        };
        format!("{title_pred} AND {author_pred}")
    };
    let books_pred = pred("b.title_norm", "b.author_norm");
    let effective_pred = pred(
        "COALESCE(mo.title_norm, b.title_norm)",
        "COALESCE(mo.author_norm, b.author_norm)",
    );
    let scanned_cols = scan_book_cols(false, true);
    let effective_cols = scan_book_cols(true, true);
    // The union is wrapped rather than ordered in place: SQLite only accepts a
    // bare result column in a compound SELECT's ORDER BY, never an expression.
    let sql = format!(
        "SELECT * FROM (
           SELECT {scanned_cols}, b.author_norm AS match_author_norm,
                  {} AS match_title_norm
             FROM books b
            WHERE {books_pred} AND {LIVE_BOOK}
              AND NOT EXISTS (SELECT 1 FROM metadata_overrides mo WHERE mo.book_uuid = b.uuid)
           UNION ALL
           SELECT {effective_cols}, COALESCE(mo.author_norm, b.author_norm) AS match_author_norm,
                  {} AS match_title_norm
             FROM books b
             JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
             LEFT JOIN scan_roots l ON l.id = b.library_id
            WHERE {effective_pred} AND {LIVE_BOOK})
          ORDER BY (match_title_norm <> ?1), uuid LIMIT {LOOSE_FETCH_LIMIT}",
        bare_title_sql("b.title_norm"),
        bare_title_sql("COALESCE(mo.title_norm, b.title_norm)"),
    );
    let mut query = sqlx::query(&sql).bind(&title_bare);
    if let Some(last_name) = last_name {
        query = query.bind(last_name.to_string());
    }
    // First-token (initial) agreement runs in Rust: SQLite has no tidy way to split a key.
    let rows = query.fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .filter(|r| {
            let library = r.get::<Option<String>, _>("match_author_norm");
            authors_compatible(author_norm, library.as_deref())
        })
        .take(MAX_CLOSE_MATCH_CANDIDATES)
        .map(row_to_scan_book)
        .collect())
}

/// How many rows pass 3 fetches before [`authors_compatible`] thins them.
///
/// Five times the candidate cap: a title selective enough to be worth offering
/// on rarely has more than a handful of library rows, and anything past this
/// window is a pathological match the picker could not present anyway.
pub(super) const LOOSE_FETCH_LIMIT: usize = MAX_CLOSE_MATCH_CANDIDATES * 5;

/// A SQL expression stripping a leading English article off `title`, mirroring
/// [`strip_leading_article`]. Interpolated into the query, so `title` must be a
/// static column expression and never user input.
fn bare_title_sql(title: &str) -> String {
    format!(
        "(CASE WHEN {title} LIKE 'the %' THEN substr({title}, 5)
               WHEN {title} LIKE 'an %'  THEN substr({title}, 4)
               WHEN {title} LIKE 'a %'   THEN substr({title}, 3)
               ELSE {title} END)"
    )
}

/// Drop a leading `a` / `an` / `the` from a normalized title.
///
/// English only, deliberately: these keys are ASCII-folded and the providers
/// that disagree about the article are indexing English titles. A title that is
/// *only* an article keeps it, so the key never normalizes to nothing.
pub(super) fn strip_leading_article(title_norm: &str) -> String {
    for article in ["the ", "an ", "a "] {
        if let Some(rest) = title_norm.strip_prefix(article) {
            if !rest.is_empty() {
                return rest.to_string();
            }
        }
    }
    title_norm.to_string()
}

/// Whether a provider author key and a library author key are close enough to
/// *offer* as a match: the same last token, and first tokens that agree on their
/// initial (one a prefix of the other, so `"e"` matches `"edward"`). Last token,
/// not a parsed surname: assume no more than a token comparison. `None` on either
/// side means *can't tell*, not *doesn't match*, so it is still offered on its title.
pub(super) fn authors_compatible(provider: Option<&str>, library: Option<&str>) -> bool {
    let (Some(provider), Some(library)) = (provider, library) else {
        return true;
    };
    if provider == library {
        return true;
    }
    let (provider_first, provider_last) = split_name(provider);
    let (library_first, library_last) = split_name(library);
    if provider_last != library_last {
        return false;
    }
    match (provider_first, library_first) {
        // A single-token key on either side contradicts nothing the other
        // asserts.
        (None, _) | (_, None) => true,
        (Some(a), Some(b)) => a.starts_with(b) || b.starts_with(a),
    }
}

/// Split a normalized author key into `(first token, last token)` — a
/// positional split on spaces, not name parsing. A single-token key is all
/// last token.
fn split_name(author_norm: &str) -> (Option<&str>, &str) {
    match author_norm.rsplit_once(' ') {
        Some((head, last)) => (head.split(' ').next(), last),
        None => (None, author_norm),
    }
}

/// Run one pass of the norm rung, returning every matching book up to
/// [`MAX_CLOSE_MATCH_CANDIDATES`]. `tolerant` widens the title predicate from
/// exact equality to word-boundary prefix in either direction; author stays an
/// exact effective-norm match in both modes.
async fn query_norm_candidates(
    pool: &SqlitePool,
    title_norm: &str,
    author_norm: &str,
    tolerant: bool,
) -> Result<Vec<ScanBook>, sqlx::Error> {
    // Norm strings are `[a-z0-9 ]` only (see `normalize`), so `?1` carries no
    // LIKE wildcards and the ` %` suffix asserts a word boundary — a prefix
    // match can't span mid-word. The predicates are static strings, not user
    // input, so interpolating them into the SQL is injection-safe.
    let (title_pred_books, title_pred_effective) = if tolerant {
        (
            "(b.title_norm = ?1
              OR b.title_norm LIKE ?1 || ' %'
              OR ?1 LIKE b.title_norm || ' %')",
            "(COALESCE(mo.title_norm, b.title_norm) = ?1
              OR COALESCE(mo.title_norm, b.title_norm) LIKE ?1 || ' %'
              OR ?1 LIKE COALESCE(mo.title_norm, b.title_norm) || ' %')",
        )
    } else {
        (
            "b.title_norm = ?1",
            "COALESCE(mo.title_norm, b.title_norm) = ?1",
        )
    };
    // Two disjoint arms, so `UNION ALL` is exact. No override row (the common case): the
    // effective norm is the scanned norm, so `idx_books_norm` serves it. With one (rare):
    // join the small `metadata_overrides` table and compare the `COALESCE`d norm.
    let scanned_cols = scan_book_cols(false, true);
    let effective_cols = scan_book_cols(true, true);
    let sql = format!(
        "SELECT {scanned_cols}
           FROM books b
          WHERE {title_pred_books} AND b.author_norm = ?2 AND {LIVE_BOOK}
            AND NOT EXISTS (SELECT 1 FROM metadata_overrides mo WHERE mo.book_uuid = b.uuid)
         UNION ALL
         SELECT {effective_cols}
           FROM books b
           JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
           LEFT JOIN scan_roots l ON l.id = b.library_id
          WHERE {title_pred_effective} AND COALESCE(mo.author_norm, b.author_norm) = ?2
            AND {LIVE_BOOK}
          ORDER BY uuid LIMIT {MAX_CLOSE_MATCH_CANDIDATES}"
    );
    let rows = sqlx::query(&sql)
        .bind(title_norm)
        .bind(author_norm)
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(row_to_scan_book).collect())
}
