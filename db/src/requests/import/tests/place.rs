//! Placing a download in the library: the staging folder, the rename, and the scan's view of it.

use std::fs;
use std::path::Path;

use super::super::place::{discard_staging, place_blocking};
use super::{write, EPUB_BYTES};

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
