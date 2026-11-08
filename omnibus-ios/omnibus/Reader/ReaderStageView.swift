//  ReaderStageView.swift
//  The view `ReaderWebView` hands SwiftUI: the live web view, and over it the
//  page curl, which is shown only while it has something to draw. It also
//  reports the window it sits in, which is what decides where Two Pages fits.

import UIKit
import WebKit

final class ReaderStageView: UIView {
    let webView: WKWebView
    let curl: PageCurlHost

    /// Told when the window's size or safe areas change, whether the status bar was
    /// hidden when they were read, and the top inset the page itself was handed.
    var onScreenChange: ((ReaderScreen, _ statusBarHidden: Bool, _ pageTop: CGFloat) -> Void)?
    /// Told whether a hinged phone is folded, as the hinge moves.
    var onFoldChange: ((Bool) -> Void)?
    /// The edge an iPhone Duo runs its bars down, whose column the page takes
    /// back; nil elsewhere. The reader keeps the status bar hidden while one is set.
    var sideColumnEdge: UIRectEdge? {
        didSet { if sideColumnEdge != oldValue { reportScreen() } }
    }
    private var reportedScreen: ReaderScreen?
    private var reportedStatusBarHidden: Bool?
    private var reportedPageTop: CGFloat?

    init(webView: WKWebView, curl: PageCurlHost) {
        self.webView = webView
        self.curl = curl
        super.init(frame: .zero)
        addSubview(webView)
        curl.install(on: self)
        observeHinge()
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func layoutSubviews() {
        super.layoutSubviews()
        let resized = webView.frame.size != bounds.size
        webView.frame = bounds
        // The glue re-paginates to the new size, so every snapshot is stale;
        // the curl is laid over the new page when it is next captured.
        if resized { curl.pageChanged() }
        reportScreen()
    }

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        reportScreen()
    }

    /// Partially open counts as folded: the app is still on the outer screen
    /// while a phone is opening, and the note shouldn't drop out under it.
    private func observeHinge() {
        // UIKit in the iOS 27.1 SDK, the first with `UIHingeInteraction`; an
        // older SDK compiles this out and never learns of a fold.
        #if canImport(UIKit, _version: 9127.0.85)
        if #available(iOS 27.1, *) {
            addInteraction(
                UIHingeInteraction { [weak self] _, update in
                    guard let self else { return }
                    let status = update.hinge?.status
                    onFoldChange?(status == .closed || status == .partiallyOpen)
                })
        }
        #endif
    }

    /// The window, not this view: the audio dock shortens the stage, which
    /// would understate the long side the landscape rule reads. The page top is
    /// this view's own, which the web view's `env()` resolves from: an open iPhone
    /// Duo's window keeps its top inset with the status bar hidden, while the
    /// view's drops to zero.
    private func reportScreen() {
        guard let window else { return }
        var screen = ReaderScreen(size: window.bounds.size, insets: window.safeAreaInsets)
        let statusBarHidden = window.windowScene?.statusBarManager?.isStatusBarHidden ?? false
        let pageTop = safeAreaInsets.top
        screen.stageInsets = reclaimedInsets(in: window, screen: screen)
        guard screen != reportedScreen || statusBarHidden != reportedStatusBarHidden
            || pageTop != reportedPageTop
        else { return }
        reportedScreen = screen
        reportedStatusBarHidden = statusBarHidden
        reportedPageTop = pageTop
        onScreenChange?(screen, statusBarHidden, pageTop)
    }

    /// The side column given back, or nil where the stage keeps the safe area.
    ///
    /// Gated on the reader's policy, not the live bar: a sheet over the reader that
    /// shows the status bar (the player's) would otherwise reflow the page behind it.
    private func reclaimedInsets(in window: UIWindow, screen: ReaderScreen) -> UIEdgeInsets? {
        // The occlusion regions are UIKit in the iOS 27.1 SDK, like the hinge.
        #if canImport(UIKit, _version: 9127.0.85)
        if #available(iOS 27.1, *), let edge = sideColumnEdge {
            let occlusions = window.reservedRegions(kind: .occlusion, options: [])
                .filter(\.isActive)
                .map(\.frame)
            let reclaimed = ReaderScreen.reclaimingSideColumn(
                edge, safe: screen.insets, size: screen.size, occlusions: occlusions
            )
            return reclaimed == screen.insets ? nil : reclaimed
        }
        #endif
        return nil
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        curl.adopt(by: window == nil ? nil : nearestViewController)
    }

    private var nearestViewController: UIViewController? {
        var responder = next
        while let current = responder {
            if let controller = current as? UIViewController { return controller }
            responder = current.next
        }
        return nil
    }
}
