//! The store's clock-driven progress, delivery, removal and outcome changes, with no HTTP.

use std::fs;
use std::time::Duration;

use omnibus_shared::ReleaseProtocol;

use crate::catalogue::{Format, Payloads};

use super::*;

fn release(id: &str, format: Format) -> Release {
    Release {
        id: id.into(),
        title: "Dracula".into(),
        format,
        protocol: ReleaseProtocol::Torrent,
    }
}

fn payloads(dir: &Path) -> Payloads {
    let payloads = Payloads {
        epub: dir.join("alpha.epub"),
        m4b: dir.join("book.m4b"),
    };
    fs::write(&payloads.epub, b"epub bytes").unwrap();
    fs::write(&payloads.m4b, b"m4b bytes").unwrap();
    payloads
}

struct Fixture {
    store: Store,
    downloads: PathBuf,
    now: Instant,
    _dirs: (tempfile::TempDir, tempfile::TempDir),
}

fn fixture(secs: u64) -> Fixture {
    let downloads = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let store = Store::new(
        downloads.path().to_path_buf(),
        payloads(source.path()),
        secs,
    );
    Fixture {
        store,
        downloads: downloads.path().to_path_buf(),
        now: Instant::now(),
        _dirs: (downloads, source),
    }
}

impl Fixture {
    /// Adds a torrent EPUB download named after `id`.
    fn add(&mut self, id: &str) -> u64 {
        self.store.add(
            DownloadClientKind::Qbittorrent,
            id.into(),
            release(id, Format::Epub),
            format!("mock-{id}"),
            self.now,
        )
    }

    fn after(&mut self, secs: u64) -> &mut Store {
        self.now += Duration::from_secs(secs);
        self.store.refresh(self.now);
        &mut self.store
    }

    fn progress(&self, id: &str) -> f64 {
        self.store
            .find(DownloadClientKind::Qbittorrent, id)
            .unwrap()
            .progress()
    }
}

#[test]
fn mint_gives_unique_forty_hex_ids() {
    let mut f = fixture(30);

    let (a, b) = (f.store.mint(), f.store.mint());

    assert_ne!(a, b);
    for id in [a, b] {
        assert_eq!(id.len(), 40);
        assert!(
            id.bytes().all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f')),
            "{id}"
        );
    }
}

#[test]
fn release_finds_what_remember_kept() {
    let mut f = fixture(30);
    f.store.remember(release("abc", Format::Epub));

    assert_eq!(
        f.store.release("abc").map(|r| r.title.as_str()),
        Some("Dracula")
    );
    assert!(f.store.release("nope").is_none());
}

#[test]
fn refresh_reports_half_progress_at_half_the_time_and_all_of_it_at_the_end() {
    let mut f = fixture(30);
    f.add("a");

    f.after(15);
    assert_eq!(f.progress("a"), 0.5);
    assert_eq!(
        f.store
            .find(DownloadClientKind::Qbittorrent, "a")
            .unwrap()
            .eta(30),
        Some(15)
    );

    f.after(15);
    assert_eq!(f.progress("a"), 1.0);
    assert_eq!(
        f.store
            .find(DownloadClientKind::Qbittorrent, "a")
            .unwrap()
            .eta(30),
        None
    );
}

#[test]
fn refresh_finishes_on_the_first_read_when_downloads_take_no_time() {
    let mut f = fixture(0);
    f.add("a");

    f.after(0);

    assert_eq!(f.progress("a"), 1.0);
}

#[test]
fn refresh_stops_at_one_however_long_it_has_been() {
    let mut f = fixture(30);
    f.add("a");

    f.after(3000);

    assert_eq!(f.progress("a"), 1.0);
}

#[test]
fn stall_freezes_progress_and_complete_resumes_from_it() {
    let mut f = fixture(30);
    f.add("a");
    f.after(15);

    f.store.set(Some(Outcome::Stall), None, f.now);
    f.after(100);
    assert_eq!(f.progress("a"), 0.5);

    f.store.set(Some(Outcome::Complete), None, f.now);
    f.after(15);
    assert_eq!(f.progress("a"), 1.0);
}

#[test]
fn fail_freezes_progress_without_finishing() {
    let mut f = fixture(30);
    f.add("a");
    f.store.set(Some(Outcome::Fail), None, f.now);

    f.after(100);

    assert_eq!(f.progress("a"), 0.0);
    assert!(
        !f.store
            .find(DownloadClientKind::Qbittorrent, "a")
            .unwrap()
            .done
    );
}

#[test]
fn refresh_writes_the_payload_into_the_download_folder_once_it_finishes() {
    let mut f = fixture(30);
    f.add("a");

    f.after(29);
    assert!(!f.downloads.join("mock-a").exists());

    f.after(1);
    let delivered = f.downloads.join("mock-a/mock-a.epub");
    assert_eq!(fs::read(delivered).unwrap(), b"epub bytes");
}

#[test]
fn refresh_delivers_an_m4b_release_as_an_m4b_file() {
    let mut f = fixture(0);
    f.store.add(
        DownloadClientKind::Qbittorrent,
        "b".into(),
        release("b", Format::M4b),
        "mock-b".into(),
        f.now,
    );

    f.after(0);

    assert_eq!(
        fs::read(f.downloads.join("mock-b/mock-b.m4b")).unwrap(),
        b"m4b bytes"
    );
}

#[test]
fn refresh_delivers_only_a_readme_for_a_junk_download() {
    let mut f = fixture(0);
    f.store.set(Some(Outcome::Junk), None, f.now);
    f.add("a");

    f.after(0);

    let names: Vec<_> = fs::read_dir(f.downloads.join("mock-a"))
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    assert_eq!(names, ["README.txt"]);
}

#[test]
fn refresh_copies_the_payload_only_once_per_download() {
    let mut f = fixture(0);
    f.add("a");
    f.after(0);
    let delivered = f.downloads.join("mock-a/mock-a.epub");
    fs::write(&delivered, b"edited").unwrap();

    f.after(10);

    assert_eq!(fs::read(delivered).unwrap(), b"edited");
}

#[test]
fn add_gives_the_same_number_when_the_download_is_already_held() {
    let mut f = fixture(30);

    let (first, again) = (f.add("a"), f.add("a"));
    let other = f.add("b");

    assert_eq!(first, again);
    assert_ne!(first, other);
}

#[test]
fn find_sees_only_downloads_of_its_own_client() {
    let mut f = fixture(30);
    f.add("a");

    assert!(f
        .store
        .find(DownloadClientKind::Transmission, "a")
        .is_none());
    assert!(f.store.find(DownloadClientKind::Qbittorrent, "a").is_some());
}

#[test]
fn remove_deletes_the_download_folder_and_nothing_else() {
    let mut f = fixture(0);
    f.add("a");
    f.add("b");
    f.after(0);

    f.store.remove(DownloadClientKind::Qbittorrent, "a", true);

    assert!(f.store.find(DownloadClientKind::Qbittorrent, "a").is_none());
    assert!(!f.downloads.join("mock-a").exists());
    assert!(f.downloads.join("mock-b").exists());
}

#[test]
fn remove_keeps_the_files_when_asked_to() {
    let mut f = fixture(0);
    f.add("a");
    f.after(0);

    f.store.remove(DownloadClientKind::Qbittorrent, "a", false);

    assert!(f.downloads.join("mock-a/mock-a.epub").exists());
}

#[test]
fn set_applies_to_unfinished_downloads_and_to_later_ones() {
    let mut f = fixture(30);
    f.add("a");

    f.store.set(Some(Outcome::Stall), Some(60), f.now);
    f.add("b");

    for id in ["a", "b"] {
        let d = f.store.find(DownloadClientKind::Qbittorrent, id).unwrap();
        assert_eq!(d.outcome, Outcome::Stall, "{id}");
    }
    f.store.set(Some(Outcome::Complete), None, f.now);
    f.after(30);
    assert_eq!((f.progress("a"), f.progress("b")), (0.5, 0.5));
}

#[test]
fn set_leaves_a_finished_download_alone() {
    let mut f = fixture(0);
    f.add("a");
    f.after(0);

    f.store.set(Some(Outcome::Fail), None, f.now);

    assert_eq!(
        f.store
            .find(DownloadClientKind::Qbittorrent, "a")
            .unwrap()
            .outcome,
        Outcome::Complete
    );
}

impl Fixture {
    /// A release the store has made and kept, as a search would, over `protocol`.
    fn offered(&mut self, protocol: ReleaseProtocol) -> Release {
        let mut made = release(&self.store.mint(), Format::Epub);
        made.protocol = protocol;
        self.store.remember(made.clone());
        made
    }
}

#[test]
fn add_torrent_starts_a_download_for_a_magnet_the_mock_offered() {
    let mut f = fixture(30);
    let offered = f.offered(ReleaseProtocol::Torrent);
    let magnet = offered.link("http://127.0.0.1:1");

    let id = f
        .store
        .add_torrent(DownloadClientKind::Transmission, &magnet, f.now);

    assert_eq!(id.as_deref(), Some(offered.id.as_str()));
    let held = f
        .store
        .find(DownloadClientKind::Transmission, &offered.id)
        .unwrap();
    assert_eq!(held.folder, format!("mock-{}", offered.id));
}

#[test]
fn add_torrent_is_none_for_a_usenet_release_and_for_an_unknown_magnet() {
    let mut f = fixture(30);
    let usenet = f.offered(ReleaseProtocol::Usenet);
    let unknown = format!("magnet:?xt=urn:btih:{}", "c".repeat(40));

    for link in [usenet.link("http://127.0.0.1:1"), unknown] {
        let id = f
            .store
            .add_torrent(DownloadClientKind::Qbittorrent, &link, f.now);

        assert_eq!(id, None, "{link}");
    }
}

#[test]
fn add_usenet_starts_a_job_named_after_the_upload() {
    let mut f = fixture(30);
    let offered = f.offered(ReleaseProtocol::Usenet);
    let name = format!("omnibus-{}", "a".repeat(40));

    let num = f.store.add_usenet(
        DownloadClientKind::Sabnzbd,
        &name,
        crate::nzb::body(&offered.id).as_bytes(),
        f.now,
    );

    let held = f.store.find(DownloadClientKind::Sabnzbd, &name).unwrap();
    assert_eq!((num, held.folder.as_str()), (Ok(held.num), name.as_str()));
}

#[test]
fn add_usenet_refuses_a_job_name_that_could_be_a_path_and_an_nzb_it_never_offered() {
    let mut f = fixture(30);
    let offered = f.offered(ReleaseProtocol::Usenet);
    let good = format!("omnibus-{}", "a".repeat(40));
    let cases = [
        (
            "../escape",
            crate::nzb::body(&offered.id),
            UsenetRefused::JobName,
        ),
        (
            good.as_str(),
            crate::nzb::body(&"d".repeat(40)),
            UsenetRefused::UnknownNzb,
        ),
        (
            good.as_str(),
            "<nzb></nzb>".to_string(),
            UsenetRefused::UnknownNzb,
        ),
    ];
    for (name, nzb, refused) in cases {
        let added = f
            .store
            .add_usenet(DownloadClientKind::Nzbget, name, nzb.as_bytes(), f.now);

        assert_eq!(added, Err(refused), "{name}");
    }
    assert!(f.store.all().is_empty());
}

#[test]
fn remove_num_forgets_only_the_download_with_that_number_of_that_client() {
    let mut f = fixture(0);
    let (a, b) = (f.add("a"), f.add("b"));
    f.after(0);

    f.store
        .remove_num(DownloadClientKind::Transmission, a, true);
    assert!(f.store.find(DownloadClientKind::Qbittorrent, "a").is_some());
    f.store.remove_num(DownloadClientKind::Qbittorrent, a, true);

    assert!(f.store.find(DownloadClientKind::Qbittorrent, "a").is_none());
    assert!(!f.downloads.join("mock-a").exists());
    assert!(f.store.find(DownloadClientKind::Qbittorrent, "b").is_some());
    assert_ne!(a, b);
}
