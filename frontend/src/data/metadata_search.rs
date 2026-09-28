//! Edition-picker client wrappers for the metadata-edit page: the provider
//! catalog, the fan-out search, and the detail fetch for a selected
//! candidate. Web/SSR only — the picker itself has no mobile surface, though
//! Android reaches the edit page (`book_detail/mobile.rs`) and so shares
//! [`apply_cover_from_url`]'s pasted-URL apply.

use omnibus_shared::metadata_lookup::{
    EditionSearchRequest, EditionSearchResponse, MetadataProvider, ProviderEdition, ProviderInfo,
};
use omnibus_shared::EbookMetadata;

#[cfg(not(feature = "mobile"))]
use super::note_server_fn_err;
use super::DataError;
#[cfg(feature = "mobile")]
use super::{drain_error, http_client, note_status, with_bearer};

/// Web/SSR: the provider catalog, which the picker reads to decide whether
/// to offer a search at all.
#[cfg(not(feature = "mobile"))]
pub async fn list_metadata_providers(_server_url: &str) -> Result<Vec<ProviderInfo>, DataError> {
    crate::rpc::rpc_metadata_providers()
        .await
        .map_err(note_server_fn_err)
}

/// Mobile stub — the metadata-edit page is a web-only surface.
#[cfg(feature = "mobile")]
pub async fn list_metadata_providers(_server_url: &str) -> Result<Vec<ProviderInfo>, DataError> {
    Ok(Vec::new())
}

/// Web/SSR: search every configured provider.
///
/// Takes the whole request rather than a string so the structured
/// title/author/ISBN ride along — which is what lets each provider be asked in
/// its own terms instead of being handed one flattened phrase.
#[cfg(not(feature = "mobile"))]
pub async fn search_editions(
    _server_url: &str,
    req: EditionSearchRequest,
) -> Result<EditionSearchResponse, DataError> {
    crate::rpc::rpc_search_editions(req)
        .await
        .map_err(note_server_fn_err)
}

/// Mobile stub — see [`list_metadata_providers`].
#[cfg(feature = "mobile")]
pub async fn search_editions(
    _server_url: &str,
    _req: EditionSearchRequest,
) -> Result<EditionSearchResponse, DataError> {
    Err(DataError::Other("edition search is web-only".into()))
}

/// Web/SSR: re-fetch one selected candidate in full. `Ok(None)` means the
/// provider no longer knows the candidate — the caller keeps the one it
/// already has.
///
/// `isbn13` is optional because a candidate may not have one; the handle is
/// what the re-fetch is keyed on either way.
#[cfg(not(feature = "mobile"))]
pub async fn hydrate_edition(
    _server_url: &str,
    source: MetadataProvider,
    provider_ref: &str,
    isbn13: Option<&str>,
) -> Result<Option<ProviderEdition>, DataError> {
    crate::rpc::rpc_hydrate_edition(source, provider_ref.to_string(), isbn13.map(str::to_string))
        .await
        .map_err(note_server_fn_err)
}

/// Mobile stub — see [`list_metadata_providers`].
#[cfg(feature = "mobile")]
pub async fn hydrate_edition(
    _server_url: &str,
    _source: MetadataProvider,
    _provider_ref: &str,
    _isbn13: Option<&str>,
) -> Result<Option<ProviderEdition>, DataError> {
    Err(DataError::Other("edition search is web-only".into()))
}

/// Web: apply a provider's cover by URL — `POST /api/ebooks/{uuid}/cover/from-url`.
///
/// Straight to REST via `gloo-net`, like the neighbouring cover calls in
/// `data::books::manage`, rather than through a server function: the write
/// path (fetch → sniff → `persist_cover` → thumbnail invalidation) lives in
/// the REST handler, and a server-fn analogue would have to repeat it.
///
/// `Ok(None)` when the book is gone; every refusal is an `Err` carrying the
/// server's own message, because each one names a different thing the reader
/// or the source did wrong.
#[cfg(feature = "web")]
pub async fn apply_cover_from_url(
    _server_url: &str,
    uuid: &str,
    url: &str,
) -> Result<Option<EbookMetadata>, DataError> {
    use gloo_net::http::Request;

    let res = Request::post(&format!("/api/ebooks/{uuid}/cover/from-url"))
        .json(&serde_json::json!({ "url": url }))
        .map_err(|e| DataError::Other(e.to_string()))?
        .send()
        .await
        .map_err(|e| DataError::Other(e.to_string()))?;
    if res.status() == 401 {
        crate::data::web_auth_state::notify_unauthorized();
        return Err(DataError::Unauthorized);
    }
    if res.status() == 404 {
        return Ok(None);
    }
    if !res.ok() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(DataError::Http { status, body });
    }
    res.json::<EbookMetadata>()
        .await
        .map(Some)
        .map_err(|e| DataError::Other(e.to_string()))
}

/// Android: apply a cover by URL — bearer REST to the same route the web
/// sidebar posts to, mirroring `books::manage::upload_ebook_cover`'s mobile
/// variant.
#[cfg(feature = "mobile")]
pub async fn apply_cover_from_url(
    server_url: &str,
    uuid: &str,
    url: &str,
) -> Result<Option<EbookMetadata>, DataError> {
    crate::data::require_online()?;
    let endpoint = format!("{server_url}/api/ebooks/{uuid}/cover/from-url");
    let response = with_bearer(http_client().post(&endpoint))
        .json(&serde_json::json!({ "url": url }))
        .send()
        .await?;
    let status = note_status(response.status());
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !status.is_success() {
        return Err(drain_error(response, status).await);
    }
    Ok(Some(response.json::<EbookMetadata>().await?))
}

/// SSR stub. The web sidebar's apply only fires from a client-side click, and
/// SSR never renders the control busy.
#[cfg(not(any(feature = "web", feature = "mobile")))]
pub async fn apply_cover_from_url(
    _server_url: &str,
    _uuid: &str,
    _url: &str,
) -> Result<Option<EbookMetadata>, DataError> {
    Err(DataError::Other("applying a cover is web-only".into()))
}
