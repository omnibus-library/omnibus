//! Adds a finished download to the library, filed under the book that was asked for.
//! [`import_finished`] runs inside the request poller, one request at a time so no two
//! imports race on a merge: [`files`] picks the book out of the download, [`place`] stages
//! it inside the library and renames it into the canonical layout named from the wished
//! book, the worker scans it in, and it is merged into the wished book when the scanner
//! filed it as a book of its own. The download is only read, never moved or removed.

use std::io;
use std::path::PathBuf;
use std::sync::Arc;

use omnibus_shared::{RequestKind, StuckReason};
use sqlx::SqlitePool;

use crate::merge::{merge_books, MergeError};
use crate::settings::RequestsConfig;
use crate::worker::{Task, TaskOutcome, Worker};

use super::clients::DownloadClient;
use super::paths::PathMapError;
use super::store::{self, RequestError, RequestRow};
use super::ConnectionError;

pub mod files;
pub mod place;

/// Why a finished download could not be added. Each message is for an admin: the reader
/// sees only "Couldn't add it". A client that cannot be reached is not a failure of the
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
/// `couldnt_add` with the reason for admins; one that must wait (its client cannot be
/// reached, or is still moving the files) stays as it is for the next pass, and the answer
/// is then true.
// shortcut: the poller does nothing else while a scan is awaited; move imports to a spawned task if big libraries make cancels lag.
pub async fn import_finished(
    pool: &SqlitePool,
    client: &impl DownloadClient,
    worker: &Arc<Worker>,
    config: &RequestsConfig,
) -> Result<bool, RequestError> {
    let mut waiting = false;
    for row in store::awaiting_import(pool).await? {
        let pick = row.chosen_result_id;
        match import_one(pool, client, worker, config, &row).await {
            Ok(Step::Added) => store::mark_ready(pool, row.id, pick).await?,
            Ok(Step::Later) => waiting = true,
            Err(ImportError::Client(e)) => {
                tracing::warn!(error = %e, request = row.id, "download client, during an import");
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
    if row.kind != RequestKind::Ebook {
        return Err(cannot("audiobook import is not supported yet"));
    }
    let root = ebook_root(pool).await?;
    let wished = wished_book(pool, &row.book_uuid).await?;
    // A retry finds its file already filed, and goes straight to the scan.
    let key = match &row.import_key {
        Some(key) if PathBuf::from(&root).join(key).is_file() => key.clone(),
        _ => match file_into_library(pool, client, config, row, &root, &wished).await? {
            Some(key) => key,
            None => return Ok(Step::Later),
        },
    };
    scan_and_merge(pool, worker, &root, &key, &wished).await?;
    Ok(Step::Added)
}

fn cannot(why: &str) -> ImportError {
    ImportError::Cannot(why.to_string())
}

async fn ebook_root(pool: &SqlitePool) -> Result<String, ImportError> {
    let settings = crate::get_settings(pool)
        .await
        .map_err(|e| ImportError::Cannot(format!("the library could not be read: {e}")))?;
    settings
        .ebook_library_path
        .filter(|p| !p.is_empty())
        .ok_or_else(|| cannot("no ebook library is set up"))
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
    let tag = row.client_tag.as_deref().unwrap_or_default();
    let Some(status) = client.status(tag).await? else {
        return Err(cannot("the download client no longer has the download"));
    };
    if status.state.starts_with("moving") || status.state.starts_with("checking") {
        return Ok(None);
    }
    let listed = client.files(tag).await?;
    let (config, root_path) = (config.clone(), PathBuf::from(root));
    let (id, author, title) = (row.id, wished.author.clone(), wished.title.clone());
    let placed = tokio::task::spawn_blocking(move || -> Result<PathBuf, ImportError> {
        let found = files::resolve(&status, &listed, &config)?;
        let (src, ext) = files::pick(&found)?;
        Ok(place::place_blocking(
            &root_path, id, &src, &author, &title, ext,
        )?)
    })
    .await
    .map_err(|e| io::Error::other(e.to_string()))??;
    let key = placed
        .strip_prefix(root)
        .map_err(|e| io::Error::other(e.to_string()))?
        .to_string_lossy()
        .into_owned();
    if let Err(e) = store::set_import_key(pool, row.id, row.chosen_result_id, &key).await {
        // Unrecorded, a retry would file a second copy beside this one.
        let _ = tokio::fs::remove_file(&placed).await;
        return Err(e.into());
    }
    Ok(Some(key))
}

/// Scan the library so the file becomes a book, then fold that book into the wished one
/// unless the scanner already filed it there. A file the scanner attached to some other,
/// already-known book is left where it is: merging would erase that book.
async fn scan_and_merge(
    pool: &SqlitePool,
    worker: &Arc<Worker>,
    root: &str,
    key: &str,
    wished: &Wished,
) -> Result<(), ImportError> {
    let scan = worker.post(Task::Scan {
        library_path: root.to_string(),
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
    merge_books(pool, &found, &wished.uuid, None).await?;
    Ok(())
}

#[cfg(test)]
mod tests;
