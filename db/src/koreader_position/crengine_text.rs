//! How crengine reads a text node, and the offset maps between that text and
//! the raw DOM text a CFI counts in. crengine turns `\t \n \r` into spaces and
//! folds each run of spaces into one, keeping a leading space; offsets count
//! Unicode scalars, where a CFI counts UTF-16 units of the raw text.

/// Whether `c` is one of the four characters crengine treats as a space.
fn is_space(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\r')
}

/// Whether the node is nothing but those spaces, so crengine may drop it.
pub(super) fn is_blank(raw: &str) -> bool {
    raw.chars().all(is_space)
}

/// The raw UTF-16 offset of crengine character offset `offset`; the node's
/// raw length when `offset` is its end. `None` past the end.
pub(super) fn raw_offset(raw: &str, offset: u32) -> Option<u32> {
    let mut kept = 0;
    let mut utf16 = 0;
    let mut prev_space = false;
    for c in raw.chars() {
        let dropped = is_space(c) && prev_space;
        if !dropped {
            if kept == offset {
                return Some(utf16);
            }
            kept += 1;
        }
        prev_space = is_space(c);
        utf16 += c.len_utf16() as u32;
    }
    (kept == offset).then_some(utf16)
}

/// The crengine offset for raw UTF-16 offset `utf16_offset`. An offset inside a
/// collapsed run maps to the run's kept space. `None` past the raw end.
pub(super) fn crengine_offset(raw: &str, utf16_offset: u32) -> Option<u32> {
    let mut kept = 0;
    let mut utf16 = 0;
    let mut prev_space = false;
    for c in raw.chars() {
        let dropped = is_space(c) && prev_space;
        if utf16 >= utf16_offset {
            return Some(if dropped { kept - 1 } else { kept });
        }
        if !dropped {
            kept += 1;
        }
        prev_space = is_space(c);
        utf16 += c.len_utf16() as u32;
    }
    (utf16 == utf16_offset).then_some(kept)
}
