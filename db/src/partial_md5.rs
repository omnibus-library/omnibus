//! KOReader's document fingerprint: the partial MD5 a device sends as the `document` of a
//! kosync request. Bit-exact with KOReader's `util.partialMD5`, called by the backfill that
//! fills `book_files.partial_md5` and by the export-digest record. It names a file, it is
//! not a content validator ([rule 09](../../.claude/rules/09-content-validators.md)).

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

use md5::{Digest, Md5};

const SAMPLE_LEN: u64 = 1024;

/// KOReader's `util.partialMD5` of the file at `path`: lowercase hex MD5 over 1 KiB samples at 0, 1 KiB,
/// 4 KiB, ... 1 GiB, stopping at end of file.
pub fn partial_md5(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Md5::new();
    // KOReader's loop runs i = -1..=10 over `lshift(1024, 2 * i)`, whose i = -1 wraps to offset 0.
    let offsets = std::iter::once(0).chain((0..=10).map(|i| SAMPLE_LEN << (2 * i)));
    for offset in offsets {
        file.seek(SeekFrom::Start(offset))?;
        let mut sample = Vec::with_capacity(SAMPLE_LEN as usize);
        (&mut file).take(SAMPLE_LEN).read_to_end(&mut sample)?;
        if sample.is_empty() {
            break;
        }
        hasher.update(&sample);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests;
