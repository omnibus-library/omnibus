//! `KosyncUser` — the `x-auth-user` / `x-auth-key` extractor for the kosync routes. The key is
//! the MD5 of the password the reader generated in Settings. There is no account lockout (it
//! would let a stranger lock a reader's sync by username); instead each IP gets a budget of
//! failed checks (an `Arc<RateLimiter>` layered on the router). A correct key is never charged
//! and always gets in, so one device holding a stale key can't lock out a household behind the
//! same IP; the key's ~99 bits are what stop guessing, not the budget.

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
use crate::rate_limit::{client_ip, RateLimiter};

/// The reader a request authenticated as.
pub(super) struct KosyncUser(pub i64);

impl FromRequestParts<AppState> for KosyncUser {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let failures = parts
            .extensions
            .get::<Arc<RateLimiter>>()
            .ok_or_else(|| internal("kosync auth", "missing RateLimiter extension"))?;
        let ip = client_ip(&parts.extensions, &parts.headers);
        let too_many = || {
            error(
                StatusCode::TOO_MANY_REQUESTS,
                429,
                "Too many failed attempts. Try again later.",
            )
        };
        let header = |name: &str| parts.headers.get(name).and_then(|v| v.to_str().ok());
        if let (Some(username), Some(key)) = (header("x-auth-user"), header("x-auth-key")) {
            match db::kosync::verify_kosync_key(state.pool(), username, key).await {
                Ok(Some(user_id)) => return Ok(Self(user_id)),
                Ok(None) => {}
                Err(e) => return Err(internal("kosync auth", e)),
            }
        }
        if !failures.allow(ip).await {
            return Err(too_many());
        }
        Err(error(StatusCode::UNAUTHORIZED, 2001, "Unauthorized"))
    }
}
