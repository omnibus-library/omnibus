//  SpoilerBlurTests.swift
//  The spoiler renderer: the room it asks for around the text must not change
//  where the text wraps, and it must actually blur the runs tagged for it —
//  pinned by rendering to pixels, so a lost tag or a dropped blur fails.

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

/// `view`'s pixels at a fixed size and scale, for comparing two renders.
@MainActor
private func pixels(_ view: some View) -> [UInt8] {
    let renderer = ImageRenderer(
        content: view.frame(width: 280, height: 90, alignment: .topLeading)
    )
    renderer.scale = 2
    guard let image = renderer.cgImage else { return [] }
    var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
    let drew = bytes.withUnsafeMutableBytes { buffer -> Bool in
        guard let ctx = CGContext(
            data: buffer.baseAddress,
            width: image.width,
            height: image.height,
            bitsPerComponent: 8,
            bytesPerRow: image.width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return false }
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return true
    }
    return drew ? bytes : []
}

@MainActor
@Test func journalBodyBlursAHiddenSpoilerThatPlainTextLeavesSharp() {
    // Unrevealable, so the spoiler carries no link: the SpoilerRun tag —
    // carried through the body's Text interpolation — is the only difference.
    let hidden = pixels(JournalBody(md: "she ||dies|| in the end", revealable: false))
    let plain = pixels(JournalBody(md: "she dies in the end", revealable: false))
    #expect(!hidden.isEmpty)
    #expect(hidden.count == plain.count)
    #expect(hidden != plain)
}

@MainActor
@Test func maskedTextBlursItsVeiledRunsAndLeavesTheProseAsIs() {
    let veiled = pixels(MaskedText(runs: [.text("she "), .veiled("lore"), .text(" in the end")]))
    let plain = pixels(MaskedText(runs: [.text("she "), .text("lore"), .text(" in the end")]))
    #expect(!veiled.isEmpty)
    #expect(veiled != plain)
}

@MainActor
@Test func spoilerRendererDrawsUntaggedTextExactlyAsPlainTextDoes() {
    // A revealed span drops its tag, so it must render as if no spoiler
    // renderer were there at all.
    let text = Text("she dies in the end").font(.display(18))
    let rendered = pixels(text.textRenderer(SpoilerRenderer(plate: .gray)))
    let plain = pixels(text)
    #expect(!rendered.isEmpty)
    #expect(rendered == plain)
}
