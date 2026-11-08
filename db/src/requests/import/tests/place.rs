//! Placing a download in the library: the staging folder, the rename, and the scan's view of it.

use std::fs;
use std::path::Path;

use super::super::place::{discard_staging, place_blocking, place_folder_blocking};
use super::{write, EPUB_BYTES, MP3_BYTES};

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
    fn fails_and_creates_nothing_when_the_library_folder_is_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let (src, _) = download_and_library(tmp.path());
        let absent = tmp.path().join("not-mounted");

        let err = place_blocking(&absent, 7, &src, "Frank Herbert", "Dune", "epub");

        assert!(err.is_err());
        assert!(!absent.exists());
    }

    #[test]
    fn never_touches_the_source_file() {
        let tmp = tempfile::tempdir().unwrap();
        let (src, root) = download_and_library(tmp.path());

        place_blocking(&root, 7, &src, "Frank Herbert", "Dune", "epub").unwrap();

        assert_eq!(fs::read(&src).unwrap(), EPUB_BYTES);
    }
}

mod place_folder_blocking {
    use super::*;

    /// Two chapters in separate disc folders of a download, and an empty library root.
    fn two_discs(tmp: &Path) -> (Vec<std::path::PathBuf>, std::path::PathBuf) {
        let parts = vec![
            write(tmp, "dl/Dune/CD1/01.mp3", MP3_BYTES),
            write(tmp, "dl/Dune/CD2/01.mp3", b"ID3 the second disc"),
        ];
        let root = tmp.join("library");
        fs::create_dir_all(&root).unwrap();
        (parts, root)
    }

    #[test]
    fn files_nested_parts_in_one_canonical_folder_under_distinct_names() {
        let tmp = tempfile::tempdir().unwrap();
        let (parts, root) = two_discs(tmp.path());

        let placed = place_folder_blocking(&root, 7, &parts, "Frank Herbert", "Dune").unwrap();

        assert_eq!(placed, root.join("frank-herbert/dune"));
        assert_eq!(fs::read(placed.join("cd1-01.mp3")).unwrap(), MP3_BYTES);
        assert_eq!(
            fs::read(placed.join("cd2-01.mp3")).unwrap(),
            b"ID3 the second disc"
        );
    }

    #[test]
    fn removes_the_staging_dir_after_the_rename() {
        let tmp = tempfile::tempdir().unwrap();
        let (parts, root) = two_discs(tmp.path());

        place_folder_blocking(&root, 7, &parts, "Frank Herbert", "Dune").unwrap();

        assert!(!root.join(".omnibus-staging").exists());
    }

    #[test]
    fn removes_the_staging_dir_and_leaves_no_folder_when_a_part_is_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let (mut parts, root) = two_discs(tmp.path());
        parts.push(tmp.path().join("dl/Dune/CD3/gone.mp3"));

        let err = place_folder_blocking(&root, 7, &parts, "Frank Herbert", "Dune");

        assert!(err.is_err());
        assert!(!root.join(".omnibus-staging").exists());
        assert!(!root.join("frank-herbert").exists());
    }

    #[test]
    fn numbers_a_part_whose_name_collides_after_the_slug_is_cut_short() {
        let tmp = tempfile::tempdir().unwrap();
        let long = "a".repeat(80);
        let parts = vec![
            write(tmp.path(), &format!("dl/{long}-001.mp3"), MP3_BYTES),
            write(tmp.path(), &format!("dl/{long}-002.mp3"), MP3_BYTES),
        ];
        let root = tmp.path().join("library");
        fs::create_dir_all(&root).unwrap();

        let placed = place_folder_blocking(&root, 7, &parts, "Frank Herbert", "Dune").unwrap();

        assert!(placed.join(format!("{long}.mp3")).is_file());
        assert!(placed.join(format!("{long}-2.mp3")).is_file());
    }

    #[test]
    fn fails_and_creates_nothing_when_the_library_folder_is_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let (parts, _) = two_discs(tmp.path());
        let absent = tmp.path().join("not-mounted");

        let err = place_folder_blocking(&absent, 7, &parts, "Frank Herbert", "Dune");

        assert!(err.is_err());
        assert!(!absent.exists());
    }

    #[test]
    fn never_touches_the_downloaded_parts() {
        let tmp = tempfile::tempdir().unwrap();
        let (parts, root) = two_discs(tmp.path());

        place_folder_blocking(&root, 7, &parts, "Frank Herbert", "Dune").unwrap();

        assert_eq!(fs::read(&parts[0]).unwrap(), MP3_BYTES);
        assert!(parts[1].is_file());
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
