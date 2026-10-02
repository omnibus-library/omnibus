//  ReaderStageView.swift
//  The view `ReaderWebView` hands SwiftUI: the live web view, and over it the
//  page curl, which is shown only while it has something to draw.

import UIKit
import WebKit

final class ReaderStageView: UIView {
    let webView: WKWebView
    let curl: PageCurlHost

    init(webView: WKWebView, curl: PageCurlHost) {
        self.webView = webView
        self.curl = curl
        super.init(frame: .zero)
        addSubview(webView)
        curl.install(on: self)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func layoutSubviews() {
        super.layoutSubviews()
        let resized = webView.frame.size != bounds.size
        webView.frame = bounds
        curl.view.frame = bounds
        // The glue re-paginates to the new size, so every snapshot is stale.
        if resized { curl.pageChanged() }
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
