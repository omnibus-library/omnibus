//! Typography preference enums, plus their `web_sys`-backed localStorage
//! persistence (web only — see `mobile::prefs_storage` for the WebView
//! counterpart). These are cross-book, per-user reader prefs (typeface,
//! line spacing, margins); the reader page reads them on mount and writes
//! them on every change.

/// Reader body typeface choice. Mirrors `ReaderTypeface` in
/// `omnibus-ios/omnibus/Reader/ReaderWebView.swift` — keep the stacks
/// identical.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Typeface {
    Original,
    Editorial,
    Classic,
    Modern,
    Sans,
    Mono,
}

// Unused only in plain SSR builds (no web, no mobile) — both interactive targets convert.
#[cfg_attr(not(any(feature = "web", feature = "mobile")), allow(dead_code))]
impl Typeface {
    /// Every variant, in the order the AA panel lays the chips out.
    pub(crate) const ALL: [Typeface; 6] = [
        Self::Original,
        Self::Editorial,
        Self::Classic,
        Self::Modern,
        Self::Sans,
        Self::Mono,
    ];

    /// The reader-owned `font-family` stack, or `None` for Original — no
    /// override at all, so the publisher's faces win.
    pub(crate) fn to_css(self) -> Option<&'static str> {
        // Georgia sits ahead of the generic `serif` so a webfont that fails to
        // load in the section iframe degrades to a real book serif, not Times.
        match self {
            Self::Original => None,
            Self::Editorial => Some("'Instrument Serif',Georgia,serif"),
            Self::Classic => Some("'EB Garamond',Georgia,serif"),
            Self::Modern => Some("Georgia,serif"),
            Self::Sans => Some("system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif"),
            Self::Mono => Some("ui-monospace,'SF Mono',Menlo,Consolas,monospace"),
        }
    }

    /// The AA-panel chip label for this value.
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Original => "Original",
            Self::Editorial => "Editorial",
            Self::Classic => "Classic",
            Self::Modern => "Modern",
            Self::Sans => "Sans",
            Self::Mono => "Mono",
        }
    }

    /// The localStorage token for this value.
    pub(crate) fn to_storage(self) -> &'static str {
        match self {
            Self::Original => "original",
            Self::Editorial => "editorial",
            Self::Classic => "classic",
            Self::Modern => "modern",
            Self::Sans => "sans",
            Self::Mono => "mono",
        }
    }

    /// Parse a stored token; `None` for anything unrecognized.
    pub(crate) fn from_storage(s: &str) -> Option<Self> {
        match s {
            "original" => Some(Self::Original),
            "editorial" => Some(Self::Editorial),
            "classic" => Some(Self::Classic),
            "modern" => Some(Self::Modern),
            "sans" => Some(Self::Sans),
            "mono" => Some(Self::Mono),
            _ => None,
        }
    }
}

/// Reader line-height choice.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum LineSpacing {
    Tight,
    Cozy,
    Airy,
}

#[cfg_attr(not(any(feature = "web", feature = "mobile")), allow(dead_code))]
impl LineSpacing {
    /// The `line-height` applied to the section iframe.
    pub(crate) fn to_css(self) -> &'static str {
        match self {
            Self::Tight => "1.4",
            Self::Cozy => "1.7",
            Self::Airy => "2.0",
        }
    }

    /// The localStorage token for this value.
    pub(crate) fn to_storage(self) -> &'static str {
        match self {
            Self::Tight => "tight",
            Self::Cozy => "cozy",
            Self::Airy => "airy",
        }
    }

    /// Parse a stored token; `None` for anything unrecognized.
    pub(crate) fn from_storage(s: &str) -> Option<Self> {
        match s {
            "tight" => Some(Self::Tight),
            "cozy" => Some(Self::Cozy),
            "airy" => Some(Self::Airy),
            _ => None,
        }
    }
}

/// Reader text-column width choice.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Margins {
    Narrow,
    Normal,
    Wide,
}

#[cfg_attr(not(any(feature = "web", feature = "mobile")), allow(dead_code))]
impl Margins {
    /// The column's max-width, clamped to keep it clear of the `.rd-turn` buttons.
    pub(crate) fn to_css(self) -> &'static str {
        match self {
            Self::Narrow => "min(95%, calc(100% - 172px))",
            Self::Normal => "min(80%, calc(100% - 172px))",
            Self::Wide => "min(65%, calc(100% - 172px))",
        }
    }

    /// The localStorage token for this value.
    pub(crate) fn to_storage(self) -> &'static str {
        match self {
            Self::Narrow => "narrow",
            Self::Normal => "normal",
            Self::Wide => "wide",
        }
    }

    /// Parse a stored token; `None` for anything unrecognized.
    pub(crate) fn from_storage(s: &str) -> Option<Self> {
        match s {
            "narrow" => Some(Self::Narrow),
            "normal" => Some(Self::Normal),
            "wide" => Some(Self::Wide),
            _ => None,
        }
    }
}

/// Single-page vs two-page spread. Maps to epub.js `rendition.spread(...)`:
/// `"none"` forces a single column, `"auto"` lets epub.js pair pages when the
/// viewport is wide enough.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Spread {
    Single,
    Double,
}

#[cfg_attr(not(any(feature = "web", feature = "mobile")), allow(dead_code))]
impl Spread {
    /// The epub.js `spread` mode this value maps to.
    pub(crate) fn to_css(self) -> &'static str {
        match self {
            Self::Single => "none",
            Self::Double => "auto",
        }
    }

    /// The localStorage token for this value.
    pub(crate) fn to_storage(self) -> &'static str {
        match self {
            Self::Single => "single",
            Self::Double => "double",
        }
    }

    /// Parse a stored token; `None` for anything unrecognized.
    pub(crate) fn from_storage(s: &str) -> Option<Self> {
        match s {
            "single" => Some(Self::Single),
            "double" => Some(Self::Double),
            _ => None,
        }
    }
}

#[cfg(feature = "web")]
fn local_storage() -> Option<web_sys::Storage> {
    web_sys::window().and_then(|w| w.local_storage().ok().flatten())
}

// Thin `web_sys::Storage` wrappers, no browser to test against — no test per the thin-wrapper carve-out.

/// Persist a single reader preference under its `omn.*` key.
#[cfg(feature = "web")]
pub(crate) fn save_reader_pref(key: &str, value: &str) {
    if let Some(storage) = local_storage() {
        let _ = storage.set_item(key, value);
    }
}

/// Load a single reader preference, returning `None` when unset.
#[cfg(feature = "web")]
pub(crate) fn load_reader_pref(key: &str) -> Option<String> {
    local_storage().and_then(|s| s.get_item(key).ok().flatten())
}

#[cfg(test)]
mod tests {
    use super::*;

    // The storage token is the persistence contract: a `to_storage` arm that
    // drifts out of lockstep with its `from_storage` arm silently loses a
    // saved preference on the next reader mount. These round-trips pin every
    // variant of every enum so that drift fails here, not in a browser.

    #[test]
    fn typeface_round_trips_through_storage_for_every_variant() {
        for variant in Typeface::ALL {
            assert_eq!(Typeface::from_storage(variant.to_storage()), Some(variant));
        }
    }

    #[test]
    fn typeface_to_css_is_none_only_for_original() {
        // Original is the *absence* of an override — a stack here (even an
        // empty string) would flatten the publisher's faces, which is the one
        // thing this variant exists to avoid.
        assert_eq!(Typeface::Original.to_css(), None);
        for variant in Typeface::ALL
            .into_iter()
            .filter(|t| *t != Typeface::Original)
        {
            let stack = variant
                .to_css()
                .unwrap_or_else(|| panic!("{variant:?} must name a stack"));
            assert!(!stack.is_empty(), "{variant:?} stack is empty");
            // Every named stack ends in a generic family, so a face that fails
            // to load still lands on something readable.
            assert!(
                stack.ends_with("serif")
                    || stack.ends_with("sans-serif")
                    || stack.ends_with("monospace"),
                "{variant:?} stack has no generic fallback: {stack}"
            );
        }
    }

    #[test]
    fn line_spacing_round_trips_through_storage_for_every_variant() {
        for variant in [LineSpacing::Tight, LineSpacing::Cozy, LineSpacing::Airy] {
            assert_eq!(
                LineSpacing::from_storage(variant.to_storage()),
                Some(variant)
            );
        }
    }

    #[test]
    fn margins_round_trips_through_storage_for_every_variant() {
        for variant in [Margins::Narrow, Margins::Normal, Margins::Wide] {
            assert_eq!(Margins::from_storage(variant.to_storage()), Some(variant));
        }
    }

    #[test]
    fn margins_to_css_reserves_a_fixed_gutter_for_every_variant() {
        // Regression guard for #1236: pins the exact clamped value per
        // variant so a regressed percentage (not just a dropped clamp)
        // fails here too.
        assert_eq!(Margins::Narrow.to_css(), "min(95%, calc(100% - 172px))");
        assert_eq!(Margins::Normal.to_css(), "min(80%, calc(100% - 172px))");
        assert_eq!(Margins::Wide.to_css(), "min(65%, calc(100% - 172px))");
    }

    #[test]
    fn spread_round_trips_through_storage_for_every_variant() {
        for variant in [Spread::Single, Spread::Double] {
            assert_eq!(Spread::from_storage(variant.to_storage()), Some(variant));
        }
    }

    #[test]
    fn from_storage_returns_none_for_unrecognized_token() {
        // One per enum: an unknown stored value must fall through to `None`
        // so the caller can drop to its default rather than mis-restore.
        assert_eq!(Typeface::from_storage("nonsense"), None);
        assert_eq!(LineSpacing::from_storage(""), None);
        assert_eq!(Margins::from_storage("NARROW"), None);
        assert_eq!(Spread::from_storage("triple"), None);
    }
}
