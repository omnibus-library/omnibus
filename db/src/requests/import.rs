//! Adds a finished download to the library, filed under the book that was asked for.
//! [`import_finished`] runs inside the request poller, one request at a time so no two
//! imports race on a merge: [`files`] picks the book out of the download, [`place`] stages
//! it inside the library and renames it into the canonical layout named from the wished
//! book, the worker scans it in, and it is merged into the wished book when the scanner
//! filed it as a book of its own. The download is only read, never moved or removed.

use std::io;
use std::path::PathBuf;
use std::sync::Arc;

use omnibus_shared::RequestKind;
use sqlx::SqlitePool;

use super::clients::DownloadClient;
use super::paths::PathMapError;
use super::store::{self, RequestError, RequestRow};
use super::ConnectionError;
use crate::merge::{merge_books, MergeError};
use crate::settings::RequestsConfig;
use crate::worker::{Task, TaskOutcome, Worker};

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
    #[error("no ebook library is set up")]
    NoLibrary,
    #[error("audiobook import is not supported yet")]
    AudiobookUnsupported,
    #[error("the library could not be read: {0}")]
    Library(String),
    #[error("the library scan did not take the file: {0}")]
    Scan(String),
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
/// `couldnt_add` with the reason for admins; one whose client cannot be reached stays as it
/// is for the next pass, and the answer is then true.
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
            Ok(()) => store::mark_ready(pool, row.id, pick).await?,
            Err(ImportError::Client(e)) => {
                tracing::warn!(error = %e, request = row.id, "download client, during an import");
                waiting = true;
            }
            Err(e) => {
                tracing::warn!(error = %e, request = row.id, "a download could not be added");
                store::mark_couldnt_add(pool, row.id, pick, &e.to_string()).await?;
            }
        }
    }
    Ok(waiting)
}

async fn import_one(
    pool: &SqlitePool,
    client: &impl DownloadClient,
    worker: &Arc<Worker>,
    config: &RequestsConfig,
    row: &RequestRow,
) -> Result<(), ImportError> {
    if row.kind != RequestKind::Ebook {
        return Err(ImportError::AudiobookUnsupported);
    }
    let root = ebook_root(pool).await?;
    let wished = wished_book(pool, &row.book_uuid).await?;
    // A retry finds its file already filed, and goes straight to the scan.
    let key = match &row.import_key {
        Some(key) if PathBuf::from(&root).join(key).is_file() => key.clone(),
        _ => file_into_library(pool, client, config, row, &root, &wished).await?,
    };
    scan_and_merge(pool, worker, &root, &key, &wished.uuid).await
}

async fn ebook_root(pool: &SqlitePool) -> Result<String, ImportError> {
    let settings = crate::get_settings(pool)
        .await
        .map_err(|e| ImportError::Library(e.to_string()))?;
    settings
        .ebook_library_path
        .filter(|p| !p.is_empty())
        .ok_or(ImportError::NoLibrary)
}

/// The requested book, under its surviving uuid, with the author and title files are named by.
async fn wished_book(pool: &SqlitePool, book_uuid: &str) -> Result<Wished, ImportError> {
    let gone = || ImportError::Library("the requested book is no longer in the library".into());
    let read = |e: crate::books::BooksError| ImportError::Library(e.to_string());
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
/// its library-relative key.
async fn file_into_library(
    pool: &SqlitePool,
    client: &impl DownloadClient,
    config: &RequestsConfig,
    row: &RequestRow,
    root: &str,
    wished: &Wished,
) -> Result<String, ImportError> {
    let tag = row.client_tag.as_deref().unwrap_or_default();
    let Some(status) = client.status(tag).await? else {
        return Err(ImportError::NothingImportable);
    };
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
    store::set_import_key(pool, row.id, row.chosen_result_id, &key).await?;
    Ok(key)
}

/// Scan the library so the file becomes a book, then fold that book into the wished one
/// unless the scanner already filed it there.
async fn scan_and_merge(
    pool: &SqlitePool,
    worker: &Arc<Worker>,
    root: &str,
    key: &str,
    wished: &str,
) -> Result<(), ImportError> {
    let scan = worker.post(Task::Scan {
        library_path: root.to_string(),
    });
    if let TaskOutcome::Err(e) = worker.await_completion(scan).await {
        return Err(ImportError::Scan(e));
    }
    let found = crate::get_book_uuid_by_scan_key(pool, root, key)
        .await
        .map_err(|e| ImportError::Library(e.to_string()))?
        .ok_or_else(|| ImportError::Scan("the scan did not surface the file".into()))?;
    if found != wished {
        merge_books(pool, &found, wished, None).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
