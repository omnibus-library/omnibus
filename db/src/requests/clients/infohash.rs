//! The BitTorrent info hash of a release, read before the download client is given it, so a
//! download is found again by the hash of its content and never by anything Omnibus attached.
//! A magnet carries it in `xt=urn:btih:`; a `.torrent` file's is the SHA-1 of its bencoded
//! `info` dictionary, whose raw bytes are hashed as they sit in the file.
// shortcut: v2-only torrents (no v1 info hash) are refused, not hashed; support them when a
// supported indexer starts serving them.

use sha1::{Digest, Sha1};

/// Nesting deeper than this is not a torrent; it also keeps the walk off the stack's end.
const MAX_DEPTH: usize = 32;

/// Why a release's info hash could not be read, as the end of "the release link ...".
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct InfohashError(&'static str);

const UNREADABLE: &str = "is not a readable magnet or torrent file";
const NO_V1: &str = "has no BitTorrent v1 info hash, which Omnibus needs";

/// The lowercase hex info hash of `magnet`.
pub fn from_magnet(magnet: &str) -> Result<String, InfohashError> {
    let url = reqwest::Url::parse(magnet).map_err(|_| bad())?;
    let hash = url
        .query_pairs()
        .filter(|(key, _)| key == "xt")
        .find_map(|(_, value)| value.strip_prefix("urn:btih:").map(str::to_string))
        .ok_or(InfohashError(NO_V1))?;
    match hash.len() {
        40 if hash.bytes().all(|b| b.is_ascii_hexdigit()) => Ok(hash.to_ascii_lowercase()),
        32 => {
            let bytes = data_encoding::BASE32_NOPAD
                .decode(hash.to_ascii_uppercase().as_bytes())
                .map_err(|_| bad())?;
            Ok(data_encoding::HEXLOWER.encode(&bytes))
        }
        _ => Err(bad()),
    }
}

/// The lowercase hex info hash of the `.torrent` file `bytes`.
pub fn from_torrent(bytes: &[u8]) -> Result<String, InfohashError> {
    let info = info_span(bytes)?;
    if !dict_has_key(info, b"pieces")? {
        return Err(InfohashError(NO_V1));
    }
    Ok(data_encoding::HEXLOWER.encode(&Sha1::digest(info)))
}

fn bad() -> InfohashError {
    InfohashError(UNREADABLE)
}

/// The end of the bencoded value that starts at `at`.
fn skip(b: &[u8], at: usize, depth: usize) -> Result<usize, InfohashError> {
    if depth > MAX_DEPTH {
        return Err(bad());
    }
    match b.get(at).ok_or_else(bad)? {
        b'i' => {
            let end = b[at..].iter().position(|&c| c == b'e');
            end.map(|n| at + n + 1).ok_or_else(bad)
        }
        b'l' | b'd' => {
            let mut pos = at + 1;
            while b.get(pos).ok_or_else(bad)? != &b'e' {
                pos = skip(b, pos, depth + 1)?;
            }
            Ok(pos + 1)
        }
        b'0'..=b'9' => string(b, at).map(|(_, end)| end),
        _ => Err(bad()),
    }
}

/// The `len:data` string at `at`: its data and where it ends.
fn string(b: &[u8], at: usize) -> Result<(&[u8], usize), InfohashError> {
    let colon = b[at..].iter().position(|&c| c == b':').ok_or_else(bad)?;
    let len: usize = std::str::from_utf8(&b[at..at + colon])
        .ok()
        .and_then(|n| n.parse().ok())
        .ok_or_else(bad)?;
    let start = at + colon + 1;
    let end = start.checked_add(len).filter(|&e| e <= b.len());
    let end = end.ok_or_else(bad)?;
    Ok((&b[start..end], end))
}

/// Calls `visit(key, value_start, value_end)` for each entry of the dictionary at `at`.
fn each_entry(
    b: &[u8],
    at: usize,
    mut visit: impl FnMut(&[u8], usize, usize) -> bool,
) -> Result<(), InfohashError> {
    if b.get(at) != Some(&b'd') {
        return Err(bad());
    }
    let mut pos = at + 1;
    while b.get(pos).ok_or_else(bad)? != &b'e' {
        let (key, start) = string(b, pos)?;
        let end = skip(b, start, 1)?;
        if visit(key, start, end) {
            return Ok(());
        }
        pos = end;
    }
    Ok(())
}

/// The bytes of the top-level `info` value.
fn info_span(b: &[u8]) -> Result<&[u8], InfohashError> {
    let mut span = None;
    each_entry(b, 0, |key, start, end| {
        if key == b"info" {
            span = Some(&b[start..end]);
        }
        span.is_some()
    })?;
    span.ok_or_else(bad)
}

/// Whether the dictionary `b` has `wanted` among its keys.
fn dict_has_key(b: &[u8], wanted: &[u8]) -> Result<bool, InfohashError> {
    let mut found = false;
    each_entry(b, 0, |key, _, _| {
        found = key == wanted;
        found
    })?;
    Ok(found)
}

#[cfg(test)]
mod tests;
