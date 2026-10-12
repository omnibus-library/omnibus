//! Tests for the router's limiter wiring: the auth and shared search limiters
//! `build_router_limiters` hands `build_router` follow the rate-limit switch.

use std::net::IpAddr;

use super::*;

fn loopback() -> IpAddr {
    "127.0.0.1".parse().unwrap()
}

#[tokio::test]
async fn build_router_limiters_auth_admits_every_call_when_rate_limits_are_disabled() {
    let limiters = build_router_limiters(rate_limit::RateLimits::Disabled);
    for _ in 0..=rate_limit::MAX_REQUESTS {
        assert!(limiters.auth.allow(loopback()).await);
    }
}

#[tokio::test]
async fn build_router_limiters_search_admits_every_call_when_rate_limits_are_disabled() {
    let limiters = build_router_limiters(rate_limit::RateLimits::Disabled);
    for _ in 0..=backend::SEARCH_RATE_LIMIT_MAX {
        assert!(limiters.search.allow(loopback()).await);
    }
}

#[tokio::test]
async fn build_router_limiters_auth_blocks_after_max_when_rate_limits_are_enforced() {
    let limiters = build_router_limiters(rate_limit::RateLimits::Enforced);
    for _ in 0..rate_limit::MAX_REQUESTS {
        assert!(limiters.auth.allow(loopback()).await);
    }
    assert!(!limiters.auth.allow(loopback()).await);
}
