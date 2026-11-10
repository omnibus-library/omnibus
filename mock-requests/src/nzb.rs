//! NZB files for usenet releases: the fake Prowlarr links to `/nzb/{id}`, the server fetches
//! it and uploads the bytes to SABnzbd or NZBGet, and those fakes read the release id back
//! out of the upload. The id travels in the NZB's name meta because the server names the job
//! by a hash of the link, which cannot be reversed.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use omnibus_shared::ReleaseProtocol;

use crate::catalogue::is_id;
use crate::Shared;

const MARKER: &str = r#"<meta type="name">"#;

/// The route that serves a usenet release's NZB.
pub fn routes() -> Router<Shared> {
    Router::new().route("/nzb/{id}", get(serve))
}

async fn serve(State(mock): State<Shared>, Path(id): Path<String>) -> Response {
    let usenet = mock
        .store()
        .release(&id)
        .is_some_and(|r| r.protocol == ReleaseProtocol::Usenet);
    if usenet {
        ([("content-type", "application/x-nzb")], body(&id)).into_response()
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
}

/// A small NZB that names `id`.
pub fn body(id: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
 <head>{MARKER}{id}</meta></head>
 <file poster="mock" date="0" subject="{id}">
  <groups><group>alt.binaries.mock</group></groups>
  <segments><segment bytes="1" number="1">{id}@mock</segment></segments>
 </file>
</nzb>
"#
    )
}

/// The release id an uploaded NZB names, or `None` for bytes that do not carry one.
pub fn release_id(nzb: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(nzb).ok()?;
    let rest = text.split(MARKER).nth(1)?;
    let id = rest.split('<').next()?;
    is_id(id).then(|| id.to_string())
}

/// Whether `name` is `omnibus-` and 40 lowercase hex characters, the only job names the
/// server gives, so that a name taken from a request can safely be a folder.
pub fn job_name_ok(name: &str) -> bool {
    name.strip_prefix("omnibus-").is_some_and(is_id)
}

#[cfg(test)]
mod tests;
