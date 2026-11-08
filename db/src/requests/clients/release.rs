//! What a download client is given, and the fetch that produces it. Omnibus fetches the
//! release itself, torrent or NZB, and uploads it: the client may have no route to Prowlarr,
//! and the release link carries Prowlarr's API key. Every error leaves the link out for the
//! same reason.

use std::time::Duration;

use reqwest::header::LOCATION;
use reqwest::Url;

use crate::requests::ConnectionError;

/// A torrent file is kilobytes; anything past this is not one.
pub const MAX_TORRENT_BYTES: usize = 4 * 1024 * 1024;

/// An NZB lists a release's articles; a book's is far smaller than this.
pub const MAX_NZB_BYTES: usize = 16 * 1024 * 1024;

/// How many redirects a release link may take before it is given up on.
const MAX_HOPS: usize = 3;

/// A release fetched, as a client's `add` takes it.
pub enum Release {
    Magnet(String),
    /// A `.torrent` file.
    File(Vec<u8>),
    /// An NZB file.
    Nzb(Vec<u8>),
}

/// The reason a release link was refused, as the end of "the release link ...".
pub fn rejected(why: &str) -> ConnectionError {
    ConnectionError::Rejected(format!("the release link {why}"))
}

/// What a fetch looks for: how big it may be, what to call it, whether a magnet will do.
struct Wanted {
    limit: usize,
    noun: &'static str,
    magnet_ok: bool,
}

const TORRENT: Wanted = Wanted {
    limit: MAX_TORRENT_BYTES,
    noun: "a torrent file",
    magnet_ok: true,
};

const NZB: Wanted = Wanted {
    limit: MAX_NZB_BYTES,
    noun: "an NZB file",
    magnet_ok: false,
};

/// Resolve `link` to a magnet or the torrent file it names.
pub async fn fetch_torrent(
    http: &reqwest::Client,
    link: &str,
    timeout: Duration,
) -> Result<Release, ConnectionError> {
    match fetch(http, link, timeout, &TORRENT).await? {
        Fetched::Magnet(magnet) => Ok(Release::Magnet(magnet)),
        Fetched::Bytes(bytes) => Ok(Release::File(bytes)),
    }
}

/// Resolve `link` to the NZB file it names.
pub async fn fetch_nzb(
    http: &reqwest::Client,
    link: &str,
    timeout: Duration,
) -> Result<Release, ConnectionError> {
    match fetch(http, link, timeout, &NZB).await? {
        Fetched::Magnet(_) => Err(rejected("is a magnet, not an NZB")),
        Fetched::Bytes(bytes) => Ok(Release::Nzb(bytes)),
    }
}

enum Fetched {
    Magnet(String),
    Bytes(Vec<u8>),
}

/// Follow up to [`MAX_HOPS`] redirects ourselves, since [`crate::requests::http_client`]
/// follows none, and read the body under `wanted.limit`.
async fn fetch(
    http: &reqwest::Client,
    link: &str,
    timeout: Duration,
    wanted: &Wanted,
) -> Result<Fetched, ConnectionError> {
    let mut url = Url::parse(link).map_err(|_| rejected("is not a URL"))?;
    for _ in 0..=MAX_HOPS {
        if url.scheme() == "magnet" && wanted.magnet_ok {
            return Ok(Fetched::Magnet(url.into()));
        }
        if !matches!(url.scheme(), "http" | "https") {
            return Err(rejected("is not a web address"));
        }
        let response = http
            .get(url.clone())
            .timeout(timeout)
            .send()
            .await
            .map_err(|e| ConnectionError::from_transport(&e))?;
        let status = response.status();
        if status.is_redirection() {
            url = response
                .headers()
                .get(LOCATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|l| url.join(l).ok())
                .ok_or_else(|| rejected("redirected nowhere"))?;
            continue;
        }
        if !status.is_success() {
            return Err(rejected(&format!("answered {status}")));
        }
        let too_large = || rejected(&format!("is too large to be {}", wanted.noun));
        if response.content_length().unwrap_or(0) as usize > wanted.limit {
            return Err(too_large());
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|e| ConnectionError::from_transport(&e))?;
        if bytes.len() > wanted.limit {
            return Err(too_large());
        }
        return Ok(Fetched::Bytes(bytes.to_vec()));
    }
    Err(rejected("redirected too many times"))
}
