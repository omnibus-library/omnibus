//! Unit tests for [`super::list_images`] and [`super::read_image`] against
//! hand-built EPUBs: manifest scan, spine references, ordering, and the
//! exact-match / byte-cap guards on the fetch.

use std::path::PathBuf;

use omnibus_shared::{BookImage, BookImageReference};

use crate::test_support::{
    assemble_test_epub, build_stored_zip, build_test_epub_with_images, make_test_dir,
    solid_color_png,
};

use super::*;

const PAGE_OPEN: &str = "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body>";
const PAGE_CLOSE: &str = "</body></html>";

fn page(body: &str) -> String {
    format!("{PAGE_OPEN}{body}{PAGE_CLOSE}")
}

fn write_epub(spine: &[(&str, &str)], images: &[(&str, &str, &[u8])]) -> PathBuf {
    let path = make_test_dir("book_images").join("book.epub");
    std::fs::write(&path, build_test_epub_with_images(spine, images)).unwrap();
    path
}

/// An EPUB whose manifest hrefs are percent-encoded while its zip entries are
/// named with the literal spaces, as exporters write them.
fn write_encoded_href_epub(chapter: &str, png: &[u8]) -> PathBuf {
    let container = br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#;
    let opf = br#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier><dc:title>T</dc:title></metadata>
  <manifest>
    <item id="p" href="Text/Chapter%201.xhtml" media-type="application/xhtml+xml"/>
    <item id="i" href="Images/my%20map.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="p"/></spine>
</package>"#;
    let zip = build_stored_zip(&[
        ("mimetype", b"application/epub+zip"),
        ("META-INF/container.xml", container),
        ("content.opf", opf),
        ("Text/Chapter 1.xhtml", chapter.as_bytes()),
        ("Images/my map.png", png),
    ]);
    let path = make_test_dir("book_images_encoded").join("book.epub");
    std::fs::write(&path, zip).unwrap();
    path
}

fn reference(spine_index: i64, alt: Option<&str>) -> BookImageReference {
    BookImageReference {
        spine_index,
        alt: alt.map(str::to_string),
    }
}

fn image<'a>(images: &'a [BookImage], href: &str) -> &'a BookImage {
    images
        .iter()
        .find(|i| i.href == href)
        .unwrap_or_else(|| panic!("no image {href} in {images:?}"))
}

#[test]
fn list_images_returns_each_manifest_image_with_size_dimensions_and_references() {
    let png = solid_color_png(10, 20, 30, 7, 5);
    let path = write_epub(
        &[("c1.xhtml", &page(r#"<img src="map.png" alt="A map"/>"#))],
        &[("map.png", "image/png", &png)],
    );

    let images = list_images(&path).unwrap();

    assert_eq!(
        images,
        vec![BookImage {
            href: "map.png".into(),
            media_type: "image/png".into(),
            byte_size: png.len() as i64,
            width: Some(7),
            height: Some(5),
            references: vec![reference(0, Some("A map"))],
        }]
    );
}

#[test]
fn list_images_resolves_a_reference_relative_to_its_spine_document() {
    let png = solid_color_png(1, 2, 3, 2, 2);
    let path = write_epub(
        &[(
            "text/c1.xhtml",
            &page(r#"<img src="../images/fig.png#top" alt="Fig"/>"#),
        )],
        &[("images/fig.png", "image/png", &png)],
    );

    let images = list_images(&path).unwrap();

    assert_eq!(
        image(&images, "images/fig.png").references,
        vec![reference(0, Some("Fig"))]
    );
}

#[test]
fn list_images_reads_an_image_and_spine_document_whose_manifest_hrefs_are_percent_encoded() {
    let png = solid_color_png(1, 2, 3, 4, 3);
    let path = write_encoded_href_epub(
        &page(r#"<img src="../Images/my%20map.png" alt="Map"/>"#),
        &png,
    );

    let images = list_images(&path).unwrap();

    assert_eq!(
        images,
        vec![BookImage {
            href: "Images/my%20map.png".into(),
            media_type: "image/png".into(),
            byte_size: png.len() as i64,
            width: Some(4),
            height: Some(3),
            references: vec![reference(0, Some("Map"))],
        }]
    );
}

#[test]
fn list_images_keeps_the_first_alt_when_a_document_shows_an_image_twice() {
    let png = solid_color_png(1, 2, 3, 2, 2);
    let path = write_epub(
        &[(
            "c1.xhtml",
            &page(r#"<img src="a.png" alt="First"/><img src="a.png" alt="Second"/>"#),
        )],
        &[("a.png", "image/png", &png)],
    );

    let images = list_images(&path).unwrap();

    assert_eq!(
        image(&images, "a.png").references,
        vec![reference(0, Some("First"))]
    );
}

#[test]
fn list_images_counts_an_svg_image_element_as_a_reference() {
    let png = solid_color_png(1, 2, 3, 2, 2);
    let path = write_epub(
        &[(
            "c1.xhtml",
            &page(
                r#"<svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="plate.png"/></svg>"#,
            ),
        )],
        &[("plate.png", "image/png", &png)],
    );

    let images = list_images(&path).unwrap();

    assert_eq!(
        image(&images, "plate.png").references,
        vec![reference(0, None)]
    );
}

#[test]
fn list_images_reports_no_pixel_dimensions_for_an_svg() {
    let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>"#;
    let path = write_epub(
        &[("c1.xhtml", &page(r#"<img src="logo.svg"/>"#))],
        &[("logo.svg", "image/svg+xml", svg)],
    );

    let images = list_images(&path).unwrap();

    let logo = image(&images, "logo.svg");
    assert_eq!(
        (logo.media_type.as_str(), logo.width, logo.height),
        ("image/svg+xml", None, None)
    );
    assert_eq!(logo.byte_size, svg.len() as i64);
}

#[test]
fn list_images_reports_an_empty_alt_as_none() {
    let png = solid_color_png(1, 2, 3, 2, 2);
    let path = write_epub(
        &[("c1.xhtml", &page(r#"<img src="a.png" alt="  "/>"#))],
        &[("a.png", "image/png", &png)],
    );

    let images = list_images(&path).unwrap();

    assert_eq!(image(&images, "a.png").references, vec![reference(0, None)]);
}

#[test]
fn list_images_ignores_a_data_uri_an_external_url_and_an_unresolvable_src() {
    let png = solid_color_png(1, 2, 3, 2, 2);
    let path = write_epub(
        &[(
            "c1.xhtml",
            &page(
                r#"<img src="data:image/png;base64,AAAA"/><img src="https://example.com/a.png"/><img src="missing.png"/>"#,
            ),
        )],
        &[("a.png", "image/png", &png)],
    );

    let images = list_images(&path).unwrap();

    assert_eq!(image(&images, "a.png").references, vec![]);
}

#[test]
fn list_images_skips_a_spine_document_that_exceeds_the_byte_cap() {
    let png = solid_color_png(1, 2, 3, 2, 2);
    let oversized = page(&format!(
        r#"<img src="a.png"/><p>{}</p>"#,
        "x".repeat(70 * 1024)
    ));
    let path = write_epub(
        &[
            ("big.xhtml", &oversized),
            ("c2.xhtml", &page(r#"<img src="a.png"/>"#)),
        ],
        &[("a.png", "image/png", &png)],
    );

    let images = list_images(&path).unwrap();

    assert_eq!(image(&images, "a.png").references, vec![reference(1, None)]);
}

#[test]
fn list_images_stops_reading_spine_documents_once_the_byte_budget_is_spent() {
    let png = solid_color_png(1, 2, 3, 2, 2);
    // Each page is just under the per-page cap, so a handful spend the budget.
    let body = page(&format!(
        r#"<img src="a.png"/><p>{}</p>"#,
        "x".repeat(60 * 1024)
    ));
    let names: Vec<String> = (0..8).map(|i| format!("c{i}.xhtml")).collect();
    let spine: Vec<(&str, &str)> = names.iter().map(|n| (n.as_str(), body.as_str())).collect();
    let path = write_epub(&spine, &[("a.png", "image/png", &png)]);

    let images = list_images(&path).unwrap();

    let seen: Vec<i64> = image(&images, "a.png")
        .references
        .iter()
        .map(|r| r.spine_index)
        .collect();
    assert!(seen.contains(&0), "{seen:?}");
    assert!(
        !seen.contains(&7),
        "page past the budget was read: {seen:?}"
    );
}

#[test]
fn list_images_spends_the_byte_budget_on_spine_documents_that_exceed_the_cap() {
    let png = solid_color_png(1, 2, 3, 2, 2);
    let oversized = page(&format!(
        r#"<img src="a.png"/><p>{}</p>"#,
        "x".repeat(70 * 1024)
    ));
    let fine = page(r#"<img src="a.png"/>"#);
    let names: Vec<String> = (0..6).map(|i| format!("c{i}.xhtml")).collect();
    let bodies = [&oversized, &oversized, &oversized, &oversized, &fine, &fine];
    let spine: Vec<(&str, &str)> = names
        .iter()
        .zip(bodies)
        .map(|(n, body)| (n.as_str(), body.as_str()))
        .collect();
    let path = write_epub(&spine, &[("a.png", "image/png", &png)]);

    let images = list_images(&path).unwrap();

    assert_eq!(image(&images, "a.png").references, vec![]);
}

#[test]
fn list_images_lists_images_past_the_byte_budget_without_pixel_dimensions() {
    // 100 KiB each against the 256 KiB test budget: the third read spends it.
    let mut plate = solid_color_png(1, 2, 3, 4, 3);
    plate.resize(100 * 1024, 0);
    let names: Vec<String> = (0..5).map(|i| format!("plate{i}.png")).collect();
    let images: Vec<(&str, &str, &[u8])> = names
        .iter()
        .map(|n| (n.as_str(), "image/png", plate.as_slice()))
        .collect();
    let path = write_epub(&[("c1.xhtml", &page("<p>text</p>"))], &images);

    let listed = list_images(&path).unwrap();

    let sized: Vec<_> = listed.iter().map(|i| (i.width, i.height)).collect();
    assert_eq!(listed.len(), 5);
    assert_eq!(sized.iter().filter(|d| **d == (Some(4), Some(3))).count(), 3);
    assert_eq!(sized.iter().filter(|d| **d == (None, None)).count(), 2);
}

#[test]
fn list_images_lists_an_unreferenced_image_with_no_references() {
    let png = solid_color_png(1, 2, 3, 2, 2);
    let path = write_epub(
        &[("c1.xhtml", &page("<p>no pictures</p>"))],
        &[("orphan.png", "image/png", &png)],
    );

    let images = list_images(&path).unwrap();

    assert_eq!(image(&images, "orphan.png").references, vec![]);
}

#[test]
fn list_images_orders_images_by_the_first_spine_document_that_shows_them() {
    let png = solid_color_png(1, 2, 3, 2, 2);
    let path = write_epub(
        &[
            ("c1.xhtml", &page(r#"<img src="b.png"/><img src="b.png"/>"#)),
            ("c2.xhtml", &page(r#"<img src="a.png"/><img src="b.png"/>"#)),
        ],
        &[
            ("z-orphan.png", "image/png", &png),
            ("a.png", "image/png", &png),
            ("b.png", "image/png", &png),
        ],
    );

    let images = list_images(&path).unwrap();

    let hrefs: Vec<&str> = images.iter().map(|i| i.href.as_str()).collect();
    assert_eq!(hrefs, ["b.png", "a.png", "z-orphan.png"]);
    // b.png is shown twice in c1 (one reference) and again in c2.
    assert_eq!(
        image(&images, "b.png").references,
        vec![reference(0, None), reference(1, None)]
    );
}

#[test]
fn list_images_errors_when_the_file_is_not_an_epub() {
    let path = make_test_dir("book_images_bad").join("book.epub");
    std::fs::write(&path, b"not a zip").unwrap();

    assert!(list_images(&path).is_err());
}

#[test]
fn read_image_returns_the_media_type_and_original_bytes_for_a_manifest_href() {
    let png = solid_color_png(9, 9, 9, 3, 3);
    let path = write_epub(
        &[("c1.xhtml", &page(r#"<img src="map.png"/>"#))],
        &[("map.png", "image/png", &png)],
    );

    let read = read_image(File::open(&path).unwrap(), "map.png").unwrap();

    assert_eq!(read, Some(("image/png".to_string(), png)));
}

#[test]
fn read_image_returns_the_bytes_for_a_percent_encoded_manifest_href() {
    let png = solid_color_png(9, 9, 9, 3, 3);
    let path = write_encoded_href_epub(&page("<p>text</p>"), &png);

    let read = read_image(File::open(&path).unwrap(), "Images/my%20map.png").unwrap();

    assert_eq!(read, Some(("image/png".to_string(), png)));
}

#[test]
fn read_image_returns_none_for_an_href_that_is_not_a_manifest_image() {
    let png = solid_color_png(9, 9, 9, 3, 3);
    let path = write_epub(
        &[("c1.xhtml", &page("<p>text</p>"))],
        &[("map.png", "image/png", &png)],
    );

    for href in ["c1.xhtml", "content.opf", "../../etc/passwd"] {
        let read = read_image(File::open(&path).unwrap(), href).unwrap();
        assert_eq!(read, None, "{href} must not be served");
    }
}

#[test]
fn read_image_returns_none_for_a_manifest_image_missing_from_the_archive() {
    let epub = assemble_test_epub(
        &[("c1.xhtml", &page("<p>text</p>"))],
        r#"<item id="ghost" href="ghost.png" media-type="image/png"/>"#,
        "",
        &[],
    );
    let path = make_test_dir("book_images_ghost").join("book.epub");
    std::fs::write(&path, epub).unwrap();

    let read = read_image(File::open(&path).unwrap(), "ghost.png").unwrap();

    assert_eq!(read, None);
}

#[test]
fn read_image_errors_when_an_image_exceeds_the_byte_cap() {
    let huge = vec![0u8; 70 * 1024];
    let path = write_epub(
        &[("c1.xhtml", &page("<p>text</p>"))],
        &[("huge.png", "image/png", &huge)],
    );

    let err = read_image(File::open(&path).unwrap(), "huge.png").unwrap_err();

    assert!(err.to_string().contains("exceeds"), "{err}");
}
