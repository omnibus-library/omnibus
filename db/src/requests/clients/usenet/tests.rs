use std::fs;

use super::*;
use tempfile::TempDir;

/// The SHA-1 of `abc`, from FIPS 180-1.
const ABC_SHA1: &str = "a9993e364706816aba3e25717850c26c9cd0d89d";

mod job_id_of {
    use super::*;

    #[test]
    fn gives_the_sha1_of_the_link_in_lowercase_hex() {
        assert_eq!(job_id("abc"), ABC_SHA1);
    }

    #[test]
    fn gives_different_ids_to_different_links() {
        assert_ne!(job_id("http://a.invalid/1"), job_id("http://a.invalid/2"));
    }
}

mod job_name_of {
    use super::*;

    #[test]
    fn prefixes_the_id_so_the_job_is_recognisable_in_the_client() {
        assert_eq!(job_name(ABC_SHA1), format!("omnibus-{ABC_SHA1}"));
    }
}

mod prepare_nzb {
    use super::*;

    #[test]
    fn names_the_job_by_the_hash_of_its_link_and_carries_the_link() {
        let link = "http://prowlarr.invalid/13/download?apikey=secret";

        let prepared = prepare(link).unwrap();

        assert_eq!(prepared.hash, job_id(link));
        assert!(matches!(prepared.release, Release::NzbLink(l) if l == link));
    }

    #[test]
    fn rejects_a_magnet_link_naming_why() {
        let err = prepare("magnet:?xt=urn:btih:abc").err().unwrap();

        assert!(matches!(&err, ConnectionError::Rejected(_)), "{err:?}");
        assert_eq!(err.to_string(), "the release link is a magnet, not an NZB");
    }

    #[test]
    fn rejects_a_link_that_is_not_a_web_address() {
        let err = prepare("ftp://host.invalid/a.nzb").err().unwrap();

        assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
    }

    #[test]
    fn rejects_a_link_that_is_not_a_url() {
        let err = prepare("not-a-link").err().unwrap();

        assert!(matches!(err, ConnectionError::Rejected(_)), "{err:?}");
    }
}

mod job_folders_files {
    use super::*;

    fn write(root: &Path, relative: &str, bytes: &[u8]) {
        let file = root.join(relative);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, bytes).unwrap();
    }

    fn names(files: &[ClientFile]) -> Vec<&str> {
        files.iter().map(|f| f.name.as_str()).collect()
    }

    #[tokio::test]
    async fn lists_the_files_of_the_folder_and_its_subfolders_relative_to_it() {
        let job = TempDir::new().unwrap();
        write(job.path(), "Dune.epub", b"12345");
        write(job.path(), "extras/cover.jpg", b"123");

        let files = JobFolders::default()
            .files(job.path().to_str().unwrap())
            .await;

        let expected = vec![
            ClientFile {
                name: "Dune.epub".to_string(),
                size: 5,
            },
            ClientFile {
                name: "extras/cover.jpg".to_string(),
                size: 3,
            },
        ];
        assert_eq!(files, expected);
    }

    #[tokio::test]
    async fn reads_the_folder_where_this_server_mounts_it_when_both_prefixes_are_set() {
        let local = TempDir::new().unwrap();
        write(local.path(), "complete/job/Dune.epub", b"1");
        let folders = JobFolders::new(Some("/downloads"), local.path().to_str());

        let files = folders.files("/downloads/complete/job").await;

        assert_eq!(names(&files), ["Dune.epub"]);
    }

    #[tokio::test]
    async fn lists_nothing_when_the_folder_is_not_under_the_clients_prefix() {
        let local = TempDir::new().unwrap();
        write(local.path(), "job/Dune.epub", b"1");
        let folders = JobFolders::new(Some("/downloads"), local.path().to_str());

        let files = folders.files("/elsewhere/job").await;

        assert_eq!(files, Vec::new());
    }

    #[tokio::test]
    async fn lists_nothing_when_the_folder_does_not_exist_here() {
        let files = JobFolders::default().files("/no/such/omnibus/folder").await;

        assert_eq!(files, Vec::new());
    }

    #[tokio::test]
    async fn goes_eight_folders_deep_and_no_further() {
        let job = TempDir::new().unwrap();
        write(job.path(), "1/2/3/4/5/6/7/8/in.epub", b"1");
        write(job.path(), "1/2/3/4/5/6/7/8/9/out.epub", b"1");

        let files = JobFolders::default()
            .files(job.path().to_str().unwrap())
            .await;

        assert_eq!(names(&files), ["1/2/3/4/5/6/7/8/in.epub"]);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn skips_a_symlink_so_a_job_cannot_list_files_outside_its_folder() {
        let job = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        write(outside.path(), "secret.epub", b"1");
        write(job.path(), "Dune.epub", b"1");
        std::os::unix::fs::symlink(outside.path(), job.path().join("link")).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secret.epub"),
            job.path().join("secret.epub"),
        )
        .unwrap();

        let files = JobFolders::default()
            .files(job.path().to_str().unwrap())
            .await;

        assert_eq!(names(&files), ["Dune.epub"]);
    }
}
