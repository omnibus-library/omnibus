//! Cover-accent color extraction: decodes cover bytes, bins pixels into hue
//! buckets, and returns one representative `oklch(L C H)` accent string. Called
//! from [`super::parse`] so the indexer can persist it alongside the cover; the
//! same bucketing also yields a cover's gradient pairs for the quote card.

use omnibus_shared::{CoverInk, CoverPair};

/// Hard cap on embedded cover bytes we'll hand to the `image` decoder.
/// Higher than the 10 MiB HTTP cap in `author_photos` because these are
/// trusted local files; 20 MiB still covers uncompressed print-resolution
/// covers while bounding the decode allocation against a crafted EPUB.
pub(crate) const MAX_EMBEDDED_COVER_BYTES: usize = 20 * 1024 * 1024;

/// Extract a representative accent color from cover bytes. Returns an
/// `oklch(L C H)` string clamped to a readable band, or `None` when decoding
/// fails or the cover has no chromatic content. The algorithm hue-buckets
/// the pixels, picks the highest-weighted bucket, and converts to OKLCH —
/// see `docs/design/atrium-design-system.md` §2b for the rationale.
pub fn extract_accent(bytes: &[u8]) -> Option<String> {
    let small = decode_thumbnail(bytes)?;
    let mut buckets = [AccentBucket::default(); 12];
    for px in small.pixels() {
        add_to_bucket(&mut buckets, to_unit_rgb(px));
    }

    let best = buckets.iter().max_by(|a, b| a.w.total_cmp(&b.w))?;
    if best.w == 0.0 {
        return None;
    }
    let [r, g, b] = best.mean();
    let (l, c, h) = rgb_to_oklch(r, g, b);
    let l = l.clamp(0.55, 0.78);
    let c = c.clamp(0.06, 0.18);
    Some(format!("oklch({l:.3} {c:.3} {h:.1})"))
}

/// Derive up to four gradient pairs from cover bytes: the top chromatic hue
/// buckets plus a dark and a light neutral, sorted by luminance and paired with
/// their neighbours. Each pair carries the ink that reads on both stops; a pair
/// no ink reads on is dropped. An undecodable cover yields no pairs.
pub fn extract_cover_palette(bytes: &[u8]) -> Vec<CoverPair> {
    let Some(small) = decode_thumbnail(bytes) else {
        return Vec::new();
    };
    let mut buckets = [AccentBucket::default(); 12];
    let mut dark = Neutral::default();
    let mut light = Neutral::default();
    for px in small.pixels() {
        let rgb = to_unit_rgb(px);
        if add_to_bucket(&mut buckets, rgb) {
            continue;
        }
        if rgb.iter().copied().fold(0.0, f32::max) < 0.5 {
            dark.add(rgb);
        } else {
            light.add(rgb);
        }
    }

    let mut ranked: Vec<&AccentBucket> = buckets.iter().filter(|b| b.w > 0.0).collect();
    ranked.sort_by(|a, b| b.w.total_cmp(&a.w));
    let total = small.pixels().len() as f32;
    let mut colors: Vec<[f32; 3]> = ranked.iter().take(3).map(|b| b.mean()).collect();
    colors.extend([dark, light].iter().filter_map(|n| n.mean_if_over(total)));
    colors.sort_by(|a, b| relative_luminance(*a).total_cmp(&relative_luminance(*b)));

    colors
        .windows(2)
        .filter_map(|w| pair_with_ink(w[0], w[1]))
        .take(MAX_PAIRS)
        .collect()
}

const MAX_PAIRS: usize = 4;
/// A neutral colour joins the palette once it holds this share of the pixels.
const NEUTRAL_MIN_SHARE: f32 = 0.05;
const MIN_INK_CONTRAST: f32 = 4.5;
const LIGHT_INK: &str = "#f5f0e8";
const DARK_INK: &str = "#221d18";

fn decode_thumbnail(bytes: &[u8]) -> Option<image::RgbImage> {
    if bytes.is_empty() || bytes.len() > MAX_EMBEDDED_COVER_BYTES {
        return None;
    }
    let img = image::load_from_memory(bytes).ok()?;
    Some(img.thumbnail(32, 48).to_rgb8())
}

fn to_unit_rgb(px: &image::Rgb<u8>) -> [f32; 3] {
    [
        px[0] as f32 / 255.0,
        px[1] as f32 / 255.0,
        px[2] as f32 / 255.0,
    ]
}

/// Bin a pixel into its 30° hue bucket, weighted by saturation × value.
/// Returns false for the near-black and near-grayscale pixels that are
/// filtered out so they don't overwhelm the actual artwork color.
fn add_to_bucket(buckets: &mut [AccentBucket; 12], [r, g, b]: [f32; 3]) -> bool {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;
    if max < 0.10 || delta < 0.06 {
        return false;
    }
    let hue = if delta == 0.0 {
        0.0
    } else if (max - r).abs() < f32::EPSILON {
        60.0 * (((g - b) / delta).rem_euclid(6.0))
    } else if (max - g).abs() < f32::EPSILON {
        60.0 * ((b - r) / delta + 2.0)
    } else {
        60.0 * ((r - g) / delta + 4.0)
    };
    let sat = if max == 0.0 { 0.0 } else { delta / max };
    let weight = sat * max;
    // `hue` is in [0.0, 360.0) from the HSV formula above, so the
    // floored quotient is a small non-negative integer (≤ 12)
    // before `.min(11)` clamps it into the bucket array.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let idx = ((hue / 30.0).floor() as usize).min(11);
    buckets[idx].r += r * weight;
    buckets[idx].g += g * weight;
    buckets[idx].b += b * weight;
    buckets[idx].w += weight;
    true
}

#[derive(Default, Clone, Copy)]
struct AccentBucket {
    r: f32,
    g: f32,
    b: f32,
    w: f32,
}

impl AccentBucket {
    fn mean(&self) -> [f32; 3] {
        [self.r / self.w, self.g / self.w, self.b / self.w]
    }
}

/// Running sum of the achromatic pixels on one side of mid-brightness.
#[derive(Default)]
struct Neutral {
    sum: [f32; 3],
    count: f32,
}

impl Neutral {
    fn add(&mut self, rgb: [f32; 3]) {
        for (s, v) in self.sum.iter_mut().zip(rgb) {
            *s += v;
        }
        self.count += 1.0;
    }

    fn mean_if_over(&self, total: f32) -> Option<[f32; 3]> {
        (self.count >= total * NEUTRAL_MIN_SHARE).then(|| self.sum.map(|s| s / self.count))
    }
}

/// WCAG relative luminance of non-linear sRGB in [0, 1].
fn relative_luminance([r, g, b]: [f32; 3]) -> f32 {
    0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

/// WCAG contrast ratio between two relative luminances.
fn contrast_ratio(a: f32, b: f32) -> f32 {
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}

fn hex_to_unit(hex: &str) -> [f32; 3] {
    let n = u32::from_str_radix(&hex[1..], 16).unwrap_or(0);
    [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map(|v| v as f32 / 255.0)
}

fn to_hex([r, g, b]: [f32; 3]) -> String {
    // Values are in [0, 1], so the rounded product fits a u8.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let byte = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{:02x}{:02x}{:02x}", byte(r), byte(g), byte(b))
}

/// Pair two stops (`from` darker) with whichever ink holds the better worst-case
/// contrast over both; `None` when even that falls short of [`MIN_INK_CONTRAST`].
fn pair_with_ink(from: [f32; 3], to: [f32; 3]) -> Option<CoverPair> {
    // Measure the colours as emitted, so the 4.5:1 holds for the hex a client reads.
    let (low, high) = (to_hex(from), to_hex(to));
    let stops = [&low, &high].map(|hex| relative_luminance(hex_to_unit(hex)));
    let worst = |ink: &str| {
        let lum = relative_luminance(hex_to_unit(ink));
        stops
            .iter()
            .map(|s| contrast_ratio(lum, *s))
            .fold(f32::INFINITY, f32::min)
    };
    let (light, dark) = (worst(LIGHT_INK), worst(DARK_INK));
    let (ink, best) = if light >= dark {
        (CoverInk::Light, light)
    } else {
        (CoverInk::Dark, dark)
    };
    (best >= MIN_INK_CONTRAST).then_some(CoverPair {
        from: low,
        to: high,
        ink,
    })
}

/// sRGB channel in [0, 1] to linear light.
fn linearize(v: f32) -> f32 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

/// Convert non-linear sRGB in [0, 1] to OKLCH. Matrix from Björn Ottosson,
/// <https://bottosson.github.io/posts/oklab/>. Returns `(L, C, H°)`.
fn rgb_to_oklch(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    // OKLab matrix coefficients (Björn Ottosson). Truncated to f32 precision
    // — clippy's `excessive_precision` lint flags the full 10-digit form,
    // and the extra digits don't survive `f32` round-off anyway.
    let r = linearize(r);
    let g = linearize(g);
    let b = linearize(b);
    let l = 0.412_221_47 * r + 0.536_332_54 * g + 0.051_445_995 * b;
    let m = 0.211_903_5 * r + 0.680_699_5 * g + 0.107_396_96 * b;
    let s = 0.088_302_46 * r + 0.281_718_85 * g + 0.629_978_7 * b;
    let l_ = l.cbrt();
    let m_ = m.cbrt();
    let s_ = s.cbrt();
    let big_l = 0.210_454_26 * l_ + 0.793_617_8 * m_ - 0.004_072_047 * s_;
    let a = 1.977_998_5 * l_ - 2.428_592_2 * m_ + 0.450_593_7 * s_;
    let b_oklab = 0.025_904_037 * l_ + 0.782_771_77 * m_ - 0.808_675_77 * s_;
    let c = (a * a + b_oklab * b_oklab).sqrt();
    let mut h = b_oklab.atan2(a).to_degrees();
    if h < 0.0 {
        h += 360.0;
    }
    (big_l, c, h)
}

#[cfg(test)]
mod tests;
