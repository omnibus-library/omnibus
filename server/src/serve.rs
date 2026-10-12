//! Binds a listener and serves a router with peer addresses attached, so
//! `rate_limit::client_ip` and the request log see a real `ConnectInfo`.

use std::net::SocketAddr;

use axum::Router;

/// Serve `router` on `listener`, attaching each connection's peer address. Dioxus 0.7.9's
/// serve paths insert no `ConnectInfo<SocketAddr>`, so the per-IP rate limiter and request
/// log would see every request as `0.0.0.0`, one bucket for the whole internet;
/// `into_make_service_with_connect_info` is the only fix and dioxus exposes no hook for it.
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
