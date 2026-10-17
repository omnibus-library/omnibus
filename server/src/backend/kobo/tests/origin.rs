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
    // The listing is matched without regard to the host's case.
    let mixed_case = origins(&["http://nas.lan:3000", "http://nas.lan"]);

    assert_eq!(origin_for(&req, &public), "https://nas.lan");
    assert_eq!(
        origin_for(&headers(&[("host", "NAS.lan")]), &mixed_case),
        "http://NAS.lan"
    );
}

#[test]
fn origin_for_keeps_the_request_scheme() {
    // The Kobo drops only the port, so a differently-schemed entry must not win.
    let proxied = headers(&[
        ("x-forwarded-host", "nas.lan"),
        ("x-forwarded-proto", "https"),
    ]);
    let direct = headers(&[("host", "nas.lan")]);
    let both = origins(&["http://nas.lan:3000", "https://nas.lan:8443"]);
    let both_reversed = origins(&["https://nas.lan:8443", "http://nas.lan:3000"]);

    assert_eq!(origin_for(&proxied, &both), "https://nas.lan:8443");
    assert_eq!(origin_for(&direct, &both_reversed), "http://nas.lan:3000");
    assert_eq!(
        origin_for(&direct, &origins(&["https://nas.lan"])),
        "http://nas.lan"
    );
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
