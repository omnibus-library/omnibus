//! Tool implementations, one module per family: reads in [`read`], check-in /
//! wishlist / physical in [`checkin`], shelf authoring in [`shelves`],
//! metadata repair in [`metadata`], admin merge/undo in [`merge`], and the
//! chapter/content-search reads in [`content`]. Each is a `#[tool_router]`
//! impl block combined in `OmnibusMcp::new`, per [`crate::client`]'s allowlist.

pub mod checkin;
pub mod content;
pub mod merge;
pub mod metadata;
pub mod read;
pub mod shelves;

use rmcp::ErrorData;

/// Validate a model-supplied handle before it becomes one URL path segment.
/// Only plain `[A-Za-z0-9-]` strings pass; anything else is rejected as invalid
/// params, since an extra or empty segment would trip the
/// [`crate::client::WRITE_ALLOWLIST`] assert and panic the process.
pub(crate) fn path_segment<'a>(value: &'a str, what: &str) -> Result<&'a str, ErrorData> {
    let well_formed =
        !value.is_empty() && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if well_formed {
        Ok(value)
    } else {
        Err(ErrorData::invalid_params(
            format!(
                "{what} must be a non-empty identifier (letters, digits, dashes): got {value:?}"
            ),
            None,
        ))
    }
}
