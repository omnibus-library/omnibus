//! The retired star-rating transport (mobile). Nothing writes ratings any
//! more — the book page writes reviews — but a device that upgraded with a
//! rating op still queued replays it through these two calls.

use omnibus_shared::{RatingRecord, RatingUpdate};

use super::{drain_error, http_client, note_status, with_bearer, DataError};

/// POST `/api/ratings` — replays a queued rating set.
pub(crate) async fn set_rating_online(
    server_url: &str,
    update: RatingUpdate,
) -> Result<RatingRecord, DataError> {
    let url = format!("{server_url}/api/ratings");
    let response = with_bearer(http_client().post(&url).json(&update))
        .send()
        .await?;
    let status = note_status(response.status());
    if !status.is_success() {
        return Err(drain_error(response, status).await);
    }
    Ok(response.json::<RatingRecord>().await?)
}

/// DELETE `/api/ratings/{uuid}` — replays a queued rating clear.
pub(crate) async fn clear_rating_online(server_url: &str, uuid: &str) -> Result<(), DataError> {
    let url = format!("{server_url}/api/ratings/{uuid}");
    let response = with_bearer(http_client().delete(&url)).send().await?;
    let status = note_status(response.status());
    if !status.is_success() {
        return Err(drain_error(response, status).await);
    }
    Ok(())
}
