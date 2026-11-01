//! Server library: the axum backend the `omnibus` binary in `main.rs` serves.
//!
//! A lib crate so the integration tests can import it with `use omnibus::backend`.

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
