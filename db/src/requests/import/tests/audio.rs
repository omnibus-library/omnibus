//! The import run for audiobook requests: one M4B or a folder of MP3s filed into the audiobook
//! library and merged into the wished book, and the ways it ends `couldnt_add`.

use std::fs;
use std::path::PathBuf;

use omnibus_shared::{RequestKind, Settings};
use sqlx::SqlitePool;

use crate::requests::test_support::{update, StubClient};
use crate::set_settings;
use crate::test_support::{build_m4b_with_chapters, count_rows, generated_audiobook};

use super::run::{
    assert_ready, couldnt_add_detail, downloaded, env, epub_by, files_of, finished_request,
    index_existing, run, wish, Env,
};
use super::EPUB_BYTES;

/// Point the audiobook library setting at a new folder beside the ebook library, and return it.
async fn with_audio_library(env: &Env) -> PathBuf {
    let audio = env.root.parent().unwrap().join("audiobooks");
    fs::create_dir_all(&audio).unwrap();
    let settings = Settings {
        ebook_library_path: env.root.to_str().map(str::to_string),
        audiobook_library_path: audio.to_str().map(str::to_string),
        scan_interval_hours: None,
    };
    set_settings(&env.pool, &settings).await.unwrap();
    audio
}

fn m4b() -> Vec<u8> {
    build_m4b_with_chapters(&[(0, "Opening"), (30_000_000, "Descent")])
}

fn fixture_mp3(rel: &str) -> Vec<u8> {
    fs::read(generated_audiobook(rel)).unwrap()
}

/// `(format, scan_key, library_path)` of every file the book holds, by format.
async fn files_by_format(pool: &SqlitePool, uuid: &str) -> Vec<(String, String, String)> {
    sqlx::query_as(
        "SELECT f.format, f.scan_key, f.library_path FROM book_files f
         JOIN books b ON b.id = f.book_id WHERE b.uuid = ? ORDER BY f.format",
    )
    .bind(uuid)
    .fetch_all(pool)
    .await
    .unwrap()
}

mod import_finished {
    use super::*;

    mod success {
        use super::*;

        #[tokio::test]
        async fn gives_a_book_that_has_an_epub_its_audiobook_as_a_second_format() {
            let env = env().await;
            let audio = with_audio_library(&env).await;
            let wished = index_existing(
                &env,
                "frank-herbert/dune/dune.epub",
                &epub_by("Dune", "Frank Herbert"),
            )
            .await;
            let request = finished_request(&env, &wished, RequestKind::Audiobook).await;
            let client = downloaded(&env, &request, &[("Release/Dune.m4b", &m4b())]);

            run(&env, &client).await;

            assert_ready(&env, request.id).await;
            assert_eq!(count_rows(&env.pool, "SELECT COUNT(*) FROM books").await, 1);
            let formats: Vec<String> = files_by_format(&env.pool, &wished)
                .await
                .into_iter()
                .map(|f| f.0)
                .collect();
            assert_eq!(formats, ["EPUB", "M4B"]);
            assert!(audio.join("frank-herbert/dune/dune.m4b").is_file());
        }

        #[tokio::test]
        async fn files_a_lone_m4b_under_the_wished_book_in_the_audiobook_library() {
            let env = env().await;
            let audio = with_audio_library(&env).await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Audiobook).await;
            let client = downloaded(&env, &request, &[("Dune.m4b", &m4b())]);

            run(&env, &client).await;

            assert_ready(&env, request.id).await;
            assert!(audio.join("frank-herbert/dune/dune.m4b").is_file());
            assert!(!audio.join(".omnibus-staging").exists());
            assert_eq!(
                files_by_format(&env.pool, &wished).await,
                [(
                    "M4B".to_string(),
                    "frank-herbert/dune/dune.m4b".to_string(),
                    audio.to_str().unwrap().to_string()
                )]
            );
            assert_eq!(count_rows(&env.pool, "SELECT COUNT(*) FROM books").await, 1);
        }

        #[tokio::test]
        async fn files_a_folder_of_mp3s_as_one_book_in_one_folder() {
            let env = env().await;
            let audio = with_audio_library(&env).await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Audiobook).await;
            let one = fixture_mp3("grace_hopper_series/the_compiled_tales/chapter01.mp3");
            let two = fixture_mp3("grace_hopper_series/the_compiled_tales/chapter02.mp3");
            let client = downloaded(
                &env,
                &request,
                &[("Dune/chapter01.mp3", &one), ("Dune/chapter02.mp3", &two)],
            );

            run(&env, &client).await;

            assert_ready(&env, request.id).await;
            let mut parts: Vec<String> = fs::read_dir(audio.join("frank-herbert/dune"))
                .unwrap()
                .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .collect();
            parts.sort();
            assert_eq!(parts, ["chapter01.mp3", "chapter02.mp3"]);
            let files = files_by_format(&env.pool, &wished).await;
            assert_eq!(files.len(), 1);
            assert_eq!(files[0].0, "MP3");
            assert_eq!(files[0].1, "frank-herbert/dune");
            assert_eq!(count_rows(&env.pool, "SELECT COUNT(*) FROM books").await, 1);
        }
    }

    mod retry {
        use super::*;

        #[tokio::test]
        async fn goes_straight_to_the_scan_when_the_import_key_names_a_placed_folder() {
            let env = env().await;
            let audio = with_audio_library(&env).await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Audiobook).await;
            let folder = audio.join("frank-herbert/dune");
            fs::create_dir_all(&folder).unwrap();
            fs::write(
                folder.join("cd1-chapter01.mp3"),
                fixture_mp3("grace_hopper_series/the_compiled_tales/chapter01.mp3"),
            )
            .unwrap();
            update(&env.pool, request.id, "import_key = 'frank-herbert/dune'").await;
            let client = StubClient::new();

            run(&env, &client).await;

            assert_ready(&env, request.id).await;
            assert!(client.calls().is_empty());
            assert_eq!(
                fs::read_dir(audio.join("frank-herbert")).unwrap().count(),
                1
            );
            assert_eq!(files_of(&env, &wished).await, 1);
        }
    }

    mod empty_key {
        use super::*;

        #[tokio::test]
        async fn files_the_download_again_when_the_import_key_names_an_empty_folder() {
            let env = env().await;
            let audio = with_audio_library(&env).await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Audiobook).await;
            fs::create_dir_all(audio.join("frank-herbert/dune")).unwrap();
            update(&env.pool, request.id, "import_key = 'frank-herbert/dune'").await;
            let part = fixture_mp3("grace_hopper_series/the_compiled_tales/chapter01.mp3");
            let client = downloaded(&env, &request, &[("Dune/01.mp3", &part)]);

            run(&env, &client).await;

            assert_ready(&env, request.id).await;
            assert!(audio.join("frank-herbert/dune/01.mp3").is_file());
        }
    }

    mod cleanup {
        use super::*;

        #[tokio::test]
        async fn removes_the_placed_folder_when_the_import_key_cannot_be_recorded() {
            let env = env().await;
            let audio = with_audio_library(&env).await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Audiobook).await;
            let part = fixture_mp3("grace_hopper_series/the_compiled_tales/chapter01.mp3");
            let client = downloaded(&env, &request, &[("01.mp3", &part), ("02.mp3", &part)]);
            sqlx::query(
                "CREATE TRIGGER refuse_import_key BEFORE UPDATE OF import_key ON book_requests
                 BEGIN SELECT RAISE(ABORT, 'refused'); END",
            )
            .execute(&env.pool)
            .await
            .unwrap();

            run(&env, &client).await;

            assert!(!audio.join("frank-herbert").join("dune").exists());
            let detail = couldnt_add_detail(&env, request.id).await;
            assert!(detail.contains("refused"), "{detail}");
        }
    }

    mod failure {
        use super::*;

        #[tokio::test]
        async fn when_no_audiobook_library_is_set_up() {
            let env = env().await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Audiobook).await;
            let client = downloaded(&env, &request, &[("Dune.m4b", &m4b())]);

            run(&env, &client).await;

            let detail = couldnt_add_detail(&env, request.id).await;
            assert_eq!(detail, "no audiobook library is set up");
        }

        #[tokio::test]
        async fn when_the_download_holds_only_an_epub() {
            let env = env().await;
            with_audio_library(&env).await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Audiobook).await;
            let client = downloaded(&env, &request, &[("Dune.epub", EPUB_BYTES)]);

            run(&env, &client).await;

            let detail = couldnt_add_detail(&env, request.id).await;
            assert_eq!(detail, "the download has no audiobook file to add");
        }

        #[tokio::test]
        async fn when_the_download_is_split_into_several_m4b_files() {
            let env = env().await;
            let audio = with_audio_library(&env).await;
            let wished = wish(&env, "Dune", "Frank Herbert").await;
            let request = finished_request(&env, &wished, RequestKind::Audiobook).await;
            let client = downloaded(
                &env,
                &request,
                &[("Part 1.m4b", &m4b()), ("Part 2.m4b", &m4b())],
            );

            run(&env, &client).await;

            let detail = couldnt_add_detail(&env, request.id).await;
            assert_eq!(detail, "this version is split into several M4B files");
            assert!(!audio.join("frank-herbert").exists());
        }
    }
}
