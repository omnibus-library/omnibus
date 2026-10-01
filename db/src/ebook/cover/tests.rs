//! Tests for EPUB cover extraction: sidecar-over-embedded precedence,
//! opt-in sidecar materialization and its reuse on a second scan, repairing
//! or falling back from an unreadable/failed materialization, leaving an
//! unrelated existing sidecar untouched, and finding an embedded cover the
//! package never declares.

use crate::ebook::test_support::*;
use crate::ebook::{scan_ebook_library, scan_ebook_library_with, ScanOptions};

#[test]
fn extract_metadata_uses_sidecar_when_present() {
    // alpha.epub ships an embedded cover. Plant a recognizably-different
    // sidecar next to it; the scanner must return the sidecar bytes.
    let dir = make_test_dir("sidecar_wins");
    copy_fixture_into("alpha.epub", &dir);
    let sidecar_bytes: &[u8] = b"sidecar-jpg-magic-bytes";
    std::fs::write(dir.join("alpha.jpg"), sidecar_bytes).unwrap();

    let out = scan_ebook_library(Some(dir.to_str().unwrap()));
    std::fs::remove_dir_all(&dir).unwrap();

    let alpha = out
        .books
        .iter()
        .find(|b| b.metadata.filename == "alpha.epub")
        .expect("alpha present");
    let (mime, bytes) = alpha.cover.as_ref().expect("cover present");
    assert_eq!(bytes, sidecar_bytes, "expected sidecar bytes, got embedded");
    assert_eq!(mime, "image/jpeg");
}

#[test]
fn extract_metadata_uses_embedded_when_no_sidecar() {
    // alpha.epub has an embedded cover; no sidecar planted. We don't
    // know the exact embedded bytes, but they should be non-empty and
    // the cover slot must be populated. Default ScanOptions disables
    // materialization, so no sidecar should appear after the scan.
    let dir = make_test_dir("embedded_only");
    copy_fixture_into("alpha.epub", &dir);

    let out = scan_ebook_library(Some(dir.to_str().unwrap()));
    let sidecar_appeared = find_materialized_sidecar(&dir, "alpha").is_some();
    std::fs::remove_dir_all(&dir).unwrap();

    assert!(
        !sidecar_appeared,
        "default ScanOptions must not materialize sidecars"
    );
    let alpha = out
        .books
        .iter()
        .find(|b| b.metadata.filename == "alpha.epub")
        .expect("alpha present");
    let (_, bytes) = alpha.cover.as_ref().expect("embedded cover present");
    assert!(!bytes.is_empty());
}

#[test]
fn extract_metadata_materializes_sidecar_with_opt_in() {
    // With `materialize_sidecars: true`, scanning an epub that has an
    // embedded cover but no sidecar must write `<basename>.{jpg|png}`
    // (extension matches embedded mime) next to the file so subsequent
    // scans hit the sidecar directly.
    let dir = make_test_dir("materialize");
    copy_fixture_into("alpha.epub", &dir);
    assert!(
        find_materialized_sidecar(&dir, "alpha").is_none(),
        "precondition: no sidecar yet"
    );

    let out = scan_ebook_library_with(
        Some(dir.to_str().unwrap()),
        ScanOptions {
            materialize_sidecars: true,
        },
    );

    let sidecar = find_materialized_sidecar(&dir, "alpha");
    let written = sidecar.as_ref().and_then(|p| std::fs::read(p).ok());
    let alpha = out
        .books
        .iter()
        .find(|b| b.metadata.filename == "alpha.epub")
        .map(|b| b.cover.as_ref().map(|(_, bytes)| bytes.clone()))
        .unwrap_or(None);
    std::fs::remove_dir_all(&dir).unwrap();

    assert!(sidecar.is_some(), "sidecar should have been written");
    assert_eq!(
        written.as_deref(),
        alpha.as_deref(),
        "written sidecar bytes must match returned cover bytes"
    );
}

#[test]
fn extract_metadata_second_scan_reads_sidecar_not_zip() {
    // After materialization, swap the sidecar with different bytes. The
    // next scan should return *those* bytes, proving the read came from
    // the sidecar and not the unchanged embedded cover in the zip.
    let dir = make_test_dir("second_scan");
    copy_fixture_into("alpha.epub", &dir);

    // First scan: materialize.
    let _ = scan_ebook_library_with(
        Some(dir.to_str().unwrap()),
        ScanOptions {
            materialize_sidecars: true,
        },
    );

    let sidecar_path =
        find_materialized_sidecar(&dir, "alpha").expect("first scan materialized a sidecar");

    // Replace the sidecar (same path/extension) with sentinel bytes.
    let sentinel: &[u8] = b"replaced-after-materialization";
    std::fs::write(&sidecar_path, sentinel).unwrap();

    // Second scan (default opts) — should read the sentinel, not
    // re-extract the embedded cover.
    let out = scan_ebook_library(Some(dir.to_str().unwrap()));
    std::fs::remove_dir_all(&dir).unwrap();

    let alpha = out
        .books
        .iter()
        .find(|b| b.metadata.filename == "alpha.epub")
        .expect("alpha present");
    let (_, bytes) = alpha.cover.as_ref().expect("cover present");
    assert_eq!(
        bytes, sentinel,
        "second scan should have read the swapped sidecar"
    );
}

#[test]
fn extract_metadata_repairs_unreadable_sidecar_on_materialize() {
    // alpha.epub has an embedded cover. Plant a zero-length sidecar that
    // sidecar_cover_for() will pick up but read_sidecar() can't use.
    // With materialize_sidecars=true, the broken cache must be repaired
    // so the next scan reads the sidecar instead of re-opening the zip.
    let dir = make_test_dir("repair_sidecar");
    copy_fixture_into("alpha.epub", &dir);

    // alpha.epub embeds a PNG, so the materializer would write
    // `alpha.png`. Plant the corrupt sidecar at that exact path.
    let broken = dir.join("alpha.png");
    std::fs::write(&broken, b"").unwrap();

    let out = scan_ebook_library_with(
        Some(dir.to_str().unwrap()),
        ScanOptions {
            materialize_sidecars: true,
        },
    );

    let repaired_bytes = std::fs::read(&broken).expect("sidecar still on disk");
    let alpha_cover = out
        .books
        .iter()
        .find(|b| b.metadata.filename == "alpha.epub")
        .and_then(|b| b.cover.as_ref().map(|(_, bytes)| bytes.clone()));
    std::fs::remove_dir_all(&dir).unwrap();

    assert!(
        !repaired_bytes.is_empty(),
        "broken zero-length sidecar should have been repaired"
    );
    assert_eq!(
        alpha_cover.as_deref(),
        Some(repaired_bytes.as_slice()),
        "repaired sidecar bytes must match the embedded cover the scan returned"
    );
}

#[test]
fn extract_metadata_does_not_clobber_unrelated_existing_sidecar() {
    // The repair gate must only overwrite the *exact* corrupt file the
    // sidecar lookup returned — never a different valid file that
    // happens to sit at the materialize target.
    //
    // Setup: alpha.epub embeds a PNG, so materialize would target
    // alpha.png. We plant a corrupt (empty) `alpha.jpg` (which jpg-over-
    // png priority makes sidecar_cover_for return) AND a valid `alpha.png`
    // (the user's curated cover). The materialize step must refuse to
    // overwrite alpha.png because the *known* corrupt path is alpha.jpg.
    let dir = make_test_dir("no_clobber");
    copy_fixture_into("alpha.epub", &dir);

    let corrupt_jpg = dir.join("alpha.jpg");
    std::fs::write(&corrupt_jpg, b"").unwrap();
    let valid_png = dir.join("alpha.png");
    let curated: &[u8] = b"user-curated-cover-do-not-touch";
    std::fs::write(&valid_png, curated).unwrap();

    let _ = scan_ebook_library_with(
        Some(dir.to_str().unwrap()),
        ScanOptions {
            materialize_sidecars: true,
        },
    );

    let png_after = std::fs::read(&valid_png).unwrap();
    std::fs::remove_dir_all(&dir).unwrap();

    assert_eq!(
        png_after, curated,
        "alpha.png is not the corrupt sidecar — must not be overwritten"
    );
}

#[test]
fn extract_metadata_no_embedded_no_sidecar_returns_none() {
    // gamma.epub has no embedded cover. No sidecar planted, no
    // materialization. Cover should stay None and no file should be
    // written.
    let dir = make_test_dir("no_cover");
    copy_fixture_into("gamma.epub", &dir);

    let out = scan_ebook_library_with(
        Some(dir.to_str().unwrap()),
        ScanOptions {
            materialize_sidecars: true,
        },
    );
    let sidecar_appeared = find_materialized_sidecar(&dir, "gamma").is_some();
    std::fs::remove_dir_all(&dir).unwrap();

    assert!(
        !sidecar_appeared,
        "no embedded cover → nothing to materialize"
    );
    let gamma = out
        .books
        .iter()
        .find(|b| b.metadata.filename == "gamma.epub")
        .expect("gamma present");
    assert!(gamma.cover.is_none());
}

#[cfg(unix)]
#[test]
fn extract_metadata_materialization_failure_falls_back_to_embedded() {
    // chmod the directory read-only-execute so write fails. The scanner
    // must still return cover bytes (from embedded), and no sidecar
    // should appear.
    use std::os::unix::fs::PermissionsExt;

    let dir = make_test_dir("readonly_dir");
    copy_fixture_into("alpha.epub", &dir);
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).unwrap();

    // Skip if the chmod didn't take (e.g. running as root in some CI
    // containers).
    if std::fs::write(dir.join("write_probe"), b"x").is_ok() {
        std::fs::remove_file(dir.join("write_probe")).ok();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        return;
    }

    let out = scan_ebook_library_with(
        Some(dir.to_str().unwrap()),
        ScanOptions {
            materialize_sidecars: true,
        },
    );

    let sidecar_appeared = find_materialized_sidecar(&dir, "alpha").is_some();

    // Restore perms before cleanup.
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::remove_dir_all(&dir).unwrap();

    assert!(!sidecar_appeared, "read-only fs must not produce a sidecar");
    let alpha = out
        .books
        .iter()
        .find(|b| b.metadata.filename == "alpha.epub")
        .expect("alpha present");
    let (_, bytes) = alpha.cover.as_ref().expect("embedded fallback present");
    assert!(!bytes.is_empty(), "embedded fallback must be non-empty");
}

/// AC1/AC2 of #2240: the same fixture, the same image bytes, declared each of
/// the two ways a package can point at its cover. The EPUB3 form is what the
/// generator emits; the legacy form is what `EpubDoc::get_cover` ignores on a
/// 3.0 package, and what a large share of real-world books actually use.
#[test]
fn extract_metadata_extracts_the_cover_from_both_declaration_styles() {
    let dir = make_test_dir("cover_declaration_styles");
    copy_fixture_into("alpha.epub", &dir);
    copy_fixture_with_legacy_cover("alpha.epub", &dir, "legacy.epub");

    let out = scan_ebook_library(Some(dir.to_str().unwrap()));
    std::fs::remove_dir_all(&dir).unwrap();

    let cover_for = |filename: &str| -> Vec<u8> {
        out.books
            .iter()
            .find(|b| b.metadata.filename == filename)
            .unwrap_or_else(|| panic!("{filename} present"))
            .cover
            .as_ref()
            .unwrap_or_else(|| panic!("{filename} has a cover"))
            .1
            .clone()
    };

    let epub3 = cover_for("alpha.epub");
    assert!(!epub3.is_empty());
    assert_eq!(
        cover_for("legacy.epub"),
        epub3,
        "the legacy declaration must reach the same image"
    );
}

/// Write an EPUB2 package into `dir` whose OPF sits at `opf_path`, beside
/// `entries`. Built in memory, so each test states exactly how the cover is
/// (or isn't) declared.
fn write_epub2(
    dir: &std::path::Path,
    name: &str,
    opf_path: &str,
    opf: &str,
    entries: &[(&str, &[u8])],
) -> std::path::PathBuf {
    let container = format!(
        "<?xml version=\"1.0\"?><container version=\"1.0\" \
         xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\"><rootfiles>\
         <rootfile full-path=\"{opf_path}\" media-type=\"application/oebps-package+xml\"/>\
         </rootfiles></container>"
    );
    let mut all: Vec<(&str, &[u8])> = vec![
        ("mimetype", b"application/epub+zip"),
        ("META-INF/container.xml", container.as_bytes()),
        (opf_path, opf.as_bytes()),
    ];
    all.extend_from_slice(entries);
    let path = dir.join(name);
    std::fs::write(&path, crate::test_support::build_stored_zip(&all)).unwrap();
    path
}

/// An EPUB2 OPF with no `<meta name="cover">`, carrying `manifest` items and
/// `guide` references as given.
fn epub2_opf(manifest: &str, guide: &str) -> String {
    format!(
        "<?xml version='1.0' encoding='utf-8'?>\
         <package xmlns=\"http://www.idpf.org/2007/opf\" unique-identifier=\"uuid_id\" version=\"2.0\">\
         <metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:opf=\"http://www.idpf.org/2007/opf\">\
         <dc:title>The Dungeon Anarchist's Cookbook</dc:title>\
         <dc:creator opf:role=\"aut\">Matt Dinniman</dc:creator>\
         <dc:identifier id=\"uuid_id\">urn:uuid:5f0c9a3e-0000-4000-8000-000000000000</dc:identifier>\
         <dc:language>en</dc:language>\
         </metadata>\
         <manifest>{manifest}\
         <item id=\"html1\" href=\"text/part0000.html\" media-type=\"application/xhtml+xml\"/>\
         </manifest>\
         <spine><itemref idref=\"html1\"/></spine>\
         <guide>{guide}</guide>\
         </package>"
    )
}

const CHAPTER: &[u8] =
    b"<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><p>Chapter one.</p></body></html>";

/// Calibre's title page: the cover drawn by an SVG `<image xlink:href>`.
fn svg_title_page(href: &str) -> String {
    format!(
        "<?xml version='1.0' encoding='utf-8'?>\
         <html xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>Cover</title></head><body><div>\
         <svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" \
         version=\"1.1\" viewBox=\"0 0 1200 1800\"><image width=\"1200\" height=\"1800\" \
         xlink:href=\"{href}\"/></svg></div></body></html>"
    )
}

fn scanned_cover(dir: &std::path::Path, filename: &str) -> Option<Vec<u8>> {
    scan_ebook_library(Some(dir.to_str().unwrap()))
        .books
        .into_iter()
        .find(|b| b.metadata.filename == filename)
        .unwrap_or_else(|| panic!("{filename} present"))
        .cover
        .map(|(_, bytes)| bytes)
}

#[test]
fn extract_metadata_extracts_a_calibre_epub2_cover_named_only_by_manifest_id_and_guide() {
    // The Calibre 7.2 shape: the image is manifest item `id="cover"`, the
    // guide points at an SVG title page, and nothing declares either.
    let dir = make_test_dir("calibre_epub2_cover");
    let cover: &[u8] = b"\xFF\xD8\xFF\xE0calibre-cover";
    let page = svg_title_page("cover.jpeg");
    let opf = epub2_opf(
        "<item id=\"cover\" href=\"cover.jpeg\" media-type=\"image/jpeg\"/>\
         <item id=\"titlepage\" href=\"titlepage.xhtml\" media-type=\"application/xhtml+xml\"/>",
        "<reference type=\"cover\" title=\"Cover\" href=\"titlepage.xhtml\"/>",
    );
    let path = write_epub2(
        &dir,
        "calibre.epub",
        "content.opf",
        &opf,
        &[
            ("cover.jpeg", cover),
            ("titlepage.xhtml", page.as_bytes()),
            ("text/part0000.html", CHAPTER),
        ],
    );

    let scanned = scanned_cover(&dir, "calibre.epub");
    let backfilled = crate::ebook::extract_cover(&path);
    std::fs::remove_dir_all(&dir).unwrap();

    assert_eq!(scanned.as_deref(), Some(cover), "the scan finds the cover");
    assert_eq!(
        backfilled,
        Some(("image/jpeg".to_string(), cover.to_vec())),
        "the cover backfill finds it too"
    );
}

#[test]
fn extract_metadata_follows_the_guide_cover_page_to_its_single_image() {
    // No conventional id: only the guide leads to the image, through a page
    // in another directory than the image it shows.
    let dir = make_test_dir("guide_cover_page");
    let cover: &[u8] = b"\x89PNGguide-cover";
    let page = b"<html xmlns=\"http://www.w3.org/1999/xhtml\"><body>\
        <img src=\"../images/front.png\" alt=\"\"/></body></html>";
    let opf = epub2_opf(
        "<item id=\"img0\" href=\"images/front.png\" media-type=\"image/png\"/>\
         <item id=\"img1\" href=\"images/larger-map.png\" media-type=\"image/png\"/>\
         <item id=\"front\" href=\"text/front.xhtml\" media-type=\"application/xhtml+xml\"/>",
        "<reference type=\"cover\" href=\"text/front.xhtml#top\"/>",
    );
    write_epub2(
        &dir,
        "guide.epub",
        "OEBPS/content.opf",
        &opf,
        &[
            ("OEBPS/images/front.png", cover),
            ("OEBPS/images/larger-map.png", &[7u8; 64]),
            ("OEBPS/text/front.xhtml", page),
            ("OEBPS/text/part0000.html", CHAPTER),
        ],
    );

    let scanned = scanned_cover(&dir, "guide.epub");
    std::fs::remove_dir_all(&dir).unwrap();

    assert_eq!(scanned.as_deref(), Some(cover));
}

#[test]
fn extract_metadata_falls_back_to_the_largest_manifest_image() {
    let dir = make_test_dir("largest_image_cover");
    let opf = epub2_opf(
        "<item id=\"a\" href=\"a.png\" media-type=\"image/png\"/>\
         <item id=\"b\" href=\"b.jpg\" media-type=\"image/jpeg\"/>\
         <item id=\"c\" href=\"c.svg\" media-type=\"image/svg+xml\"/>",
        "",
    );
    let largest = [2u8; 48];
    write_epub2(
        &dir,
        "undeclared.epub",
        "content.opf",
        &opf,
        &[
            ("a.png", &[1u8; 16]),
            ("b.jpg", &largest),
            // Larger still, but a vector image is not a cover to guess at.
            ("c.svg", &[3u8; 96]),
            ("text/part0000.html", CHAPTER),
        ],
    );

    let scanned = scanned_cover(&dir, "undeclared.epub");
    std::fs::remove_dir_all(&dir).unwrap();

    assert_eq!(scanned.as_deref(), Some(&largest[..]));
}
