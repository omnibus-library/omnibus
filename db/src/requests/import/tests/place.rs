//! Placing a download in the library: the staging folder, the rename, and the scan's view of it.

use std::fs;
use std::path::Path;

use sqlx::SqlitePool;

use crate::convert::ConvertError;

use super::super::place::{discard_staging, place_blocking, place_converted};
use super::super::ImportError;
use super::{failing_converter, mobi_bytes, working_converter, write, EPUB_BYTES};

/// A download folder holding `Dune.epub`, and an empty library root beside it.
fn download_and_library(tmp: &Path) -> (std::path::PathBuf, std::path::PathBuf) {
    let src = write(tmp, "dl/Dune.epub", EPUB_BYTES);
    let root = tmp.join("library");
    fs::create_dir_all(&root).unwrap();
    (src, root)
}

mod place_blocking {
    use super::*;

    #[test]
    fn renames_into_the_canonical_path_named_from_the_book() {
        let tmp = tempfile::tempdir().unwrap();
        let (src, root) = download_and_library(tmp.path());

        let placed = place_blocking(&root, 7, &src, "Frank Herbert", "Dune", "epub").unwrap();

        assert_eq!(placed, root.join("frank-herbert/dune/dune.epub"));
        assert_eq!(fs::read(&placed).unwrap(), EPUB_BYTES);
    }

    #[test]
    fn removes_the_staging_dir_after_the_rename() {
        let tmp = tempfile::tempdir().unwrap();
        let (src, root) = download_and_library(tmp.path());

        place_blocking(&root, 7, &src, "Frank Herbert", "Dune", "epub").unwrap();

        assert!(!root.join(".omnibus-staging").exists());
    }

    #[test]
    fn removes_the_staging_dir_when_the_copy_fails() {
        let tmp = tempfile::tempdir().unwrap();
        let (_, root) = download_and_library(tmp.path());
        let missing = tmp.path().join("dl/gone.epub");

        let err = place_blocking(&root, 7, &missing, "Frank Herbert", "Dune", "epub");

        assert!(err.is_err());
        assert!(!root.join(".omnibus-staging").exists());
        assert!(!root.join("frank-herbert").exists());
    }

    #[test]
    fn clears_a_leftover_staging_dir_first() {
        let tmp = tempfile::tempdir().unwrap();
        let (src, root) = download_and_library(tmp.path());
        let leftover = root.join(".omnibus-staging/7");
        fs::create_dir_all(&leftover).unwrap();
        fs::write(leftover.join("book.epub"), b"half a copy").unwrap();

        let placed = place_blocking(&root, 7, &src, "Frank Herbert", "Dune", "epub").unwrap();

        assert_eq!(fs::read(placed).unwrap(), EPUB_BYTES);
        assert!(!root.join(".omnibus-staging").exists());
    }

    #[test]
    fn never_touches_the_source_file() {
        let tmp = tempfile::tempdir().unwrap();
        let (src, root) = download_and_library(tmp.path());

        place_blocking(&root, 7, &src, "Frank Herbert", "Dune", "epub").unwrap();

        assert_eq!(fs::read(&src).unwrap(), EPUB_BYTES);
    }
}

/// A database whose `ebook-convert` is the script at `converter`.
async fn pool_converting_with(converter: &Path) -> SqlitePool {
    let pool = crate::pool::init_db("sqlite::memory:").await.unwrap();
    crate::set_ebook_convert_path(&pool, converter.to_str())
        .await
        .unwrap();
    pool
}

/// Every file under `dir`, recursively.
fn files_under(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut found = Vec::new();
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            found.extend(files_under(&path));
        } else {
            found.push(path);
        }
    }
    found
}

mod place_converted {
    use super::*;

    /// A download folder holding `Dune.mobi`, a library root beside it, and the converter's
    /// scratch folder holding the EPUB it will produce.
    struct Fixture {
        src: std::path::PathBuf,
        root: std::path::PathBuf,
        scripts: std::path::PathBuf,
        produced: std::path::PathBuf,
    }

    fn fixture(tmp: &Path) -> Fixture {
        let src = write(tmp, "dl/Dune.mobi", &mobi_bytes());
        let root = tmp.join("library");
        fs::create_dir_all(&root).unwrap();
        let scripts = tmp.join("scripts");
        let produced = write(&scripts, "converted.epub", EPUB_BYTES);
        Fixture {
            src,
            root,
            scripts,
            produced,
        }
    }

    #[tokio::test]
    async fn lands_the_converters_epub_at_the_canonical_path_and_leaves_the_download_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let f = fixture(tmp.path());
        let pool = pool_converting_with(&working_converter(&f.scripts, &f.produced)).await;

        let placed = place_converted(&pool, &f.root, 7, &f.src, "Frank Herbert", "Dune")
            .await
            .unwrap();

        assert_eq!(placed, f.root.join("frank-herbert/dune/dune.epub"));
        assert_eq!(fs::read(&placed).unwrap(), EPUB_BYTES);
        assert_eq!(fs::read(&f.src).unwrap(), mobi_bytes());
        assert_eq!(files_under(&f.root), vec![placed]);
    }

    #[tokio::test]
    async fn converts_straight_from_the_download_rather_than_a_staged_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let f = fixture(tmp.path());
        let pool = pool_converting_with(&working_converter(&f.scripts, &f.produced)).await;

        place_converted(&pool, &f.root, 7, &f.src, "Frank Herbert", "Dune")
            .await
            .unwrap();

        let asked = fs::read_to_string(f.scripts.join("src-arg")).unwrap();
        assert_eq!(asked.trim(), f.src.to_str().unwrap());
    }

    #[tokio::test]
    async fn removes_the_staging_dir_after_the_rename() {
        let tmp = tempfile::tempdir().unwrap();
        let f = fixture(tmp.path());
        let pool = pool_converting_with(&working_converter(&f.scripts, &f.produced)).await;

        place_converted(&pool, &f.root, 7, &f.src, "Frank Herbert", "Dune")
            .await
            .unwrap();

        assert!(!f.root.join(".omnibus-staging").exists());
    }

    #[tokio::test]
    async fn leaves_the_library_empty_when_the_conversion_fails() {
        let tmp = tempfile::tempdir().unwrap();
        let f = fixture(tmp.path());
        let pool = pool_converting_with(&failing_converter(&f.scripts)).await;

        let err = place_converted(&pool, &f.root, 7, &f.src, "Frank Herbert", "Dune")
            .await
            .unwrap_err();

        assert!(
            matches!(&err, ImportError::Convert(ConvertError::Failed(_)))
                && err.to_string().contains("boom: conversion failed"),
            "{err}"
        );
        assert_eq!(fs::read_dir(&f.root).unwrap().count(), 0);
    }
}

mod discard_staging {
    use super::*;

    #[test]
    fn leaves_another_requests_staging_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let (_, root) = download_and_library(tmp.path());
        fs::create_dir_all(root.join(".omnibus-staging/7")).unwrap();
        fs::create_dir_all(root.join(".omnibus-staging/8")).unwrap();

        discard_staging(&root, 7).unwrap();

        assert!(!root.join(".omnibus-staging/7").exists());
        assert!(root.join(".omnibus-staging/8").exists());
    }
}

mod staging_scan {
    use super::*;
    use crate::test_support::build_test_epub;

    #[tokio::test]
    async fn staging_dir_is_skipped_by_the_scan() {
        let tmp = tempfile::tempdir().unwrap();
        let (_, root) = download_and_library(tmp.path());
        let staged = root.join(".omnibus-staging/1/x.epub");
        fs::create_dir_all(staged.parent().unwrap()).unwrap();
        fs::write(&staged, build_test_epub(&[("c1.xhtml", "<p>hi</p>")])).unwrap();
        let pool = crate::pool::init_db("sqlite::memory:").await.unwrap();

        crate::indexer::reindex(&pool, root.to_str().unwrap())
            .await
            .unwrap();

        let books: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM books")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(books, 0);
    }
}
