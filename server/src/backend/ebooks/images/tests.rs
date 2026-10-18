//! Unit tests for the image-link signature: what it binds, and what a
//! signature minted for one triple must never verify as.

use super::*;

const KEY: &[u8] = &[7u8; 64];
const UUID: &str = "11111111-1111-1111-1111-111111111111";
const EXPIRES: i64 = 1_700_000_000;

fn sign(uuid: &str, href: &str, expires: i64) -> String {
    sign_image_link(KEY, uuid, href, expires).unwrap()
}

#[test]
fn sign_image_link_verifies_for_the_same_uuid_href_and_expiry() {
    let sig = sign(UUID, "images/map.png", EXPIRES);

    assert!(verify_image_link(
        KEY,
        UUID,
        "images/map.png",
        EXPIRES,
        &sig
    ));
}

#[test]
fn verify_image_link_rejects_a_different_href() {
    let sig = sign(UUID, "images/map.png", EXPIRES);

    assert!(!verify_image_link(
        KEY,
        UUID,
        "images/plate.png",
        EXPIRES,
        &sig
    ));
}

#[test]
fn verify_image_link_rejects_a_different_uuid() {
    let sig = sign(UUID, "images/map.png", EXPIRES);

    assert!(!verify_image_link(
        KEY,
        "22222222-2222-2222-2222-222222222222",
        "images/map.png",
        EXPIRES,
        &sig
    ));
}

#[test]
fn verify_image_link_rejects_a_tampered_expiry() {
    let sig = sign(UUID, "images/map.png", EXPIRES);

    assert!(!verify_image_link(
        KEY,
        UUID,
        "images/map.png",
        EXPIRES + 1,
        &sig
    ));
}

#[test]
fn verify_image_link_rejects_fields_shifted_across_the_uuid_href_boundary() {
    let sig = sign("ab", "c", EXPIRES);

    assert!(!verify_image_link(KEY, "a", "bc", EXPIRES, &sig));
}

#[test]
fn verify_image_link_rejects_a_signature_from_another_key() {
    let sig = sign_image_link(&[8u8; 64], UUID, "map.png", EXPIRES).unwrap();

    assert!(!verify_image_link(KEY, UUID, "map.png", EXPIRES, &sig));
}

#[test]
fn verify_image_link_rejects_a_signature_that_is_not_base64() {
    assert!(!verify_image_link(KEY, UUID, "map.png", EXPIRES, "***"));
}
