//! Covers the way the firmware caches them: per `(ImageId, width, height)`,
//! decoded once and never revalidated, so a cover change under an unchanged
//! `CoverImageId` is never refetched ([`crate::firmware::Quirk::CoverCache`]).
//! Only JPEG and PNG decode; anything else caches as [`Cover::Undecodable`]
//! ([`crate::firmware::Quirk::CoverDecode`]).

use serde::{Deserialize, Serialize};

use crate::client::Client;
use crate::device::Device;
use crate::firmware::{COVER_QUALITY, COVER_SIZES, SHOWN_COVER_SIZE};

/// A cover's cached shape, or that it couldn't be rendered at all.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Cover {
    Jpeg,
    Png,
    Undecodable,
}

const JPEG_MAGIC: &[u8] = &[0xFF, 0xD8, 0xFF];
const PNG_MAGIC: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

/// Decode one cover response the way the firmware does: a cover renders only
/// when its content type (essence, case-insensitive) and magic bytes name
/// the same format; anything else, including a mismatched pair, is undecodable.
pub fn decode(content_type: Option<&str>, bytes: &[u8]) -> Cover {
    let essence = content_type
        .and_then(|value| value.split(';').next())
        .map(|value| value.trim().to_ascii_lowercase());
    match essence.as_deref() {
        Some("image/jpeg") if bytes.starts_with(JPEG_MAGIC) => Cover::Jpeg,
        Some("image/png") if bytes.starts_with(PNG_MAGIC) => Cover::Png,
        _ => Cover::Undecodable,
    }
}

/// The cache key one `(ImageId, size)` cover decodes under.
fn cache_key(image_id: &str, (width, height): (u32, u32)) -> String {
    format!("{image_id}@{width}x{height}")
}

/// Fetch every book's covers not yet cached, at each of [`COVER_SIZES`] in
/// order, through `template`. A non-2xx answer, or no answer at all, is not
/// cached and never fails the sync — the next sync asks for it again. Each
/// book's shown cover is set from the cache afterwards, whether freshly
/// fetched this sync or already held from before.
pub async fn fetch_covers(client: &mut Client, device: &mut Device, template: &str) {
    let uuids: Vec<String> = device.library.keys().cloned().collect();
    for uuid in uuids {
        let image_id = device.library[&uuid].cover_image_id.clone();
        if image_id.is_empty() {
            continue;
        }
        for size in COVER_SIZES {
            fetch_one(client, device, &image_id, size, template).await;
        }
        let shown = device
            .covers
            .get(&cache_key(&image_id, SHOWN_COVER_SIZE))
            .copied();
        if let Some(book) = device.library.get_mut(&uuid) {
            book.cover = shown;
        }
    }
}

/// Fetch and cache one `(image_id, size)` cover, unless it is already cached.
async fn fetch_one(
    client: &mut Client,
    device: &mut Device,
    image_id: &str,
    size: (u32, u32),
    template: &str,
) {
    let key = cache_key(image_id, size);
    if device.covers.contains_key(&key) {
        return;
    }
    let url = fill_template(template, image_id, size);
    let Ok(response) = client.cover(&url).await else {
        return;
    };
    if !response.status().is_success() {
        return;
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let Ok(bytes) = response.bytes().await else {
        return;
    };
    device
        .covers
        .insert(key, decode(content_type.as_deref(), &bytes));
}

/// Fill `image_url_quality_template`'s placeholders for one cover request.
fn fill_template(template: &str, image_id: &str, (width, height): (u32, u32)) -> String {
    template
        .replace("{ImageId}", image_id)
        .replace("{Width}", &width.to_string())
        .replace("{Height}", &height.to_string())
        .replace("{Quality}", &COVER_QUALITY.to_string())
        .replace("{IsGreyscale}", "false")
}

#[cfg(test)]
mod tests;
