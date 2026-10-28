//  SpoilerBlurTests.swift
//  The spoiler renderer: the room it asks for around the text must not change
//  where the text wraps, it must blur the runs tagged for it under one plate
//  per span, and it must leave the prose after them sharp — pinned by
//  rendering to pixels, so a lost tag, a dropped blur or a leaked filter fails.

import SwiftUI
import Testing

@testable import omnibus

/// The layout a renderer was handed, read back after the draw.
private final class LayoutRecorder {
    var widest: CGFloat = 0
    var layout: Text.Layout?
}

/// Asks for `SpoilerRenderer`'s padding and records the layout that buys.
private struct RecordingRenderer: TextRenderer {
    let recorder: LayoutRecorder

    var displayPadding: EdgeInsets { SpoilerRenderer(plate: .clear).displayPadding }

    func draw(layout: Text.Layout, in ctx: inout GraphicsContext) {
        recorder.widest = layout.map { $0.typographicBounds.width }.max() ?? 0
        recorder.layout = layout
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

/// The lines `text` lays out on one unwrapped line's worth of room.
@MainActor
private func layoutLines(_ text: Text) -> [Text.Layout.Line] {
    let recorder = LayoutRecorder()
    _ = ImageRenderer(content: text.fixedSize().textRenderer(RecordingRenderer(recorder: recorder))).uiImage
    return recorder.layout.map { Array($0) } ?? []
}

@MainActor
@Test func spoilerRendererPlatesASpanCrossingAFontChangeAsOneRect() throws {
    // A bold name inside a spoiler is a second run; a plate per run notches.
    let lines = layoutLines(Text("\(Text("Alice").bold()) dies").customAttribute(SpoilerRun()))
    #expect(lines.count == 1)
    let line = try #require(lines.first)
    let runs = Array(line)
    #expect(runs.count > 1)
    #expect(runs.allSatisfy { $0[SpoilerRun.self] != nil })
    let plates = SpoilerRenderer.plates(line)
    #expect(plates.count == 1)
    let plate = try #require(plates.first)
    for run in runs { #expect(plate.contains(run.typographicBounds.rect)) }
}

@MainActor
@Test func spoilerRendererPlatesTwoSpansSplitByProseSeparately() {
    let lines = layoutLines(Text(
        "\(Text("Alice").customAttribute(SpoilerRun())) and \(Text("Bob").customAttribute(SpoilerRun()))"
    ))
    #expect(lines.count == 1)
    #expect(lines.first.map { SpoilerRenderer.plates($0).count } == 2)
}

/// Pixel rows per point at the scale `pixels` renders at.
private let pixelScale: CGFloat = 2

/// `view`'s pixels at a fixed size and scale, for comparing two renders.
@MainActor
private func pixels(_ view: some View, height: CGFloat = 90) -> [UInt8] {
    let renderer = ImageRenderer(
        content: view.frame(width: 280, height: height, alignment: .topLeading)
    )
    renderer.scale = pixelScale
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
@Test func spoilerRendererBlursTheTaggedRunWhenThePlateIsClear() {
    // A clear plate and no radius leave the blur as the only difference.
    let text = Text("she dies in the end").font(.display(18)).customAttribute(SpoilerRun())
    let blurred = pixels(text.textRenderer(SpoilerRenderer(plate: .clear)))
    let sharp = pixels(text.textRenderer(SpoilerRenderer(plate: .clear, radius: 0)))
    #expect(!blurred.isEmpty)
    #expect(blurred.count == sharp.count)
    #expect(blurred != sharp)
}

@MainActor
@Test func spoilerRendererLeavesProseAfterASpoilerSharp() {
    // The spoiler's blur must not leak into what is drawn after it: blank
    // lines keep its halo out of the rows the last line is compared on.
    let tail = "\n\n\n\nshe was gone in the end"
    let veiled = Text("\(Text("dies").customAttribute(SpoilerRun()))\(tail)").font(.display(18))
    let plain = Text("dies\(tail)").font(.display(18))
    let renderer = SpoilerRenderer(plate: .gray)
    let height: CGFloat = 170
    let veiledPixels = pixels(veiled.textRenderer(renderer), height: height)
    let plainPixels = pixels(plain.textRenderer(renderer), height: height)
    #expect(!veiledPixels.isEmpty)
    #expect(veiledPixels.count == plainPixels.count)
    #expect(veiledPixels != plainPixels)
    let rowBytes = Int(280 * pixelScale) * 4
    // The fifth line starts below 70pt; the spoiler's blur ends above it.
    let lastLine = Int(70 * pixelScale) * rowBytes
    let veiledTail = veiledPixels.dropFirst(lastLine)
    #expect(veiledTail.contains { $0 != 0 })
    #expect(veiledTail.elementsEqual(plainPixels.dropFirst(lastLine)))
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
