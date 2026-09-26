//  ReaderNativeSelectionTests.swift
//  WebKit's own selection stays off in the reader, at both layers.
//
//  XCUITest's synthesized touches never fire WebKit's text-interaction
//  recogniser, so the guards are asserted directly: the configuration flag,
//  and the host page's own declarations (#2655).

import Foundation
import Testing
import WebKit

@testable import omnibus

@Suite("Reader native selection")
struct ReaderNativeSelectionTests {
    @Test("makeConfiguration switches WebKit's text interaction off")
    @MainActor
    func makeConfigurationDisablesTextInteraction() {
        let configuration = ReaderWebView.makeConfiguration(coordinator: coordinator())

        #expect(configuration.preferences.isTextInteractionEnabled == false)
    }

    @Test("makeConfiguration still installs the reader's scheme handler")
    @MainActor
    func makeConfigurationInstallsSchemeHandler() {
        let configuration = ReaderWebView.makeConfiguration(coordinator: coordinator())

        #expect(configuration.urlSchemeHandler(forURLScheme: ReaderWebView.scheme) != nil)
    }

    @Test("the bundled reader.html declares its host document unselectable")
    @MainActor
    func hostPageIsUnselectable() throws {
        let url = try #require(
            ReaderWebView.Coordinator.bundledAssetURL(named: "reader.html"),
            "reader.html is not in the app bundle"
        )
        let declarations = try hostRuleDeclarations(in: String(contentsOf: url, encoding: .utf8))

        #expect(declarations.contains("-webkit-user-select: none"))
        #expect(declarations.contains("user-select: none"))
        #expect(declarations.contains("-webkit-touch-callout: none"))
    }

    @MainActor
    private func coordinator() -> ReaderWebView.Coordinator {
        ReaderWebView.Coordinator(
            controller: ReaderController(settings: ReaderSettings()), bookUUID: "uuid"
        )
    }

    /// The declarations of the host `html, body` rule, each as `property: value`.
    /// Whole declarations, so a prefixed property can never stand in for the
    /// unprefixed one — and nothing here depends on how the file is indented.
    private func hostRuleDeclarations(in html: String) throws -> Set<String> {
        let stripped = html.replacingOccurrences(
            of: "(?s)/\\*.*?\\*/", with: "", options: .regularExpression
        )
        let rule = try #require(
            stripped.range(of: "html\\s*,\\s*body\\s*\\{[^}]*\\}", options: .regularExpression)
                .map { stripped[$0] },
            "no html, body rule in reader.html"
        )
        let body = rule.drop(while: { $0 != "{" }).dropFirst().dropLast()
        let declarations = body.split(separator: ";").map { declaration in
            declaration.split(separator: ":", maxSplits: 1)
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .joined(separator: ": ")
        }
        return Set(declarations.filter { !$0.isEmpty })
    }
}
