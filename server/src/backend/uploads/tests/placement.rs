//! Taking back out an upload that never became a book: the file and the
//! folders it left empty go, nothing outside them does, and the error says
//! whether the file is still in the library.

use axum::{body::to_bytes, http::StatusCode, response::IntoResponse};

use super::super::*;

/// `<root>/author/title/title.m4b`, beside a sibling book in the same author
/// folder.
fn placed_beside_a_sibling(root: &Path) -> PathBuf {
    let author = root.join("author");
    std::fs::create_dir_all(author.join("other")).unwrap();
    std::fs::write(author.join("other").join("other.m4b"), b"x").unwrap();
    std::fs::create_dir_all(author.join("title")).unwrap();
    let file = author.join("title").join("title.m4b");
    std::fs::write(&file, b"x").unwrap();
    file
}

async fn body_of(err: UploadError) -> (StatusCode, String) {
    let res = err.into_response();
    let status = res.status();
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    (status, String::from_utf8_lossy(&bytes).into_owned())
}

#[tokio::test]
async fn abandon_placed_removes_the_file_and_only_the_folders_it_emptied() {
    let root = tempfile::tempdir().unwrap();
    let file = placed_beside_a_sibling(root.path());

    let err = abandon_placed(root.path(), &file, "test", "boom").await;

    assert!(!file.parent().unwrap().exists(), "the title folder goes");
    assert!(
        root.path()
            .join("author")
            .join("other")
            .join("other.m4b")
            .exists(),
        "the author folder still holds another book, so it stays"
    );
    assert!(root.path().exists(), "the library root is never removed");
    assert_eq!(
        body_of(err).await,
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            NOT_INDEXED_DISCARDED.to_string()
        )
    );
}

#[tokio::test]
async fn abandon_placed_prunes_an_author_folder_it_left_empty() {
    let root = tempfile::tempdir().unwrap();
    let folder = root.path().join("author").join("title");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("01.mp3"), b"x").unwrap();

    abandon_placed(root.path(), &folder, "test", "boom").await;

    assert!(!root.path().join("author").exists());
    assert!(root.path().exists());
}

#[cfg(unix)]
#[tokio::test]
async fn abandon_placed_reports_a_file_it_could_not_remove_as_stored() {
    use std::os::unix::fs::PermissionsExt;

    let root = tempfile::tempdir().unwrap();
    let file = placed_beside_a_sibling(root.path());
    let folder = file.parent().unwrap().to_path_buf();
    // A read-only folder refuses the unlink.
    std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o555)).unwrap();

    let err = abandon_placed(root.path(), &file, "test", "boom").await;
    std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o755)).unwrap();

    // Running as root ignores the mode bits, so there is nothing stuck to report.
    if !file.exists() {
        return;
    }
    assert_eq!(
        body_of(err).await,
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            NOT_INDEXED_STORED.to_string()
        ),
        "a file still in the library must not invite another upload"
    );
}
