//! Candidate search for the merge dialog: one FTS5 pass over each
//! configured library, deduped by uuid and capped small. Shared by the web
//! `rpc_merge_candidates` server fn and the REST
//! `GET /api/books/merge/candidates` handler so the two surfaces can't drift.

use std::collections::HashSet;

use omnibus_shared::EbookMetadata;
use sqlx::SqlitePool;

use super::MergeError;

/// Rows the dialog shows — it lists a handful, so the search is capped here
/// rather than paged.
pub const MERGE_CANDIDATE_CAP: usize = 20;

/// Search both configured libraries for `q`, explicitly deduped by uuid for
/// the shared-directory case (both library slots pointing at one path would
/// otherwise return every hit twice) and truncated to
/// [`MERGE_CANDIDATE_CAP`]. Callers enforce the query-length cap; this is
/// the search itself.
pub async fn merge_candidates(
    pool: &SqlitePool,
    q: &str,
) -> Result<Vec<EbookMetadata>, MergeError> {
    let settings = crate::get_settings(pool).await?;
    let mut out: Vec<EbookMetadata> = Vec::new();
    for path in [settings.ebook_library_path, settings.audiobook_library_path]
        .into_iter()
        .flatten()
    {
        out.extend(crate::search_books(pool, &path, q).await?);
    }
    let mut seen = HashSet::new();
    out.retain(|b| seen.insert(b.unique_identifier.clone()));
    out.truncate(MERGE_CANDIDATE_CAP);
    Ok(out)
}
