//! The terms a cover is fetched under — a provider catalog cover, or a
//! reader-pasted URL.
//!
//! Applying a cover means the server fetching a client-supplied URL, which is
//! a textbook SSRF gadget aimed at the server's own network. A provider host
//! gets the allowlisted terms — [`super::cover_hosts`], the same list the
//! `img-src` CSP is built from, so a host the picker can render is exactly a
//! host a cover can be applied from. Any other host gets the pasted terms:
//! no allowlist, HTTPS only, the address gate on every hop.
//! [`cover_image_config_for`] is the split.

use crate::author_photos::{fetch_remote_image_with, FetchRemoteImageError, RemoteImageConfig};

use super::providers::googlebooks;

/// Redirect hops allowed when fetching a provider cover. Not zero: Open
/// Library's cover CDN 302s to `archive.org`, which 302s again to the node
/// holding the file. Every hop is re-checked against the same scheme and
/// allowlist gates as the original URL.
pub const MAX_COVER_REDIRECTS: u8 = 4;

/// The fetch config for a provider cover: HTTPS only, hosts limited to the
/// provider catalog's, and a bounded redirect follow. Production callers pass
/// `allow_private_addresses = false`; it exists so a test can point the fetch at
/// a loopback `wiremock` origin, and every other gate applies either way.
pub fn provider_cover_image_config(allow_private_addresses: bool) -> RemoteImageConfig {
    RemoteImageConfig {
        allow_private_addresses,
        host_allowlist: super::all_cover_hosts()
            .into_iter()
            .map(str::to_string)
            .collect(),
        require_https: true,
        max_redirects: MAX_COVER_REDIRECTS,
    }
}

/// Route a cover URL to the terms it should fetch under: the provider
/// catalog's allowlisted terms for a catalog host, or the pasted terms —
/// [`provider_cover_image_config`] with the allowlist dropped, the address
/// gate on every hop the only remaining control — for anything else.
pub fn cover_image_config_for(url: &str, allow_private_addresses: bool) -> RemoteImageConfig {
    let provider_config = provider_cover_image_config(allow_private_addresses);
    let is_provider_host = reqwest::Url::parse(url)
        .ok()
        .and_then(|parsed| {
            parsed
                .host_str()
                .map(|host| provider_config.host_allowed(host))
        })
        .unwrap_or(true);
    if is_provider_host {
        provider_config
    } else {
        RemoteImageConfig {
            host_allowlist: Vec::new(),
            ..provider_config
        }
    }
}

/// How far a high-resolution candidate's aspect ratio may drift from the
/// thumbnail's before it is judged a different picture. Measured across 18
/// volumes: genuine covers matched within 2.6%, placeholders missed by 5.4% or
/// more, and the threshold sits in that gap.
const COVER_ASPECT_TOLERANCE: f64 = 0.04;

/// Fetch a provider cover, taking the highest resolution that is provably the
/// same picture. Only Google Books differs from [`fetch_remote_image_with`]: it
/// publishes 128px thumbnails, and a volume with no full art answers **200 with
/// a placeholder**, so the full-size bytes are compared with the thumbnail,
/// which is kept if they disagree. Both fetches run under the caller's `config`.
pub async fn fetch_provider_cover(
    url: &str,
    config: &RemoteImageConfig,
) -> Result<(String, Vec<u8>), FetchRemoteImageError> {
    let Some(upgraded_url) = googlebooks::upgrade_cover_url(url) else {
        return fetch_remote_image_with(url, config).await;
    };

    let (thumbnail, upgraded) = tokio::join!(
        fetch_remote_image_with(url, config),
        fetch_remote_image_with(&upgraded_url, config),
    );
    let thumbnail = thumbnail?;

    // Best-effort by construction: the thumbnail is a real cover, so anything
    // that goes wrong reaching for a bigger one is a reason to keep what we
    // already have rather than to fail the reader's apply.
    let Ok(upgraded) = upgraded else {
        return Ok(thumbnail);
    };
    if is_larger_rendition(&thumbnail.1, &upgraded.1) {
        Ok(upgraded)
    } else {
        Ok(thumbnail)
    }
}

/// Whether `candidate` is a bigger rendition of `thumbnail` rather than a
/// different image, judged by aspect ratio: a rendition keeps its shape and a
/// substituted placeholder does not. Undecodable bytes on either side answer
/// `false`, keeping the thumbnail.
fn is_larger_rendition(thumbnail: &[u8], candidate: &[u8]) -> bool {
    let (Some((tw, th)), Some((cw, ch))) = (dimensions(thumbnail), dimensions(candidate)) else {
        return false;
    };
    // No point paying for a second image that is not actually bigger.
    if cw <= tw {
        return false;
    }
    let (Some(thumb_ratio), Some(cand_ratio)) = (ratio(tw, th), ratio(cw, ch)) else {
        return false;
    };
    (thumb_ratio - cand_ratio).abs() / thumb_ratio <= COVER_ASPECT_TOLERANCE
}

/// Width-over-height, or `None` for a zero dimension a decoder should never
/// have produced.
fn ratio(width: u32, height: u32) -> Option<f64> {
    (width > 0 && height > 0).then(|| f64::from(width) / f64::from(height))
}

/// Pixel dimensions from an image header, without decoding the pixels.
pub(crate) fn dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()
}

#[cfg(test)]
mod tests {
    use omnibus_shared::metadata_lookup::MetadataProvider;

    use super::*;
    use crate::metadata_lookup::{all_cover_hosts, cover_hosts};

    #[test]
    fn provider_cover_config_allows_every_host_the_catalog_publishes() {
        let config = provider_cover_image_config(false);
        for provider in MetadataProvider::ALL.iter().copied() {
            for host in cover_hosts(provider) {
                assert!(
                    config.host_allowlist.iter().any(|h| h == host),
                    "{host} renders in the picker but could not be applied"
                );
            }
        }
    }

    #[test]
    fn provider_cover_config_is_https_only_and_follows_a_bounded_number_of_hops() {
        let config = provider_cover_image_config(false);
        assert!(config.require_https);
        assert!(!config.allow_private_addresses);
        // Two is the real requirement (Open Library's double redirect); the
        // assertion is that it is bounded, not that it is generous.
        assert!(config.max_redirects >= 2);
        assert!(config.max_redirects <= 8);
    }

    #[test]
    fn cover_image_config_for_routes_a_catalog_host_to_the_provider_terms() {
        for url in [
            "https://books.google.com/books/content?id=x&zoom=1",
            "https://covers.openlibrary.org/b/id/1-L.jpg",
            "https://ia800505.us.archive.org/x.jpg",
        ] {
            let config = cover_image_config_for(url, false);
            assert_eq!(
                config.host_allowlist,
                all_cover_hosts()
                    .into_iter()
                    .map(str::to_string)
                    .collect::<Vec<_>>(),
                "{url} should route to the provider terms"
            );
        }
    }

    #[test]
    fn cover_image_config_for_routes_any_other_host_to_the_pasted_terms() {
        let config = cover_image_config_for("https://images.example.com/c.jpg", false);
        assert!(config.host_allowlist.is_empty());
        assert!(config.require_https);
        assert!(!config.allow_private_addresses);
        assert_eq!(config.max_redirects, MAX_COVER_REDIRECTS);
    }

    /// A blank JPEG of the given size — `is_larger_rendition` reads the header
    /// only, so the pixels are irrelevant and the shape is the whole fixture.
    fn jpeg(width: u32, height: u32) -> Vec<u8> {
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(image::RgbImage::new(width, height))
            .write_to(&mut out, image::ImageFormat::Jpeg)
            .expect("encode fixture");
        out.into_inner()
    }

    // The dimensions below are measured from Google Books, not invented: the
    // thumbnail is what `imageLinks` publishes, and each candidate is what the
    // upgraded URL actually returned for some volume.

    #[test]
    fn is_larger_rendition_accepts_the_full_size_art_for_the_same_cover() {
        // Dune: 128x192 thumbnail, 1749x2694 original. A 2.6% ratio drift,
        // which is JPEG-era rounding rather than a different picture.
        assert!(is_larger_rendition(&jpeg(128, 192), &jpeg(1749, 2694)));
    }

    #[test]
    fn is_larger_rendition_rejects_the_image_not_available_placeholder() {
        // The commonest substitution: 11 of 18 sampled volumes answered the
        // upgraded URL with this one card, byte-identical, at a 200.
        assert!(!is_larger_rendition(&jpeg(128, 192), &jpeg(575, 750)));
    }

    #[test]
    fn is_larger_rendition_rejects_the_redacted_cover_skeleton() {
        // A second placeholder, and the reason file size cannot be the signal:
        // this one is a 246 KB drawing, far heavier than a real small cover.
        assert!(!is_larger_rendition(&jpeg(128, 198), &jpeg(575, 829)));
    }

    #[test]
    fn is_larger_rendition_rejects_a_candidate_that_is_no_bigger() {
        // Nothing gained, and a second fetch already spent.
        assert!(!is_larger_rendition(&jpeg(128, 192), &jpeg(128, 192)));
        assert!(!is_larger_rendition(&jpeg(800, 1200), &jpeg(575, 863)));
    }

    #[test]
    fn is_larger_rendition_rejects_bytes_it_cannot_decode() {
        // "Can't tell" resolves to keeping the thumbnail, which is known good.
        assert!(!is_larger_rendition(&jpeg(128, 192), b"not an image"));
        assert!(!is_larger_rendition(b"not an image", &jpeg(800, 1200)));
    }

    #[test]
    fn ratio_refuses_a_zero_dimension() {
        assert_eq!(ratio(0, 100), None);
        assert_eq!(ratio(100, 0), None);
    }
}
