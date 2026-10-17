//! Which origin the Kobo URLs are built on: the request headers, or the
//! `OMNIBUS_PUBLIC_ORIGIN` entry a portless Kobo `Host` points at.

use axum::http::{HeaderMap, HeaderName, HeaderValue};

use super::origin_for;

fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
    pairs
        .iter()
        .map(|(name, value)| {
            (
                HeaderName::from_bytes(name.as_bytes()).unwrap(),
                HeaderValue::from_str(value).unwrap(),
            )
        })
        .collect()
}

fn origins(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

#[test]
fn origin_for_uses_the_public_origin_matching_a_portless_host() {
    // The Kobo sends `Host` without the port it is connected to (#2756).
    let public = origins(&[
        "http://localhost:3001",
        "http://192.168.1.214:3001",
        "http://192.168.1.214:3002",
    ]);

    let origin = origin_for(&headers(&[("host", "192.168.1.214")]), &public);

    assert_eq!(origin, "http://192.168.1.214:3001");
}

#[test]
fn origin_for_matches_the_host_case_insensitively() {
    let public = origins(&["http://omnibus.lan:3001"]);

    let origin = origin_for(&headers(&[("host", "Omnibus.LAN")]), &public);

    assert_eq!(origin, "http://omnibus.lan:3001");
}

#[test]
fn origin_for_drops_the_path_from_a_public_origin() {
    // Someone pasted the whole Kobo endpoint into the setting.
    let public = origins(&["http://192.168.1.214:3001/kobo/abc"]);

    let origin = origin_for(&headers(&[("host", "192.168.1.214")]), &public);

    assert_eq!(origin, "http://192.168.1.214:3001");
}

#[test]
fn origin_for_matches_the_public_origin_against_x_forwarded_host() {
    let public = origins(&["https://omnibus.example.com:8443"]);
    let req = headers(&[
        ("x-forwarded-host", "omnibus.example.com"),
        ("x-forwarded-proto", "https"),
        ("host", "127.0.0.1:3000"),
    ]);

    assert_eq!(
        origin_for(&req, &public),
        "https://omnibus.example.com:8443"
    );
}

#[test]
fn origin_for_keeps_a_request_origin_that_is_already_listed() {
    // A TLS proxy on 443 next to the direct port: the proxied request is right as sent.
    let public = origins(&["http://nas.lan:3000", "https://nas.lan"]);
    let req = headers(&[
        ("x-forwarded-host", "nas.lan"),
        ("x-forwarded-proto", "https"),
    ]);

    assert_eq!(origin_for(&req, &public), "https://nas.lan");
}

#[test]
fn origin_for_ignores_a_public_origin_without_a_port() {
    // The Kobo drops only the port, so an http-only Kobo must not be moved to https.
    let public = origins(&["https://nas.lan"]);

    let origin = origin_for(&headers(&[("host", "nas.lan")]), &public);

    assert_eq!(origin, "http://nas.lan");
}

#[test]
fn origin_for_keeps_the_request_host_when_it_carries_a_port() {
    let public = origins(&["http://192.168.1.214:3000"]);

    let origin = origin_for(&headers(&[("host", "192.168.1.214:3001")]), &public);

    assert_eq!(origin, "http://192.168.1.214:3001");
}

#[test]
fn origin_for_keeps_the_request_host_when_no_public_origin_matches() {
    let req = headers(&[("host", "omni.test")]);
    // The scheme-less entry is not an origin, so it never counts as a match.
    let public = origins(&["http://localhost:3000", "omni.test:3000"]);

    assert_eq!(origin_for(&req, &[]), "http://omni.test");
    assert_eq!(origin_for(&req, &public), "http://omni.test");
}

#[test]
fn origin_for_returns_empty_when_no_host_is_resolvable() {
    // Callers rely on "" to emit host-relative URLs instead of `http:///…`.
    let public = origins(&["http://192.168.1.214:3001"]);

    assert_eq!(origin_for(&HeaderMap::new(), &public), "");
}
