//! Tests for the OpenAPI document: it matches the committed file, and the
//! properties clients build on hold (operation ids, security, paging headers).
use std::collections::BTreeSet;

use serde_json::Value;

use super::*;

const METHODS: [&str; 5] = ["get", "post", "put", "patch", "delete"];

fn spec_value() -> Value {
    serde_json::to_value(spec()).unwrap()
}

fn operations(doc: &Value) -> Vec<(String, &str, &Value)> {
    let paths = doc["paths"].as_object().unwrap();
    paths
        .iter()
        .flat_map(|(path, item)| {
            METHODS
                .iter()
                .filter_map(move |m| item.get(*m).map(|op| (path.clone(), *m, op)))
        })
        .collect()
}

fn collect_refs(value: &Value, refs: &mut BTreeSet<String>) {
    match value {
        Value::Object(map) => {
            if let Some(Value::String(r)) = map.get("$ref") {
                refs.insert(r.clone());
            }
            map.values().for_each(|v| collect_refs(v, refs));
        }
        Value::Array(items) => items.iter().for_each(|v| collect_refs(v, refs)),
        _ => {}
    }
}

#[test]
fn spec_matches_committed_openapi_json() {
    let committed = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../openapi/openapi.json"
    ));
    // `assert!`, not `assert_eq!`: a stale spec would print two whole documents.
    assert!(
        committed == spec_json().unwrap(),
        "openapi/openapi.json is stale: run `just openapi-gen` and commit the result"
    );
}

#[test]
fn spec_gives_every_operation_a_unique_id() {
    let doc = spec_value();
    let mut seen = BTreeSet::new();
    let duplicates: Vec<String> = operations(&doc)
        .into_iter()
        .map(|(_, _, op)| op["operationId"].as_str().unwrap().to_string())
        .filter(|id| !seen.insert(id.clone()))
        .collect();
    assert!(
        duplicates.is_empty(),
        "duplicate operationIds: {duplicates:?}"
    );
}

#[test]
fn spec_requires_a_session_by_default() {
    let doc = spec_value();
    let schemes: BTreeSet<&str> = doc["security"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|req| req.as_object().unwrap().keys().map(String::as_str))
        .collect();
    assert_eq!(schemes, BTreeSet::from(["bearer", "session_cookie"]));
}

#[test]
fn spec_marks_public_routes_as_needing_no_session() {
    let doc = spec_value();
    let public = [
        ("/api/_health", "get"),
        ("/api/auth/login", "post"),
        ("/api/auth/register", "post"),
        ("/api/auth/registration", "get"),
    ];
    for (path, method) in public {
        assert_eq!(
            doc["paths"][path][method]["security"],
            serde_json::json!([{}]),
            "{method} {path} should need no session"
        );
    }
}

#[test]
fn spec_lists_media_token_on_every_media_route() {
    let doc = spec_value();
    let media = [
        "/api/audiobooks/{uuid}/parts/{ordinal}",
        "/api/authors/{id}/photo",
        "/api/covers/{uuid}",
        "/api/ebooks/{uuid}/file",
        "/api/ebooks/{uuid}/images",
        "/api/ebooks/{uuid}/images/file",
        "/api/ebooks/{uuid}/pages/{page}",
        "/api/journals/images/{name}",
        "/api/suggestions/{uuid}/{rank}/cover",
        "/api/thumbs/{uuid}/{size}",
        "/api/users/{user_id}/avatar",
    ];
    for path in media {
        assert_eq!(
            doc["paths"][path]["get"]["security"],
            serde_json::json!([{"bearer": []}, {"session_cookie": []}, {"media_token": []}]),
            "get {path} should accept a bearer, a session cookie or a media token"
        );
    }
}

#[test]
fn spec_documents_paging_headers_on_get_ebooks() {
    let doc = spec_value();
    let headers: BTreeSet<&str> = doc["paths"]["/api/ebooks"]["get"]["responses"]["200"]["headers"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        headers,
        BTreeSet::from([
            "X-Hidden-Count",
            "X-Next-Cursor",
            "X-Total-Cap",
            "X-Total-Count"
        ])
    );
}

#[test]
fn spec_gives_every_response_a_description() {
    // OpenAPI requires one, and generators reject a response without it.
    let doc = spec_value();
    let missing: Vec<String> = operations(&doc)
        .into_iter()
        .flat_map(|(path, method, op)| {
            let responses = op["responses"].as_object().unwrap();
            responses
                .iter()
                .filter(|(_, r)| r.get("description").is_none())
                .map(move |(status, _)| format!("{method} {path} {status}"))
                .collect::<Vec<_>>()
        })
        .collect();
    assert!(
        missing.is_empty(),
        "responses without a description: {missing:?}"
    );
}

#[test]
fn spec_resolves_every_schema_reference() {
    let doc = spec_value();
    let mut refs = BTreeSet::new();
    collect_refs(&doc, &mut refs);
    let schemas = doc["components"]["schemas"].as_object().unwrap();
    let dangling: Vec<&String> = refs
        .iter()
        .filter(|r| {
            let name = r.trim_start_matches("#/components/schemas/");
            !schemas.contains_key(name)
        })
        .collect();
    assert!(
        dangling.is_empty(),
        "references to missing schemas: {dangling:?}"
    );
}
