//  SpoilerBlur.swift
//  A hidden `||spoiler||` drawn the way the web draws one: the text blurred
//  over a faint plate. `Text` cannot blur part of itself, so the runs to hide
//  are tagged with `SpoilerRun` and `SpoilerRenderer` draws the tagged ones.

import SwiftUI

/// Tags a run of `Text` as a hidden spoiler, for `SpoilerRenderer` to blur.
struct SpoilerRun: TextAttribute {}

/// Draws every `SpoilerRun` blurred over a rounded plate, and the rest of the
/// text as usual — the web's `.spoiler` look.
struct SpoilerRenderer: TextRenderer {
    var plate: Color
    /// The web's `blur(5px)`.
    var radius: CGFloat = 5

    // Room for the blur above and below the glyphs, never beside them: SwiftUI
    // wraps the text for drawing at its width plus this padding, so side room
    // would run each line past its frame.
    var displayPadding: EdgeInsets {
        EdgeInsets(top: radius * 2, leading: 0, bottom: radius * 2, trailing: 0)
    }

    func draw(layout: Text.Layout, in ctx: inout GraphicsContext) {
        for line in layout {
            for run in line {
                guard run[SpoilerRun.self] != nil else {
                    ctx.draw(run)
                    continue
                }
                ctx.fill(
                    Path(roundedRect: run.typographicBounds.rect, cornerRadius: 3),
                    with: .color(plate)
                )
                var blurred = ctx
                blurred.addFilter(.blur(radius: radius))
                blurred.draw(run)
            }
        }
    }
}

/// A line from an always-visible surface, its veiled runs set blurred.
struct MaskedText: View {
    let runs: [MaskedRun]

    @Environment(\.palette) private var palette

    var body: some View {
        runs.reduce(Text(verbatim: "")) { line, run in
            switch run {
            case .text(let text): Text("\(line)\(Text(verbatim: text))")
            case .veiled(let filler): Text("\(line)\(Text(verbatim: filler).customAttribute(SpoilerRun()))")
            }
        }
        .textRenderer(SpoilerRenderer(plate: palette.bg2Color))
        .accessibilityLabel(JournalMarkdown.spoken(runs))
    }
}
