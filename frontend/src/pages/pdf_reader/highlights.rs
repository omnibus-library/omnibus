//! The PDF reader's side of the shared highlight UI: the text-layer selection
//! payload the glue reports, its `pdf:{page}:{quads}` anchor, the
//! [`AnnotationBridge`] the drawers drive, and the paint list the glue
//! overlays on the current page.

use omnibus_shared::{pdf_anchor_page, Highlight, HighlightColor, PdfAnchor, PdfQuad};

use crate::pages::reader::highlights::{AnnotationBridge, AnnotationViewer};
use crate::pages::reader::selection::SelectionRect;

use super::interop;

/// A settled selection on PDF.js's text layer, as the glue reports it: the
/// 0-based page, one quad per selected line fragment in PDF user-space points
/// (`QuadPoints` order: upper-left, upper-right, lower-left, lower-right), the
/// selected prose, and the bounding rect in reader-root coordinates for the
/// popover.
#[derive(Clone, Debug, Default, serde::Deserialize)]
pub(super) struct PdfSelection {
    pub page: usize,
    #[serde(default)]
    pub quads: Vec<[f32; 8]>,
    #[serde(default)]
    pub text: String,
    pub rect: SelectionRect,
}

impl PdfSelection {
    /// The anchor this selection stores — the whole-quads form, degrading to
    /// the page alone past the cap the way [`PdfAnchor::encode`] does, so an
    /// over-long selection still saves (it lists and jumps, it just is not
    /// painted).
    pub(super) fn anchor(&self) -> String {
        PdfAnchor {
            page: self.page,
            quads: self
                .quads
                .iter()
                .map(|q| PdfQuad {
                    points: [(q[0], q[1]), (q[2], q[3]), (q[4], q[5]), (q[6], q[7])],
                })
                .collect(),
        }
        .encode()
    }
}

/// One entry of the glue's `paintHighlights` list.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub(super) struct PaintedHighlight {
    pub anchor: String,
    pub color: &'static str,
}

/// The highlights the glue can place: those with a parseable `pdf:` anchor.
/// EPUB CFIs (a mixed-format book's other file) and anchorless Kobo rows are
/// left out rather than handed to a painter that can't read them.
pub(super) fn paint_list(highlights: &[Highlight]) -> Vec<PaintedHighlight> {
    highlights
        .iter()
        .filter_map(|h| {
            let anchor = h.epub_cfi_range.as_deref()?;
            PdfAnchor::parse(anchor)?;
            Some(PaintedHighlight {
                anchor: anchor.to_string(),
                color: h.color.as_str(),
            })
        })
        .collect()
}

/// Push the whole set to the glue, which keeps it and repaints the ones on
/// the current page after every render.
pub(super) fn paint_all(highlights: &[Highlight]) {
    interop::pdf_call_json("paintHighlights", &paint_list(highlights));
}

/// The bridge the shared drawer/popover code drives for a PDF. Painting is
/// list-driven — the page repaints the whole set whenever the `highlights`
/// signal changes — so `paint`/`unpaint` have nothing to do per anchor and
/// only `navigate` reaches the glue.
pub(super) fn pdf_bridge() -> AnnotationBridge {
    AnnotationBridge {
        viewer: AnnotationViewer::Pdf,
        navigate: pdf_navigate,
        paint: pdf_paint,
        unpaint: pdf_unpaint,
        copy: pdf_copy,
    }
}

fn pdf_copy(text: &str) {
    interop::pdf_call_json("copyText", text);
}

fn pdf_navigate(anchor: &str) {
    if let Some(page) = pdf_anchor_page(anchor) {
        interop::go_to(page);
    }
}

fn pdf_paint(_anchor: &str, _color: HighlightColor) {}

fn pdf_unpaint(_anchor: &str) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn highlight(id: i64, anchor: Option<&str>, color: HighlightColor) -> Highlight {
        Highlight {
            id,
            book_uuid: "book-a".to_string(),
            epub_cfi_range: anchor.map(str::to_string),
            color,
            note: None,
            text: None,
            client_id: None,
            created_at: 0,
            created_at_iso: None,
            spine_index: None,
            chapter_title: None,
            percent_through_book: None,
        }
    }

    #[test]
    fn pdf_selection_anchor_encodes_the_page_and_quads() {
        let sel = PdfSelection {
            page: 3,
            quads: vec![[72.0, 710.25, 172.0, 710.25, 72.0, 700.0, 172.0, 700.0]],
            text: "some words".into(),
            rect: SelectionRect::default(),
        };
        assert_eq!(
            sel.anchor(),
            "pdf:3:72.0,710.2,172.0,710.2,72.0,700.0,172.0,700.0"
        );
        let parsed = PdfAnchor::parse(&sel.anchor()).unwrap();
        assert_eq!(parsed.page, 3);
        assert_eq!(parsed.quads.len(), 1);
    }

    #[test]
    fn pdf_selection_with_no_quads_degrades_to_the_page() {
        let sel = PdfSelection {
            page: 5,
            ..Default::default()
        };
        assert_eq!(sel.anchor(), "pdf:5");
    }

    #[test]
    fn pdf_selection_decodes_the_glue_payload() {
        let sel: PdfSelection = serde_json::from_str(
            r#"{"page":1,"quads":[[1,2,3,4,5,6,7,8]],"text":"t","rect":{"x":10,"y":20,"width":30}}"#,
        )
        .unwrap();
        assert_eq!(sel.page, 1);
        assert_eq!(sel.quads, vec![[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]]);
        assert_eq!(sel.rect.x, 10.0);
    }

    #[test]
    fn paint_list_keeps_only_placeable_pdf_anchors() {
        let list = paint_list(&[
            highlight(1, Some("pdf:2:0,0,1,0,0,1,1,1"), HighlightColor::Green),
            highlight(
                2,
                Some("epubcfi(/6/4!/4/2,/1:0,/1:4)"),
                HighlightColor::Amber,
            ),
            highlight(3, None, HighlightColor::Blue),
            highlight(4, Some("pdf:7"), HighlightColor::Rose),
        ]);
        assert_eq!(
            list,
            vec![
                PaintedHighlight {
                    anchor: "pdf:2:0,0,1,0,0,1,1,1".into(),
                    color: "green"
                },
                PaintedHighlight {
                    anchor: "pdf:7".into(),
                    color: "rose"
                },
            ]
        );
    }

    #[test]
    fn pdf_bridge_paint_hooks_are_inert_and_navigate_ignores_foreign_anchors() {
        // Painting is list-driven, so the per-anchor hooks must be no-ops the
        // shared code can call freely; `navigate` on a foreign anchor is a
        // no-op too rather than a jump to page 0. A PDF anchor would reach
        // `document::eval`, which needs a live runtime on the interactive
        // targets, so the page it resolves to is asserted on the parser
        // instead.
        let bridge = pdf_bridge();
        assert_eq!(bridge.viewer, AnnotationViewer::Pdf);
        (bridge.paint)("pdf:1", HighlightColor::Amber);
        (bridge.unpaint)("pdf:1");
        (bridge.navigate)("epubcfi(/6/4!/4/2)");
        (bridge.navigate)("comic-page:4");
        assert_eq!(pdf_anchor_page("pdf:4"), Some(4));
        assert_eq!(pdf_anchor_page("pdf-page:4"), Some(4));
    }
}
