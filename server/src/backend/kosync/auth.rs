//! `KosyncUser` — the `x-auth-user` / `x-auth-key` extractor for the kosync routes. The key is
//! the MD5 of the password the reader generated in Settings. There is no account lockout (it
//! would let a stranger lock a reader's sync by username); instead each IP gets a budget of
//! failed checks, and a correct key is never charged against it.

use std::sync::Arc;

use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    response::Response,
};
use omnibus_db as db;

use super::error;
use crate::backend::AppState;
use crate::http_errors::internal;
use crate::rate_limit::{client_ip, RateLimiter, RateLimits};

/// Per-IP budget of failed credential checks, layered on the router as an `Extension`.
pub(super) struct AuthFailures(RateLimiter);

impl AuthFailures {
    pub(super) fn new(limits: RateLimits) -> Self {
        Self(RateLimiter::new().with_limits(limits))
    }
}

/// The reader a request authenticated as.
pub(super) struct KosyncUser(pub i64);

impl FromRequestParts<AppState> for KosyncUser {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let header = |name: &str| parts.headers.get(name).and_then(|v| v.to_str().ok());
        if let (Some(username), Some(key)) = (header("x-auth-user"), header("x-auth-key")) {
            match db::kosync::verify_kosync_key(state.pool(), username, key).await {
                Ok(Some(user_id)) => return Ok(Self(user_id)),
                Ok(None) => {}
                Err(e) => return Err(internal("kosync auth", e)),
            }
        }
        let failures = parts
            .extensions
            .get::<Arc<AuthFailures>>()
            .ok_or_else(|| internal("kosync auth", "missing AuthFailures extension"))?;
        if !failures
            .0
            .allow(client_ip(&parts.extensions, &parts.headers))
            .await
        {
            return Err(error(
                StatusCode::TOO_MANY_REQUESTS,
                429,
                "Too many failed attempts. Try again later.",
            ));
        }
        Err(error(StatusCode::UNAUTHORIZED, 2001, "Unauthorized"))
    }
}
