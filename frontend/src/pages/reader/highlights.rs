//! Highlight-creation action shared by the selection popover's swatch,
//! Note, and Quote buttons: optimistically annotates the viewer, persists
//! the highlight, and (per `PostCreate`) opens the note composer or quote
//! panel on the created row. Extracted from `BookReadPage`.
//!
//! The viewer it paints into is abstracted by [`AnnotationBridge`]: the EPUB
//! reader talks to epub.js's annotation layer, the PDF reader
//! (`pages/pdf_reader`) to PDF.js's highlight divs. Both store the anchor in
//! the same `epub_cfi_range` column — a CFI for one, a `pdf:{page}:{quads}`
//! anchor (`omnibus_shared::PdfAnchor`) for the other.

use dioxus::prelude::*;
use omnibus_shared::{Highlight, HighlightColor};

use crate::data;

/// What to open on the created highlight after the swatch/Note/Quote actions.
#[derive(Clone, Copy)]
pub(crate) enum PostCreate {
    None,
    Note,
    Quote,
}

/// One highlight-creation request: the selection's anchor plus what to open
/// on the created row afterwards.
pub(crate) struct NewHighlight {
    /// The stored anchor: an EPUB CFI range or a PDF `pdf:` anchor.
    pub anchor: String,
    pub color: HighlightColor,
    pub text: String,
    pub post: PostCreate,
}

/// Where a created highlight lands: the list signal plus the note/quote
/// panel targets [`PostCreate`] may open.
#[derive(Clone, Copy)]
pub(crate) struct HighlightTargets {
    pub highlights: Signal<Vec<Highlight>>,
    pub note_target: Signal<Option<Highlight>>,
    pub quote_target: Signal<Option<Highlight>>,
}

/// Which viewer an [`AnnotationBridge`] drives — its identity for prop
/// diffing, since function pointers compare by address and two copies of the
/// same bridge are still the same bridge.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AnnotationViewer {
    Epub,
    Pdf,
}

/// How the highlight UI (creation, the drawer's jump / recolor / delete)
/// reaches the viewer that paints annotations. Plain function pointers so the
/// struct is `Copy` and can ride a component prop; each reader supplies its
/// own set, and the EPUB reader's is the default.
#[derive(Clone, Copy)]
pub(crate) struct AnnotationBridge {
    pub viewer: AnnotationViewer,
    /// Show the passage at `anchor`.
    pub navigate: fn(&str),
    /// Paint `anchor` in `color` (a fresh highlight, or a recolor's new swatch).
    pub paint: fn(&str, HighlightColor),
    /// Remove the painted annotation at `anchor`.
    pub unpaint: fn(&str),
    /// Put `text` on the clipboard (each glue owns the clipboard call so it
    /// can fall back the way its surface allows).
    pub copy: fn(&str),
}

impl PartialEq for AnnotationBridge {
    fn eq(&self, other: &Self) -> bool {
        self.viewer == other.viewer
    }
}

impl AnnotationBridge {
    /// The epub.js glue: `display`, `addAnnotation`, `removeAnnotation`.
    pub(crate) fn epub() -> Self {
        Self {
            viewer: AnnotationViewer::Epub,
            navigate: epub_navigate,
            paint: epub_paint,
            unpaint: epub_unpaint,
            copy: epub_copy,
        }
    }
}

impl Default for AnnotationBridge {
    fn default() -> Self {
        Self::epub()
    }
}

/// Navigate the rendition to a CFI (via the glue; SSR no-op).
#[cfg_attr(not(any(feature = "web", feature = "mobile")), allow(unused_variables))]
fn epub_navigate(cfi: &str) {
    #[cfg(any(feature = "web", feature = "mobile"))]
    super::reader_call_json("display", cfi);
}

#[cfg_attr(not(any(feature = "web", feature = "mobile")), allow(unused_variables))]
fn epub_paint(cfi: &str, color: HighlightColor) {
    #[cfg(any(feature = "web", feature = "mobile"))]
    super::reader_call_json2("addAnnotation", cfi, color.as_str());
}

#[cfg_attr(not(any(feature = "web", feature = "mobile")), allow(unused_variables))]
fn epub_unpaint(cfi: &str) {
    #[cfg(any(feature = "web", feature = "mobile"))]
    super::reader_call_json("removeAnnotation", cfi);
}

#[cfg_attr(not(any(feature = "web", feature = "mobile")), allow(unused_variables))]
fn epub_copy(text: &str) {
    #[cfg(any(feature = "web", feature = "mobile"))]
    super::reader_call_json("copyText", text);
}

/// Optimistically annotate the selection, persist the highlight, and — per
/// `req.post` — open the note composer or quote panel on the created row.
/// Shared by the swatch (highlight), Note, and Quote popover actions. Rolls
/// the optimistic annotation back if the write fails.
pub(crate) fn spawn_create_highlight(
    server_url: String,
    uuid: String,
    req: NewHighlight,
    targets: HighlightTargets,
    bridge: AnnotationBridge,
) {
    let NewHighlight {
        anchor,
        color,
        text,
        post,
    } = req;
    let HighlightTargets {
        mut highlights,
        mut note_target,
        mut quote_target,
    } = targets;
    (bridge.paint)(&anchor, color);
    let create = omnibus_shared::CreateHighlight {
        book_uuid: uuid,
        epub_cfi_range: anchor.clone(),
        color,
        text: if text.is_empty() { None } else { Some(text) },
        // Web doesn't need a device-minted handle: its outbox is typed
        // (`Op::CreateHighlight { temp_id, .. }`) and rewrites the temp id
        // into the server's on apply. Mobile's outbox replays opaque
        // request bytes and can't, which is what `client_id` is for.
        client_id: None,
    };
    spawn(async move {
        match data::create_highlight(&server_url, create).await {
            Ok(h) => {
                highlights.write().push(h.clone());
                match post {
                    PostCreate::Note => note_target.set(Some(h)),
                    PostCreate::Quote => quote_target.set(Some(h)),
                    PostCreate::None => {}
                }
            }
            Err(_) => (bridge.unpaint)(&anchor),
        }
    });
}
