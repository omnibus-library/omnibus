use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use omnibus_shared::{RequestKind, RequestState, Settings, StuckReason, WishlistSource};
use sqlx::SqlitePool;

use crate::requests::store::{self, RequestRow};
use crate::requests::test_support::{requests_config, Call, StubClient};
use crate::test_support::{build_test_epub, seed_user};
use crate::worker::{Task, Worker, WorkerConfig};
use crate::{
    add_wishlist_entry, create_fileless_book, get_book_by_uuid, get_book_files, set_settings,
    FilelessBook,
};

use super::super::import_finished;

/// A library root and a download folder on disk, a database that points at the library, and a
/// real worker. The database is a file: an in-memory one answers the scan's follow-up writes
/// racing a merge with SQLITE_LOCKED, where a file waits its turn as production does.
struct Env {
    pool: SqlitePool,
    worker: Arc<Worker>,
    root: PathBuf,
    dl: PathBuf,
    _tmp: tempfile::TempDir,
}

async fn env() -> Env {
    let tmp = tempfile::tempdir().unwrap();
    let (root, dl) = (tmp.path().join("library"), tmp.path().join("dl"));
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&dl).unwrap();
    let url = format!(
        "sqlite://{}?mode=rwc",
        tmp.path().join("omnibus.db").display()
    );
    let pool = crate::pool::init_db(&url).await.unwrap();
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

/// A fileless book, as a wishlist entry makes one.
async fn wish(env: &Env, title: &str, author: &str) -> String {
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

/// A request of `kind` for `book_uuid` whose download is complete and waits for the import.
async fn finished_request(env: &Env, book_uuid: &str, kind: RequestKind) -> RequestRow {
    let pool = &env.pool;
    let user = seed_user(pool, "ada").await;
    let id = store::start(pool, user, book_uuid, kind, 5)
        .await
        .unwrap()
        .request
        .id;
    let result: i64 = sqlx::query_scalar(
        "INSERT INTO book_request_results (request_id, guid, title, download_url, score)
         VALUES (?, 'g', 't', 'magnet:?xt=urn:btih:abc', 1.0) RETURNING id",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE book_requests SET state = 'on_its_way', chosen_result_id = ?1, progress = 1,
         client_tag = 'omnibus-' || id || '-' || ?1 WHERE id = ?2",
    )
    .bind(result)
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
    row(env, id).await
}

async fn row(env: &Env, id: i64) -> RequestRow {
    store::get(&env.pool, id).await.unwrap().unwrap()
}

/// Write `files` (relative name, bytes) into the download folder, and return a client that
/// holds them as the finished download of `request`.
fn downloaded(env: &Env, request: &RequestRow, files: &[(&str, &[u8])]) -> StubClient {
    let mut listed = Vec::new();
    for (name, bytes) in files {
        let path = env.dl.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, bytes).unwrap();
        listed.push((*name, bytes.len() as u64));
    }
    let tag = request.client_tag.as_deref().unwrap();
    StubClient::new().with_files(tag, env.dl.to_str().unwrap(), &listed)
}

/// One pass of the import with the download folders unmapped.
async fn run(env: &Env, client: &StubClient) -> bool {
    let config = requests_config(None, None);
    import_finished(&env.pool, client, &env.worker, &config)
        .await
        .unwrap()
}

async fn count(env: &Env, table: &str) -> i64 {
    sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
        .fetch_one(&env.pool)
        .await
        .unwrap()
}

async fn files_of(env: &Env, uuid: &str) -> usize {
    let book = get_book_by_uuid(&env.pool, uuid).await.unwrap().unwrap();
    get_book_files(&env.pool, book.id).await.unwrap().len()
}

/// Index `bytes` filed at `name` under the library, as a book already there, and return its uuid.
async fn index_existing(env: &Env, name: &str, bytes: &[u8]) -> String {
    let path = env.root.join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, bytes).unwrap();
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
async fn assert_ready(env: &Env, id: i64) {
    let after = row(env, id).await;
    assert_eq!(after.state, RequestState::Ready, "{:?}", after.stuck_detail);
}

/// The request's detail for an admin, after asserting it ended `couldnt_add`.
async fn couldnt_add_detail(env: &Env, id: i64) -> String {
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
            let reader = seed_user(&env.pool, "reader").await;
            add_wishlist_entry(&env.pool, reader, &wished, WishlistSource::Detail)
                .await
                .unwrap();
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;
            let client = downloaded(&env, &request, &[("Release/Dune.epub", &epub("dune"))]);

            run(&env, &client).await;

            assert_ready(&env, request.id).await;
            assert_eq!(count(&env, "books").await, 1);
            assert_eq!(count(&env, "wishlist_entries").await, 1);
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

    mod retry {
        use super::*;

        #[tokio::test]
        async fn resumes_from_the_import_key_without_a_second_copy() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;
            let key = "frank-herbert/dune/dune.epub";
            let filed = env.root.join(key);
            fs::create_dir_all(filed.parent().unwrap()).unwrap();
            fs::write(&filed, epub("dune")).unwrap();
            sqlx::query("UPDATE book_requests SET import_key = ? WHERE id = ?")
                .bind(key)
                .bind(request.id)
                .execute(&env.pool)
                .await
                .unwrap();
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
            sqlx::query("UPDATE book_requests SET import_key = 'gone/gone.epub' WHERE id = ?")
                .bind(request.id)
                .execute(&env.pool)
                .await
                .unwrap();
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
        async fn leaves_a_download_that_is_still_coming_alone() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;
            sqlx::query("UPDATE book_requests SET progress = 0.5 WHERE id = ?")
                .bind(request.id)
                .execute(&env.pool)
                .await
                .unwrap();
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
        async fn when_the_scan_does_not_surface_the_file() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Ebook).await;
            fs::write(env.root.join("notes.txt"), b"not a book").unwrap();
            sqlx::query("UPDATE book_requests SET import_key = 'notes.txt' WHERE id = ?")
                .bind(request.id)
                .execute(&env.pool)
                .await
                .unwrap();

            run(&env, &StubClient::new()).await;

            let detail = couldnt_add_detail(&env, request.id).await;
            assert!(detail.contains("did not surface the file"), "{detail}");
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
