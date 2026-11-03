//! Loopback proof that `serve_with_peer_addresses` hands each request its
//! real peer address.

use std::io::{Read, Write};
use std::net::TcpStream as StdTcpStream;

use axum::extract::ConnectInfo;
use axum::routing::get;
use axum::Router;

use super::{listen_address, serve_with_peer_addresses};

async fn probe(ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>) -> String {
    addr.ip().to_string()
}

#[tokio::test]
async fn serve_with_peer_addresses_attaches_the_real_peer_to_each_request() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = Router::new().route("/probe", get(probe));

    tokio::spawn(serve_with_peer_addresses(listener, router));

    let body = tokio::task::spawn_blocking(move || {
        let mut stream = StdTcpStream::connect(addr).unwrap();
        stream
            .write_all(b"GET /probe HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    })
    .await
    .unwrap();

    assert!(body.contains("127.0.0.1"), "got response: {body}");
    assert!(!body.contains("0.0.0.0"), "got response: {body}");
}

#[test]
fn listen_address_binds_the_ip_and_port_it_is_given() {
    assert_eq!(
        listen_address(Some("0.0.0.0"), Some("3000")),
        "0.0.0.0:3000".parse().unwrap()
    );
}

#[test]
fn listen_address_falls_back_to_loopback_8080_when_unset_or_unparseable() {
    assert_eq!(
        listen_address(None, Some("not-a-port")),
        "127.0.0.1:8080".parse().unwrap()
    );
}

#[test]
fn listen_address_falls_back_to_loopback_when_the_ip_is_a_hostname() {
    assert_eq!(
        listen_address(Some("localhost"), Some("3000")),
        "127.0.0.1:3000".parse().unwrap()
    );
}
