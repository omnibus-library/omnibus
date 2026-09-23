//  PDFStage.swift
//  The PDFKit view under the reader's chrome, and the controller the SwiftUI
//  screen drives it through.
//
//  `PDFView` does the paging, zooming and text selection; what the app adds
//  is the same contract the comic pager has — tap zones for turns and
//  chrome, a page index the screen can read and set — plus the selection and
//  highlight hooks the passage menu needs. PDFKit's own edit menu is
//  suppressed so the app's `AnnotationMenu` is the only one over a passage.

import PDFKit
import SwiftUI

/// Which third of the page a tap landed in — the comic pager's zones.
enum PDFTapZone {
    case previous
    case next
    case toggle
}

/// What the stage reports and what the screen asks of it.
@Observable
@MainActor
final class PDFStageController {
    /// The page on screen, 0-based. Written by the stage on every turn.
    var page = 0
    /// The settled selection, or `nil` when nothing is selected.
    var selection: PDFSelectionData?
    /// A tapped painted highlight, with where it sits on screen.
    var tappedHighlight: (highlight: Highlight, rects: [PageRect])?
    /// The stage's zoom, republished so the chrome can re-ask what is behind
    /// it after a pinch settles.
    var scaleFactor: CGFloat = 1

    fileprivate weak var view: PDFView?
    /// The rows currently painted, so a repaint can take the old ones down.
    fileprivate var painted: [(page: PDFPage, annotation: PDFAnnotation)] = []
    /// The rows the last paint used, for tracing a tap back to its row.
    fileprivate var highlights: [Highlight] = []

    var pageCount: Int { view?.document?.pageCount ?? 0 }

    /// The current page's frame on screen, in the stage view's coordinates —
    /// the chrome asks what is behind it against this.
    func pageFrame() -> CGRect? {
        guard let view, let page = view.currentPage else { return nil }
        return view.convert(page.bounds(for: .cropBox), from: page)
    }

    /// Re-express a window-space rect — SwiftUI's `.global` frames — in the
    /// stage view's coordinates.
    func stageRect(fromWindow rect: CGRect) -> CGRect? {
        guard let view else { return nil }
        return view.convert(rect, from: nil)
    }

    /// One snapshot of the stage's own pixels, taken once per chrome sample
    /// and cropped per control — a full-hierarchy render per control would
    /// be five screen renders a sample, one of them at the exact moment the
    /// chrome animates in. `afterScreenUpdates` is on: the sample wants the
    /// page that is actually on screen, not the last committed one, or a
    /// turn's sample can read the page that just left.
    ///
    /// Samples the `PDFView` alone — the SwiftUI chrome sits above it, so a
    /// sample can never include the thing it is choosing a colour for.
    func stageSnapshot() -> CGImage? {
        guard let view, view.bounds.width >= 2, view.bounds.height >= 2 else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.opaque = true
        format.scale = 1
        let snapshot = UIGraphicsImageRenderer(bounds: view.bounds, format: format).image { _ in
            view.drawHierarchy(in: view.bounds, afterScreenUpdates: true)
        }
        return snapshot.cgImage
    }

    /// Mean luminance of a stage snapshot under `rect` (view coordinates).
    func meanLuminance(of snapshot: CGImage, under rect: CGRect) -> Double? {
        guard let view else { return nil }
        let target = rect.intersection(view.bounds)
        guard !target.isNull, target.width >= 2, target.height >= 2 else { return nil }
        guard let crop = snapshot.cropping(to: target) else { return nil }
        return ReaderBackdrop.meanLuminance(of: crop)
    }

    func go(to page: Int) {
        guard let view, let document = view.document, document.pageCount > 0 else { return }
        let target = min(max(page, 0), document.pageCount - 1)
        guard let pdfPage = document.page(at: target), view.currentPage != pdfPage else { return }
        view.go(to: pdfPage)
    }

    func clearSelection() {
        view?.clearSelection()
        selection = nil
    }

    /// Replace every painted highlight with this set. List-driven, like the
    /// web glue: the screen hands over the whole list whenever it changes.
    func paint(_ highlights: [Highlight]) {
        self.highlights = highlights
        for (page, annotation) in painted { page.removeAnnotation(annotation) }
        painted = []
        guard let document = view?.document else { return }
        for highlight in highlights {
            guard let (page, annotation) = PDFHighlightPainter.annotation(for: highlight, in: document)
            else { continue }
            page.addAnnotation(annotation)
            painted.append((page, annotation))
        }
    }

    /// Where a stored highlight sits on screen right now, for the menu.
    func rects(of highlight: Highlight) -> [PageRect] {
        guard let view, let anchorText = highlight.epubCFIRange,
              let anchor = PDFAnchor.parse(anchorText),
              let page = view.document?.page(at: anchor.page)
        else { return [] }
        return anchor.quads.map { quad in
            let rect = view.convert(quad.boundingRect, from: page)
            return PageRect(x: rect.minX, y: rect.minY, width: rect.width, height: rect.height)
        }
    }
}

struct PDFStage: UIViewRepresentable {
    let document: PDFDocument
    let controller: PDFStageController
    let startPage: Int
    let onTap: (PDFTapZone) -> Void

    func makeUIView(context: Context) -> PDFView {
        let view = QuietPDFView()
        view.document = document
        view.displayMode = .singlePage
        view.displayDirection = .horizontal
        view.autoScales = true
        view.backgroundColor = .black
        view.pageShadowsEnabled = false
        view.usePageViewController(true, withViewOptions: [
            UIPageViewController.OptionsKey.interPageSpacing: 0,
        ])
        if let page = document.page(at: min(max(startPage, 0), max(document.pageCount - 1, 0))) {
            view.go(to: page)
        }
        controller.view = view
        context.coordinator.attach(to: view)
        return view
    }

    func updateUIView(_ uiView: PDFView, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(controller: controller, onTap: onTap)
    }

    @MainActor
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        private let controller: PDFStageController
        private let onTap: (PDFTapZone) -> Void
        private weak var view: PDFView?
        private var observers: [NSObjectProtocol] = []
        private var settle: Task<Void, Never>?
        private var singleTap: UITapGestureRecognizer?
        private var doubleTap: UITapGestureRecognizer?
        /// Whether the touch that began the current gesture landed on a
        /// painted highlight — decided at touch-down, because that is when
        /// UIKit asks which recogniser yields to which.
        private var touchOnHighlight = false

        init(controller: PDFStageController, onTap: @escaping (PDFTapZone) -> Void) {
            self.controller = controller
            self.onTap = onTap
        }

        deinit {
            for observer in observers { NotificationCenter.default.removeObserver(observer) }
        }

        func attach(to view: PDFView) {
            self.view = view
            let center = NotificationCenter.default
            observers.append(center.addObserver(
                forName: .PDFViewPageChanged, object: view, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated { self?.pageChanged() }
            })
            observers.append(center.addObserver(
                forName: .PDFViewSelectionChanged, object: view, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated { self?.selectionChanged() }
            })
            observers.append(center.addObserver(
                forName: .PDFViewScaleChanged, object: view, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated { self?.scaleChanged() }
            })

            // A single tap waits on the double so PDFKit's zoom doesn't also
            // turn a page — the same beat Apple Books takes.
            let double = UITapGestureRecognizer()
            double.numberOfTapsRequired = 2
            double.delegate = self
            double.cancelsTouchesInView = false
            view.addGestureRecognizer(double)
            let single = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
            single.numberOfTapsRequired = 1
            single.delegate = self
            single.cancelsTouchesInView = false
            single.require(toFail: double)
            view.addGestureRecognizer(single)
            singleTap = single
            doubleTap = double
        }

        /// The painted highlight under a point in the view, if any.
        private func paintedHighlight(at point: CGPoint) -> Highlight? {
            guard let view, let page = view.page(for: point, nearest: false),
                  let annotation = page.annotation(at: view.convert(point, to: page)),
                  PDFHighlightPainter.isPainted(annotation)
            else { return nil }
            return PDFHighlightPainter.highlight(for: annotation, in: controller.highlights)
        }

        private func pageChanged() {
            guard let view, let document = view.document, let current = view.currentPage else { return }
            let index = document.index(for: current)
            if controller.page != index { controller.page = index }
            // A turn leaves any selection, and any tapped highlight, behind
            // on the old page — a menu anchored to the old rects would
            // otherwise sit over the new one.
            if controller.selection != nil { controller.selection = nil }
            if controller.tappedHighlight != nil { controller.tappedHighlight = nil }
        }

        /// The stage reports every scale change mid-pinch; the chrome
        /// debounces its resample, so passing each one along is cheap.
        private func scaleChanged() {
            guard let view, controller.scaleFactor != view.scaleFactor else { return }
            controller.scaleFactor = view.scaleFactor
        }

        /// Settled selections only: PDFKit reports every handle movement, so
        /// wait a beat past the last one before raising the menu.
        private func selectionChanged() {
            settle?.cancel()
            settle = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled else { return }
                self?.reportSelection()
            }
        }

        private func reportSelection() {
            guard let view else { return }
            guard let selection = view.currentSelection, let page = view.currentPage,
                  let document = view.document,
                  var data = PDFHighlightPainter.selectionData(
                      selection, on: page, index: document.index(for: page)
                  )
            else {
                if controller.selection != nil { controller.selection = nil }
                return
            }
            data.rects = data.quads.map { quad in
                let rect = view.convert(quad.boundingRect, from: page)
                return PageRect(x: rect.minX, y: rect.minY, width: rect.width, height: rect.height)
            }
            if controller.selection != data { controller.selection = data }
        }

        @objc private func tapped(_ recognizer: UITapGestureRecognizer) {
            guard let view else { return }
            let point = recognizer.location(in: view)
            // With a selection up, a tap is PDFKit's to handle: it clears its
            // own selection and reports the change, which takes the menu
            // down. The release of the long press that *made* the selection
            // lands here too — a tap recogniser has no hold limit — so this
            // must not clear anything itself, or the menu dies on the way up.
            if view.currentSelection != nil { return }
            if controller.selection != nil {
                controller.selection = nil
                return
            }
            if let highlight = paintedHighlight(at: point) {
                controller.tappedHighlight = (highlight, controller.rects(of: highlight))
                return
            }
            if controller.tappedHighlight != nil {
                controller.tappedHighlight = nil
                return
            }
            let third = view.bounds.width / 3
            if point.x < third {
                onTap(.previous)
            } else if point.x > third * 2 {
                onTap(.next)
            } else {
                onTap(.toggle)
            }
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            true
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch
        ) -> Bool {
            if gestureRecognizer === singleTap, let view {
                touchOnHighlight = paintedHighlight(at: touch.location(in: view)) != nil
            }
            return true
        }

        /// A tap on a painted highlight is the app's alone. PDFKit's own tap
        /// recognisers — the ones that raise its markup menu over an
        /// annotation — yield to the single tap and fail when it lands, so
        /// the app's passage menu is the only one that opens. Everywhere
        /// else PDFKit keeps its taps: deselecting, double-tap zoom.
        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            gestureRecognizer === singleTap
                && touchOnHighlight
                && otherGestureRecognizer !== doubleTap
                && otherGestureRecognizer is UITapGestureRecognizer
        }
    }
}

/// A `PDFView` with no edit menu of its own: the passage menu is the app's,
/// and a system callout over it would offer a second, weaker set of verbs.
/// The edit menu is a `UIEditMenuInteraction` built through the responder
/// chain's menu builder, so it is emptied there — `canPerformAction` alone
/// no longer reaches it.
private final class QuietPDFView: PDFView {
    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        guard builder.system == .context else { return }
        builder.replaceChildren(ofMenu: .root) { _ in [] }
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        false
    }
}
