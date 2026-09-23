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
    /// The book the stage is showing, so a settled zoom can be remembered
    /// for it.
    let bookUUID: String
    /// The zoom the reader left this book at — a multiple of fit-to-screen,
    /// `nil` for fit — applied once the stage has a size to fit against.
    let initialZoom: Double?

    func makeUIView(context: Context) -> PDFView {
        let view = QuietPDFView()
        PDFStage.configure(view, document: document)
        if let page = document.page(at: min(max(startPage, 0), max(document.pageCount - 1, 0))) {
            view.go(to: page)
        }
        controller.view = view
        let coordinator = context.coordinator
        view.onLayout = { [weak coordinator] bounds in
            coordinator?.stageDidLayout(bounds)
        }
        coordinator.attach(to: view)
        return view
    }

    /// The one place the stage's `PDFView` is configured. The gesture tests
    /// stand up the same view through this, so the walk's predicate cannot
    /// drift from what the app ships.
    static func configure(_ view: PDFView, document: PDFDocument) {
        view.document = document
        view.displayMode = .singlePage
        view.displayDirection = .horizontal
        // Fit is managed by the coordinator, not PDFKit: `autoScales`
        // re-fits on every page change, which is exactly the zoom loss the
        // reader is not supposed to have. The stage owns the scale.
        view.autoScales = false
        view.backgroundColor = .black
        view.pageShadowsEnabled = false
        view.usePageViewController(true, withViewOptions: [
            UIPageViewController.OptionsKey.interPageSpacing: 0,
        ])
    }

    func updateUIView(_ uiView: PDFView, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(
            controller: controller,
            bookUUID: bookUUID,
            initialZoom: initialZoom,
            onTap: onTap
        )
    }

    /// The gesture model, and the pinch wiring the zoom capture attributes
    /// by, in one pass over PDFKit's scroll views: the per-page scrollers —
    /// the zoomable ones, the only scroll views carrying a pinch — pan on
    /// two fingers only, and the page view controller's pager is capped to
    /// one, so a two-finger drag cannot chain to it at the page's content
    /// edge. Every one-finger drag then falls back to the pager, which
    /// turns pages at any zoom. Selection handles keep their own
    /// recognisers and never needed the scrollers' pan, so they are
    /// untouched.
    ///
    /// Returns the pinch recognisers it saw, so the caller can wire the
    /// zoom capture's attribution in the same pass.
    @discardableResult
    static func applyTwoFingerPanning(in view: UIView) -> [UIPinchGestureRecognizer] {
        var pinches: [UIPinchGestureRecognizer] = []
        var queue: [UIView] = [view]
        while let next = queue.popLast() {
            if let scroll = next as? UIScrollView {
                if let pinch = scroll.pinchGestureRecognizer {
                    pinches.append(pinch)
                    scroll.panGestureRecognizer.minimumNumberOfTouches = 2
                } else {
                    // The pager: one finger only, so a two-finger drag
                    // cannot chain to it at the page's content edge.
                    scroll.panGestureRecognizer.maximumNumberOfTouches = 1
                }
            }
            queue.append(contentsOf: next.subviews)
        }
        return pinches
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
        private let bookUUID: String
        /// Where the zoom store lives — scratch defaults in the tests, the
        /// standard suite in the app.
        private let defaults: UserDefaults
        /// The zoom multiple the stage should hold — `nil` for fit. Seeded
        /// from the store, updated by settled pinches and the reset tap.
        private var desiredZoom: Double?
        /// Set while the stage is applying its own scale, so the resulting
        /// notification is not mistaken for a reader pinch.
        private var isApplyingScale = false
        private var zoomCapture: Task<Void, Never>?
        /// The stage size the current scale was fitted against; a change
        /// means a re-fit (first layout, rotation).
        private var lastLayoutSize: CGSize = .zero
        /// The layout pass's re-assert, coalesced: layout fires on every
        /// scroll and zoom, so a pending enqueue is reused rather than
        /// stacked, and the newest size is the one that runs.
        private var layoutApplyPending = false
        private var pendingLayoutSize: CGSize = .zero
        /// Set when the reader's pinch is seen moving, consumed by the next
        /// settled capture — attribution is causal, not temporal. A scale
        /// change landing after the fingers lift (a zoom bounce settling,
        /// PDFKit laying a page out) still belongs to the pinch while no
        /// capture has run since; a change with no pinch behind it at all is
        /// still correctly unattributed.
        private var pinchSinceCapture = false
        /// The pinch recognisers already wired, so recycled page views do
        /// not register twice.
        private var wiredPinches = NSHashTable<UIPinchGestureRecognizer>.weakObjects()
        /// Whether the touch that began the current gesture landed on a
        /// painted highlight — decided at touch-down, because that is when
        /// UIKit asks which recogniser yields to which.
        private var touchOnHighlight = false

        init(
            controller: PDFStageController,
            bookUUID: String,
            initialZoom: Double?,
            defaults: UserDefaults = .standard,
            onTap: @escaping (PDFTapZone) -> Void
        ) {
            self.controller = controller
            self.bookUUID = bookUUID
            self.desiredZoom = initialZoom
            self.defaults = defaults
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
            let double = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
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

            reconfigureScrollers()
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
            // A turn must not re-fit a zoomed reader: PDFKit may reset the
            // scale while laying the new page out, so the stage's zoom is
            // re-asserted whenever the two disagree.
            if abs(view.scaleFactor - targetScale()) > 0.01 { applyScale() }
            // The pager recycles its page views; their pinches need wiring
            // and the new ones need the gesture model too.
            reconfigureScrollers()
        }

        /// The stage reports every scale change mid-pinch: the chrome
        /// debounces its resample off the republished scale, and a settled
        /// pinch decides the book's zoom, so the churn is waited out below.
        private func scaleChanged() {
            guard let view, controller.scaleFactor != view.scaleFactor else { return }
            controller.scaleFactor = view.scaleFactor
            // The stage's own applies are not the reader pinching.
            guard !isApplyingScale else { return }
            scheduleZoomCapture()
        }

        /// One pass for everything the stage needs from PDFKit's scroll
        /// views: the gesture model, and the pinch wiring the zoom capture
        /// attributes by. PDFKit builds and recycles page views as it goes,
        /// so this runs wherever they can change.
        private func reconfigureScrollers() {
            guard let view else { return }
            let pinches = PDFStage.applyTwoFingerPanning(in: view)
            for pinch in pinches where !wiredPinches.contains(pinch) {
                wiredPinches.add(pinch)
                pinch.addTarget(self, action: #selector(pinchChanged(_:)))
            }
        }

        @objc private func pinchChanged(_ recognizer: UIPinchGestureRecognizer) {
            guard recognizer.state == .changed else { return }
            notePinch()
        }

        /// The pinch's own signal, split out so the capture's attribution is
        /// testable without synthesising a gesture.
        func notePinch() {
            pinchSinceCapture = true
        }

        /// The scale the stage should be at right now: the remembered zoom
        /// (or fit) against the current size.
        private func targetScale() -> CGFloat {
            guard let view else { return 0 }
            return CGFloat(desiredZoom ?? 1.0) * view.scaleFactorForSizeToFit
        }

        /// Re-assert the stage's scale — first layout, rotation, a page
        /// change that moved it, or the reset tap. Returns whether the scale
        /// was actually set: before the stage has a size to fit against there
        /// is nothing to apply, and the layout that finally can must not be
        /// treated as already served.
        @discardableResult
        private func applyScale() -> Bool {
            guard let view else { return false }
            let fit = view.scaleFactorForSizeToFit
            guard fit > 0 else { return false }
            // PDFKit's own ceiling is an absolute 5.0 while the store's cap
            // is a multiple of fit: for a page that fits below 0.83, six
            // times fit is past PDFKit's limit, so an apply would land
            // clamped and a later capture would read the clamp as intent.
            // Pinning the ceiling to the cap keeps every apply exact.
            view.maxScaleFactor = fit * PDFZoomStore.maxZoom
            // And the floor: PDFKit's default 0.25 was fine while
            // `autoScales` managed the fit, but a page that fits below it —
            // an ANSI D sheet, a broadsheet scan — would clamp short of fit
            // and never converge. The stage's floor is the fit itself.
            view.minScaleFactor = fit
            isApplyingScale = true
            defer { isApplyingScale = false }
            view.scaleFactor = fit * CGFloat(desiredZoom ?? 1.0)
            return true
        }

        /// A settled pinch decides the book's zoom: past fit it is kept and
        /// remembered; at or under fit the stage returns to exact fit.
        private func scheduleZoomCapture() {
            zoomCapture?.cancel()
            zoomCapture = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(350))
                guard !Task.isCancelled else { return }
                self?.captureZoom()
            }
        }

        /// A settled scale change decides the book's zoom — but only when it
        /// was the reader's pinch. PDFKit resets the scale on its own while
        /// laying a page out, and an unattributed change must re-assert the
        /// remembered zoom rather than overwrite it: read as intent, a reset
        /// would delete the book's key.
        private func captureZoom() {
            guard let view else { return }
            let fit = view.scaleFactorForSizeToFit
            guard fit > 0 else { return }
            let readerPinched = pinchSinceCapture
            pinchSinceCapture = false
            guard readerPinched else {
                if abs(view.scaleFactor - targetScale()) > 0.01 { applyScale() }
                return
            }
            let multiple = Double(view.scaleFactor / fit)
            let settled = PDFZoomStore.settledZoom(forMultiple: multiple)
            if settled != desiredZoom {
                desiredZoom = settled
                PDFZoomStore.setZoom(settled, for: bookUUID, defaults: defaults)
            }
            // A pinch under fit lands on exact fit rather than lingering.
            if settled == nil, abs(view.scaleFactor - fit) > 0.01 { applyScale() }
        }

        /// The stage laid itself out — first layout, a rotation, or PDFKit
        /// still finishing its own setup. Re-fit, out of the layout pass:
        /// mutating the scale from inside `layoutSubviews` works, but it is
        /// the kind of thing an OS point release moves.
        func stageDidLayout(_ bounds: CGRect) {
            guard bounds.width > 1, bounds.height > 1 else { return }
            reconfigureScrollers()
            pendingLayoutSize = bounds.size
            guard !layoutApplyPending else { return }
            layoutApplyPending = true
            DispatchQueue.main.async { [weak self] in
                guard let self, let view = self.view else { return }
                self.layoutApplyPending = false
                let size = self.pendingLayoutSize
                // A same-size pass can still have moved the scale — PDFKit
                // re-fits during its own setup without a notification — so
                // the re-assert is driven by the drift, not the size alone.
                let drifted = abs(view.scaleFactor - self.targetScale()) > 0.01
                guard self.lastLayoutSize != size || drifted else { return }
                // The size is marked served only once the scale could
                // actually be applied; before there is a fit, the next
                // layout must try again.
                guard self.applyScale() else { return }
                self.lastLayoutSize = size
            }
        }

        /// The reader's own double-tap beat, the Apple Books one: zoomed, it
        /// returns to fit; at fit, it doubles the scale anchored on the
        /// tapped point. Both branches write the remembered zoom directly —
        /// a double-tap is not a pinch, so the capture path must not have to
        /// infer it. PDFKit's own double-tap always yields (see
        /// `shouldBeRequiredToFailBy`), so the two never race over a gesture.
        @objc private func doubleTapped(_ recognizer: UITapGestureRecognizer) {
            guard let view else { return }
            let fit = view.scaleFactorForSizeToFit
            guard fit > 0 else { return }
            if isZoomed {
                desiredZoom = nil
                PDFZoomStore.setZoom(nil, for: bookUUID, defaults: defaults)
                applyScale()
                return
            }
            let point = recognizer.location(in: view)
            guard let page = view.page(for: point, nearest: true) else { return }
            let pagePoint = view.convert(point, to: page)
            desiredZoom = 2.0
            PDFZoomStore.setZoom(2.0, for: bookUUID, defaults: defaults)
            applyScale()
            // Land the tapped point back under the finger, the way PDFKit's
            // own double-tap does.
            let anchor = CGRect(x: pagePoint.x - 1, y: pagePoint.y - 1, width: 2, height: 2)
            view.go(to: anchor, on: page)
        }

        private var isZoomed: Bool {
            guard let view else { return false }
            let fit = view.scaleFactorForSizeToFit
            return fit > 0 && view.scaleFactor > fit * CGFloat(PDFZoomStore.fitEpsilon)
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
            if gestureRecognizer === singleTap {
                return touchOnHighlight
                    && otherGestureRecognizer !== doubleTap
                    && otherGestureRecognizer is UITapGestureRecognizer
            }
            // The double-tap is the reader's own either way: zoomed it
            // resets, at fit it zooms in (below). PDFKit's own double-tap
            // always waits it out — otherwise the two race over one gesture,
            // and its zoom-in can land just before the reset reads the scale.
            if gestureRecognizer === doubleTap {
                return otherGestureRecognizer is UITapGestureRecognizer
            }
            return false
        }
    }
}

/// A `PDFView` with no edit menu of its own: the passage menu is the app's,
/// and a system callout over it would offer a second, weaker set of verbs.
/// The edit menu is a `UIEditMenuInteraction` built through the responder
/// chain's menu builder, so it is emptied there — `canPerformAction` alone
/// no longer reaches it.
final class QuietPDFView: PDFView {
    /// Called after every layout pass — the stage fits its scale once it
    /// has a size, re-fits after a rotation, and re-applies its gesture
    /// model once PDFKit's page views exist.
    var onLayout: ((CGRect) -> Void)?

    override func layoutSubviews() {
        super.layoutSubviews()
        onLayout?(bounds)
    }

    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        guard builder.system == .context else { return }
        builder.replaceChildren(ofMenu: .root) { _ in [] }
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        false
    }
}
