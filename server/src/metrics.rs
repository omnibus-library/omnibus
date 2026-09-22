//! Prometheus HTTP metrics: the middleware layer plus the `/metrics` scrape
//! route. `/metrics` sits outside `/api/*`, so `auth::require_auth` never
//! sees it — the route authenticates itself against `OMNIBUS_METRICS_TOKEN`
//! and does not exist at all until that token is set.

use std::sync::OnceLock;

use axum::{
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use axum_prometheus::{
    metrics_exporter_prometheus::PrometheusHandle, EndpointLabel, PrometheusMetricLayer,
    PrometheusMetricLayerBuilder,
};

/// Env var holding the bearer token a Prometheus scraper must present.
const METRICS_TOKEN_ENV: &str = "OMNIBUS_METRICS_TOKEN";

/// The one label every request that matched no route is reported under —
/// the SSR fallback, a probe, a traversal attempt — so an invented URL
/// cannot mint a Prometheus series per path an attacker cares to type.
pub(crate) const UNMATCHED_ENDPOINT: &str = "/<unmatched>";

/// Build (once) the Prometheus metrics middleware and its `/metrics` scrape
/// route, returning clones.
///
/// The builder installs the process-global metrics recorder and panics on a
/// second install, so the (layer, route) is memoized in a `OnceLock` and every
/// call after the first returns clones of it. Apply the returned layer as the
/// outermost app layer so it observes every request, and merge the returned
/// router into the app. Series are labeled by method, status, and
/// `MatchedPath` — so id-bearing routes collapse to their registered pattern
/// (`/api/ebooks/{uuid}`) — with every unmatched path collapsed to
/// [`UNMATCHED_ENDPOINT`] so an invented URL cannot mint a series.
pub fn layer_and_route() -> (PrometheusMetricLayer<'static>, Router) {
    static CELL: OnceLock<(PrometheusMetricLayer<'static>, Router)> = OnceLock::new();
    CELL.get_or_init(|| {
        let (layer, handle) = PrometheusMetricLayerBuilder::new()
            .with_endpoint_label_type(EndpointLabel::MatchedPathWithFallbackFn(|_| {
                UNMATCHED_ENDPOINT.to_string()
            }))
            .with_default_metrics()
            .build_pair();
        let route = Router::new().route(
            "/metrics",
            get(move |headers: HeaderMap| {
                let handle = handle.clone();
                async move { render(&handle, &headers) }
            }),
        );
        (layer, route)
    })
    .clone()
}

/// One startup WARN when no scrape token is configured, so an operator who
/// expected metrics learns why `/metrics` answers 404. Mirrors
/// `omnibus_db::kepub::warn_if_unavailable`: at most once per process, and
/// never a reason the boot fails.
pub fn warn_if_disabled() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    if scrape_token().is_none() {
        ONCE.call_once(|| {
            tracing::warn!(
                target: "omnibus::startup",
                "{METRICS_TOKEN_ENV} is unset \u{2014} GET /metrics answers 404 until it is set"
            );
        });
    }
}

/// The configured scrape token, or `None` when unset or blank.
///
/// Read per request rather than memoized: a `getenv` against a 15-second
/// scrape is free, while a `OnceLock` would pin whatever value happened to be
/// set when the first request arrived for the rest of the process.
fn scrape_token() -> Option<String> {
    std::env::var(METRICS_TOKEN_ENV)
        .ok()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
}

/// Byte comparison that does not short-circuit, so a wrong token cannot be
/// extended one byte at a time from response latency. Length is compared up
/// front and is not secret — a token's length is not the token.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Answer a scrape. 404 while no token is configured — a 401 would advertise
/// an endpoint the operator never asked for — then 401 for anything but the
/// configured bearer.
fn render(handle: &PrometheusHandle, headers: &HeaderMap) -> Response {
    let Some(token) = scrape_token() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let presented = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    match presented {
        Some(p) if constant_time_eq(p.as_bytes(), token.as_bytes()) => {
            handle.render().into_response()
        }
        _ => (StatusCode::UNAUTHORIZED, "unauthorized").into_response(),
    }
}

#[cfg(test)]
mod tests;
