//! `convert_book` — shells out to Calibre's `ebook-convert` to convert one
//! book's `source_format` file to `target_format`, caching the result via an
//! atomic temp-then-rename ([`super::fs::convert_path`]), then persists it
//! as a `book_files` row ([`super::persist::persist_converted_file`]).
//! Driven by `Task::ConvertFormat` (`crate::worker`).

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::Context;
use sqlx::SqlitePool;

use super::detect::is_runnable;
use super::fs::{convert_dir, convert_path, validate_format_pair};
use super::persist::persist_converted_file;
use crate::settings::effective_ebook_convert_path;

/// Default per-job watchdog when `OMNIBUS_CONVERT_TIMEOUT_SECS` is unset.
/// `ebook-convert` is far lighter than an ffmpeg transcode, but still
/// generous for a large book on a loaded host.
const DEFAULT_TIMEOUT_SECS: u64 = 600;

/// Errors from the format-conversion path. `SourceMissing`, `BinaryUnavailable`,
/// `Timeout` and `InvalidFormat` stay distinct because
/// `worker::handlers::convert_outcome` branches on them to decide whether the
/// message is safe to hand back verbatim (none carries a path or subprocess
/// output); everything else collapses into `Failed` (rule 02).
#[derive(Debug, thiserror::Error)]
pub enum ConvertError {
    #[error("book {book_id} has no {format} file to convert")]
    SourceMissing { book_id: i64, format: String },
    #[error("ebook-convert is not installed or not runnable")]
    BinaryUnavailable,
    #[error("conversion timed out after {0}s")]
    Timeout(u64),
    /// `field` names which of `source_format`/`target_format` failed
    /// validation ([`super::fs::validate_format_pair`]) — never the raw
    /// value, so a payload crafted to poison logs or a client-facing status
    /// message can't ride along in the error text.
    #[error("invalid {field}: must be 1-16 ASCII alphanumeric characters")]
    InvalidFormat { field: &'static str },
    #[error("conversion failed: {0}")]
    Failed(#[from] anyhow::Error),
}

/// Convert `book_id`'s `source_format` file to `target_format` and return the
/// output path, `<convert_dir>/<book_id>.<target_format>`; always reconverts.
/// Not self-serializing: callers hold `Task::ConvertFormat`'s keyed mutex.
/// Errors on unsafe formats ([`super::fs::validate_format_pair`]), an unrunnable
/// `ebook-convert`, a missing source, a non-zero exit, or a timeout ([`DEFAULT_TIMEOUT_SECS`]).
pub async fn convert_book(
    pool: &SqlitePool,
    book_id: i64,
    source_format: &str,
    target_format: &str,
) -> Result<PathBuf, ConvertError> {
    // Validated first and unconditionally: `Task::ConvertFormat`'s fields
    // are wire-facing, and every later use of either string — the DB
    // lookup, the two filesystem paths built below — must only ever see a
    // token that's already been proven safe.
    validate_format_pair(source_format, target_format)?;

    let (bin, _source) = effective_ebook_convert_path(pool)
        .await
        .context("resolve ebook-convert path")?;
    if !probe_runnable(&bin).await {
        return Err(ConvertError::BinaryUnavailable);
    }

    let src = crate::book_file_path(pool, book_id, source_format)
        .await
        .context("look up book's source file path")?
        .ok_or_else(|| ConvertError::SourceMissing {
            book_id,
            format: source_format.to_string(),
        })?;

    let dir = convert_dir();
    tokio::fs::create_dir_all(&dir)
        .await
        .with_context(|| format!("create convert cache dir {}", dir.display()))?;
    // `convert_path` is the one place a format token becomes a path
    // component; the temp path below derives from *its* output rather than
    // reformatting `target_format` a second time, so there is exactly one
    // call site to audit for path safety.
    let out_path = convert_path(book_id, target_format)?;
    let out_file_name = out_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| {
            ConvertError::Failed(anyhow::anyhow!("convert cache path has no file name"))
        })?;
    // Hidden, per-(book, target) temp so a crashed run leaves no half-written
    // cache and different conversions never collide.
    let tmp = out_path.with_file_name(format!(".{out_file_name}.tmp"));
    let _ = tokio::fs::remove_file(&tmp).await;

    tracing::info!(
        target: "omnibus::convert",
        book_id, ?src, target_format, "converting book format"
    );
    if let Err(e) = run_ebook_convert(&bin, &src, &tmp).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e);
    }
    tokio::fs::rename(&tmp, &out_path)
        .await
        .context("move converted file into cache")?;
    // Make the converted file a real, listed format of the book, rather
    // than a file only the conversion cache knows about. Runs after the
    // rename, so a failure here still leaves a usable cache file behind
    // for the next request to retry against.
    persist_converted_file(pool, book_id, target_format, &out_path)
        .await
        .context("persist converted book_files row")?;
    tracing::info!(target: "omnibus::convert", book_id, target_format, "conversion complete");

    Ok(out_path)
}

/// `--version` probe for `bin`, off the async runtime thread (the probe
/// itself blocks on a child process). A join failure (panic/cancel) reads as
/// "not available" rather than propagating — the probe is just a fast-fail
/// gate, and the real spawn below would fail the same way regardless.
async fn probe_runnable(bin: &str) -> bool {
    let probe = bin.to_string();
    match tokio::task::spawn_blocking(move || is_runnable(&probe)).await {
        Ok(available) => available,
        Err(e) => {
            tracing::error!(error = %e, "convert_book: binary probe task join failed");
            false
        }
    }
}

/// Run `<bin> <src> <out>` under a wall-clock timeout
/// (`OMNIBUS_CONVERT_TIMEOUT_SECS`, default [`DEFAULT_TIMEOUT_SECS`]), and
/// bail on a non-zero exit carrying the captured stderr.
async fn run_ebook_convert(bin: &str, src: &Path, out: &Path) -> Result<(), ConvertError> {
    let timeout_secs: u64 = std::env::var("OMNIBUS_CONVERT_TIMEOUT_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_TIMEOUT_SECS);

    tracing::debug!(target: "omnibus::convert", %bin, ?src, ?out, "spawning ebook-convert");
    let child = tokio::process::Command::new(bin)
        .arg(src)
        .arg(out)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            ConvertError::Failed(
                anyhow::Error::new(e).context(format!("spawn ebook-convert ({bin})")),
            )
        })?;

    match tokio::time::timeout(Duration::from_secs(timeout_secs), child.wait_with_output()).await {
        Ok(Ok(output)) if output.status.success() => Ok(()),
        Ok(Ok(output)) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(ConvertError::Failed(anyhow::anyhow!(
                "ebook-convert exited with {}: {stderr}",
                output.status
            )))
        }
        Ok(Err(io_err)) => Err(ConvertError::Failed(
            anyhow::Error::new(io_err).context("ebook-convert wait failed"),
        )),
        // `kill_on_drop(true)` reaps the child when the wait future is
        // dropped on this return path.
        Err(_elapsed) => Err(ConvertError::Timeout(timeout_secs)),
    }
}
