//! Admin REST handlers for notification connections: list, create, replace, switch and
//! delete them, and send a test message with saved or unsaved settings. Connections are general, so
//! unlike the request connections these routes answer whatever the book-requests flag says;
//! the flag only decides which events the list offers. No response carries a saved secret.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{
    self as db,
    notify::{self, ConnectionSettings, NotifyError},
};
use omnibus_shared::{
    NotificationConnection, NotificationConnectionEnabled, NotificationConnectionInput,
    NotificationConnections, NotificationEvent, NotificationTest,
};

use crate::auth::AdminUser;

use super::{internal, AppState};

/// List notification connections
///
/// Every notification connection, sorted by name, each with how its last finished
/// notification went, and the events this server offers now. Tokens and passwords are
/// never returned; `token_set` and `password_set` say whether one is saved. Needs an admin
/// account.
#[utoipa::path(
    get,
    path = "/api/admin/notifications/connections",
    tag = "Admin",
    operation_id = "list_notification_connections",
    responses(
        (status = 200, description = "The connections and the events on offer.", body = NotificationConnections),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn list_connections(_admin: AdminUser, State(state): State<AppState>) -> Response {
    match notify::list_connections(&state.pool).await {
        Ok(connections) => Json(NotificationConnections {
            connections,
            available_events: available_events(&state),
        })
        .into_response(),
        Err(e) => internal("list notification connections", e),
    }
}

/// Create a notification connection
///
/// Saves a new connection. A token or password left out is simply not set. Needs an admin
/// account.
#[utoipa::path(
    post,
    path = "/api/admin/notifications/connections",
    tag = "Admin",
    operation_id = "create_notification_connection",
    request_body = NotificationConnectionInput,
    responses(
        (status = 201, description = "The connection is saved; the body is what is now set.", body = NotificationConnection),
        (status = 403, description = "You aren't an admin."),
        (status = 422, description = "A field isn't valid, such as a blank name, a topic with other characters, or `token` auth without a token; the body says which."),
    ),
)]
pub(super) async fn create_connection(
    _admin: AdminUser,
    State(state): State<AppState>,
    Json(input): Json<NotificationConnectionInput>,
) -> Response {
    match notify::create_connection(&state.pool, &input).await {
        Ok(connection) => (StatusCode::CREATED, Json(connection)).into_response(),
        Err(e) => error_response("create a notification connection", e),
    }
}

/// Replace a notification connection
///
/// Replaces every field of a saved connection. A token or password left out or null keeps
/// the saved one, and an empty string clears it; switching `auth` drops the old mode's
/// secrets. A saved secret is kept only for the address it was saved for: when
/// `server_url` changes, or for a password the `username`, it must be given again. To switch
/// a connection on or off, use `PATCH` on the same path, which changes nothing else. Needs an
/// admin account.
#[utoipa::path(
    put,
    path = "/api/admin/notifications/connections/{id}",
    tag = "Admin",
    operation_id = "update_notification_connection",
    params(("id" = i64, Path, description = "The connection's id.")),
    request_body = NotificationConnectionInput,
    responses(
        (status = 200, description = "The connection is saved; the body is what is now set.", body = NotificationConnection),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "No connection has that id."),
        (status = 422, description = "A field isn't valid, or the change leaves `token` or `basic` auth without its secret, such as a saved one left out after `server_url` changed; the body says which. Nothing is saved."),
    ),
)]
pub(super) async fn update_connection(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(input): Json<NotificationConnectionInput>,
) -> Response {
    match notify::update_connection(&state.pool, id, &input).await {
        Ok(connection) => Json(connection).into_response(),
        Err(e) => error_response("update a notification connection", e),
    }
}

/// Turn a notification connection on or off
///
/// Switches a connection on or off and changes nothing else, so it can't undo another
/// admin's edit of the name, settings or events. A connection that is off sends nothing, and
/// what was queued for it is dropped unsent. Needs an admin account.
#[utoipa::path(
    patch,
    path = "/api/admin/notifications/connections/{id}",
    tag = "Admin",
    operation_id = "set_notification_connection_enabled",
    params(("id" = i64, Path, description = "The connection's id.")),
    request_body = NotificationConnectionEnabled,
    responses(
        (status = 200, description = "The connection is switched; the body is the whole connection as it now is.", body = NotificationConnection),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "No connection has that id."),
        (status = 422, description = "The body isn't `{\"enabled\": true}` or `{\"enabled\": false}`: `enabled` is missing or not a boolean, or another field is present."),
    ),
)]
pub(super) async fn set_connection_enabled(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(switch): Json<NotificationConnectionEnabled>,
) -> Response {
    match notify::set_connection_enabled(&state.pool, id, switch.enabled).await {
        Ok(connection) => Json(connection).into_response(),
        Err(e) => error_response("switch a notification connection", e),
    }
}

/// Delete a notification connection
///
/// Deletes a connection, with every notification queued or sent for it. Needs an admin
/// account.
#[utoipa::path(
    delete,
    path = "/api/admin/notifications/connections/{id}",
    tag = "Admin",
    operation_id = "delete_notification_connection",
    params(("id" = i64, Path, description = "The connection's id.")),
    responses(
        (status = 204, description = "The connection is deleted."),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "No connection has that id."),
    ),
)]
pub(super) async fn delete_connection(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    match notify::delete_connection(&state.pool, id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => error_response("delete a notification connection", e),
    }
}

/// Send a test notification
///
/// Sends a test message with the given settings straight away, without saving them. With
/// `id`, a token or password the settings leave out is taken from that saved connection, as
/// saving would: only while `server_url`, and for a password the `username`, match the saved
/// ones, so a saved secret never goes to a new address. An unsaved connection gives every
/// secret it needs. The message links to the public server URL when one is set. Needs an
/// admin account.
#[utoipa::path(
    post,
    path = "/api/admin/notifications/test",
    tag = "Admin",
    operation_id = "test_notification_connection",
    request_body = NotificationTest,
    responses(
        (status = 204, description = "The provider accepted the test message."),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "`id` names no saved connection."),
        (status = 422, description = "A setting isn't valid, or a secret is missing, such as a saved one left out for a changed `server_url`; the body says which."),
        (status = 502, description = "The provider couldn't be reached or refused the message. The body is a plain sentence saying which, such as that the provider refused the sign-in, to show as it is; it never quotes the provider's answer."),
    ),
)]
pub(super) async fn post_test(
    _admin: AdminUser,
    State(state): State<AppState>,
    Json(test): Json<NotificationTest>,
) -> Response {
    let saved = match test.id {
        Some(id) => match notify::get_connection(&state.pool, id).await {
            Ok(connection) => Some(connection.settings),
            Err(e) => return error_response("read a notification connection", e),
        },
        None => None,
    };
    let settings = match ConnectionSettings::from_input(&test.settings, saved.as_ref()) {
        Ok(settings) => settings,
        Err(e) => return error_response("check notification settings", e),
    };
    let public_url = match db::effective_public_url(&state.pool).await {
        Ok(url) => url,
        Err(e) => return internal("read the public url", e),
    };
    let client = match notify::http_client() {
        Ok(client) => client,
        Err(e) => return internal("build the notification client", e),
    };
    // A `DeliverError`'s text is a fixed sentence, never the request or the provider's body,
    // so it is safe to send back.
    match notify::deliver(
        &client,
        notify::render_test(&settings, public_url.as_deref()),
    )
    .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

/// The events a connection can be sent on this server now.
fn available_events(state: &AppState) -> Vec<NotificationEvent> {
    if state.book_requests() {
        vec![NotificationEvent::RequestNeedsChooser]
    } else {
        Vec::new()
    }
}

/// 422 with the reason, 404, or a logged 500.
fn error_response(context: &'static str, e: NotifyError) -> Response {
    match e {
        NotifyError::Validation(message) => {
            (StatusCode::UNPROCESSABLE_ENTITY, message).into_response()
        }
        NotifyError::NotFound => (StatusCode::NOT_FOUND, e.to_string()).into_response(),
        NotifyError::Db(_) => internal(context, e),
    }
}

#[cfg(test)]
mod tests;
