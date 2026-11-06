//  QuoteCardView.swift
//  Turning a passage into something worth posting.
//
//  The card is a real SwiftUI view rendered twice: once at the width the sheet
//  has, and once at 1080pt for export. Every metric is a fraction of that
//  width, so the PNG the reader shares is exactly the card they were looking
//  at — a canvas renderer with its own font stack, which is how the web build
//  does it, can only ever approximate the preview.

import SwiftUI

extension String {
    /// One space per run of whitespace, ends trimmed.
    ///
    /// A passage carries the EPUB source file's own line breaks and
    /// indentation. They are invisible on the page, where the browser
    /// collapses them, and ragged everywhere else the text is re-set — a
    /// note, a paste, a quote card. Newer highlights are collapsed in the
    /// glue; rows the web client wrote, or this app wrote before that, are
    /// not, so anything re-setting a stored passage collapses it again here.
    var collapsingWhitespace: String {
        replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// A passage on its way to the quote-card sheet. Identity is per request, so
/// making a card of the same passage twice reopens the sheet.
struct QuoteRequest: Identifiable {
    let id = UUID()
    let text: String
}

/// A card background: a ground tone plus whether its ink is light or dark.
struct QuoteStyle: Identifiable {
    var id: String
    var base: OKLCH
    var lightInk: Bool

    /// A two-stop wash rather than a flat fill — a flat colour behind serif
    /// type reads as a placeholder, and the drift is what gives the card
    /// depth at thumbnail size.
    var gradient: LinearGradient {
        LinearGradient(
            colors: [
                OKLCH(base.l, base.c, base.h).color,
                OKLCH(
                    max(0.06, base.l - (lightInk ? 0.10 : -0.05)),
                    base.c * 0.85,
                    base.h + 12
                ).color,
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    var ink: Color {
        lightInk ? OKLCH(0.95, 0.012, base.h).color : OKLCH(0.24, 0.02, base.h).color
    }

    static func book(_ tone: OKLCH) -> QuoteStyle {
        QuoteStyle(id: "book", base: OKLCH(min(0.46, max(0.28, tone.l)), max(0.05, tone.c), tone.h), lightInk: true)
    }

    static let presets: [QuoteStyle] = [
        QuoteStyle(id: "ink", base: OKLCH(0.19, 0.012, 70), lightInk: true),
        QuoteStyle(id: "paper", base: OKLCH(0.93, 0.017, 80), lightInk: false),
        QuoteStyle(id: "moss", base: OKLCH(0.38, 0.075, 155), lightInk: true),
        QuoteStyle(id: "rose", base: OKLCH(0.44, 0.11, 15), lightInk: true),
        QuoteStyle(id: "dusk", base: OKLCH(0.36, 0.085, 285), lightInk: true),
        QuoteStyle(id: "sea", base: OKLCH(0.40, 0.075, 230), lightInk: true),
    ]
}

/// Card shapes, named for what they're for.
enum QuoteRatio: String, CaseIterable, Identifiable {
    case square, post, portrait, story

    var id: String { rawValue }

    var value: CGFloat {
        switch self {
        case .square: 1
        case .post: 4.0 / 5.0
        case .portrait: 3.0 / 4.0
        case .story: 9.0 / 16.0
        }
    }

    var label: String {
        switch self {
        case .square: "Square"
        case .post: "Post"
        case .portrait: "Portrait"
        case .story: "Story"
        }
    }

    /// The ratio itself, drawn under the name.
    var detail: String {
        switch self {
        case .square: "1:1"
        case .post: "4:5"
        case .portrait: "3:4"
        case .story: "9:16"
        }
    }
}

/// The typeface the passage is set in.
enum QuoteFace: String, CaseIterable {
    case serif, sans, mono

    var label: String {
        switch self {
        case .serif: "Serif"
        case .sans: "Sans"
        case .mono: "Mono"
        }
    }
}

/// How large the passage is set, as a multiple of its length-stepped size.
enum QuoteSize: String, CaseIterable {
    case s, m, l

    var label: String { rawValue.uppercased() }

    var scale: CGFloat {
        switch self {
        case .s: 0.85
        case .m: 1.0
        case .l: 1.18
        }
    }
}

/// Everything about the passage's type that a reader can change.
struct QuoteType: Equatable {
    var face = QuoteFace.serif
    var size = QuoteSize.m
    var bold = false
    var italic = false

    /// The passage face at `size` points. Only Cormorant's Regular, SemiBold
    /// and Italic cuts and Instrument Sans's Regular and SemiBold are bundled,
    /// so the combinations without a real cut are synthesised.
    func font(_ size: CGFloat) -> Font {
        switch face {
        case .serif:
            if italic {
                let base = Font.displayItalic(size)
                return bold ? base.bold() : base
            }
            return .display(size, weight: bold ? .semibold : .regular)
        case .sans:
            let base = Font.ui(size, weight: bold ? .semibold : .regular)
            return italic ? base.italic() : base
        case .mono:
            let base = Font.system(size: size, weight: bold ? .bold : .regular, design: .monospaced)
            return italic ? base.italic() : base
        }
    }
}

// MARK: - The card

/// The card itself. Draws identically at any width — every dimension below is
/// a fraction of `width`.
struct QuoteCard: View {
    let quote: String
    let title: String
    let author: String?
    let style: QuoteStyle
    let ratio: QuoteRatio
    let type: QuoteType
    let width: CGFloat

    private var height: CGFloat { width / ratio.value }
    private var pad: CGFloat { width * 0.094 }

    private var quoteSize: CGFloat {
        Self.passageSize(characters: quote.count, width: width, size: type.size)
    }

    private var text: String { quote.collapsingWhitespace }

    var body: some View {
        ZStack(alignment: .topLeading) {
            style.gradient

            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 0)

                // Takes its own layout space, so it moves with the passage and
                // can never sit on top of the first line.
                Text("\u{201C}")
                    .font(type.font(width * 0.30))
                    .foregroundStyle(style.ink.opacity(0.13))
                    .fixedSize()
                    .frame(height: width * 0.16, alignment: .topLeading)
                    .offset(x: -width * 0.035)
                    .accessibilityHidden(true)

                Text(text)
                    .font(type.font(quoteSize))
                    .foregroundStyle(style.ink)
                    .lineSpacing(quoteSize * 0.34)
                    .multilineTextAlignment(.leading)
                    .layoutPriority(1)
                    .minimumScaleFactor(0.55)

                Spacer(minLength: 0)

                Rectangle()
                    .fill(style.ink.opacity(0.22))
                    .frame(width: width * 0.14, height: max(1, width * 0.004))
                    .padding(.bottom, width * 0.042)

                if let author = author?.nilIfBlank {
                    Text(author.uppercased())
                        .font(.system(size: width * 0.026, weight: .semibold))
                        .tracking(width * 0.0036)
                        .foregroundStyle(style.ink.opacity(0.75))
                        .padding(.bottom, width * 0.012)
                }
                Text(title)
                    .font(.displayItalic(width * 0.033))
                    .foregroundStyle(style.ink.opacity(0.62))
                    .lineLimit(2)
            }
            .padding(pad)

            // The mark, quiet enough to be a signature rather than a watermark.
            Text("OMNIBUS")
                .font(.system(size: width * 0.021, weight: .semibold))
                .tracking(width * 0.006)
                .foregroundStyle(style.ink.opacity(0.34))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                .padding(pad)
        }
        .frame(width: width, height: height)
        .clipped()
    }
}

extension QuoteCard {
    /// Long passages step down rather than shrink to fit: a card whose type
    /// scales continuously with length has no typographic identity, and the
    /// steps keep every card recognisably the same object.
    nonisolated static func passageSize(characters: Int, width: CGFloat, size: QuoteSize) -> CGFloat {
        let step: CGFloat
        switch characters {
        case ..<90: step = 0.082
        case ..<180: step = 0.066
        case ..<320: step = 0.052
        case ..<520: step = 0.042
        default: step = 0.034
        }
        return width * step * size.scale
    }
}
