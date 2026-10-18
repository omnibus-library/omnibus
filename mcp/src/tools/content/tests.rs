use std::sync::Arc;

use axum::extract::{Path, Query};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json as AxumJson, Router};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ContentBlock};

use omnibus_shared::{
    BookImage, BookImageLink, BookImageList, BookImageReference, ChapterListEntry,
    ChapterListResponse, ChapterTextResponse, ContentSearchHit, ContentSearchResults,
};

use super::*;
use crate::client::OmnibusClient;
use crate::config::Config;

/// Every content tool this issue ships, by MCP tool name.
const EXPECTED_TOOLS: &[&str] = &[
    "list_chapters",
    "read_chapter_text",
    "search_book_content",
    "list_book_images",
    "read_book_image",
];

const SVG: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>"#;

fn encode_png(image: image::DynamicImage) -> Vec<u8> {
    let mut bytes = Vec::new();
    image
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .unwrap();
    bytes
}

fn opaque_png(width: u32, height: u32) -> Vec<u8> {
    let pixels = image::RgbImage::from_pixel(width, height, image::Rgb([200, 30, 30]));
    encode_png(image::DynamicImage::ImageRgb8(pixels))
}

fn transparent_png(width: u32, height: u32) -> Vec<u8> {
    let pixels = image::RgbaImage::from_pixel(width, height, image::Rgba([10, 20, 30, 0]));
    encode_png(image::DynamicImage::ImageRgba8(pixels))
}

/// The `BookImageRead` a `read_book_image` call carried as structured content.
fn read_of(result: CallToolResult) -> omnibus_shared::BookImageRead {
    result.into_typed().unwrap()
}

async fn login() -> AxumJson<serde_json::Value> {
    AxumJson(serde_json::json!({
        "user": {
            "id": 1, "username": "reader", "is_admin": false,
            "can_upload": false, "can_edit": false, "can_download": true
        },
        "token": "token-1",
    }))
}

async fn chapters(Path(uuid): Path<String>) -> Result<AxumJson<ChapterListResponse>, StatusCode> {
    match uuid.as_str() {
        "uuid-frank" => Ok(AxumJson(ChapterListResponse {
            book_uuid: uuid,
            has_text: true,
            spine_count: 3,
            chapters: vec![ChapterListEntry {
                ordinal: 0,
                title: "Letter 1".into(),
                spine_index: 1,
            }],
        })),
        "uuid-audio" => Ok(AxumJson(ChapterListResponse {
            book_uuid: uuid,
            has_text: false,
            spine_count: 0,
            chapters: vec![],
        })),
        _ => Err(StatusCode::NOT_FOUND),
    }
}

#[derive(serde::Deserialize)]
struct TextQuery {
    offset: Option<i64>,
    limit: Option<i64>,
}

async fn chapter_text(
    Path((uuid, spine_index)): Path<(String, i64)>,
    Query(q): Query<TextQuery>,
) -> Result<AxumJson<ChapterTextResponse>, StatusCode> {
    if uuid != "uuid-frank" || spine_index >= 3 {
        return Err(StatusCode::NOT_FOUND);
    }
    // Echo the requested window as a truncated slice so the test can assert
    // the boundary fields pass through the tool untouched.
    let offset = q.offset.unwrap_or(0);
    let limit = q.limit.unwrap_or(100_000);
    Ok(AxumJson(ChapterTextResponse {
        book_uuid: uuid,
        has_text: true,
        spine_index,
        text: "It was on a dreary night of November".into(),
        offset,
        total_chars: 5_000,
        truncated: true,
        next_offset: Some(offset + limit),
        truncated_by_progress: false,
    }))
}

async fn content_search(
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> AxumJson<ContentSearchResults> {
    // The scoping params are echoed into `hint` so a test can prove they
    // reached the wire in the shape the server parses.
    if q.get("q").map(String::as_str) == Some("echo") {
        return AxumJson(ContentSearchResults {
            hits: Vec::new(),
            withheld_ahead: None,
            hint: Some(format!(
                "book_uuid={} book_uuids={} limit={} spoiler_filter={}",
                q.get("book_uuid").cloned().unwrap_or_default(),
                q.get("book_uuids").cloned().unwrap_or_default(),
                q.get("limit").cloned().unwrap_or_default(),
                q.get("spoiler_filter").cloned().unwrap_or_default(),
            )),
        });
    }
    if q.get("q").map(String::as_str) == Some("dreary night") {
        AxumJson(ContentSearchResults {
            hits: vec![ContentSearchHit {
                book_uuid: "uuid-frank".into(),
                spine_index: 1,
                title: "Frankenstein".into(),
                snippet: "It was on a [dreary] [night] of November…".into(),
                chapter_title: Some("Chapter Four".into()),
                ahead_of_reader: None,
                position_delta_percent: None,
            }],
            withheld_ahead: None,
            hint: None,
        })
    } else {
        AxumJson(ContentSearchResults::default())
    }
}

async fn images(Path(uuid): Path<String>) -> Result<AxumJson<BookImageList>, StatusCode> {
    match uuid.as_str() {
        "uuid-frank" => Ok(AxumJson(BookImageList {
            book_uuid: uuid,
            images: vec![BookImage {
                href: "OEBPS/images/map.png".into(),
                media_type: "image/png".into(),
                byte_size: 2048,
                width: Some(640),
                height: Some(480),
                references: vec![BookImageReference {
                    spine_index: 1,
                    alt: Some("A map".into()),
                }],
            }],
        })),
        "uuid-comic" => Err(StatusCode::UNPROCESSABLE_ENTITY),
        _ => Err(StatusCode::NOT_FOUND),
    }
}

/// `GET …/images/file`: four PNG-typed bytes for `uuid-frank`'s map, with the
/// statuses the server answers for each way the read can fail.
async fn image_file(
    Path(uuid): Path<String>,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    match (uuid.as_str(), q.get("href").map(String::as_str)) {
        ("uuid-frank", Some("OEBPS/images/map.png")) => (
            [(axum::http::header::CONTENT_TYPE, "image/png")],
            vec![1u8, 2, 3, 4],
        )
            .into_response(),
        ("uuid-frank", Some("OEBPS/images/plate.png")) => (
            [(axum::http::header::CONTENT_TYPE, "image/png")],
            opaque_png(8, 6),
        )
            .into_response(),
        ("uuid-frank", Some("OEBPS/images/logo.svg")) => (
            [(axum::http::header::CONTENT_TYPE, "image/svg+xml")],
            SVG.to_vec(),
        )
            .into_response(),
        ("uuid-frank", _) => StatusCode::BAD_REQUEST.into_response(),
        ("uuid-nodl", _) => StatusCode::FORBIDDEN.into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

/// `GET …/images/link`: a signed path over the `href` it was asked to mint for.
async fn image_link(
    Path(uuid): Path<String>,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> AxumJson<BookImageLink> {
    let mut query = reqwest::Url::parse("http://stub").unwrap();
    query
        .query_pairs_mut()
        .append_pair("href", q.get("href").map_or("", String::as_str))
        .append_pair("expires", "1893456000")
        .append_pair("sig", "abc");
    AxumJson(BookImageLink {
        path: format!(
            "/api/ebooks/{uuid}/images/file?{}",
            query.query().unwrap_or_default()
        ),
        expires_at: 1_893_456_000,
    })
}

/// Boot a stub instance serving the content read routes; returns its origin.
async fn spawn_stub() -> String {
    let app = Router::new()
        .route("/api/auth/login", post(login))
        .route("/api/ebooks/{uuid}/chapters", get(chapters))
        .route(
            "/api/ebooks/{uuid}/chapters/{spine_index}/text",
            get(chapter_text),
        )
        .route("/api/ebooks/{uuid}/images", get(images))
        .route("/api/ebooks/{uuid}/images/file", get(image_file))
        .route("/api/ebooks/{uuid}/images/link", get(image_link))
        .route("/api/search/content", get(content_search));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

/// A service logged in to the stub instance.
async fn stub_service() -> OmnibusMcp {
    let client = OmnibusClient::new(Config {
        base_url: spawn_stub().await,
        username: "reader".into(),
        password: "correct horse battery".into(),
    })
    .unwrap();
    OmnibusMcp::new(Arc::new(client))
}

/// `unwrap_err` needs `T: Debug`, which `rmcp::Json` does not implement.
fn expect_err<T>(result: Result<T, ErrorData>) -> ErrorData {
    match result {
        Err(e) => e,
        Ok(_) => panic!("expected an error"),
    }
}

#[test]
fn content_tools_router_lists_every_expected_tool_with_a_description() {
    let router = OmnibusMcp::content_tools();
    let tools = router.list_all();
    let names: Vec<&str> = tools.iter().map(|t| t.name.as_ref()).collect();
    for expected in EXPECTED_TOOLS {
        assert!(names.contains(expected), "missing tool {expected}");
    }
    assert_eq!(
        tools.len(),
        EXPECTED_TOOLS.len(),
        "unexpected extra tools: {names:?}"
    );
    for tool in &tools {
        let desc = tool.description.as_deref().unwrap_or_default();
        assert!(
            desc.len() > 20,
            "tool {} needs a real description",
            tool.name
        );
    }
}

#[tokio::test]
async fn list_chapters_returns_the_toc_with_spine_addressing() {
    let service = stub_service().await;
    let listing = service
        .list_chapters(Parameters(ListChaptersParams {
            book_uuid: "uuid-frank".into(),
        }))
        .await
        .unwrap();
    assert!(listing.0.has_text);
    assert_eq!(listing.0.spine_count, 3);
    assert_eq!(listing.0.chapters.len(), 1);
    assert_eq!(listing.0.chapters[0].title, "Letter 1");
    assert_eq!(listing.0.chapters[0].spine_index, 1);
}

#[tokio::test]
async fn list_chapters_passes_through_the_no_text_answer() {
    let service = stub_service().await;
    let listing = service
        .list_chapters(Parameters(ListChaptersParams {
            book_uuid: "uuid-audio".into(),
        }))
        .await
        .unwrap();
    assert!(!listing.0.has_text);
    assert_eq!(listing.0.spine_count, 0);
    assert!(listing.0.chapters.is_empty());
}

#[tokio::test]
async fn list_chapters_reports_not_found_for_an_unknown_uuid() {
    let service = stub_service().await;
    let err = expect_err(
        service
            .list_chapters(Parameters(ListChaptersParams {
                book_uuid: "uuid-missing".into(),
            }))
            .await,
    );
    assert!(err.message.contains("not found"));
}

#[tokio::test]
async fn read_chapter_text_sends_the_window_and_surfaces_the_truncation_boundary() {
    let service = stub_service().await;
    let slice = service
        .read_chapter_text(Parameters(ChapterTextParams {
            book_uuid: "uuid-frank".into(),
            spine_index: 1,
            offset: Some(200),
            limit: Some(50),
            stop_at_progress: None,
        }))
        .await
        .unwrap();
    assert!(slice.0.has_text);
    assert_eq!(slice.0.spine_index, 1);
    assert!(slice.0.text.contains("dreary night"));
    // The boundary fields the description tells the model to page by.
    assert_eq!(slice.0.offset, 200);
    assert_eq!(slice.0.total_chars, 5_000);
    assert!(slice.0.truncated);
    assert_eq!(slice.0.next_offset, Some(250));
}

#[tokio::test]
async fn read_chapter_text_reports_an_out_of_range_spine_index() {
    let service = stub_service().await;
    let err = expect_err(
        service
            .read_chapter_text(Parameters(ChapterTextParams {
                book_uuid: "uuid-frank".into(),
                spine_index: 9,
                offset: None,
                limit: None,
                stop_at_progress: None,
            }))
            .await,
    );
    assert!(err.message.contains("out of range"), "got: {}", err.message);
    assert!(err.message.contains("spine_count"));
}

#[tokio::test]
async fn search_book_content_returns_chapter_cited_hits() {
    let service = stub_service().await;
    let results = service
        .search_book_content(Parameters(ContentSearchParams {
            query: "dreary night".into(),
            book_uuid: None,
            book_uuids: None,
            limit: None,
            spoiler_filter: None,
        }))
        .await
        .unwrap();
    assert_eq!(results.0.hits.len(), 1);
    let hit = &results.0.hits[0];
    assert_eq!(hit.book_uuid, "uuid-frank");
    assert_eq!(hit.spine_index, 1);
    assert_eq!(hit.title, "Frankenstein");
    assert!(hit.snippet.contains("[dreary]"));
}

#[tokio::test]
async fn search_book_content_answers_no_match_with_an_empty_hit_list() {
    let service = stub_service().await;
    let results = service
        .search_book_content(Parameters(ContentSearchParams {
            query: "phrase in no book".into(),
            book_uuid: None,
            book_uuids: None,
            limit: None,
            spoiler_filter: None,
        }))
        .await
        .unwrap();
    assert!(results.0.hits.is_empty());
}

#[tokio::test]
async fn read_chapter_text_rejects_a_negative_spine_index_locally() {
    // The params are i64 to match the shared wire types; a negative never
    // becomes a URL the server's unsigned parse would opaquely 400.
    let service = stub_service().await;
    let err = expect_err(
        service
            .read_chapter_text(Parameters(ChapterTextParams {
                book_uuid: "uuid-frank".into(),
                spine_index: -1,
                offset: None,
                limit: None,
                stop_at_progress: None,
            }))
            .await,
    );
    assert!(
        err.message.contains("non-negative"),
        "message: {}",
        err.message
    );
}

#[tokio::test]
async fn read_chapter_text_rejects_a_uuid_that_is_not_one_path_segment() {
    // A slash-bearing "uuid" would splice extra segments into the request
    // path; the shared guard answers invalid params before any request forms.
    let service = stub_service().await;
    let err = expect_err(
        service
            .read_chapter_text(Parameters(ChapterTextParams {
                book_uuid: "uuid-a/../uuid-b".into(),
                spine_index: 1,
                offset: None,
                limit: None,
                stop_at_progress: None,
            }))
            .await,
    );
    assert!(
        err.message.contains("book_uuid"),
        "message: {}",
        err.message
    );
}

#[tokio::test]
async fn search_book_content_forwards_scope_limit_and_spoiler_filter() {
    let service = stub_service().await;
    let results = service
        .search_book_content(Parameters(ContentSearchParams {
            query: "echo".into(),
            book_uuid: Some("uuid-frank".into()),
            book_uuids: Some(vec!["uuid-a".into(), "uuid-b".into()]),
            limit: Some(7),
            spoiler_filter: Some(omnibus_shared::SpoilerFilter::Exclude),
        }))
        .await
        .expect("search should succeed");
    assert_eq!(
        results.0.hint.as_deref(),
        Some("book_uuid=uuid-frank book_uuids=uuid-a,uuid-b limit=7 spoiler_filter=exclude")
    );
}

#[tokio::test]
async fn search_book_content_sends_no_scope_params_when_none_are_given() {
    let service = stub_service().await;
    let results = service
        .search_book_content(Parameters(ContentSearchParams {
            query: "echo".into(),
            book_uuid: None,
            book_uuids: None,
            limit: None,
            spoiler_filter: None,
        }))
        .await
        .expect("search should succeed");
    assert_eq!(
        results.0.hint.as_deref(),
        Some("book_uuid= book_uuids= limit= spoiler_filter=")
    );
}

#[tokio::test]
async fn search_book_content_surfaces_the_chapter_title_on_each_hit() {
    let service = stub_service().await;
    let results = service
        .search_book_content(Parameters(ContentSearchParams {
            query: "dreary night".into(),
            book_uuid: None,
            book_uuids: None,
            limit: None,
            spoiler_filter: None,
        }))
        .await
        .expect("search should succeed");
    assert_eq!(
        results.0.hits[0].chapter_title.as_deref(),
        Some("Chapter Four"),
        "a caller must not have to join spine_index back to a chapter itself"
    );
}

#[tokio::test]
async fn read_chapter_text_forwards_stop_at_progress_only_when_asked() {
    let service = stub_service().await;
    // The stub echoes `limit` into `next_offset`, so an unchanged response
    // proves the extra param did not disturb the existing query.
    let text = service
        .read_chapter_text(Parameters(ChapterTextParams {
            book_uuid: "uuid-frank".into(),
            spine_index: 1,
            offset: Some(10),
            limit: Some(5),
            stop_at_progress: Some(true),
        }))
        .await
        .expect("read should succeed");
    assert_eq!(text.0.offset, 10);
    assert!(!text.0.truncated_by_progress, "the stub reports no cut");
}

#[tokio::test]
async fn list_book_images_returns_each_image_with_its_references() {
    let service = stub_service().await;
    let list = service
        .list_book_images(Parameters(ListBookImagesParams {
            book_uuid: "uuid-frank".into(),
        }))
        .await
        .unwrap();
    assert_eq!(list.0.book_uuid, "uuid-frank");
    assert_eq!(list.0.images.len(), 1);
    let image = &list.0.images[0];
    assert_eq!(image.href, "OEBPS/images/map.png");
    assert_eq!(image.media_type, "image/png");
    assert_eq!(
        (image.byte_size, image.width, image.height),
        (2048, Some(640), Some(480))
    );
    assert_eq!(image.references[0].spine_index, 1);
    assert_eq!(image.references[0].alt.as_deref(), Some("A map"));
}

#[tokio::test]
async fn list_book_images_reports_not_found_for_an_unknown_uuid() {
    let service = stub_service().await;
    let err = expect_err(
        service
            .list_book_images(Parameters(ListBookImagesParams {
                book_uuid: "uuid-missing".into(),
            }))
            .await,
    );
    assert_eq!(err.message, "book uuid-missing not found");
}

#[tokio::test]
async fn list_book_images_reports_a_book_without_an_epub() {
    let service = stub_service().await;
    let err = expect_err(
        service
            .list_book_images(Parameters(ListBookImagesParams {
                book_uuid: "uuid-comic".into(),
            }))
            .await,
    );
    assert!(
        err.message.contains("has no EPUB file"),
        "got: {}",
        err.message
    );
    assert!(err.message.contains("CBZ"), "names what is not covered");
}

#[tokio::test]
async fn read_book_image_returns_a_signed_download_url_on_the_public_url() {
    let service = stub_service().await;
    let public = service.client.public_url().to_string();

    let read = service
        .read_book_image(Parameters(ReadBookImageParams {
            book_uuid: "uuid-frank".into(),
            href: "OEBPS/images/map.png".into(),
        }))
        .await
        .unwrap();
    let read = read_of(read);

    assert_eq!(read.book_uuid, "uuid-frank");
    assert_eq!(read.href, "OEBPS/images/map.png");
    assert_eq!(read.media_type, "image/png");
    assert_eq!(read.byte_size, 4);
    assert_eq!(read.expires_at, 1_893_456_000);
    assert_eq!(read.expires_at_iso, "2030-01-01T00:00:00Z");
    assert!(
        read.download_url.starts_with(&public),
        "{}",
        read.download_url
    );
}

#[tokio::test]
async fn read_book_image_reports_an_href_that_is_not_a_manifest_image() {
    let service = stub_service().await;
    let err = expect_err(
        service
            .read_book_image(Parameters(ReadBookImageParams {
                book_uuid: "uuid-frank".into(),
                href: "c1.xhtml".into(),
            }))
            .await,
    );
    assert!(
        err.message
            .contains("not an image in this book's EPUB manifest"),
        "got: {}",
        err.message
    );
}

#[tokio::test]
async fn read_book_image_reports_a_download_permission_denial() {
    let service = stub_service().await;
    let err = expect_err(
        service
            .read_book_image(Parameters(ReadBookImageParams {
                book_uuid: "uuid-nodl".into(),
                href: "OEBPS/images/map.png".into(),
            }))
            .await,
    );
    assert!(
        err.message.contains("not permitted to download"),
        "got: {}",
        err.message
    );
}

#[tokio::test]
async fn read_book_image_builds_the_download_url_on_the_public_url_not_the_base_url() {
    // The hosted `/mcp` shape: calls go through a loopback base URL, but the link
    // goes to a person, so it must carry the origin they reached the server on.
    let client = OmnibusClient::with_bearer(
        spawn_stub().await,
        "caller-token".into(),
        "https://omnibus.example.com".into(),
    )
    .unwrap();
    let service = OmnibusMcp::new(Arc::new(client));

    let read = service
        .read_book_image(Parameters(ReadBookImageParams {
            book_uuid: "uuid-frank".into(),
            href: "OEBPS/images/map.png".into(),
        }))
        .await
        .unwrap();
    let read = read_of(read);

    assert_eq!(
        read.download_url,
        "https://omnibus.example.com/api/ebooks/uuid-frank/images/file\
         ?href=OEBPS%2Fimages%2Fmap.png&expires=1893456000&sig=abc"
    );
}

#[test]
fn preview_returns_none_for_svg_bytes() {
    assert!(preview(SVG).is_none());
}

#[test]
fn preview_shrinks_an_image_whose_edge_exceeds_the_cap() {
    let (bytes, media_type) = preview(&opaque_png(3136, 1000)).unwrap();

    assert_eq!(media_type, "image/jpeg");
    let decoded = image::load_from_memory(&bytes).unwrap();
    assert_eq!((decoded.width(), decoded.height()), (1568, 500));
}

#[test]
fn preview_leaves_an_image_exactly_at_the_cap_unscaled() {
    let (bytes, _) = preview(&opaque_png(1568, 4)).unwrap();

    let decoded = image::load_from_memory(&bytes).unwrap();
    assert_eq!((decoded.width(), decoded.height()), (1568, 4));
}

#[test]
fn preview_keeps_a_small_image_at_its_own_size() {
    let (bytes, media_type) = preview(&opaque_png(64, 48)).unwrap();

    assert_eq!(media_type, "image/jpeg");
    let decoded = image::load_from_memory(&bytes).unwrap();
    assert_eq!((decoded.width(), decoded.height()), (64, 48));
}

#[test]
fn preview_encodes_png_when_the_image_has_alpha() {
    let (bytes, media_type) = preview(&transparent_png(32, 32)).unwrap();

    assert_eq!(media_type, "image/png");
    assert!(image::load_from_memory(&bytes).unwrap().color().has_alpha());
}

#[test]
fn preview_returns_none_for_an_image_wider_than_the_decode_limit() {
    assert!(preview(&opaque_png(DECODE_MAX_EDGE + 1, 1)).is_none());
}

#[tokio::test]
async fn read_book_image_attaches_an_image_block_for_a_raster() {
    let service = stub_service().await;

    let result = service
        .read_book_image(Parameters(ReadBookImageParams {
            book_uuid: "uuid-frank".into(),
            href: "OEBPS/images/plate.png".into(),
        }))
        .await
        .unwrap();

    let block = result
        .content
        .iter()
        .find_map(|c| match c {
            ContentBlock::Image(image) => Some(image),
            _ => None,
        })
        .expect("a raster comes with an image block");
    assert_eq!(block.mime_type, "image/jpeg");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&block.data)
        .unwrap();
    let decoded = image::load_from_memory(&bytes).unwrap();
    assert_eq!((decoded.width(), decoded.height()), (8, 6));
    let read = read_of(result);
    assert_eq!(read.byte_size, opaque_png(8, 6).len() as i64);
    // The mint is asked for the href the caller named, not any other image's.
    let url = reqwest::Url::parse(&read.download_url).unwrap();
    let minted_for: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    assert_eq!(minted_for["href"], "OEBPS/images/plate.png");
}

#[tokio::test]
async fn read_book_image_attaches_no_image_block_for_an_svg() {
    let service = stub_service().await;

    let result = service
        .read_book_image(Parameters(ReadBookImageParams {
            book_uuid: "uuid-frank".into(),
            href: "OEBPS/images/logo.svg".into(),
        }))
        .await
        .unwrap();

    assert!(
        result
            .content
            .iter()
            .all(|c| !matches!(c, ContentBlock::Image(_))),
        "an SVG comes as the URL only"
    );
    assert_eq!(read_of(result).media_type, "image/svg+xml");
}
