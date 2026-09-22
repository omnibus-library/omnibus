//! Loopback proof that `serve_with_peer_addresses` hands each request its
//! real peer address.

use std::io::{Read, Write};
use std::net::TcpStream as StdTcpStream;

use axum::extract::ConnectInfo;
use axum::routing::get;
use axum::Router;

use super::serve_with_peer_addresses;

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
