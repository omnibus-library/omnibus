//  PageCurlHost.swift
//  The Books-style page curl, drawn over the reader's web view.
//
//  UIKit curls view controllers, and the reader is one web view laying a
//  chapter out as columns, so what curls is snapshots (`CurlPages`): the page
//  in front of the reader and its neighbours, which the glue's `peek` shows in
//  place under a cover for a moment each. The live page sits underneath
//  throughout and is moved to the destination the moment a curl lands.

import SwiftUI
import UIKit
import WebKit

/// Drives a `UIPageViewController` curl over snapshots of the reader's pages.
@MainActor
final class PageCurlHost: NSObject {
    weak var webView: WKWebView?
    weak var controller: ReaderController?

    var isEnabled = false {
        didSet {
            guard isEnabled != oldValue else { return }
            pages = CurlPages()
            queuedTurns = 0
            if isEnabled { pageChanged() } else { announce() }
        }
    }

    private(set) var pager = PageCurlHost.makePager(spine: .min)
    private var pages = CurlPages()
    /// What the page was laid out as at the last capture; nil slides.
    private var layout: CurlLayout?
    /// Directions whose next page is in a chapter not yet laid out: nothing to
    /// snapshot, so a turn there crosses first and curls on its own.
    private var crossings: Set<Int> = []
    /// The directions the glue was last told are ours; it gives those swipes up.
    private var announced: Set<Int> = []
    /// A capture, curl or landing is under way; nothing else may start.
    private var busy = false
    /// What the page shows changed since the snapshots were taken.
    private var stale = true
    /// The pager turned the current pan into a transition.
    private var curlStarted = false
    /// Taps that arrived during a turn, signed by direction.
    private var queuedTurns = 0
    /// The position the snapshots were taken at.
    private var capturedCFI: String?
    private var acceptSamePosition = false
    private var captureTask: Task<Void, Never>?
    private weak var pan: UIPanGestureRecognizer?
    private weak var stage: UIView?
    private weak var pagerPanDelegate: (any UIGestureRecognizerDelegate)?

    func install(on stage: UIView) {
        self.stage = stage
        attachPager(to: stage)
        NotificationCenter.default.addObserver(
            self, selector: #selector(reduceMotionChanged),
            name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil
        )
    }

    /// A pager's spine is fixed when it is made, so a spread and a single
    /// column each need their own.
    private static func makePager(
        spine: UIPageViewController.SpineLocation
    ) -> UIPageViewController {
        let pager = UIPageViewController(
            transitionStyle: .pageCurl, navigationOrientation: .horizontal,
            options: [.spineLocation: NSNumber(value: spine.rawValue)]
        )
        pager.isDoubleSided = true
        return pager
    }

    private func attachPager(to stage: UIView) {
        pager.dataSource = self
        pager.delegate = self
        pager.view.isHidden = true
        pager.view.isUserInteractionEnabled = false
        stage.addSubview(pager.view)
        // The pager's own recognizers, moved to the stage so they still see
        // touches while the curl is hidden. Taps stay the glue's.
        for recognizer in pager.gestureRecognizers {
            guard let pan = recognizer as? UIPanGestureRecognizer else {
                recognizer.isEnabled = false
                continue
            }
            pagerPanDelegate = pan.delegate
            pan.delegate = self
            pan.addTarget(self, action: #selector(panChanged(_:)))
            stage.addGestureRecognizer(pan)
            self.pan = pan
        }
    }

    /// Swap in a pager with the spine `layout` turns about, and lay it over
    /// the band that spine is the middle of.
    func fit(_ layout: CurlLayout, spine: CGFloat?) {
        guard let stage else { return }
        if pager.spineLocation != layout.spineLocation {
            let parent = pager.parent
            adopt(by: nil)
            pager.view.removeFromSuperview()
            if let pan { stage.removeGestureRecognizer(pan) }
            pager = Self.makePager(spine: layout.spineLocation)
            attachPager(to: stage)
            adopt(by: parent)
        }
        pager.view.frame = layout.frame(in: stage.bounds, spine: spine)
    }

    func adopt(by parent: UIViewController?) {
        guard pager.parent !== parent else { return }
        if pager.parent != nil {
            pager.willMove(toParent: nil)
            pager.removeFromParent()
        }
        guard let parent else { return }
        parent.addChild(pager)
        pager.didMove(toParent: parent)
    }

    // MARK: - Keeping the snapshots current

    /// What the page shows changed, so every snapshot is stale. A relocate
    /// during a curl is the curl's own landing, and epub.js re-announces a
    /// landed page once its scroll event arrives. Anything else that repaints
    /// (a mark, a setting) lets the next relocate through even at the same
    /// position, since a reflow keeps its CFI.
    func pageChanged(byRelocate: Bool = false) {
        guard isEnabled, !(busy && byRelocate) else { return }
        if !byRelocate {
            acceptSamePosition = true
        } else if !acceptSamePosition, !stale, controller?.location?.cfi == capturedCFI {
            return
        } else {
            acceptSamePosition = false
        }
        stale = true
        announce()
        guard !busy else { return }
        captureTask?.cancel()
        captureTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(120))
            guard !Task.isCancelled else { return }
            await self?.capture()
        }
    }

    /// A capture skipped for a live selection runs once it is gone.
    func selectionCleared() {
        if stale { pageChanged() }
    }

    @objc private func reduceMotionChanged() {
        pageChanged()
    }

    private var curlsAtAll: Bool {
        isEnabled && layout != nil && !UIAccessibility.isReduceMotionEnabled
    }

    private var canCurl: Bool {
        guard curlsAtAll, !busy, !stale, let controller else { return false }
        return controller.isReady && controller.selection == nil
            && controller.tappedAnnotation == nil
    }

    private var paper: UIColor {
        UIColor(ReaderTheme.pageColor(controller?.settings.theme ?? ""))
    }

    /// Snapshot whatever the ring is missing, under a cover of the page in
    /// front so the peeks are never seen.
    private func capture() async {
        guard isEnabled, !busy, let webView, let controller, controller.isReady,
              controller.selection == nil
        else {
            if !busy { pager.view.isHidden = true }
            return
        }
        busy = true
        if stale { pages = CurlPages() }
        stale = false
        let settled = await call("return await OmnibusReader.whenSettled();") as? [String: Any]
        layout = CurlLayout(columns: settled?["columns"] as? Int)
        crossings = Set([1, -1].filter { settled?[$0 > 0 ? "next" : "prev"] as? String == "section" })
        let settledAt = controller.location?.cfi
        if curlsAtAll, let layout {
            fit(layout, spine: (settled?["spine"] as? NSNumber).map { CGFloat($0.doubleValue) })
            await fill(webView)
        } else {
            pages = CurlPages()
        }
        // A move that overlapped the capture arrived as a relocate while busy,
        // which `pageChanged` drops; the snapshots may straddle it.
        if controller.location?.cfi != settledAt { stale = true }
        capturedCFI = controller.location?.cfi
        busy = false
        pager.view.isHidden = true
        settle()
    }

    private func fill(_ webView: WKWebView) async {
        if pages[0] == nil {
            // Not stale: a web view that can't be snapshotted (the app is in
            // the background) would retry forever. No pages just means slides
            // until the page next changes.
            guard let current = await snapshot(webView) else { return }
            pages = CurlPages(current: current)
        }
        coverWithCurrent()
        var peeked = false
        for dir in [1, -1] where pages[dir] == nil {
            guard await peek(dir) else { continue }
            peeked = true
            pages[dir] = await snapshot(webView)
        }
        if peeked { _ = await peek(0) }
    }

    /// Catch up on a change that landed during a capture, else run a tap that
    /// queued behind it.
    private func settle() {
        announce()
        if stale {
            queuedTurns = 0
            pageChanged()
        } else if queuedTurns != 0 {
            let dir = queuedTurns.signum()
            queuedTurns -= dir
            tapTurn(dir)
        }
    }

    /// Tell the glue whether its taps are ours, and which swipes are.
    private func announce() {
        let ready = curlsAtAll && !stale
        let next = ready && (pages[1] != nil || crossings.contains(1))
        let prev = ready && (pages[-1] != nil || crossings.contains(-1))
        announced = Set([1, -1].filter { $0 > 0 ? next : prev })
        webView?.evaluateJavaScript(
            "OmnibusReader.setCurlReady(\(curlsAtAll), \(next), \(prev))"
        )
    }

    // MARK: - Turning

    /// A gutter tap the glue handed over.
    func tapTurn(_ dir: Int) {
        if busy {
            // Two ahead at most, so a burst can't keep turning after it stops.
            queuedTurns = queuedTurns.signum() == dir ? max(-2, min(2, queuedTurns + dir)) : dir
            return
        }
        guard canCurl else {
            controller?.slide(dir)
            return
        }
        if let image = pages[dir] {
            curl(dir, to: image) { [weak self] in await self?.land(dir) }
        } else {
            Task { await curlAcrossSection(dir) }
        }
    }

    private func curl(_ dir: Int, to image: UIImage, then landing: @escaping () async -> Void) {
        busy = true
        pager.view.isHidden = false
        pager.setViewControllers(
            turn(dir, to: image), direction: dir > 0 ? .forward : .reverse, animated: true
        ) { [weak self] _ in
            Task { @MainActor in await self?.finishCurl(dir, landing: landing) }
        }
    }

    /// UIKit can cut an animated set short, so land only if the page in front
    /// is the one the curl turned to. Otherwise start over from whatever the
    /// web view shows, which a chapter crossing has already moved.
    private func finishCurl(_ dir: Int, landing: () async -> Void) async {
        guard (pager.viewControllers?.first as? CurlPageController)?.side.offset == dir else {
            busy = false
            stale = true
            pager.view.isHidden = true
            settle()
            return
        }
        await landing()
    }

    /// The next chapter isn't laid out until the reader crosses into it, so
    /// there is no snapshot to curl to: cross first, under the cover, then curl
    /// to what landed.
    private func curlAcrossSection(_ dir: Int) async {
        busy = true
        guard let webView,
              await call("return OmnibusReader.neighbourKind(dir);", ["dir": dir]) as? String
                == "section"
        else {
            busy = false
            controller?.slide(dir)
            return
        }
        pager.view.isHidden = false
        guard await turnInstant(dir), let landed = await snapshot(webView) else {
            busy = false
            stale = true
            pager.view.isHidden = true
            settle()
            return
        }
        curl(dir, to: landed) { [weak self] in await self?.land(dir, destination: landed) }
    }

    /// Land in the web view the turn the curl just showed, then capture the
    /// one page the ring is now missing with the destination still covering.
    private func land(_ dir: Int, destination: UIImage? = nil) async {
        if destination == nil, !(await turnInstant(dir)) {
            stale = true
        } else {
            pages = pages.landed(dir, destination: destination)
        }
        busy = false
        await capture()
    }

    private func endWithoutTurn() {
        busy = false
        curlStarted = false
        pager.view.isHidden = true
        settle()
    }

    @objc private func panChanged(_ pan: UIPanGestureRecognizer) {
        switch pan.state {
        case .ended, .cancelled, .failed:
            // A pan the pager never turned into a transition leaves no delegate
            // callback to take the cover down.
            DispatchQueue.main.async { [weak self] in
                guard let self, self.busy, !self.curlStarted else { return }
                self.endWithoutTurn()
            }
        default:
            break
        }
    }

    private func coverWithCurrent() {
        guard let image = pages[0] else { return }
        pager.setViewControllers(shown(image, offset: 0), direction: .forward, animated: false)
        pager.view.isHidden = false
    }

    private func shown(_ image: UIImage, offset: Int) -> [UIViewController] {
        (layout ?? .single).shown(at: offset).map { side(image, $0) }
    }

    /// `image` is the page turned to; the page turned from is in the ring.
    private func turn(_ dir: Int, to image: UIImage) -> [UIViewController] {
        (layout ?? .single).turn(dir).map {
            side($0.offset == dir ? image : pages[$0.offset] ?? image, $0)
        }
    }

    private func side(_ image: UIImage, _ side: CurlSide) -> UIViewController {
        CurlPageController(image: image, side: side, layout: layout ?? .single, paper: paper)
    }

    // MARK: - Glue

    private func peek(_ dir: Int) async -> Bool {
        await call("return await OmnibusReader.peek(dir);", ["dir": dir]) as? Bool ?? false
    }

    private func turnInstant(_ dir: Int) async -> Bool {
        await call("return await OmnibusReader.turnInstant(dir);", ["dir": dir]) as? Bool ?? false
    }

    @discardableResult
    private func call(_ body: String, _ arguments: [String: Any] = [:]) async -> Any? {
        guard let webView else { return nil }
        return try? await webView.callAsyncJavaScript(
            body, arguments: arguments, contentWorld: .page
        )
    }

    /// What the web view shows under the curl. Taken in its coordinates, which
    /// are the stage's.
    private func snapshot(_ webView: WKWebView) async -> UIImage? {
        let configuration = WKSnapshotConfiguration()
        configuration.afterScreenUpdates = true
        configuration.rect = pager.view.frame
        return await withCheckedContinuation { continuation in
            webView.takeSnapshot(with: configuration) { image, _ in
                continuation.resume(returning: image)
            }
        }
    }
}

extension PageCurlHost: UIPageViewControllerDataSource {
    func pageViewController(
        _ pageViewController: UIPageViewController,
        viewControllerAfter viewController: UIViewController
    ) -> UIViewController? {
        (viewController as? CurlPageController).flatMap { pages.sequence.after($0.side) }
            .flatMap(page)
    }

    func pageViewController(
        _ pageViewController: UIPageViewController,
        viewControllerBefore viewController: UIViewController
    ) -> UIViewController? {
        (viewController as? CurlPageController).flatMap { pages.sequence.before($0.side) }
            .flatMap(page)
    }

    private func page(_ side: CurlSide) -> UIViewController? {
        pages[side.offset].map { self.side($0, side) }
    }
}

extension PageCurlHost: UIPageViewControllerDelegate {
    func pageViewController(
        _ pageViewController: UIPageViewController,
        willTransitionTo pendingViewControllers: [UIViewController]
    ) {
        curlStarted = true
    }

    func pageViewController(
        _ pageViewController: UIPageViewController,
        didFinishAnimating finished: Bool,
        previousViewControllers: [UIViewController],
        transitionCompleted completed: Bool
    ) {
        curlStarted = false
        let landed = (pageViewController.viewControllers?.first as? CurlPageController)?.side
        guard completed, let dir = landed?.offset, dir != 0 else {
            endWithoutTurn()
            return
        }
        Task { await land(dir) }
    }
}

extension PageCurlHost: UIGestureRecognizerDelegate {
    func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
        guard recognizer === pan, let pan, let stage else { return false }
        // Any horizontal travel, as the glue yields on: a curl follows a
        // diagonal finger, and refusing one here would leave the swipe dead.
        let moved = pan.translation(in: stage)
        guard moved.x != 0 else { return false }
        let dir = moved.x < 0 ? 1 : -1
        guard canCurl, pages[dir] != nil,
              pagerPanDelegate?.gestureRecognizerShouldBegin?(recognizer) ?? true
        else {
            // The glue gave this swipe up, so nothing else will turn the page.
            // When it can't be dragged — a turn in flight, a chapter not laid
            // out, a highlight's menu up — it turns as a tap there would: queued,
            // crossed then curled, or slid.
            if announced.contains(dir), abs(moved.x) > abs(moved.y),
               controller?.selection == nil {
                DispatchQueue.main.async { [weak self] in self?.tapTurn(dir) }
            }
            return false
        }
        busy = true
        pager.view.isHidden = false
        return true
    }

    func gestureRecognizer(
        _ recognizer: UIGestureRecognizer, shouldReceive touch: UITouch
    ) -> Bool {
        pagerPanDelegate?.gestureRecognizer?(recognizer, shouldReceive: touch) ?? true
    }
}
