//! `GET`/`POST /koreader/v1/books/{uuid}/annotations` — one EPUB's highlights and notes,
//! both ways. A KOReader highlight is a pair of crengine XPointers; the store holds a range
//! CFI, so each anchor goes through the converter and one the converter cannot prove stays
//! on the device (`unplaceable`) or off it (left out of the listing). Colours cross in a
//! fixed map. The newest write wins and a delete beats an edit. The wire speaks KOReader's
//! vocabulary and is not part of the REST contract.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::annotations::{
    delete_koreader_annotations, koreader_annotations_since, upsert_koreader_annotation,
    HighlightError, KoreaderAnnotation, KoreaderCursor, KoreaderUpsert, UpsertOutcome,
};
use omnibus_db::{self as db};
use omnibus_shared::{CreateHighlight, HighlightColor, UpdateHighlightNote};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::extractor::KoreaderDevice;
use super::state::epub_source;
use crate::backend::kobo::reject_oversized_uuid;
use crate::backend::AppState;
use crate::http_errors::internal;

#[cfg(test)]
mod tests;

/// Most upserts, and most deletes, one push may carry.
const MAX_BATCH: usize = 500;

/// The `?since=` query of a listing: the opaque cursor the last page answered, or a bare
/// integer an older plugin stored. Absent means from the start.
#[derive(Deserialize)]
pub struct Since {
    since: Option<String>,
}

/// One page of changes. `more` says a list was cut short and the device should ask again
/// from `cursor`.
#[derive(Serialize)]
struct Listing {
    cursor: String,
    annotations: Vec<WireAnnotation>,
    deleted: Vec<String>,
    more: bool,
}

#[derive(Serialize)]
struct WireAnnotation {
    id: String,
    pos0: String,
    pos1: String,
    text: Option<String>,
    note: Option<String>,
    color: &'static str,
    created_at: i64,
    updated_at: i64,
}

/// A device's changes to one book: highlights to store and ids to delete, at most
/// [`MAX_BATCH`] of each.
#[derive(Deserialize)]
pub struct Push {
    #[serde(default)]
    upserts: Vec<PushUpsert>,
    #[serde(default)]
    deletes: Vec<String>,
}

#[derive(Deserialize)]
struct PushUpsert {
    id: String,
    pos0: String,
    pos1: String,
    text: Option<String>,
    note: Option<String>,
    color: Option<String>,
    created_at: i64,
    updated_at: i64,
}

/// One result per upsert, in request order.
#[derive(Serialize)]
struct PushResponse {
    results: Vec<PushResult>,
}

#[derive(Serialize)]
struct PushResult {
    id: String,
    /// `applied`, `stale`, `deleted` or `unplaceable`.
    outcome: &'static str,
    /// The server's version, for `applied` and `stale`.
    annotation: Option<WireAnnotation>,
}

/// The Omnibus colour for a KOReader highlight colour; anything unrecognised is amber.
fn omnibus_color(koreader: Option<&str>) -> HighlightColor {
    match koreader {
        Some("red") => HighlightColor::Rose,
        Some("green" | "olive") => HighlightColor::Green,
        Some("cyan" | "blue") => HighlightColor::Blue,
        Some("purple") => HighlightColor::Violet,
        _ => HighlightColor::Amber,
    }
}

/// The KOReader colour name for an Omnibus colour.
fn koreader_color(color: HighlightColor) -> &'static str {
    match color {
        HighlightColor::Amber => "yellow",
        HighlightColor::Green => "green",
        HighlightColor::Blue => "blue",
        HighlightColor::Rose => "red",
        HighlightColor::Violet => "purple",
    }
}

impl Push {
    /// The first reason this push is too large or malformed, if any.
    fn validate(&self) -> Result<(), String> {
        if self.upserts.len() > MAX_BATCH || self.deletes.len() > MAX_BATCH {
            return Err(format!(
                "a push carries at most {MAX_BATCH} upserts and deletes"
            ));
        }
        let id_ok = |id: &str| {
            !id.trim().is_empty() && id.chars().count() <= CreateHighlight::CLIENT_ID_MAX_LEN
        };
        if !self.deletes.iter().all(|id| id_ok(id)) {
            return Err("a delete id is empty or too long".into());
        }
        self.upserts
            .iter()
            .try_for_each(|u| u.validate(id_ok(&u.id)))
    }
}

impl PushUpsert {
    fn validate(&self, id_ok: bool) -> Result<(), String> {
        let within = |s: &str, max: usize| s.chars().count() <= max;
        let anchor_max = CreateHighlight::EPUB_CFI_RANGE_MAX_LEN;
        if !id_ok {
            Err("id is empty or too long".into())
        } else if !within(&self.pos0, anchor_max) || !within(&self.pos1, anchor_max) {
            Err(format!("pos0 and pos1 are at most {anchor_max} characters"))
        } else if !self
            .text
            .as_deref()
            .is_none_or(|t| within(t, CreateHighlight::TEXT_MAX_LEN))
        {
            Err(format!(
                "text exceeds {} characters",
                CreateHighlight::TEXT_MAX_LEN
            ))
        } else if !self
            .note
            .as_deref()
            .is_none_or(|n| within(n, UpdateHighlightNote::NOTE_MAX_LEN))
        {
            Err(format!(
                "note exceeds {} characters",
                UpdateHighlightNote::NOTE_MAX_LEN
            ))
        } else if self.created_at < 0 || self.updated_at < 0 {
            Err("created_at and updated_at must not be negative".into())
        } else {
            Ok(())
        }
    }
}

fn wire(a: &KoreaderAnnotation, (pos0, pos1): (String, String)) -> WireAnnotation {
    WireAnnotation {
        id: a.client_id.clone(),
        pos0,
        pos1,
        text: a.text.clone(),
        note: a.note.clone(),
        color: koreader_color(a.color),
        created_at: a.created_at,
        updated_at: a.updated_at,
    }
}

/// Run a conversion off the async runtime; a panic is an error like any other failure.
async fn off_runtime<T: Send + 'static>(
    job: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> anyhow::Result<T> {
    tokio::task::spawn_blocking(job).await?
}

/// The range CFI for each `(pos0, pos1)`. A book with no EPUB places nothing (`None` in every
/// slot); a lookup, read or conversion failure is an `Err`, so the device retries instead of
/// being told its highlights can't be placed.
async fn to_cfis(
    pool: &SqlitePool,
    uuid: &str,
    anchors: Vec<(String, String)>,
) -> anyhow::Result<Vec<Option<String>>> {
    let count = anchors.len();
    let Some(source) = epub_source(pool, uuid).await? else {
        return Ok(vec![None; count]);
    };
    off_runtime(move || db::koreader_position::annotation_cfis(&source, &anchors)).await
}

/// The XPointer pair for each range CFI; every slot is `None` for a book with no EPUB, and a
/// failure is an `Err`.
async fn to_xpointers(
    pool: &SqlitePool,
    uuid: &str,
    cfis: Vec<String>,
) -> anyhow::Result<Vec<Option<(String, String)>>> {
    let count = cfis.len();
    if count == 0 {
        return Ok(Vec::new());
    }
    let Some(source) = epub_source(pool, uuid).await? else {
        return Ok(vec![None; count]);
    };
    off_runtime(move || db::koreader_position::annotation_xpointers(&source, &cfis)).await
}

/// What changed in a book since the device's cursor. A row the converter cannot place
/// stays on the server. 404 when no book has the uuid; 500 when the EPUB cannot be found or
/// read, so the device asks again from the same cursor instead of skipping the rows.
pub async fn get_annotations(
    device: KoreaderDevice,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Query(Since { since }): Query<Since>,
) -> Response {
    if let Some(rejected) = reject_oversized_uuid(&uuid) {
        return rejected;
    }
    let since = match since.as_deref().map(KoreaderCursor::parse) {
        None => KoreaderCursor::default(),
        Some(Some(cursor)) => cursor,
        Some(None) => return (StatusCode::BAD_REQUEST, "since is not a cursor").into_response(),
    };
    let canonical = match db::resolve_canonical_book_uuid(state.pool(), &uuid).await {
        Ok(Some(canonical)) => canonical,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("koreader annotations book", e),
    };
    let listing =
        match koreader_annotations_since(state.pool(), device.user_id, &canonical, &since).await {
            Ok(listing) => listing,
            Err(e) => return internal("koreader annotations since", e),
        };
    let cfis = listing
        .annotations
        .iter()
        .map(|a| a.epub_cfi_range.clone())
        .collect();
    let placed = match to_xpointers(state.pool(), &canonical, cfis).await {
        Ok(placed) => placed,
        Err(e) => return internal("koreader annotations anchors", e),
    };
    let annotations = listing
        .annotations
        .iter()
        .zip(placed)
        .filter_map(|(a, pos)| Some(wire(a, pos?)))
        .collect();
    Json(Listing {
        cursor: listing.cursor.encode(),
        annotations,
        deleted: listing.deleted,
        more: listing.more,
    })
    .into_response()
}

/// What storing one upsert did, before a stale row is given its XPointers.
enum Stored {
    Applied(KoreaderAnnotation),
    Stale(KoreaderAnnotation),
    Deleted,
    Unplaceable,
}

/// Store every upsert, then every delete, in one transaction. An upsert with no CFI is
/// `Unplaceable`; one whose id belongs to another book is too.
async fn store(
    pool: &SqlitePool,
    user_id: i64,
    uuid: &str,
    push: &Push,
    cfis: Vec<Option<String>>,
) -> Result<Vec<Stored>, HighlightError> {
    // BEGIN IMMEDIATE avoids a stale-snapshot 517 on concurrent writers (#1862).
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let mut stored = Vec::with_capacity(push.upserts.len());
    for (u, cfi) in push.upserts.iter().zip(cfis) {
        let Some(epub_cfi_range) = cfi else {
            stored.push(Stored::Unplaceable);
            continue;
        };
        let upsert = KoreaderUpsert {
            client_id: u.id.clone(),
            epub_cfi_range,
            color: omnibus_color(u.color.as_deref()),
            text: u.text.clone(),
            note: u.note.clone(),
            created_at: u.created_at,
            event_at: u.updated_at,
        };
        stored.push(
            match upsert_koreader_annotation(&mut tx, user_id, uuid, &upsert).await {
                Ok(UpsertOutcome::Applied(row)) => Stored::Applied(row),
                Ok(UpsertOutcome::Stale(row)) => Stored::Stale(row),
                Ok(UpsertOutcome::Deleted) => Stored::Deleted,
                Err(HighlightError::NotFound) => Stored::Unplaceable,
                Err(e) => return Err(e),
            },
        );
    }
    delete_koreader_annotations(&mut tx, user_id, uuid, &push.deletes).await?;
    tx.commit().await?;
    Ok(stored)
}

/// Apply the device's upserts and deletes; answers one result per upsert. 404 when no book
/// has the uuid; 400 for an over-long field or batch; 500 when the EPUB cannot be found or
/// read, before anything is stored, so the whole push is retried.
pub async fn post_annotations(
    device: KoreaderDevice,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Json(push): Json<Push>,
) -> Response {
    if let Some(rejected) = reject_oversized_uuid(&uuid) {
        return rejected;
    }
    if let Err(msg) = push.validate() {
        return (StatusCode::BAD_REQUEST, msg).into_response();
    }
    let canonical = match db::resolve_canonical_book_uuid(state.pool(), &uuid).await {
        Ok(Some(canonical)) => canonical,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("koreader annotations book", e),
    };
    let anchors = push
        .upserts
        .iter()
        .map(|u| (u.pos0.clone(), u.pos1.clone()))
        .collect();
    let cfis = match to_cfis(state.pool(), &canonical, anchors).await {
        Ok(cfis) => cfis,
        Err(e) => return internal("koreader annotations anchors", e),
    };
    let stored = match store(state.pool(), device.user_id, &canonical, &push, cfis).await {
        Ok(stored) => stored,
        Err(e) => return internal("koreader annotations store", e),
    };
    if needs_kobo_downsync(&stored) {
        // Same as a web highlight write: let a Kobo with this book pick the change up.
        db::annotations::spawn_kobo_downsync(
            state.pool().clone(),
            Some(state.worker().clone()),
            device.user_id,
            canonical.clone(),
        );
    }
    let stale = stale_positions(&state, &canonical, &stored).await;
    Json(PushResponse {
        results: results(push.upserts, stored, stale),
    })
    .into_response()
}

/// Whether a push changed what a Kobo is served: only a written highlight can, not a stale
/// answer, a delete or an unplaceable one.
fn needs_kobo_downsync(stored: &[Stored]) -> bool {
    stored.iter().any(|s| matches!(s, Stored::Applied(_)))
}

/// The XPointers of each stale row's stored anchor, in order; `None` when they cannot be had.
async fn stale_positions(
    state: &AppState,
    uuid: &str,
    stored: &[Stored],
) -> Vec<Option<(String, String)>> {
    let cfis: Vec<String> = stored
        .iter()
        .filter_map(|s| match s {
            Stored::Stale(row) => Some(row.epub_cfi_range.clone()),
            _ => None,
        })
        .collect();
    let count = cfis.len();
    to_xpointers(state.pool(), uuid, cfis)
        .await
        .unwrap_or_else(|e| {
            tracing::warn!(%uuid, error = %e, "koreader stale annotation anchors failed");
            vec![None; count]
        })
}

/// Pair each upsert with its outcome; an applied one echoes the device's own anchors.
fn results(
    upserts: Vec<PushUpsert>,
    stored: Vec<Stored>,
    stale: Vec<Option<(String, String)>>,
) -> Vec<PushResult> {
    let mut stale = stale.into_iter();
    upserts
        .into_iter()
        .zip(stored)
        .map(|(u, stored)| {
            let (outcome, annotation) = match stored {
                Stored::Applied(row) => ("applied", Some(wire(&row, (u.pos0, u.pos1)))),
                Stored::Stale(row) => ("stale", stale.next().flatten().map(|pos| wire(&row, pos))),
                Stored::Deleted => ("deleted", None),
                Stored::Unplaceable => ("unplaceable", None),
            };
            PushResult {
                id: u.id,
                outcome,
                annotation,
            }
        })
        .collect()
}
