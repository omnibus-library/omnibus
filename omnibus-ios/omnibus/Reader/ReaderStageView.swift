//  ReaderStageView.swift
//  The view `ReaderWebView` hands SwiftUI: the live web view, and over it the
//  page curl, which is shown only while it has something to draw. It also
//  reports the window it sits in, which is what decides where Two Pages fits.

import UIKit
import WebKit

final class ReaderStageView: UIView {
    let webView: WKWebView
    let curl: PageCurlHost

    /// Told when the window's size or safe areas change.
    var onScreenChange: ((ReaderScreen) -> Void)?
    /// Told whether a hinged phone is folded, as the hinge moves.
    var onFoldChange: ((Bool) -> Void)? {
        // The hinge's first update can land before anyone is listening.
        didSet { onFoldChange?(isFolded) }
    }
    private var isFolded = false
    private var reportedScreen: ReaderScreen?

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
                    isFolded = status == .closed || status == .partiallyOpen
                    onFoldChange?(isFolded)
                })
        }
        #endif
    }

    /// The window, not this view: the audio dock shortens the stage, which
    /// would understate the long side the landscape rule reads.
    private func reportScreen() {
        guard let window else { return }
        let screen = ReaderScreen(size: window.bounds.size, insets: window.safeAreaInsets)
        guard screen != reportedScreen else { return }
        reportedScreen = screen
        onScreenChange?(screen)
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
