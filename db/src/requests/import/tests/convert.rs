//! The import run for an AZW3 or MOBI download, with a fake `ebook-convert` that stands in for
//! Calibre: converted to EPUB, a failed conversion and its retry, and no Calibre at all.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

use omnibus_shared::RequestKind;

use crate::requests::store;
use crate::{get_book_by_uuid, get_book_files};

use super::run::{
    assert_ready, couldnt_add_detail, downloaded, env, epub_by, files_of, finished_request, run,
    wish, Env,
};
use super::{failing_converter, mobi_bytes, working_converter, write};

/// Make `converter` the `ebook-convert` the import runs.
async fn use_converter(env: &Env, converter: &std::path::Path) {
    crate::set_ebook_convert_path(&env.pool, converter.to_str())
        .await
        .unwrap();
}

/// A converter, in its own folder, that produces Piranesi's EPUB.
fn converter_producing_piranesi(tmp: &std::path::Path) -> PathBuf {
    let scripts = tmp.join("working");
    let produced = write(
        &scripts,
        "converted.epub",
        &epub_by("Piranesi", "Susanna Clarke"),
    );
    working_converter(&scripts, &produced)
}

async fn format_of_only_file(env: &Env, uuid: &str) -> String {
    let book = get_book_by_uuid(&env.pool, uuid).await.unwrap().unwrap();
    let files = get_book_files(&env.pool, book.id).await.unwrap();
    assert_eq!(files.len(), 1, "{files:?}");
    files[0].format.clone()
}

mod import_finished {
    use super::*;

    #[tokio::test]
    async fn adds_an_azw3_download_as_an_epub() {
        let env = env().await;
        let scripts = tempfile::tempdir().unwrap();
        use_converter(&env, &converter_producing_piranesi(scripts.path())).await;
        let wished = wish(&env, "Piranesi", "Susanna Clarke").await;
        let request = finished_request(&env, &wished, RequestKind::Ebook).await;
        let client = downloaded(&env, &request, &[("Piranesi.azw3", &mobi_bytes())]);

        run(&env, &client).await;

        assert_ready(&env, request.id).await;
        assert_eq!(format_of_only_file(&env, &wished).await, "EPUB");
        assert!(env
            .root
            .join("susanna-clarke/piranesi/piranesi.epub")
            .is_file());
        assert!(!env.root.join(".omnibus-staging").exists());
        assert_eq!(
            fs::read(env.dl.join("Piranesi.azw3")).unwrap(),
            mobi_bytes()
        );
    }

    #[tokio::test]
    async fn gets_stuck_with_the_converters_output_when_the_conversion_fails() {
        let env = env().await;
        let scripts = tempfile::tempdir().unwrap();
        use_converter(&env, &failing_converter(scripts.path())).await;
        let wished = wish(&env, "Piranesi", "Susanna Clarke").await;
        let request = finished_request(&env, &wished, RequestKind::Ebook).await;
        let client = downloaded(&env, &request, &[("Piranesi.mobi", &mobi_bytes())]);

        run(&env, &client).await;

        let detail = couldnt_add_detail(&env, request.id).await;
        assert!(detail.contains("boom: conversion failed"), "{detail}");
        assert_eq!(files_of(&env, &wished).await, 0);
        assert_eq!(fs::read_dir(&env.root).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn adds_the_book_when_a_failed_conversion_is_retried_with_a_working_converter() {
        let env = env().await;
        let broken = tempfile::tempdir().unwrap();
        use_converter(&env, &failing_converter(broken.path())).await;
        let wished = wish(&env, "Piranesi", "Susanna Clarke").await;
        let request = finished_request(&env, &wished, RequestKind::Ebook).await;
        let client = downloaded(&env, &request, &[("Piranesi.azw3", &mobi_bytes())]);
        run(&env, &client).await;
        couldnt_add_detail(&env, request.id).await;
        let fixed = tempfile::tempdir().unwrap();
        use_converter(&env, &converter_producing_piranesi(fixed.path())).await;

        store::restart(&env.pool, request.id, 0, 5).await.unwrap();
        run(&env, &client).await;

        assert_ready(&env, request.id).await;
        assert_eq!(format_of_only_file(&env, &wished).await, "EPUB");
    }

    #[tokio::test]
    async fn names_the_missing_converter_when_the_download_is_only_an_azw3() {
        let env = env().await;
        let wished = wish(&env, "Piranesi", "Susanna Clarke").await;
        let request = finished_request(&env, &wished, RequestKind::Ebook).await;
        let client = downloaded(&env, &request, &[("Piranesi.azw3", &mobi_bytes())]);

        run(&env, &client).await;

        let detail = couldnt_add_detail(&env, request.id).await;
        assert!(
            detail.contains("ebook-convert is not installed"),
            "{detail}"
        );
        assert_eq!(fs::read_dir(&env.root).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn adds_the_epub_when_the_converter_setting_cannot_be_read() {
        let env = env().await;
        // A blob does not decode as the setting's text, so the status read fails.
        sqlx::query("UPDATE settings SET value = x'ff' WHERE key = 'ebook_convert_path'")
            .execute(&env.pool)
            .await
            .unwrap();
        assert!(crate::ebook_convert_status(&env.pool).await.is_err());
        let wished = wish(&env, "Dune", "Frank Herbert").await;
        let request = finished_request(&env, &wished, RequestKind::Ebook).await;
        let epub = epub_by("Dune", "Frank Herbert");
        let client = downloaded(
            &env,
            &request,
            &[("Dune.epub", &epub), ("Dune.mobi", &mobi_bytes())],
        );

        run(&env, &client).await;

        assert_ready(&env, request.id).await;
        assert_eq!(format_of_only_file(&env, &wished).await, "EPUB");
        assert!(env.root.join("frank-herbert/dune/dune.epub").is_file());
    }

    #[tokio::test]
    async fn never_runs_the_converter_for_an_epub_download() {
        let env = env().await;
        let scripts = tempfile::tempdir().unwrap();
        let ran = scripts.path().join("ran");
        let spy = scripts.path().join("ebook-convert");
        fs::write(&spy, format!("#!/bin/sh\necho x >> '{}'\n", ran.display())).unwrap();
        fs::set_permissions(&spy, fs::Permissions::from_mode(0o755)).unwrap();
        use_converter(&env, &spy).await;
        let wished = wish(&env, "Dune", "Frank Herbert").await;
        let request = finished_request(&env, &wished, RequestKind::Ebook).await;
        let client = downloaded(
            &env,
            &request,
            &[("Dune.epub", &epub_by("Dune", "Frank Herbert"))],
        );

        run(&env, &client).await;

        assert_ready(&env, request.id).await;
        assert!(!ran.exists(), "the converter was started");
    }
}
