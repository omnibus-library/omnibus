//  ReaderNativeSelectionTests.swift
//  WebKit's own selection stays off in the reader, at both layers.
//
//  The glue owns the range and the host draws it, so a WebKit selection is
//  never wanted here — yet only the section iframe was ever made unselectable.
//  A long press the glue declined (above the first line, on an illustration)
//  fell through to WebKit's recogniser, which selected the iframe itself as one
//  block and washed the whole page (#2655). Neither guard is observable from a
//  screenshot the suite can take — XCUITest's synthesized touches never fire
//  that recogniser — so both are pinned here directly.

import Foundation
import Testing
import WebKit

@testable import omnibus

@Suite("Reader native selection")
struct ReaderNativeSelectionTests {
    @Test("makeConfiguration switches WebKit's text interaction off for the reader web view")
    @MainActor
    func makeConfigurationDisablesTextInteraction() {
        let controller = ReaderController(settings: ReaderSettings())
        let coordinator = ReaderWebView.Coordinator(controller: controller, bookUUID: "uuid")

        let configuration = ReaderWebView.makeConfiguration(coordinator: coordinator)

        #expect(configuration.preferences.isTextInteractionEnabled == false)
        // The seam must still carry what the reader needs to boot at all.
        #expect(configuration.urlSchemeHandler(forURLScheme: ReaderWebView.scheme) != nil)
    }

    @Test("the bundled reader.html declares its host document unselectable")
    func hostPageIsUnselectable() throws {
        let url = try #require(
            Bundle.main.url(forResource: "reader", withExtension: "html", subdirectory: "Web")
                ?? Bundle.main.url(forResource: "reader", withExtension: "html"),
            "reader.html is not in the app bundle"
        )
        let html = try String(contentsOf: url, encoding: .utf8)
        let hostRule = try #require(
            html.range(of: "html,\n      body {").map { html[$0.lowerBound...] },
            "the host html/body rule is not where this test expects it"
        )
        let ruleBody = hostRule.prefix(while: { $0 != "}" })

        #expect(ruleBody.contains("-webkit-user-select: none"))
        #expect(ruleBody.contains("user-select: none"))
        // The callout alone was the previous state, and was not enough.
        #expect(ruleBody.contains("-webkit-touch-callout: none"))
    }
}
