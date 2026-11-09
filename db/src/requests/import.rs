//! Adds a finished download to the library, filed under the book that was asked for.
//! [`import_finished`] runs inside the request poller, one request at a time so no two
//! imports race on a merge: [`files`] picks the book out of the download (an EPUB or PDF
//! for an ebook request, an M4B or a folder of MP3s for an audiobook one), [`place`] stages
//! it inside that kind's library and renames it into the canonical layout named from the
//! wished book (an AZW3 or MOBI is converted to EPUB there first), the worker scans it in, and
//! it is merged into the wished book when the scanner filed it as a book of its own. The
//! download is only read here, never moved or removed; a usenet job is then queued for the
//! poller to take out of the client. Its cover is kept as the request's candidate (see
//! [`super::cover`]) whichever way the scan filed it.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use omnibus_shared::{ReleaseProtocol, RequestKind, StuckReason};
use sqlx::SqlitePool;

use crate::merge::{merge_books, MergeError};
use crate::settings::RequestsConfig;
use crate::worker::{Task, TaskOutcome, Worker};

use super::clients::DownloadClient;
use super::cover;
use super::paths::PathMapError;
use super::store::{self, RequestError, RequestRow};
use super::ConnectionError;

pub mod files;
pub mod place;

/// Why a finished download could not be added. Each message is shown as the request's
/// detail, so it says in plain words what went wrong. A client that cannot be reached is not a failure of the
/// import; it is retried on the next pass.
#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("the download has no ebook file to add")]
    NothingImportable,
    #[error("the finished download is not visible to this server: {0}")]
    NotVisible(#[from] PathMapError),
    #[error("filing the download failed: {0}")]
    Io(#[from] io::Error),
    /// Any other reason the library cannot take the file; the message is the whole story.
    #[error("{0}")]
    Cannot(String),
    /// The conversion's own message, which carries the converter's output for the admin.
    #[error(transparent)]
    Convert(#[from] crate::convert::ConvertError),
    #[error("merging into the requested book failed: {0}")]
    Merge(#[from] MergeError),
    #[error("the download client could not be asked: {0}")]
    Client(#[from] ConnectionError),
    #[error(transparent)]
    Db(#[from] RequestError),
}

/// The book a request asked for: where its file is named from.
struct Wished {
    uuid: String,
    author: String,
    title: String,
}

/// Add every finished download to the library, one at a time. A request ends `ready`, or
/// `couldnt_add` with the reason; one that must wait (its client cannot be reached or is
/// still moving the files, or the database failed it) stays as it is for the next pass, and the
/// answer is then true.
// shortcut: the poller does nothing else while a scan is awaited; move imports to a spawned task if big libraries make cancels lag.
pub async fn import_finished(
    pool: &SqlitePool,
    client: &impl DownloadClient,
    worker: &Arc<Worker>,
    config: &RequestsConfig,
) -> Result<bool, RequestError> {
    let remove_download = config.download_client_kind.protocol() == ReleaseProtocol::Usenet;
    let mut waiting = false;
    for row in store::awaiting_import(pool).await? {
        let pick = row.chosen_result_id;
        match import_one(pool, client, worker, config, &row).await {
            Ok(Step::Added) => store::mark_ready(pool, row.id, pick, remove_download).await?,
            Ok(Step::Later) => waiting = true,
            // Neither says anything about the download, so the request waits for the next pass.
            Err(
                e @ (ImportError::Client(_)
                | ImportError::Db(_)
                | ImportError::Merge(MergeError::Db(_))),
            ) => {
                tracing::warn!(error = %e, request = row.id, "an import could not go on");
                waiting = true;
            }
            Err(e) => {
                tracing::warn!(error = %e, request = row.id, "a download could not be added");
                let why = e.to_string();
                store::mark_stuck(pool, row.id, pick, StuckReason::CouldntAdd, &why).await?;
            }
        }
    }
    Ok(waiting)
}

/// How far one pass got with a request.
enum Step {
    Added,
    /// The client is not done with the files yet.
    Later,
}

async fn import_one(
    pool: &SqlitePool,
    client: &impl DownloadClient,
    worker: &Arc<Worker>,
    config: &RequestsConfig,
    row: &RequestRow,
) -> Result<Step, ImportError> {
    let root = library_root(pool, row.kind).await?;
    let wished = wished_book(pool, &row.book_uuid).await?;
    // A retry finds its file or folder already filed, and goes straight to the scan.
    let key = match &row.import_key {
        Some(key) if is_placed(&root, key).await => key.clone(),
        _ => match file_into_library(pool, client, config, row, &root, &wished).await? {
            Some(key) => key,
            None => return Ok(Step::Later),
        },
    };
    scan_and_merge(pool, worker, row, &root, &key, &wished).await?;
    Ok(Step::Added)
}

fn cannot(why: &str) -> ImportError {
    ImportError::Cannot(why.to_string())
}

/// The library folder that takes `kind`'s files.
async fn library_root(pool: &SqlitePool, kind: RequestKind) -> Result<String, ImportError> {
    let settings = crate::get_settings(pool)
        .await
        .map_err(|e| ImportError::Cannot(format!("the library could not be read: {e}")))?;
    let (path, missing) = match kind {
        RequestKind::Ebook => (settings.ebook_library_path, "no ebook library is set up"),
        RequestKind::Audiobook => (
            settings.audiobook_library_path,
            "no audiobook library is set up",
        ),
    };
    path.filter(|p| !p.is_empty())
        .ok_or_else(|| cannot(missing))
}

/// Whether `key` under `root` is already filed: a file, or a folder holding something. An
/// empty folder is what a failed placement can leave, and has nothing to scan.
async fn is_placed(root: &str, key: &str) -> bool {
    let path = Path::new(root).join(key);
    let Ok(meta) = tokio::fs::metadata(&path).await else {
        return false;
    };
    if meta.is_file() {
        return true;
    }
    match tokio::fs::read_dir(&path).await {
        Ok(mut entries) => matches!(entries.next_entry().await, Ok(Some(_))),
        Err(_) => false,
    }
}

/// The requested book, under its surviving uuid, with the author and title files are named by.
async fn wished_book(pool: &SqlitePool, book_uuid: &str) -> Result<Wished, ImportError> {
    let gone = || cannot("the requested book is no longer in the library");
    let read = |e: crate::books::BooksError| {
        ImportError::Cannot(format!("the library could not be read: {e}"))
    };
    let uuid = crate::resolve_canonical_book_uuid(pool, book_uuid)
        .await
        .map_err(read)?
        .ok_or_else(gone)?;
    let book = crate::get_book_by_uuid(pool, &uuid)
        .await
        .map_err(read)?
        .ok_or_else(gone)?;
    Ok(Wished {
        uuid,
        author: book
            .creators
            .first()
            .map(|c| c.name.clone())
            .unwrap_or_default(),
        title: book.title.unwrap_or_default(),
    })
}

/// Pick the book out of the download, file it in the library, and remember where. Returns
/// its library-relative key, or `None` while the client is still checking or moving the files.
async fn file_into_library(
    pool: &SqlitePool,
    client: &impl DownloadClient,
    config: &RequestsConfig,
    row: &RequestRow,
    root: &str,
    wished: &Wished,
) -> Result<Option<String>, ImportError> {
    let hash = row.client_hash.as_deref().unwrap_or_default();
    let Some(status) = client.status(hash).await? else {
        return Err(cannot("the download client no longer has the download"));
    };
    if status.state.starts_with("moving") || status.state.starts_with("checking") {
        return Ok(None);
    }
    let listed = client.files(hash).await?;
    let (config, root_path) = (config.clone(), PathBuf::from(root));
    let (id, kind) = (row.id, row.kind);
    let (author, title) = (wished.author.clone(), wished.title.clone());
    let found = blocking(move || files::resolve(&status, &listed, &config, kind)).await?;
    let (placed, is_folder) = match kind {
        RequestKind::Ebook => (
            place_ebook(pool, root_path, id, found, author, title).await?,
            false,
        ),
        RequestKind::Audiobook => {
            blocking(move || place_audio(&found, &root_path, id, &author, &title)).await?
        }
    };
    let key = placed
        .strip_prefix(root)
        .map_err(|e| io::Error::other(e.to_string()))?
        .to_string_lossy()
        .into_owned();
    if let Err(e) = store::set_import_key(pool, row.id, row.chosen_result_id, &key).await {
        // Unrecorded, a retry would file a second copy beside this one.
        let _ = match is_folder {
            true => tokio::fs::remove_dir_all(&placed).await,
            false => tokio::fs::remove_file(&placed).await,
        };
        return Err(e.into());
    }
    Ok(Some(key))
}

/// File the ebook out of the `found` files of the download, converting an AZW3 or MOBI to
/// EPUB first, and return where it landed.
async fn place_ebook(
    pool: &SqlitePool,
    root: PathBuf,
    request_id: i64,
    found: Vec<PathBuf>,
    author: String,
    title: String,
) -> Result<PathBuf, ImportError> {
    // Probed only now: an import with no AZW3 or MOBI never spawns the converter.
    let convertible = files::has_convertible(&found) && converter_runs(pool).await;
    let (src, ext) = blocking(move || files::pick(&found, convertible)).await?;
    if files::converts_to_epub(ext) {
        return place::place_converted(pool, &root, request_id, &src, &author, &title).await;
    }
    Ok(
        blocking(move || place::place_blocking(&root, request_id, &src, &author, &title, ext))
            .await?,
    )
}

/// File the audiobook out of the `found` files of the download, and return where it landed,
/// and whether that is a folder (several MP3s) rather than a file. Blocking.
fn place_audio(
    found: &[PathBuf],
    root: &Path,
    request_id: i64,
    author: &str,
    title: &str,
) -> Result<(PathBuf, bool), ImportError> {
    Ok(match files::pick_audio(found)? {
        files::AudioPick::Single(src, ext) => (
            place::place_blocking(root, request_id, &src, author, title, ext)?,
            false,
        ),
        files::AudioPick::Parts(parts) => (
            place::place_folder_blocking(root, request_id, &parts, author, title)?,
            true,
        ),
    })
}

/// Whether `ebook-convert` runs, so an AZW3 or MOBI can be converted. An unreadable setting
/// counts as not, so a download that also holds an EPUB or PDF still imports.
async fn converter_runs(pool: &SqlitePool) -> bool {
    match crate::ebook_convert_status(pool).await {
        Ok(status) => status.available,
        Err(e) => {
            tracing::warn!(error = %e, "check whether ebook-convert runs");
            false
        }
    }
}

/// Run blocking filesystem work off the async runtime thread.
async fn blocking<T, E>(work: impl FnOnce() -> Result<T, E> + Send + 'static) -> Result<T, E>
where
    T: Send + 'static,
    E: From<io::Error> + Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| io::Error::other(e.to_string()))?
}

/// Scan the library so the file becomes a book, then fold that book into the wished one
/// unless the scanner already filed it there. A file the scanner attached to some other,
/// already-known book is left where it is: merging would erase that book.
async fn scan_and_merge(
    pool: &SqlitePool,
    worker: &Arc<Worker>,
    row: &RequestRow,
    root: &str,
    key: &str,
    wished: &Wished,
) -> Result<(), ImportError> {
    let library_path = root.to_string();
    let scan = worker.post(match row.kind {
        RequestKind::Ebook => Task::Scan { library_path },
        RequestKind::Audiobook => Task::ScanAudiobooks { library_path },
    });
    if let TaskOutcome::Err(e) = worker.await_completion(scan).await {
        return Err(ImportError::Cannot(format!(
            "the library scan did not take the file: {e}"
        )));
    }
    let read = |e: crate::books::BooksError| {
        ImportError::Cannot(format!("the library could not be read: {e}"))
    };
    let found = crate::get_book_uuid_by_scan_key(pool, root, key)
        .await
        .map_err(read)?
        .ok_or_else(|| cannot("the library scan did not surface the file"))?;
    if found == wished.uuid {
        keep_cover(pool, row, root, key, wished).await;
        return Ok(());
    }
    let book = crate::get_book_by_uuid(pool, &found)
        .await
        .map_err(read)?
        .ok_or_else(|| cannot("the library scan did not surface the file"))?;
    let files = crate::get_book_files(pool, book.id).await.map_err(read)?;
    if files.len() != 1 || files[0].path.as_deref() != Some(key) {
        let title = book.title.unwrap_or_default();
        return Err(ImportError::Cannot(format!(
            "the library scan filed the download on another book, \"{title}\""
        )));
    }
    // Before the merge, which may give the wished book the download's cover.
    keep_cover(pool, row, root, key, wished).await;
    merge_books(pool, &found, &wished.uuid, None).await?;
    Ok(())
}

/// Keep the placed download's cover as the request's candidate, unless the request offers
/// none. A cosmetic extra, so a failure is logged and the import goes on.
async fn keep_cover(pool: &SqlitePool, row: &RequestRow, root: &str, key: &str, wished: &Wished) {
    if !row.offers_cover {
        return;
    }
    let epub = PathBuf::from(root).join(key);
    if let Err(e) = cover::record_candidate(pool, row.id, &epub, &wished.uuid).await {
        tracing::warn!(error = %e, request = row.id, "keeping a download's cover");
    }
}

#[cfg(test)]
mod tests;
