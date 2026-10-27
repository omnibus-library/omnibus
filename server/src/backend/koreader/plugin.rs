//! The Omnibus KOReader plugin as a zip, built in memory with the server's origin and one
//! device's token baked into `omnibus.json`. The plugin's files are embedded from
//! `koreader/omnibus.koplugin/`; a test keeps this list equal to that directory.

use std::io::{Cursor, Write};

use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

const PLUGIN_DIR: &str = "omnibus.koplugin";

pub(super) const PLUGIN_FILES: &[(&str, &str)] = &[
    (
        "_meta.lua",
        include_str!("../../../../koreader/omnibus.koplugin/_meta.lua"),
    ),
    (
        "main.lua",
        include_str!("../../../../koreader/omnibus.koplugin/main.lua"),
    ),
    (
        "omnibussync.lua",
        include_str!("../../../../koreader/omnibus.koplugin/omnibussync.lua"),
    ),
];

/// The plugin folder zipped up, configured to sync with `server_url` as the device `token`.
pub fn plugin_zip(server_url: &str, token: &str) -> anyhow::Result<Vec<u8>> {
    let config = serde_json::json!({ "server_url": server_url, "token": token }).to_string();
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, content) in PLUGIN_FILES
        .iter()
        .copied()
        .chain([("omnibus.json", config.as_str())])
    {
        writer.start_file(format!("{PLUGIN_DIR}/{name}"), options)?;
        writer.write_all(content.as_bytes())?;
    }
    Ok(writer.finish()?.into_inner())
}
