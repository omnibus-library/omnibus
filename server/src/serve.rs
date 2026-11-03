//! The address the server binds, and serving a router on it with peer addresses
//! attached, so `rate_limit::client_ip` and the request log see a real `ConnectInfo`.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use axum::Router;

/// The address `IP` and `PORT` name, each falling back on its own (to `127.0.0.1` and `8080`)
/// when unset or unparseable — defaults an existing deployment already relies on.
pub fn listen_address(ip: Option<&str>, port: Option<&str>) -> SocketAddr {
    let ip = parse_or(ip, "IP", IpAddr::V4(Ipv4Addr::LOCALHOST));
    SocketAddr::new(ip, parse_or(port, "PORT", 8080))
}

/// `raw` parsed as `T`, or `default` when unset; an unparseable value is warned about, not silent.
fn parse_or<T: std::str::FromStr + std::fmt::Display>(
    raw: Option<&str>,
    name: &str,
    default: T,
) -> T {
    let Some(raw) = raw else { return default };
    raw.parse().unwrap_or_else(|_| {
        tracing::warn!(%raw, "{name} is not valid; using {default}");
        default
    })
}

/// Serve `router` on `listener`, attaching each connection's peer address. Without
/// `into_make_service_with_connect_info` there is no `ConnectInfo<SocketAddr>`, and the
/// per-IP rate limiter and request log would see one client for the whole internet.
pub async fn serve_with_peer_addresses(
    listener: tokio::net::TcpListener,
    router: Router,
) -> std::io::Result<()> {
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
}

#[cfg(test)]
mod tests;
