//  SpoilerBlurTests.swift
//  The spoiler renderer's padding: the room it asks for around the text must
//  not change where the text wraps.

import SwiftUI
import Testing

@testable import omnibus

/// The layout a renderer was handed, read back after the draw.
private final class LayoutRecorder {
    var widest: CGFloat = 0
}

/// Asks for `SpoilerRenderer`'s padding and records the layout that buys.
private struct RecordingRenderer: TextRenderer {
    let recorder: LayoutRecorder

    var displayPadding: EdgeInsets { SpoilerRenderer(plate: .clear).displayPadding }

    func draw(layout: Text.Layout, in ctx: inout GraphicsContext) {
        recorder.widest = layout.map { $0.typographicBounds.width }.max() ?? 0
        for line in layout { ctx.draw(line) }
    }
}

@MainActor
@Test func spoilerRendererPaddingKeepsEveryLineInsideTheTextFrame() {
    // Side padding widens the width SwiftUI wraps at when drawing, so a long
    // paragraph's lines ran past the review card's edge.
    let recorder = LayoutRecorder()
    let view = Text("I think how much I cared about tiny details is a sign the book as a whole is very good, and then the turning point arrives.")
        .font(.display(18))
        .frame(width: 280, alignment: .leading)
        .textRenderer(RecordingRenderer(recorder: recorder))
    _ = ImageRenderer(content: view).uiImage
    #expect(recorder.widest > 0)
    #expect(recorder.widest <= 280)
}
