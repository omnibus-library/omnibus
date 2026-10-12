//! Pure helpers shared across the db query layer:
//! deterministic UUID derivation, filename / accent-color sanitisation,
//! embedded series-index parsing, and the FTS5 query / match builders.

use std::path::Path;
use std::sync::OnceLock;

use omnibus_shared::EbookMetadata;
use regex::Regex;

// `overrides_win_sql` is expanded *by* the two effective-membership macros —
// a nested `macro_rules!` name resolves at the expansion site, so it must be
// in scope here even though nothing in this file names it directly.
use crate::metadata_overrides::sql::{effective_genres_sql, effective_tags_sql, overrides_win_sql};

/// Maximum query length (in chars) accepted by the FTS5 search entrypoints
/// (`search_books`, `count_search_books`, `search_palette`). Longer inputs are
/// truncated before reaching [`build_search_query`] / `LIKE`, bounding the
/// generated MATCH expression and pattern; the limit is tunable in one place.
pub(crate) const MAX_QUERY_LEN: usize = 256;

/// Trim surrounding whitespace and cap a user query to [`MAX_QUERY_LEN`]
/// chars before it reaches [`build_search_query`] / `LIKE`. Collecting chars
/// (not bytes) guarantees the truncation never lands mid-codepoint. Shared
/// by every search entrypoint so the cap is applied identically everywhere.
pub(crate) fn cap_query_len(q: &str) -> String {
    q.trim().chars().take(MAX_QUERY_LEN).collect()
}

/// Encode library paths for binding through SQLite's `json_each`.
pub(crate) fn library_paths_json(library_paths: &[&str]) -> String {
    serde_json::Value::Array(
        library_paths
            .iter()
            .map(|path| serde_json::Value::String((*path).to_string()))
            .collect(),
    )
    .to_string()
}

/// Encode row ids for binding through SQLite's `json_each`, for id sets from
/// library data (e.g. a duplicate-merge group) that are unbounded by
/// construction: an `IN (…)` list binds one parameter per id and would hit
/// `SQLITE_MAX_VARIABLE_NUMBER`, which varies with the linked SQLite build.
pub(crate) fn ids_json(ids: &[i64]) -> String {
    serde_json::Value::Array(
        ids.iter()
            .map(|id| serde_json::Value::Number((*id).into()))
            .collect(),
    )
    .to_string()
}

/// SQL fragment for "search may surface this book": it sits under a configured
/// scan root, or holds a physical copy. A fileless book with *no* copy (a
/// wishlist entry) stays hidden. Every search path shares this definition so
/// the palette and `/api/search` cannot drift. `book` / `root` / `paths_param`
/// name the call site's aliases and the placeholder bound to [`library_paths_json`].
pub(crate) fn visible_book_sql(book: &str, root: &str, paths_param: &str) -> String {
    format!(
        "({root}.path IN (SELECT value FROM json_each({paths_param})) \
          OR EXISTS (SELECT 1 FROM physical_copies pc WHERE pc.book_uuid = {book}.uuid))"
    )
}

/// Deterministic UUIDv5 from `(library_path, filename)`, used only as the
/// handle on a `merged_uuids` attach-ledger row; book identity is
/// [`mint_uuid`]. UUIDv5, not `DefaultHasher`, because the value must survive
/// a Rust toolchain bump.
pub(crate) fn stable_uuid(library_path: &str, filename: &str) -> String {
    // NUL is the one byte that can't appear inside either side, so it's a
    // safe, unambiguous separator — no `(library_path, filename)` collision
    // is reachable from a different split.
    let key = format!("{library_path}\0{filename}");
    uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_URL, key.as_bytes())
        .hyphenated()
        .to_string()
}

/// Mint a fresh, durable book identity: a random UUIDv4 assigned once at insert
/// and **never recomputed**, so it cannot move when a library root is repointed
/// or collide for two distinct books that share a title/author or bytes. The
/// diff matches on the relative-path [`scan_key_for`] instead.
pub(crate) fn mint_uuid() -> String {
    uuid::Uuid::new_v4().hyphenated().to_string()
}

/// The diff key: a book's path *relative to its scan root* (e.g.
/// `Author/Title.epub`). Stored in `books.scan_key` and matched disk-vs-DB, so a
/// library-root repoint preserves every `books.uuid`. Currently the identity
/// function; the single chokepoint should folding ever be needed.
pub(crate) fn scan_key_for(relative_path: &str) -> String {
    relative_path.to_string()
}

/// Dot-directories and Synology's `@eaDir` — never library content, and
/// routinely unreadable, which would flag the walk `incomplete` and suppress
/// the removal pass on every scan.
pub(crate) fn is_skipped_scan_dir(name: &str) -> bool {
    name.starts_with('.') || name.eq_ignore_ascii_case("@eaDir")
}

/// Split `dir/sub/name.epub` into (`dir/sub`, `name`, `EPUB`). If no dir,
/// the path portion is empty. Extension is uppercased per Calibre convention.
pub(crate) fn split_filename(filename: &str) -> (String, String, String) {
    let path = Path::new(filename);
    let parent = path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| filename.to_string());
    let ext = path
        .extension()
        .map(|s| s.to_string_lossy().to_ascii_uppercase())
        .unwrap_or_else(|| "UNKNOWN".to_string());
    (parent, stem, ext)
}

/// Parse a series index, rejecting non-finite values. `"nan"`/`"inf"` parse to
/// floats SQLite stores happily, but a non-finite `series_index` corrupts the
/// Series-axis ordering and breaks the keyset cursor (`serde_json` refuses to
/// encode NaN/Inf), so drop them here at the source.
pub(crate) fn parse_series_index(s: &str) -> Option<f64> {
    s.trim().parse::<f64>().ok().filter(|n| n.is_finite())
}

/// Split a trailing embedded index off a series name: `"#N"` or `", Book N"`
/// (case-insensitive, optional decimal), e.g. `"Mistborn #2"`. Returns
/// `Some((cleaned_name, digits))` when the suffix is present and something
/// survives stripping it, else `None`. Shared by the sync writers and
/// `series_normalize`'s boot backfill so both converge on one series row.
pub(crate) fn split_embedded_series_index(name: &str) -> Option<(String, String)> {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    let re = PATTERN.get_or_init(|| {
        Regex::new(r"(?i)^(?P<name>.+?)\s*,?\s*(?:#\s*|book\s+)(?P<idx>\d+(?:\.\d+)?)\s*$")
            .expect("embedded series index pattern is a valid, static regex")
    });
    let caps = re.captures(name.trim())?;
    let cleaned = caps["name"].trim().trim_end_matches(',').trim();
    if cleaned.is_empty() {
        return None;
    }
    Some((cleaned.to_string(), caps["idx"].to_string()))
}

/// The series name to store for `m`: `m.series` trimmed, with any trailing
/// embedded index suffix stripped ([`split_embedded_series_index`]) so
/// "Name #1"/"Name #2" collapse onto one series row instead of fragmenting.
/// `None` when `m.series` is absent or blank.
pub(crate) fn cleaned_series_name(m: &EbookMetadata) -> Option<String> {
    let raw = m
        .series
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    Some(match split_embedded_series_index(raw) {
        Some((cleaned, _)) => cleaned,
        None => raw.to_string(),
    })
}

/// The series index to store for `m`: the explicit `series_index` field
/// when it parses to a finite number (AC2 — explicit metadata always wins),
/// else an index parsed off a trailing suffix embedded in the series name
/// itself.
pub(crate) fn resolved_series_index(m: &EbookMetadata) -> Option<f64> {
    m.series_index
        .as_deref()
        .and_then(parse_series_index)
        .or_else(|| {
            m.series
                .as_deref()
                .and_then(split_embedded_series_index)
                .and_then(|(_, idx)| parse_series_index(&idx))
        })
}

/// Defense-in-depth gate on `books.accent_color`: accepts only the exact shape
/// `oklch(L C H)` with three space-separated decimal floats, because consumers
/// inline the value into an HTML `style` attribute and a future override path
/// must not be able to smuggle CSS out of it.
pub(crate) fn sanitize_accent_color(raw: Option<&str>) -> Option<String> {
    let s = raw?.trim();
    let inner = s.strip_prefix("oklch(")?.strip_suffix(')')?;
    let parts: Vec<&str> = inner.split(' ').collect();
    if parts.len() != 3 {
        return None;
    }
    for part in &parts {
        if part.is_empty() || part.matches('.').count() > 1 {
            return None;
        }
        let mut has_digit = false;
        for c in part.chars() {
            match c {
                '0'..='9' => has_digit = true,
                '.' => {}
                _ => return None,
            }
        }
        // Reject parts with no digits at all (a bare "." or ".." stripped of
        // characters). The `extract_accent` formatter always emits at least
        // one digit on each side per `{l:.3}` / `{c:.3}` / `{h:.1}`.
        if !has_digit {
            return None;
        }
    }
    Some(s.to_string())
}

/// Join an iterator of names into a single whitespace-separated string for
/// the FTS `authors` / `tags` columns. Empty inputs collapse to "".
pub(crate) fn join_names<'a, I: IntoIterator<Item = &'a str>>(iter: I) -> String {
    let mut out = String::new();
    for name in iter {
        if name.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(name);
    }
    out
}

/// The bm25 ranking expression shared by the two FTS5 MATCH scans
/// (`books::search` and the palette's books arm): one weight per `books_fts`
/// column in declaration order (title, authors, series, tags, description,
/// isbn, genres). Title dominates, then authors and series.
// One shared constant: fts5 defaults missing weights to 1.0, so a short tuple
// would silently go stale when a column is added.
pub(crate) const FTS_BM25_RANK: &str = "bm25(books_fts, 10.0, 4.0, 3.0, 1.0, 1.0, 1.0, 1.0)";

/// One token of a parsed query, and whether the reader (or a link the app
/// built) wrote it inside double quotes.
struct QueryToken {
    text: String,
    /// A quoted token is an **exact** value, so it gets no trailing `*`: the
    /// prefix star is type-ahead, and a facet link carries a name the app knows
    /// in full, which prefix-matching would silently widen (`tag:"Science
    /// fiction"` also matched "Science Fiction & Fantasy").
    quoted: bool,
}

/// Split a query into logical tokens, keeping a double-quoted run together:
/// `tag:"Science Fiction"` is one token, not a facet per word. Quotes are
/// dropped from the text but *that it was quoted* is kept (see
/// [`QueryToken::quoted`]). An unclosed quote runs to the end of the input
/// rather than erroring, since the reader is mid-type.
fn split_query_tokens(raw: &str) -> Vec<QueryToken> {
    let mut out: Vec<QueryToken> = Vec::new();
    let mut current = String::new();
    let mut started = false;
    let mut quoted = false;
    let mut in_quotes = false;
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            // `""` inside a quoted run is one literal quote — the escape
            // `format::facet_query` writes. Toggling on both halves instead
            // swallowed the character, so a tag whose name contains a quote
            // was searched for under a different name than the heading shows.
            '"' if in_quotes && chars.peek() == Some(&'"') => {
                chars.next();
                current.push('"');
            }
            '"' => {
                in_quotes = !in_quotes;
                // A quote opens a token even when what it wraps is empty, so
                // `tag:""` still parses as an empty-valued facet and is
                // dropped by the caller rather than becoming free text.
                started = true;
                quoted = true;
            }
            c if c.is_whitespace() && !in_quotes => {
                if started {
                    out.push(QueryToken {
                        text: std::mem::take(&mut current),
                        quoted,
                    });
                    started = false;
                    quoted = false;
                }
            }
            c => {
                current.push(c);
                started = true;
            }
        }
    }
    if started {
        out.push(QueryToken {
            text: current,
            quoted,
        });
    }
    out
}

/// A user query split into the part FTS5 answers and the parts resolved relationally.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SearchQuery {
    /// The FTS5 `MATCH` expression for free text, authors, and series.
    pub fts_match: Option<String>,
    /// Tag names to match exactly against relational membership.
    pub tag_facets: Vec<String>,
    /// Genre names to match exactly against relational membership.
    pub genre_facets: Vec<String>,
}

impl SearchQuery {
    /// True when there is nothing to run — callers short-circuit to empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.fts_match.is_none() && self.tag_facets.is_empty() && self.genre_facets.is_empty()
    }
}

/// One correlated `EXISTS` per facet value, plus the values to bind in the order
/// the predicates place their placeholders. The caller supplies the outer
/// `books b` the predicates correlate against. Per value rather than one `IN`
/// list because facets AND together: a book must carry every tag named.
pub(crate) fn facet_exists_predicates(query: &SearchQuery) -> (String, Vec<String>) {
    let mut sql = String::new();
    let mut binds = Vec::with_capacity(query.tag_facets.len() + query.genre_facets.len());
    // Each predicate wraps the membership relation in a derived table so its
    // own `books b` stays scoped and `b.id` still resolves to the tested row.
    for name in &query.tag_facets {
        sql.push_str(concat!(
            " AND EXISTS (SELECT 1 FROM (",
            effective_tags_sql!(),
            ") et JOIN tags ft ON ft.id = et.tag_id
               WHERE et.book_id = b.id AND ft.name = ? COLLATE NOCASE)"
        ));
        binds.push(name.clone());
    }
    for name in &query.genre_facets {
        sql.push_str(concat!(
            " AND EXISTS (SELECT 1 FROM (",
            effective_genres_sql!(),
            ") eg JOIN genres fg ON fg.id = eg.genre_id
               WHERE eg.book_id = b.id AND fg.name = ? COLLATE NOCASE)"
        ));
        binds.push(name.clone());
    }
    (sql, binds)
}

/// Split a user query into its FTS5 expression and relational facets.
pub fn build_search_query(raw: &str) -> SearchQuery {
    let mut author_tokens: Vec<QueryToken> = Vec::new();
    let mut series_tokens: Vec<QueryToken> = Vec::new();

    let mut free_tokens: Vec<QueryToken> = Vec::new();
    let mut tag_facets: Vec<String> = Vec::new();
    let mut genre_facets: Vec<String> = Vec::new();

    for token in split_query_tokens(raw) {
        if let Some((prefix, value)) = token.text.split_once(':') {
            let lower = prefix.to_ascii_lowercase();
            if value.is_empty() && matches!(lower.as_str(), "author" | "series" | "tag" | "genre") {
                continue;
            }
            match lower.as_str() {
                "author" => {
                    author_tokens.push(QueryToken {
                        text: value.to_string(),
                        quoted: token.quoted,
                    });
                    continue;
                }
                "series" => {
                    series_tokens.push(QueryToken {
                        text: value.to_string(),
                        quoted: token.quoted,
                    });
                    continue;
                }
                "tag" => {
                    tag_facets.push(value.to_string());
                    continue;
                }
                "genre" => {
                    genre_facets.push(value.to_string());
                    continue;
                }
                _ => {}
            }
        }
        free_tokens.push(token);
    }

    let mut clauses: Vec<String> = Vec::new();
    if let Some(s) = sanitize_query_tokens(&author_tokens) {
        clauses.push(format!("{{authors}} : ({s})"));
    }
    if let Some(s) = sanitize_query_tokens(&series_tokens) {
        clauses.push(format!("{{series}} : ({s})"));
    }
    if let Some(s) = sanitize_query_tokens(&free_tokens) {
        clauses.push(format!("{{title authors series}} : ({s})"));
    }

    let fts_match = if clauses.is_empty() {
        None
    } else {
        Some(clauses.join(" AND "))
    };
    SearchQuery {
        fts_match,
        tag_facets,
        genre_facets,
    }
}

/// Wrap each whitespace-separated token in double-quotes and append `*` to the
/// last for prefix matching, so plain words (including FTS5-reserved tokens
/// like `AND`/`NOT` or hyphenated ISBNs) cannot cause a `MATCH` parse error.
/// `None` when the sanitized query is empty: don't run the query.
pub fn sanitize_fts_query(raw: &str) -> Option<String> {
    let tokens: Vec<&str> = raw.split_whitespace().collect();
    sanitize_fts_tokens(&tokens)
}

/// Per-token quoting/escaping shared by [`sanitize_fts_query`] and
/// [`build_search_query`]. A token with internal whitespace (a quoted facet
/// value from [`split_query_tokens`]) is emitted as an FTS5 phrase.
fn sanitize_fts_tokens<S: AsRef<str>>(tokens: &[S]) -> Option<String> {
    quote_tokens(tokens.iter().map(AsRef::as_ref), true)
}

/// [`sanitize_fts_tokens`] for parsed [`QueryToken`]s: identical, except the
/// trailing prefix `*` is dropped when the last token was quoted, so a
/// clicked facet matches the name exactly instead of everything starting
/// with it.
fn sanitize_query_tokens(tokens: &[QueryToken]) -> Option<String> {
    let prefix_last = !tokens.last().is_some_and(|t| t.quoted);
    quote_tokens(tokens.iter().map(|t| t.text.as_str()), prefix_last)
}

/// Quote and escape each token into an FTS5 phrase, optionally making the
/// last one a prefix match.
fn quote_tokens<'a>(tokens: impl Iterator<Item = &'a str>, prefix_last: bool) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    for token in tokens {
        // Double quotes inside a token would terminate the quoted phrase.
        // FTS5's quoted phrase escape is `""`, so double every quote.
        let escaped = token.replace('"', "\"\"");
        if escaped.is_empty() {
            continue;
        }
        parts.push(format!("\"{escaped}\""));
    }
    if parts.is_empty() {
        return None;
    }
    if prefix_last {
        let last = parts.len() - 1;
        parts[last].push('*');
    }
    Some(parts.join(" "))
}

/// Render a series index for display: whole numbers lose the decimal tail,
/// everything else keeps it. Non-finite input passes through verbatim.
pub(crate) fn format_series_index(v: f64) -> String {
    if !v.is_finite() {
        return format!("{v}");
    }
    if (v - v.trunc()).abs() < f64::EPSILON {
        // Clamp to the f64-exactly-representable integer range before the
        // cast so an out-of-range value can't saturate to `i64::MIN`/MAX
        // and surface as `-9223372036854775808` in the UI.
        const LIMIT: f64 = 9.0e15;
        let bounded = v.trunc().clamp(-LIMIT, LIMIT);
        #[allow(clippy::cast_possible_truncation)]
        let i = bounded as i64;
        format!("{i}")
    } else {
        format!("{v}")
    }
}

/// A row's creation time from the client stamp bound in place of the `?`:
/// clamped to server-now so a fast device clock can't date a row into the
/// future, and server-now when the client sent none. The casts matter —
/// `strftime` yields TEXT, which SQLite sorts above every INTEGER.
pub(crate) const CLIENT_CREATED_AT_SQL: &str =
    "MIN(COALESCE(?, CAST(strftime('%s','now') AS INTEGER)), \
     CAST(strftime('%s','now') AS INTEGER))";

#[cfg(test)]
mod tests;
