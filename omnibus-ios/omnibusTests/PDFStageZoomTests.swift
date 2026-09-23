//  PDFStageZoomTests.swift
//  The coordinator's half of persistent zoom: the layout apply, the capture
//  when the reader pinches, and the re-assert — not the wipe — when PDFKit
//  moves the scale on its own.

import PDFKit
import Testing
import UIKit

@testable import omnibus

@Suite("PDF stage zoom", .serialized)
@MainActor
struct PDFStageZoomTests {
    /// A stage wired the way `makeUIView` wires one — same configuration,
    /// same coordinator — standing in a real window, on scratch defaults so
    /// nothing touches the reader's real store.
    private func makeStage(
        initialZoom: Double? = nil,
        pageSize: CGSize = CGSize(width: 612, height: 792),
        defaults: UserDefaults? = nil
    ) throws -> (
        view: PDFView,
        controller: PDFStageController,
        coordinator: PDFStage.Coordinator,
        book: String,
        defaults: UserDefaults
    ) {
        let data = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: pageSize))
            .pdfData { context in
                context.beginPage()
                "Page".draw(at: CGPoint(x: 72, y: 72), withAttributes: [
                    .font: UIFont.systemFont(ofSize: 24),
                ])
            }
        let document = try #require(PDFDocument(data: data))
        let view = QuietPDFView(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
        PDFStage.configure(view, document: document)
        let controller = PDFStageController()
        let book = "test-zoom-\(UUID().uuidString)"
        let scratch = try #require(
            defaults ?? UserDefaults(suiteName: "test-zoom-\(UUID().uuidString)")
        )
        let coordinator = PDFStage.Coordinator(
            controller: controller,
            bookUUID: book,
            initialZoom: initialZoom,
            defaults: scratch,
            onTap: { _ in }
        )
        coordinator.attach(to: view)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
        window.addSubview(view)
        window.makeKeyAndVisible()
        view.layoutIfNeeded()
        coordinator.stageDidLayout(view.bounds)
        return (view, controller, coordinator, book, scratch)
    }

    /// The reader pinches to `multiple`: one note, one scale move, one
    /// notification — a real pinch's last movement and last scale change are
    /// simultaneous, and with causal attribution the capture needs nothing
    /// else. Deterministic by construction; no clock, no retry.
    private func settlePinch(
        _ coordinator: PDFStage.Coordinator,
        in view: PDFView,
        to multiple: Double,
        book: String,
        defaults: UserDefaults
    ) async throws -> Double? {
        let fit = view.scaleFactorForSizeToFit
        coordinator.notePinch()
        view.scaleFactor = fit * CGFloat(multiple)
        NotificationCenter.default.post(name: .PDFViewScaleChanged, object: view)
        try await Task.sleep(for: .milliseconds(1200))
        return PDFZoomStore.zoom(for: book, defaults: defaults)
    }

    @Test("first layout fits the page")
    func layoutFits() async throws {
        let (view, _, _, _, _) = try makeStage()
        try await Task.sleep(for: .milliseconds(800))
        #expect(abs(view.scaleFactor - view.scaleFactorForSizeToFit) < 0.01)
    }

    @Test("an oversized page still reaches fit")
    func oversizedPageFits() async throws {
        // A page whose fit lands below PDFKit's default 0.25 floor — an
        // ANSI D sheet in a phone viewport. The stage's own floor is fit.
        let (view, _, _, _, _) = try makeStage(pageSize: CGSize(width: 2400, height: 3100))
        try await Task.sleep(for: .milliseconds(800))
        let fit = view.scaleFactorForSizeToFit
        #expect(fit < 0.25, "the fixture must reach past PDFKit's default floor")
        #expect(abs(view.scaleFactor - fit) < 0.01)
    }

    @Test("a reader pinch is captured as the book's zoom")
    func pinchIsCaptured() async throws {
        let (view, controller, coordinator, book, defaults) = try makeStage()
        try await Task.sleep(for: .milliseconds(800))
        let fit = view.scaleFactorForSizeToFit
        coordinator.notePinch()
        view.scaleFactor = fit * 2
        NotificationCenter.default.post(name: .PDFViewScaleChanged, object: view)
        try await Task.sleep(for: .milliseconds(50))
        #expect(abs(controller.scaleFactor - fit * 2) < 0.05, "the observer republished")
        let stored = try await settlePinch(
            coordinator, in: view, to: 2, book: book, defaults: defaults
        )
        #expect(stored != nil)
        #expect(abs((stored ?? 0) - 2) < 0.05)
    }

    @Test("a scale that settles after the fingers lift is still the reader's")
    func lateSettleStillCaptured() async throws {
        // The bounce case: the pinch ends, the scroller settles a beat
        // later. Causal attribution must keep the gesture's ownership — a
        // temporal window would discard the pinch and snap back to fit.
        let (view, _, coordinator, book, defaults) = try makeStage()
        try await Task.sleep(for: .milliseconds(800))
        let fit = view.scaleFactorForSizeToFit
        coordinator.notePinch()
        view.scaleFactor = fit * 2.4
        NotificationCenter.default.post(name: .PDFViewScaleChanged, object: view)
        try await Task.sleep(for: .milliseconds(200))
        view.scaleFactor = fit * 2.2
        NotificationCenter.default.post(name: .PDFViewScaleChanged, object: view)
        try await Task.sleep(for: .milliseconds(1200))
        let stored = PDFZoomStore.zoom(for: book, defaults: defaults)
        #expect(stored != nil, "a late settle must not discard the pinch")
        #expect(abs((stored ?? 0) - 2.2) < 0.05, "the settled value is what is kept")
        #expect(abs(view.scaleFactor - fit * 2.2) < 0.01, "and the stage holds it")
    }

    @Test("PDFKit's own reset re-asserts the zoom instead of wiping it")
    func resetReasserts() async throws {
        let (view, _, coordinator, book, defaults) = try makeStage()
        try await Task.sleep(for: .milliseconds(800))
        let fit = view.scaleFactorForSizeToFit
        let stored = try await settlePinch(
            coordinator, in: view, to: 2, book: book, defaults: defaults
        )
        #expect(stored != nil)
        // PDFKit lays a page out and moves the scale by itself — no pinch.
        view.scaleFactor = fit
        NotificationCenter.default.post(name: .PDFViewScaleChanged, object: view)
        try await Task.sleep(for: .milliseconds(1200))
        #expect(
            PDFZoomStore.zoom(for: book, defaults: defaults) != nil,
            "an unattributed change must not delete the zoom"
        )
        #expect(abs(view.scaleFactor - fit * 2) < 0.01, "the stage re-asserts the remembered zoom")
    }

    @Test("a stored zoom is restored on first layout")
    func restoreOnLayout() async throws {
        let book = "test-zoom-\(UUID().uuidString)"
        let scratch = try #require(UserDefaults(suiteName: "test-zoom-\(UUID().uuidString)"))
        PDFZoomStore.setZoom(2.5, for: book, defaults: scratch)
        let (view, _, coordinator, _, _) = try makeStage(
            initialZoom: PDFZoomStore.zoom(for: book, defaults: scratch),
            defaults: scratch
        )
        try await Task.sleep(for: .milliseconds(400))
        // PDFKit finishes its own setup after the first pass and re-fits;
        // the app's `onLayout` fires again here, so the test does too.
        coordinator.stageDidLayout(view.bounds)
        try await Task.sleep(for: .milliseconds(400))
        let fit = view.scaleFactorForSizeToFit
        #expect(abs(view.scaleFactor - fit * 2.5) < 0.05)
    }
}
