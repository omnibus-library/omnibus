//! Unit tests for `ebook::accent` — exercises the cover-accent extractor
//! across the happy path (saturated PNG → clamped OKLCH string), the
//! decoder-rejection paths (empty, corrupt, oversized bytes), the
//! achromatic short-circuits (pure black, pure gray), and a perf-budget
//! guard that catches multi-second regressions on realistic cover sizes.

use super::*;
use crate::ebook::test_support::*;

// ── F1.7 accent extraction ─────────────────────────────────────────

#[test]
fn extract_accent_returns_oklch_for_saturated_cover() {
    let bytes = solid_color_png(200, 60, 50, 64, 96);
    let accent = extract_accent(&bytes).expect("saturated cover yields accent");
    assert!(
        accent.starts_with("oklch("),
        "accent should be an oklch() string, got {accent}"
    );
    // Clamps in extract_accent require the L value to stay readable.
    let mid = accent
        .trim_start_matches("oklch(")
        .trim_end_matches(')')
        .split_whitespace()
        .next()
        .unwrap()
        .parse::<f32>()
        .unwrap();
    assert!(
        (0.55..=0.78).contains(&mid),
        "lightness {mid} should be clamped to [0.55, 0.78]"
    );
}

#[test]
fn extract_accent_returns_none_for_empty_bytes() {
    assert!(extract_accent(&[]).is_none());
}

#[test]
fn extract_accent_returns_none_for_corrupt_bytes() {
    assert!(extract_accent(b"not an image, just text").is_none());
}

#[test]
fn extract_accent_returns_none_for_oversized_bytes() {
    // Start from a *valid* cover that decodes to an accent on its own, so
    // the only thing keeping the oversized case out of the decoder is the
    // size guard. (All-zero bytes would fail to decode regardless, which
    // wouldn't catch a regression that removed the guard.)
    let mut bytes = solid_color_png(200, 60, 50, 64, 96);
    assert!(
        extract_accent(&bytes).is_some(),
        "sanity: the unpadded cover should decode to an accent"
    );
    // Pad past the cap with trailing bytes the PNG decoder ignores (it
    // stops at IEND). Without the guard these would still decode and
    // yield Some, so this assertion fails if the cap check is removed.
    bytes.resize(MAX_EMBEDDED_COVER_BYTES + 1, 0);
    assert!(
        extract_accent(&bytes).is_none(),
        "oversized cover bytes should be rejected by the size guard before decoding"
    );
}

#[test]
fn extract_accent_returns_none_for_pure_black() {
    let bytes = solid_color_png(0, 0, 0, 64, 96);
    assert!(
        extract_accent(&bytes).is_none(),
        "all-black cover should produce no accent"
    );
}

#[test]
fn extract_accent_returns_none_for_pure_gray() {
    let bytes = solid_color_png(128, 128, 128, 64, 96);
    assert!(
        extract_accent(&bytes).is_none(),
        "grayscale cover should produce no accent (no chroma)"
    );
}

#[test]
fn extract_accent_completes_within_budget() {
    // Real EPUB covers top out around 1500×2250. Test against that size
    // with a generous debug-mode budget — release builds run ~3× faster.
    // The point of the test is to catch a regression to seconds, not to
    // hold a tight production-grade budget in unoptimized builds. GitHub
    // Actions ubuntu-latest runners have measurably slower per-core
    // throughput than developer workstations and can spend 600–700 ms on
    // this input in debug builds, so the threshold is set to 2 s — any
    // multi-second regression still trips it.
    let bytes = solid_color_png(80, 140, 200, 1500, 2250);
    let start = std::time::Instant::now();
    let _ = extract_accent(&bytes);
    let elapsed = start.elapsed();
    assert!(
        elapsed < std::time::Duration::from_secs(2),
        "extract_accent must stay well under multiple seconds on realistic input; took {elapsed:?}"
    );
}

// ── cover palette ──────────────────────────────────────────────────

const NEAR_BLACK: [u8; 3] = [20, 20, 20];
const RED: [u8; 3] = [200, 40, 40];
const BLUE: [u8; 3] = [40, 60, 160];
const GREEN: [u8; 3] = [30, 120, 60];
const WHITE: [u8; 3] = [255, 255, 255];
const CREAM: [u8; 3] = [240, 230, 215];

fn hex_rgb(hex: &str) -> [f32; 3] {
    let n = u32::from_str_radix(hex.trim_start_matches('#'), 16).expect("hex digits");
    [
        ((n >> 16) & 0xff) as f32 / 255.0,
        ((n >> 8) & 0xff) as f32 / 255.0,
        (n & 0xff) as f32 / 255.0,
    ]
}

fn ink_rgb(ink: CoverInk) -> [f32; 3] {
    hex_rgb(match ink {
        CoverInk::Light => LIGHT_INK,
        CoverInk::Dark => DARK_INK,
    })
}

#[test]
fn extract_cover_palette_returns_darkest_pair_first_with_lowercase_hex_for_a_striped_cover() {
    let bytes = striped_png(&[RED, NEAR_BLACK, BLUE], 64, 96);
    let pairs = extract_cover_palette(&bytes);

    assert_eq!(pairs.len(), 2, "near-black → blue → red makes two pairs");
    assert_eq!(pairs[0].to, pairs[1].from, "pairs chain through neighbours");
    for hex in pairs.iter().flat_map(|p| [&p.from, &p.to]) {
        assert_eq!(hex.len(), 7);
        assert!(hex.starts_with('#'));
        assert_eq!(hex.as_str(), hex.to_lowercase());
    }
    let lum = |hex: &String| relative_luminance(hex_rgb(hex));
    assert!(lum(&pairs[0].from) < lum(&pairs[0].to));
    assert!(lum(&pairs[0].to) < lum(&pairs[1].to));
}

#[test]
fn extract_cover_palette_picks_an_ink_that_reaches_4_5_to_1_on_both_stops() {
    let bytes = striped_png(&[CREAM, WHITE, RED, NEAR_BLACK, BLUE], 64, 100);
    let pairs = extract_cover_palette(&bytes);

    assert!(!pairs.is_empty());
    for pair in &pairs {
        let ink = relative_luminance(ink_rgb(pair.ink));
        for stop in [&pair.from, &pair.to] {
            let ratio = contrast_ratio(ink, relative_luminance(hex_rgb(stop)));
            assert!(ratio >= 4.5, "{:?} on {stop} is only {ratio}", pair.ink);
        }
    }
}

#[test]
fn extract_cover_palette_picks_dark_ink_for_a_pale_pair() {
    let bytes = striped_png(&[CREAM, WHITE], 64, 96);
    let pairs = extract_cover_palette(&bytes);

    assert_eq!(pairs.len(), 1);
    assert_eq!(pairs[0].ink, CoverInk::Dark);
}

#[test]
fn extract_cover_palette_drops_a_pair_neither_ink_can_read_on() {
    let bytes = striped_png(&[[0, 0, 0], RED, WHITE], 64, 96);
    let pairs = extract_cover_palette(&bytes);

    assert_eq!(pairs.len(), 1, "red → white has no ink that reads on both");
    assert!(relative_luminance(hex_rgb(&pairs[0].to)) < 0.5);
}

#[test]
fn extract_cover_palette_returns_at_most_four_pairs() {
    let bytes = striped_png(&[NEAR_BLACK, RED, BLUE, GREEN, WHITE, CREAM], 64, 96);

    // Five colours make four neighbours; red → white is the one no ink reads on.
    assert_eq!(extract_cover_palette(&bytes).len(), 3);
}

#[test]
fn extract_cover_palette_returns_no_pairs_for_a_single_colour_cover() {
    let bytes = solid_color_png(200, 60, 50, 64, 96);

    assert!(extract_cover_palette(&bytes).is_empty());
}

#[test]
fn extract_cover_palette_returns_no_pairs_for_corrupt_bytes() {
    assert!(extract_cover_palette(b"not an image, just text").is_empty());
}
