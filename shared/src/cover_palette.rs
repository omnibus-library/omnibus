//! The `GET /api/books/{uuid}/cover/palette` response: gradient pairs drawn from a book's cover.

use serde::{Deserialize, Serialize};

/// Gradient pairs drawn from a book's cover, for backgrounds that echo the artwork.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CoverPalette {
    /// Zero to four pairs, darkest first. Empty when the cover is too plain to yield any.
    pub pairs: Vec<CoverPair>,
}

/// Two stops of a gradient and the ink that reads on both.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CoverPair {
    /// The darker stop, as lowercase `#rrggbb`.
    pub from: String,
    /// The lighter stop, as lowercase `#rrggbb`.
    pub to: String,
    /// The ink that keeps at least 4.5:1 contrast on both stops.
    pub ink: CoverInk,
}

/// Which ink reads on a gradient pair.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "lowercase")]
pub enum CoverInk {
    /// Use light text.
    Light,
    /// Use dark text.
    Dark,
}
