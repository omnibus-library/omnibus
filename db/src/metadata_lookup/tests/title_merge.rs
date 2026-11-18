//! `search_provider_by_title`'s merged search: every configured provider asked
//! once, the pile ranked, and editions resolved only for the rows it returns.
//! Fixtures follow what the live providers answer for a famous title: popular
//! works from Open Library, a long tail from Google Books, one authorless row.

use omnibus_shared::metadata_lookup::MetadataProvider;
use serde_json::json;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::super::*;
use super::hardcover_provider::{
    hc_book, hc_search_document, mount_hc_books, mount_hc_search, ID_QUERY_MARKER,
};
use super::{
    all_keyed_config_for, config_for, gb_search_hit, keyed_config_for, mount_gb_search,
    mount_ol_search, with_check_digit, GB_PATH, ISBN13, OL_SEARCH_PATH, QUERY,
};

const HUNGER_GAMES: &str = "The Hunger Games";

/// A distinct, valid ISBN-13 for row `i` of a fixture family (`group` 0-9).
fn isbn(group: u32, i: u32) -> String {
    with_check_digit(&format!("97800{group}{i:06}"))
}

async fn mount_ol_title(server: &MockServer, docs: Vec<serde_json::Value>) {
    Mock::given(method("GET"))
        .and(path(OL_SEARCH_PATH))
        .and(query_param("title", HUNGER_GAMES))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "docs": docs })))
        .mount(server)
        .await;
}

async fn mount_gb_title(server: &MockServer, items: Vec<serde_json::Value>) {
    Mock::given(method("GET"))
        .and(path(GB_PATH))
        .and(query_param("q", HUNGER_GAMES))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "items": items })))
        .mount(server)
        .await;
}

/// An Open Library work, and the editions.json answer that gives it one ISBN.
async fn ol_work(
    server: &MockServer,
    work: u32,
    title: &str,
    author: &str,
    readers: u32,
) -> serde_json::Value {
    Mock::given(method("GET"))
        .and(path(format!("/works/OL{work}W/editions.json")))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "entries": [
                { "isbn_13": [isbn(1, work)], "physical_format": "Paperback",
                  "languages": [{ "key": "/languages/eng" }] },
            ]})),
        )
        .mount(server)
        .await;
    json!({
        "key": format!("/works/OL{work}W"),
        "title": title,
        "author_name": [author],
        "readinglog_count": readers,
    })
}

/// A Google Books row for `HUNGER_GAMES`, with an author unless `author` is `None`.
fn gb_row(i: u32, title: &str, author: Option<&str>) -> serde_json::Value {
    let mut info = json!({
        "title": title,
        "industryIdentifiers": [{ "type": "ISBN_13", "identifier": isbn(2, i) }],
    });
    if let Some(author) = author {
        info["authors"] = json!([author]);
    }
    json!({ "id": format!("gb{i}"), "volumeInfo": info })
}

async fn requests_to(server: &MockServer, needle: &str) -> usize {
    server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .filter(|r| {
            r.url.path().contains(needle) || String::from_utf8_lossy(&r.body).contains(needle)
        })
        .count()
}

#[tokio::test]
async fn search_by_title_ranks_the_most_read_exact_match_first_across_providers() {
    let server = MockServer::start().await;
    let collins = ol_work(&server, 1, HUNGER_GAMES, "Suzanne Collins", 7912).await;
    let egan = ol_work(&server, 2, HUNGER_GAMES, "Kate Egan", 41).await;
    let trilogy = ol_work(
        &server,
        3,
        "The Hunger Games Trilogy",
        "Suzanne Collins",
        477,
    )
    .await;
    mount_ol_title(&server, vec![egan, trilogy, collins]).await;
    let mut gb_rows = vec![gb_row(0, HUNGER_GAMES, None)];
    gb_rows.extend((1..=6).map(|i| gb_row(i, HUNGER_GAMES, Some(&format!("Author {i}")))));
    mount_gb_title(&server, gb_rows).await;
    let mut lit_kit = hc_search_document();
    lit_kit["title"] = json!(HUNGER_GAMES);
    lit_kit["author_names"] = json!(["LitKit"]);
    lit_kit["users_count"] = json!(3);
    mount_hc_search(&server, json!([{ "document": lit_kit }])).await;
    let mut book = hc_book();
    book["title"] = json!(HUNGER_GAMES);
    book["editions"] = json!([{ "isbn_13": isbn(3, 0) }]);
    mount_hc_books(&server, ID_QUERY_MARKER, json!([book])).await;

    let results = search_provider_by_title(&all_keyed_config_for(&server), HUNGER_GAMES)
        .await
        .unwrap();

    assert!(results.len() > 8, "got {} rows", results.len());
    assert_eq!(results[0].authors, vec!["Suzanne Collins".to_string()]);
    assert_eq!(results[0].source, MetadataProvider::OpenLibrary);
    assert_eq!(results[0].isbn13, isbn(1, 1));
    let authorless = results
        .iter()
        .position(|m| m.isbn13 == isbn(2, 0))
        .expect("the authorless Google row is still offered");
    let last_exact = results
        .iter()
        .rposition(|m| m.title == HUNGER_GAMES && !m.authors.is_empty())
        .unwrap();
    assert!(
        last_exact < authorless,
        "authorless row ranked above an authored one"
    );
}

#[tokio::test]
async fn search_by_title_resolves_editions_only_for_the_rows_it_returns() {
    let server = MockServer::start().await;
    // 3 popular exact works + 7 prefix works; 10 Google and 7 Hardcover exact rows
    // fill the 20 slots, so the 7 prefix works fall past the cap.
    let mut docs = Vec::new();
    for work in 1..=3 {
        docs.push(ol_work(&server, work, HUNGER_GAMES, "Suzanne Collins", 9000).await);
    }
    for work in 4..=10 {
        docs.push(ol_work(&server, work, "The Hunger Games Companion", "Fan", 5).await);
    }
    mount_ol_title(&server, docs).await;
    mount_gb_title(
        &server,
        (0..10)
            .map(|i| gb_row(i, HUNGER_GAMES, Some("Gb Author")))
            .collect(),
    )
    .await;
    let hits: Vec<_> = (0..7)
        .map(|i| {
            let mut doc = hc_search_document();
            doc["id"] = json!((900 + i).to_string());
            doc["title"] = json!(HUNGER_GAMES);
            json!({ "document": doc })
        })
        .collect();
    mount_hc_search(&server, json!(hits)).await;
    mount_hc_books(&server, ID_QUERY_MARKER, json!([hc_book()])).await;

    search_provider_by_title(&all_keyed_config_for(&server), HUNGER_GAMES)
        .await
        .unwrap();

    assert_eq!(requests_to(&server, "editions.json").await, 3);
    assert_eq!(requests_to(&server, OL_SEARCH_PATH).await, 1);
    assert_eq!(requests_to(&server, GB_PATH).await, 1);
    assert_eq!(requests_to(&server, "query_type").await, 1);
}

#[tokio::test]
async fn search_by_title_merges_every_configured_provider_when_a_key_is_configured() {
    let server = MockServer::start().await;
    let open_library_isbn = isbn(1, 0);
    mount_ol_search(
        &server,
        json!({ "docs": [{ "title": "Effective Java", "author_name": ["Joshua Bloch"],
                           "isbn": [open_library_isbn] }] }),
    )
    .await;
    mount_gb_search(&server, gb_search_hit()).await;

    let results = search_provider_by_title(&keyed_config_for(&server), QUERY)
        .await
        .unwrap();

    let mut isbns: Vec<_> = results.iter().map(|m| m.isbn13.as_str()).collect();
    isbns.sort_unstable();
    let mut expected = [open_library_isbn.as_str(), ISBN13];
    expected.sort_unstable();
    assert_eq!(isbns, expected);
}

#[tokio::test]
async fn search_by_title_caps_the_candidate_list() {
    let docs: Vec<_> = (0..15)
        .map(|i| json!({ "title": format!("Effective Java, Printing {i}"), "isbn": [isbn(1, i)] }))
        .collect();
    let items: Vec<_> = (0..15)
        .map(|i| {
            json!({ "id": format!("gb{i}"), "volumeInfo": {
                "title": format!("Effective Java, Edition {i}"),
                "industryIdentifiers": [{ "type": "ISBN_13", "identifier": isbn(2, i) }],
            }})
        })
        .collect();
    let server = MockServer::start().await;
    mount_ol_search(&server, json!({ "docs": docs })).await;
    mount_gb_search(&server, json!({ "items": items })).await;

    let results = search_provider_by_title(&config_for(&server), QUERY)
        .await
        .unwrap();

    assert_eq!(results.len(), SEARCH_LIMIT);
}

#[tokio::test]
async fn search_by_title_reports_a_provider_error_when_the_terminal_provider_is_cooling_and_the_rest_miss(
) {
    let server = MockServer::start().await;
    mount_ol_search(&server, json!({ "docs": [] })).await;
    let config = config_for(&server);
    config.throttle.record(MetadataProvider::GoogleBooks, None);

    let result = search_provider_by_title(&config, QUERY).await;

    assert!(matches!(result, Err(MetadataLookupError::Provider(_))));
    assert_eq!(requests_to(&server, GB_PATH).await, 0);
}
