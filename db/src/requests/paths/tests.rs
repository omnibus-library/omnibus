use std::fs;
use std::path::{Path, PathBuf};

use super::*;

/// `<tmp>/dl` holding `omnibus/x.epub`, plus a `<tmp>/outside/secret.epub` beside it.
fn download_tree(tmp: &Path) -> PathBuf {
    let dl = tmp.join("dl");
    fs::create_dir_all(dl.join("omnibus")).unwrap();
    fs::write(dl.join("omnibus/x.epub"), b"epub").unwrap();
    fs::create_dir_all(tmp.join("outside")).unwrap();
    fs::write(tmp.join("outside/secret.epub"), b"secret").unwrap();
    dl
}

mod map_client_path {
    use super::*;

    #[test]
    fn returns_the_canonical_local_path_for_a_file_under_the_prefix() {
        let tmp = tempfile::tempdir().unwrap();
        let dl = download_tree(tmp.path());

        let mapped = map_client_path(
            Path::new("/downloads/omnibus/x.epub"),
            Path::new("/downloads"),
            &dl,
        )
        .unwrap();

        let expected = tmp.path().canonicalize().unwrap().join("dl/omnibus/x.epub");
        assert_eq!(mapped, expected);
    }

    mod containment {
        use super::*;

        #[test]
        fn rejects_a_path_outside_the_client_prefix() {
            let tmp = tempfile::tempdir().unwrap();
            let dl = download_tree(tmp.path());

            for client in ["/elsewhere/x.epub", "/downloads-extra/x.epub"] {
                let err =
                    map_client_path(Path::new(client), Path::new("/downloads"), &dl).unwrap_err();
                assert!(matches!(err, PathMapError::NotUnderPrefix), "{client}");
            }
        }

        #[test]
        fn rejects_dot_dot_that_climbs_out_of_the_local_folder() {
            let tmp = tempfile::tempdir().unwrap();
            let dl = download_tree(tmp.path());

            let err = map_client_path(
                Path::new("/downloads/../outside/secret.epub"),
                Path::new("/downloads"),
                &dl,
            )
            .unwrap_err();

            assert!(matches!(err, PathMapError::Escapes));
        }

        #[cfg(unix)]
        #[test]
        fn rejects_a_symlink_inside_the_folder_that_points_outside() {
            let tmp = tempfile::tempdir().unwrap();
            let dl = download_tree(tmp.path());
            std::os::unix::fs::symlink(tmp.path().join("outside"), dl.join("link")).unwrap();

            let err = map_client_path(
                Path::new("/downloads/link/secret.epub"),
                Path::new("/downloads"),
                &dl,
            )
            .unwrap_err();

            assert!(matches!(err, PathMapError::Escapes));
        }

        #[test]
        fn returns_an_io_error_for_a_file_that_does_not_exist() {
            let tmp = tempfile::tempdir().unwrap();
            let dl = download_tree(tmp.path());

            let err = map_client_path(
                Path::new("/downloads/omnibus/missing.epub"),
                Path::new("/downloads"),
                &dl,
            )
            .unwrap_err();

            assert!(matches!(err, PathMapError::Io(_)));
        }
    }
}
