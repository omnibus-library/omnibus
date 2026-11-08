//! The import run end to end: a real worker and library on disk, a scripted download client,
//! and the request rows each outcome leaves behind.

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use omnibus_shared::{RequestKind, RequestState, Settings, StuckReason, WishlistSource};
use sqlx::SqlitePool;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::requests::poller::tick_with;
use crate::requests::store::{self, RequestRow};
use crate::requests::test_support::{
    hash, pick, requests_config, seed_picked, update, Call, StubClient,
};
use crate::test_support::{
    book_with_png_cover, build_stored_zip, build_test_epub, build_test_pdf, count_rows,
    external_meta, loopback_cover_config, seed_user, solid_color_png, CoversTempDir, TestPdf,
};
use crate::worker::{Task, Worker, WorkerConfig};
use crate::{
    add_wishlist_entry, create_fileless_book, get_book_by_uuid, get_book_files, set_settings,
    FilelessBook,
};

use super::super::import_finished;
use super::write;

/// A library root and a download folder on disk, a database that points at the library, and a
/// real worker. The database is a file: an in-memory one answers the scan's follow-up writes
/// racing a merge with SQLITE_LOCKED, where a file waits its turn as production does.
pub struct Env {
    pub pool: SqlitePool,
    pub worker: Arc<Worker>,
    pub root: PathBuf,
    pub dl: PathBuf,
    _tmp: tempfile::TempDir,
}

pub async fn env() -> Env {
    let tmp = tempfile::tempdir().unwrap();
    let (root, dl) = (tmp.path().join("library"), tmp.path().join("dl"));
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&dl).unwrap();
    let url = format!(
        "sqlite://{}?mode=rwc",
        tmp.path().join("omnibus.db").display()
    );
    let pool = crate::pool::init_db(&url).await.unwrap();
    // Not the developer's Calibre: an import that needs a converter says so through its own.
    crate::set_ebook_convert_path(&pool, Some("/nonexistent/omnibus-ebook-convert-probe"))
        .await
        .unwrap();
    let worker = Worker::new(pool.clone(), WorkerConfig::default());
    let env = Env {
        pool,
        worker,
        root,
        dl,
        _tmp: tmp,
    };
    use_library(&env, env.root.to_str()).await;
    env
}

/// Point the ebook library setting at `path`.
async fn use_library(env: &Env, path: Option<&str>) {
    let settings = Settings {
        ebook_library_path: path.map(str::to_string),
        audiobook_library_path: None,
        scan_interval_hours: None,
    };
    set_settings(&env.pool, &settings).await.unwrap();
}

fn epub(text: &str) -> Vec<u8> {
    build_test_epub(&[("c1.xhtml", &format!("<p>{text}</p>"))])
}

/// An EPUB whose own metadata names `title` and `author`.
pub fn epub_by(title: &str, author: &str) -> Vec<u8> {
    let container: &[u8] = br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#;
    let opf = format!(
        r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">{title}-by-{author}</dc:identifier>
    <dc:title>{title}</dc:title><dc:creator>{author}</dc:creator>
  </metadata>
  <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>"#
    );
    build_stored_zip(&[
        ("mimetype", b"application/epub+zip".as_slice()),
        ("META-INF/container.xml", container),
        ("content.opf", opf.as_bytes()),
        ("c1.xhtml", b"<p>hi</p>".as_slice()),
    ])
}

/// A fileless book, as a wishlist entry makes one.
pub async fn wish(env: &Env, title: &str, author: &str) -> String {
    let book = FilelessBook {
        title: title.to_string(),
        authors: vec![author.to_string()],
        isbn: None,
        pubdate: None,
        description: None,
        cover: None,
    };
    create_fileless_book(&env.pool, book).await.unwrap()
}

/// A request of `kind` for `book_uuid` whose download reached `progress`.
async fn request_at(env: &Env, book_uuid: &str, kind: RequestKind, progress: f64) -> RequestRow {
    let id = seed_picked(&env.pool, "ada", book_uuid, kind, "on_its_way").await;
    let set = format!("client_hash = '{}', progress = {progress}", hash(id));
    update(&env.pool, id, &set).await;
    row(env, id).await
}

/// A request whose download is complete and waits for the import.
pub async fn finished_request(env: &Env, book_uuid: &str, kind: RequestKind) -> RequestRow {
    request_at(env, book_uuid, kind, 1.0).await
}

pub async fn row(env: &Env, id: i64) -> RequestRow {
    store::get(&env.pool, id).await.unwrap().unwrap()
}

/// Write `files` (relative name, bytes) into the download folder, and return a client that
/// holds them as the finished download of `request`.
pub fn downloaded(env: &Env, request: &RequestRow, files: &[(&str, &[u8])]) -> StubClient {
    let listed: Vec<(&str, u64)> = files
        .iter()
        .map(|(name, bytes)| {
            write(&env.dl, name, bytes);
            (*name, bytes.len() as u64)
        })
        .collect();
    let hash = request.client_hash.as_deref().unwrap();
    StubClient::new().with_files(hash, env.dl.to_str().unwrap(), &listed)
}

/// One pass of the import with the download folders unmapped.
pub async fn run(env: &Env, client: &StubClient) -> bool {
    let config = requests_config(None, None);
    import_finished(&env.pool, client, &env.worker, &config)
        .await
        .unwrap()
}

async fn count(env: &Env, table: &str) -> i64 {
    count_rows(&env.pool, &format!("SELECT COUNT(*) FROM {table}")).await
}

pub async fn files_of(env: &Env, uuid: &str) -> usize {
    let book = get_book_by_uuid(&env.pool, uuid).await.unwrap().unwrap();
    get_book_files(&env.pool, book.id).await.unwrap().len()
}

/// Index `bytes` filed at `name` under the library, as a book already there, and return its uuid.
async fn index_existing(env: &Env, name: &str, bytes: &[u8]) -> String {
    write(&env.root, name, bytes);
    let root = env.root.to_str().unwrap().to_string();
    let scan = env.worker.post(Task::Scan {
        library_path: root.clone(),
    });
    env.worker.await_completion(scan).await;
    crate::get_book_uuid_by_scan_key(&env.pool, &root, name)
        .await
        .unwrap()
        .unwrap()
}

/// Assert the request ended `ready`, showing the admin's detail if it did not.
pub async fn assert_ready(env: &Env, id: i64) {
    let after = row(env, id).await;
    assert_eq!(after.state, RequestState::Ready, "{:?}", after.stuck_detail);
}

/// The request's detail for an admin, after asserting it ended `couldnt_add`.
pub async fn couldnt_add_detail(env: &Env, id: i64) -> String {
    let after = row(env, id).await;
    assert_eq!(after.state, RequestState::Stuck);
    assert_eq!(after.stuck_reason, Some(StuckReason::CouldntAdd));
    after.stuck_detail.unwrap()
}

mod import_finished {
    use super::*;

    mod success {
        use super::*;

        #[tokio::test]
        async fn attaches_the_epub_to_a_fileless_wished_book_without_a_duplicate() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let (wished_id, wished_uuid): (i64, String) =
                sqlx::query_as("SELECT id, uuid FROM books")
                    .fetch_one(&env.pool)
                    .await
                    .unwrap();
            assert_eq!(wished_uuid, wished);
            let reader = seed_user(&env.pool, "reader").await;
            add_wishlist_entry(&env.pool, reader, &wished, WishlistSource::Detail)
                .await
                .unwrap();
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;
            let client = downloaded(&env, &request, &[("Release/Dune.epub", &epub("dune"))]);

            run(&env, &client).await;

            assert_ready(&env, request.id).await;
            let books: Vec<(i64, String)> = sqlx::query_as("SELECT id, uuid FROM books")
                .fetch_all(&env.pool)
                .await
                .unwrap();
            assert_eq!(books, vec![(wished_id, wished.clone())]);
            let wishes: Vec<String> = sqlx::query_scalar("SELECT book_uuid FROM wishlist_entries")
                .fetch_all(&env.pool)
                .await
                .unwrap();
            assert_eq!(wishes, vec![wished.clone()]);
            assert_eq!(files_of(&env, &wished).await, 1);
            assert!(env.root.join("frank-herbert/dune/dune.epub").is_file());
            assert!(!env.root.join(".omnibus-staging").exists());
        }

        #[tokio::test]
        async fn merges_a_second_epub_into_a_book_that_has_one() {
            let env = env().await;
            let wished = index_existing(&env, "first/first.epub", &epub("first")).await;
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;
            let client = downloaded(&env, &request, &[("second.epub", &epub("second"))]);

            run(&env, &client).await;

            assert_ready(&env, request.id).await;
            assert_eq!(count(&env, "books").await, 1);
            assert_eq!(files_of(&env, &wished).await, 2);
        }

        #[tokio::test]
        async fn never_removes_or_moves_the_download() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;
            let bytes = epub("dune");
            let client = downloaded(&env, &request, &[("Dune.epub", &bytes)]);

            run(&env, &client).await;

            let removed = client
                .calls()
                .iter()
                .any(|call| matches!(call, Call::Remove { .. } | Call::Add { .. }));
            assert!(!removed);
            assert_eq!(fs::read(env.dl.join("Dune.epub")).unwrap(), bytes);
        }
    }

    mod cover_candidate {
        use super::*;

        /// An EPUB titled `title` by `author` (so the scan files it on the book of that name)
        /// whose declared cover, when given, is a `width` x `height` PNG.
        fn epub_with_cover(title: &str, author: &str, cover: Option<(u32, u32)>) -> Vec<u8> {
            let container: &[u8] = br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#;
            let item = cover.map_or("", |_| {
                r#"<item id="cv" href="cover.png" media-type="image/png" properties="cover-image"/>"#
            });
            let opf = format!(
                r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">{title}-by-{author}</dc:identifier>
    <dc:title>{title}</dc:title><dc:creator>{author}</dc:creator>
  </metadata>
  <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>{item}</manifest>
  <spine><itemref idref="c1"/></spine>
</package>"#
            );
            let png = cover.map(|(w, h)| solid_color_png(200, 10, 10, w, h));
            let mut entries = vec![
                ("mimetype", b"application/epub+zip".as_slice()),
                ("META-INF/container.xml", container),
                ("content.opf", opf.as_bytes()),
                ("c1.xhtml", b"<p>hi</p>".as_slice()),
            ];
            if let Some(png) = &png {
                entries.push(("cover.png", png.as_slice()));
            }
            build_stored_zip(&entries)
        }

        async fn cover_size(stem: &str) -> (u32, u32) {
            let (_, bytes) = crate::covers::find_cover_file(stem).unwrap();
            let img = image::load_from_memory(&bytes).unwrap();
            (img.width(), img.height())
        }

        /// A request for a book with a 20 x 30 cover, whose download is `epub`: its id and the
        /// book's uuid once `run` has imported it.
        async fn import(env: &Env, epub: &[u8], offers_cover: bool) -> (RequestRow, String) {
            let wished =
                book_with_png_cover(&env.pool, "Dune", "Frank Herbert", Some((20, 30))).await;
            let request = finished_request(env, &wished, RequestKind::Ebook).await;
            if !offers_cover {
                update(&env.pool, request.id, "offers_cover = 0").await;
            }
            let client = downloaded(env, &request, &[("Dune.epub", epub)]);
            run(env, &client).await;
            assert_ready(env, request.id).await;
            (row(env, request.id).await, wished)
        }

        #[tokio::test]
        async fn keeps_a_larger_cover_when_the_scan_files_the_download_on_the_wished_book() {
            let _covers = CoversTempDir::new("import_cover_attach");
            let env = env().await;
            let epub = epub_with_cover("Dune", "Frank Herbert", Some((40, 60)));

            let (after, wished) = import(&env, &epub, true).await;

            assert_eq!(count(&env, "merge_log").await, 0);
            let candidate = after.cover_candidate.unwrap();
            assert_eq!(cover_size(&candidate).await, (40, 60));
            assert_eq!(cover_size(&wished).await, (20, 30));
        }

        #[tokio::test]
        async fn keeps_a_larger_cover_when_the_download_is_merged_into_the_wished_book() {
            let _covers = CoversTempDir::new("import_cover_merge");
            let env = env().await;
            let epub = epub_with_cover("Dune (retail)", "Someone Else", Some((40, 60)));

            let (after, wished) = import(&env, &epub, true).await;

            assert_eq!(count(&env, "merge_log").await, 1);
            let candidate = after.cover_candidate.unwrap();
            assert_eq!(cover_size(&candidate).await, (40, 60));
            assert_eq!(cover_size(&wished).await, (20, 30));
        }

        #[tokio::test]
        async fn records_nothing_when_the_download_has_no_cover() {
            let _covers = CoversTempDir::new("import_cover_none");
            let env = env().await;
            let epub = epub_with_cover("Dune", "Frank Herbert", None);

            let (after, _) = import(&env, &epub, true).await;

            assert_eq!(after.cover_candidate, None);
        }

        #[tokio::test]
        async fn records_nothing_for_a_request_made_from_a_providers_record() {
            let _covers = CoversTempDir::new("import_cover_made_for_request");
            let env = env().await;
            let origin = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/cover.png"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .insert_header("content-type", "image/png")
                        .set_body_bytes(solid_color_png(200, 10, 10, 20, 30)),
                )
                .mount(&origin)
                .await;
            let mut meta = external_meta("Dune");
            meta.authors = vec!["Frank Herbert".into()];
            meta.cover_url = Some(format!("{}/cover.png", origin.uri()));
            let ada = seed_user(&env.pool, "ada").await;
            let made = store::start_for_new_book_with(
                &env.pool,
                ada,
                &meta,
                RequestKind::Ebook,
                5,
                &loopback_cover_config(),
            )
            .await
            .unwrap();
            pick(&env.pool, made.id, "on_its_way").await;
            let set = format!("client_hash = '{}', progress = 1.0", hash(made.id));
            update(&env.pool, made.id, &set).await;
            let request = row(&env, made.id).await;
            let epub = epub_with_cover("Dune", "Frank Herbert", Some((40, 60)));
            let client = downloaded(&env, &request, &[("Dune.epub", &epub)]);

            run(&env, &client).await;

            assert_ready(&env, made.id).await;
            assert_eq!(row(&env, made.id).await.cover_candidate, None);
        }

        #[tokio::test]
        async fn records_nothing_when_the_request_does_not_offer_the_cover() {
            let _covers = CoversTempDir::new("import_cover_not_offered");
            let env = env().await;
            let epub = epub_with_cover("Dune", "Frank Herbert", Some((40, 60)));

            let (after, _) = import(&env, &epub, false).await;

            assert_eq!(after.cover_candidate, None);
        }
    }

    mod through_the_poller {
        use super::*;

        #[tokio::test]
        async fn a_tick_takes_a_download_that_just_finished_to_ready() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = request_at(&env, &wished, RequestKind::Ebook, 0.4).await;
            let client = downloaded(&env, &request, &[("Dune.epub", &epub("dune"))]);
            let config = requests_config(None, None);

            tick_with(&env.pool, &env.worker, &client, &config, &mut None).await;

            assert_ready(&env, request.id).await;
        }
    }

    mod retry {
        use super::*;

        #[tokio::test]
        async fn resumes_from_the_import_key_without_a_second_copy() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;
            let key = "frank-herbert/dune/dune.epub";
            write(&env.root, key, &epub("dune"));
            update(&env.pool, request.id, &format!("import_key = '{key}'")).await;
            let client = StubClient::new();

            run(&env, &client).await;

            assert_ready(&env, request.id).await;
            assert!(client.calls().is_empty());
            assert_eq!(
                fs::read_dir(env.root.join("frank-herbert"))
                    .unwrap()
                    .count(),
                1
            );
            assert_eq!(files_of(&env, &wished).await, 1);
        }

        #[tokio::test]
        async fn files_the_download_again_when_the_earlier_copy_is_gone() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;
            update(&env.pool, request.id, "import_key = 'gone/gone.epub'").await;
            let client = downloaded(&env, &request, &[("Dune.epub", &epub("dune"))]);

            run(&env, &client).await;

            assert_ready(&env, request.id).await;
            assert!(env.root.join("frank-herbert/dune/dune.epub").is_file());
        }
    }

    mod waiting {
        use super::*;

        #[tokio::test]
        async fn leaves_the_request_for_the_next_pass_when_the_client_cannot_be_reached() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;

            let waiting = run(&env, &StubClient::unreachable()).await;

            assert!(waiting);
            let after = row(&env, request.id).await;
            assert_eq!(after.state, RequestState::OnItsWay);
            assert_eq!(after.stuck_reason, None);
        }

        #[tokio::test]
        async fn leaves_a_download_the_client_is_still_moving_and_stages_nothing() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;
            let client = downloaded(&env, &request, &[("Dune.epub", &epub("dune"))])
                .with_state(request.client_hash.as_deref().unwrap(), "moving");

            let waiting = run(&env, &client).await;

            assert!(waiting);
            assert_eq!(row(&env, request.id).await.state, RequestState::OnItsWay);
            assert_eq!(fs::read_dir(&env.root).unwrap().count(), 0);
        }

        #[tokio::test]
        async fn leaves_a_download_that_is_still_coming_alone() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = request_at(&env, &wished, RequestKind::Ebook, 0.5).await;
            let client = StubClient::new();

            run(&env, &client).await;

            assert!(client.calls().is_empty());
            assert_eq!(row(&env, request.id).await.state, RequestState::OnItsWay);
        }
    }

    mod couldnt_add {
        use super::*;

        #[tokio::test]
        async fn when_the_download_is_only_an_executable_and_the_library_is_untouched() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;
            let client = downloaded(&env, &request, &[("setup.exe", b"MZ")]);

            run(&env, &client).await;

            let detail = couldnt_add_detail(&env, request.id).await;
            assert!(detail.contains("no ebook file"), "{detail}");
            assert_eq!(count(&env, "books").await, 1);
            assert_eq!(fs::read_dir(&env.root).unwrap().count(), 0);
        }

        #[tokio::test]
        async fn when_the_client_no_longer_has_the_download() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;

            run(&env, &StubClient::new()).await;

            let detail = couldnt_add_detail(&env, request.id).await;
            assert!(detail.contains("no longer has the download"), "{detail}");
        }

        #[tokio::test]
        async fn when_the_path_is_not_visible() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;
            let client = downloaded(&env, &request, &[("Dune.epub", &epub("dune"))]);
            let config = requests_config(Some("/downloads"), env.dl.to_str());

            import_finished(&env.pool, &client, &env.worker, &config)
                .await
                .unwrap();

            let detail = couldnt_add_detail(&env, request.id).await;
            assert!(detail.contains("not visible"), "{detail}");
        }

        #[tokio::test]
        async fn with_no_ebook_library() {
            let env = env().await;
            use_library(&env, None).await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;
            let client = downloaded(&env, &request, &[("Dune.epub", &epub("dune"))]);

            run(&env, &client).await;

            let detail = couldnt_add_detail(&env, request.id).await;
            assert!(detail.contains("no ebook library"), "{detail}");
        }

        #[tokio::test]
        async fn for_an_audiobook_request() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Audiobook).await;
            let client = downloaded(&env, &request, &[("Dune.epub", &epub("dune"))]);

            run(&env, &client).await;

            let detail = couldnt_add_detail(&env, request.id).await;
            assert_eq!(detail, "audiobook import is not supported yet");
        }

        #[tokio::test]
        async fn when_the_requested_book_is_no_longer_in_the_library() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;
            let client = downloaded(&env, &request, &[("Dune.epub", &epub("dune"))]);
            // Raw, because deleting through the API cancels the request with it.
            sqlx::query("DELETE FROM books WHERE uuid = ?")
                .bind(&wished)
                .execute(&env.pool)
                .await
                .unwrap();

            run(&env, &client).await;

            let detail = couldnt_add_detail(&env, request.id).await;
            assert!(detail.contains("no longer in the library"), "{detail}");
        }

        #[tokio::test]
        async fn when_the_scan_does_not_surface_the_file() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;
            write(&env.root, "notes.txt", b"not a book");
            update(&env.pool, request.id, "import_key = 'notes.txt'").await;

            run(&env, &StubClient::new()).await;

            let detail = couldnt_add_detail(&env, request.id).await;
            assert!(detail.contains("did not surface the file"), "{detail}");
        }

        #[tokio::test]
        async fn when_the_scan_files_the_epub_on_another_book_and_that_book_stays() {
            let env = env().await;
            let pdf = build_test_pdf(&TestPdf {
                pages: &["hello"],
                title: Some("Hyperion"),
                author: Some("Dan Simmons"),
                keywords: None,
                outline: &[],
                rotate: None,
            });
            let other = index_existing(&env, "dan-simmons/hyperion/hyperion.pdf", &pdf).await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;
            let bytes = epub_by("Hyperion", "Dan Simmons");
            let client = downloaded(&env, &request, &[("Hyperion.epub", &bytes)]);

            run(&env, &client).await;

            let detail = couldnt_add_detail(&env, request.id).await;
            assert!(detail.contains("Hyperion"), "{detail}");
            assert!(get_book_by_uuid(&env.pool, &other).await.unwrap().is_some());
            assert_eq!(files_of(&env, &wished).await, 0);
            assert_eq!(files_of(&env, &other).await, 2);
        }

        #[tokio::test]
        async fn when_the_merge_fails() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;
            let client = downloaded(&env, &request, &[("Dune.epub", &epub("dune"))]);
            sqlx::query(
                "CREATE TRIGGER no_merges BEFORE INSERT ON merge_log
                 BEGIN SELECT RAISE(ABORT, 'merges are off'); END",
            )
            .execute(&env.pool)
            .await
            .unwrap();

            run(&env, &client).await;

            let detail = couldnt_add_detail(&env, request.id).await;
            assert!(detail.contains("merging"), "{detail}");
        }

        #[tokio::test]
        async fn when_the_file_cannot_be_staged() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;
            let client = downloaded(&env, &request, &[("Dune.epub", &epub("dune"))]);
            fs::write(env.root.join(".omnibus-staging"), b"in the way").unwrap();

            run(&env, &client).await;

            let detail = couldnt_add_detail(&env, request.id).await;
            assert!(detail.contains("filing the download failed"), "{detail}");
            assert!(env.dl.join("Dune.epub").is_file());
        }
    }
}
