//! Server library: the axum backend the `omnibus` binary in `main.rs` serves.
//!
//! A lib crate so the integration tests can import it with `use omnibus::backend`.

// Handlers return `Result<_, axum::response::Response>` on purpose; boxing the
// 128-byte `Response` on every early return buys nothing.
#![allow(clippy::result_large_err)]

pub mod auth;
pub mod backend;
pub mod http_errors;
pub mod logging;
pub mod mcp_http;
pub mod metrics;
pub mod rate_limit;
pub mod request_log;
pub mod security_headers;
pub mod serve;
