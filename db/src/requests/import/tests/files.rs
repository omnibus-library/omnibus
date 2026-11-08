//! Picking the book out of a finished download: mapping its files and choosing one.

use std::fs;

use crate::requests::clients::{ClientFile, TorrentStatus};
use crate::requests::test_support::requests_config;

use super::super::files::{has_convertible, pick, resolve};
use super::super::ImportError;
use super::{mobi_bytes, write, EPUB_BYTES};

const PDF_BYTES: &[u8] = b"%PDF-1.7 a pdf";

fn status(save_path: &str) -> TorrentStatus {
    TorrentStatus {
        hash: "h".to_string(),
        progress: 1.0,
        state: "stalledUP".to_string(),
        save_path: save_path.to_string(),
        eta: None,
        tags: String::new(),
        added_on: None,
    }
}

fn listed(names: &[&str]) -> Vec<ClientFile> {
    names
        .iter()
        .map(|name| ClientFile {
            name: (*name).to_string(),
            size: 1,
        })
        .collect()
}

mod resolve {
    use super::*;

    #[test]
    fn finds_a_file_wrapped_in_a_subfolder() {
        let tmp = tempfile::tempdir().unwrap();
        let dl = tmp.path().join("dl");
        let file = write(&dl, "Release/Dune.epub", EPUB_BYTES);
        let config = requests_config(Some("/downloads"), dl.to_str());

        let found = resolve(
            &status("/downloads"),
            &listed(&["Release/Dune.epub"]),
            &config,
        )
        .unwrap();

        assert_eq!(found, vec![file.canonicalize().unwrap()]);
    }

    #[test]
    fn uses_the_save_folder_when_the_folders_are_not_mapped() {
        let tmp = tempfile::tempdir().unwrap();
        let file = write(tmp.path(), "Dune.epub", EPUB_BYTES);
        let config = requests_config(None, None);

        let found = resolve(
            &status(tmp.path().to_str().unwrap()),
            &listed(&["Dune.epub"]),
            &config,
        )
        .unwrap();

        assert_eq!(found, vec![file.canonicalize().unwrap()]);
    }

    #[test]
    fn leaves_out_a_listed_file_that_was_never_written() {
        let tmp = tempfile::tempdir().unwrap();
        let dune = write(tmp.path(), "Dune.epub", EPUB_BYTES);
        let config = requests_config(None, None);

        let found = resolve(
            &status(tmp.path().to_str().unwrap()),
            &listed(&["Dune.epub", "missing.epub", "missing.exe"]),
            &config,
        )
        .unwrap();

        assert_eq!(found, vec![dune.canonicalize().unwrap()]);
    }

    #[test]
    fn refuses_a_download_folder_this_server_cannot_see() {
        let tmp = tempfile::tempdir().unwrap();
        let gone = tmp.path().join("not-mounted");
        let config = requests_config(None, None);

        let err = resolve(
            &status(gone.to_str().unwrap()),
            &listed(&["Dune.epub"]),
            &config,
        )
        .unwrap_err();

        assert!(matches!(err, ImportError::NotVisible(_)), "{err}");
    }

    #[test]
    fn refuses_only_one_of_the_two_download_folders_set() {
        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "Dune.epub", EPUB_BYTES);
        let dir = tmp.path().to_str();

        for config in [requests_config(dir, None), requests_config(None, dir)] {
            let err = resolve(&status(dir.unwrap()), &listed(&["Dune.epub"]), &config).unwrap_err();

            assert!(matches!(err, ImportError::Cannot(_)), "{err}");
        }
    }

    #[test]
    fn maps_azw3_and_mobi_files_whatever_the_case_of_the_extension() {
        let tmp = tempfile::tempdir().unwrap();
        let azw3 = write(tmp.path(), "Dune.AZW3", &mobi_bytes());
        let mobi = write(tmp.path(), "Dune.mobi", &mobi_bytes());
        let config = requests_config(None, None);

        let found = resolve(
            &status(tmp.path().to_str().unwrap()),
            &listed(&["Dune.AZW3", "Dune.mobi", "Dune.azw"]),
            &config,
        )
        .unwrap();

        assert_eq!(
            found,
            vec![azw3.canonicalize().unwrap(), mobi.canonicalize().unwrap()]
        );
    }

    #[test]
    fn refuses_a_path_that_escapes_the_download_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let dl = tmp.path().join("dl");
        fs::create_dir_all(&dl).unwrap();
        write(tmp.path(), "outside/secret.epub", EPUB_BYTES);
        let config = requests_config(None, None);

        let err = resolve(
            &status(dl.to_str().unwrap()),
            &listed(&["../outside/secret.epub"]),
            &config,
        )
        .unwrap_err();

        assert!(matches!(err, ImportError::NotVisible(_)), "{err}");
    }

    #[test]
    fn refuses_a_path_outside_the_client_prefix() {
        let tmp = tempfile::tempdir().unwrap();
        let dl = tmp.path().join("dl");
        write(&dl, "Dune.epub", EPUB_BYTES);
        let config = requests_config(Some("/downloads"), dl.to_str());

        let err = resolve(&status("/elsewhere"), &listed(&["Dune.epub"]), &config).unwrap_err();

        assert!(matches!(err, ImportError::NotVisible(_)), "{err}");
    }
}

mod pick {
    use super::*;

    #[test]
    fn drops_an_executable_and_an_unknown_extension() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = vec![
            write(tmp.path(), "setup.exe", b"MZ not a book"),
            write(tmp.path(), "book.cbz", EPUB_BYTES),
        ];

        let err = pick(&paths, false).unwrap_err();

        assert!(matches!(err, ImportError::NothingImportable), "{err}");
    }

    #[test]
    fn drops_an_epub_whose_bytes_are_not_a_zip() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = vec![write(tmp.path(), "fake.epub", b"<html>not an epub</html>")];

        let err = pick(&paths, false).unwrap_err();

        assert!(matches!(err, ImportError::NothingImportable), "{err}");
    }

    #[test]
    fn prefers_the_epub_when_a_release_carries_epub_and_pdf() {
        let tmp = tempfile::tempdir().unwrap();
        let epub = write(tmp.path(), "small.epub", EPUB_BYTES);
        let pdf = write(tmp.path(), "huge.pdf", &[PDF_BYTES, &[b'x'; 4096]].concat());

        let picked = pick(&[pdf, epub.clone()], false).unwrap();

        assert_eq!(picked, (epub, "epub"));
    }

    #[test]
    fn takes_the_larger_of_two_epubs() {
        let tmp = tempfile::tempdir().unwrap();
        let small = write(tmp.path(), "a.epub", EPUB_BYTES);
        let large = write(tmp.path(), "b.epub", &[EPUB_BYTES, &[b'x'; 4096]].concat());

        let picked = pick(&[small, large.clone()], false).unwrap();

        assert_eq!(picked, (large, "epub"));
    }

    #[test]
    fn fails_nothing_importable_on_an_empty_list() {
        let err = pick(&[], false).unwrap_err();

        assert!(matches!(err, ImportError::NothingImportable), "{err}");
    }
}

mod pick_convertible {
    use super::*;

    #[test]
    fn prefers_epub_then_azw3_and_mobi_then_pdf() {
        let tmp = tempfile::tempdir().unwrap();
        let big = vec![b'x'; 4096];
        let epub = write(tmp.path(), "a.epub", EPUB_BYTES);
        let mobi = write(tmp.path(), "b.mobi", &[mobi_bytes(), big.clone()].concat());
        let pdf = write(tmp.path(), "c.pdf", &[PDF_BYTES, &big].concat());

        assert_eq!(
            pick(&[pdf.clone(), mobi.clone(), epub.clone()], true).unwrap(),
            (epub, "epub")
        );
        assert_eq!(pick(&[pdf, mobi.clone()], true).unwrap(), (mobi, "mobi"));
    }

    #[test]
    fn takes_the_larger_of_an_azw3_and_a_mobi() {
        let tmp = tempfile::tempdir().unwrap();
        let small = write(tmp.path(), "a.mobi", &mobi_bytes());
        let large = write(
            tmp.path(),
            "b.azw3",
            &[mobi_bytes(), vec![b'x'; 4096]].concat(),
        );

        assert_eq!(
            pick(&[small, large.clone()], true).unwrap(),
            (large, "azw3")
        );
    }

    #[test]
    fn ignores_a_mobi_for_a_pdf_when_conversion_is_not_available() {
        let tmp = tempfile::tempdir().unwrap();
        let mobi = write(tmp.path(), "a.mobi", &mobi_bytes());
        let pdf = write(tmp.path(), "b.pdf", PDF_BYTES);

        assert_eq!(pick(&[mobi, pdf.clone()], false).unwrap(), (pdf, "pdf"));
    }

    #[test]
    fn names_the_missing_converter_when_only_a_mobi_is_left_and_conversion_is_not_available() {
        let tmp = tempfile::tempdir().unwrap();
        let mobi = write(tmp.path(), "a.mobi", &mobi_bytes());

        let err = pick(&[mobi], false).unwrap_err();

        assert!(
            matches!(
                err,
                ImportError::Convert(crate::convert::ConvertError::BinaryUnavailable)
            ),
            "{err}"
        );
    }

    #[test]
    fn drops_a_mobi_whose_bytes_are_not_a_palmdb() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = vec![write(tmp.path(), "fake.mobi", b"<html>not a mobi</html>")];

        let err = pick(&paths, true).unwrap_err();

        assert!(matches!(err, ImportError::NothingImportable), "{err}");
    }

    #[test]
    fn drops_a_mobi_too_short_to_hold_a_palmdb_header() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = vec![write(tmp.path(), "short.azw3", b"BOOKMOBI")];

        let err = pick(&paths, true).unwrap_err();

        assert!(matches!(err, ImportError::NothingImportable), "{err}");
    }
}

mod has_convertible {
    use super::*;

    #[test]
    fn is_true_only_when_an_azw3_or_mobi_is_listed() {
        let tmp = tempfile::tempdir().unwrap();
        let epub = write(tmp.path(), "a.epub", EPUB_BYTES);
        let mobi = write(tmp.path(), "b.MOBI", &mobi_bytes());

        assert!(!has_convertible(std::slice::from_ref(&epub)));
        assert!(has_convertible(&[epub, mobi]));
    }
}
