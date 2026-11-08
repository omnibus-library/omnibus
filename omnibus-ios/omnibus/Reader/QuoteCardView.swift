//  QuoteCardView.swift
//  Turning a passage into something worth posting.
//
//  The card is a real SwiftUI view rendered twice: once at the width the sheet
//  has, and once at 1080pt for export. Every metric is a fraction of that
//  width, so the PNG the reader shares is exactly the card they were looking
//  at — a canvas renderer with its own font stack, which is how the web build
//  does it, can only ever approximate the preview.

import SwiftUI
import UIKit

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

/// A card background: two stops, the angle between them, and the ink drawn on top.
struct QuoteStyle: Identifiable {
    enum Kind: Hashable { case solid, gradient }

    /// What VoiceOver reads on the swatch.
    var name: String
    var kind: Kind
    var from: OKLCH
    var to: OKLCH
    // Not `ink`: `OKLCH` has its own `opacity(_:)`, which would shadow
    // `Color`'s in `.foregroundStyle(style.ink.opacity(…))`.
    var inkTone: OKLCH
    var angle = 135

    var id: String { "\(kind)-\(name)" }

    var lightInk: Bool { inkTone.l > 0.5 }

    var ink: Color { inkTone.color }

    var gradient: LinearGradient {
        let ends = Self.points(angle)
        return LinearGradient(colors: [from.color, to.color], startPoint: ends.start, endPoint: ends.end)
    }

    /// A two-stop wash rather than a flat fill — a flat colour behind serif
    /// type reads as a placeholder, and the drift is what gives the card
    /// depth at thumbnail size.
    static func solid(_ name: String, _ base: OKLCH, lightInk: Bool) -> QuoteStyle {
        QuoteStyle(
            name: name,
            kind: .solid,
            from: base,
            to: OKLCH(max(0.06, base.l - (lightInk ? 0.10 : -0.05)), base.c * 0.85, base.h + 12),
            inkTone: lightInk ? OKLCH(0.95, 0.012, base.h) : OKLCH(0.24, 0.02, base.h)
        )
    }

    /// A preset or cover pair, drawn as exactly its two stops. `nil` when
    /// either hex does not parse.
    static func gradient(_ name: String, from: String, to: String, lightInk: Bool) -> QuoteStyle? {
        guard let start = OKLCH.parse(cssValue: from), let end = OKLCH.parse(cssValue: to) else { return nil }
        return QuoteStyle(
            name: name,
            kind: .gradient,
            from: start,
            to: end,
            inkTone: lightInk ? lightHexInk : darkHexInk
        )
    }

    static func book(_ tone: OKLCH) -> QuoteStyle {
        solid("Book", OKLCH(min(0.46, max(0.28, tone.l)), max(0.05, tone.c), tone.h), lightInk: true)
    }

    static let solids: [QuoteStyle] = [
        solid("Ink", OKLCH(0.19, 0.012, 70), lightInk: true),
        solid("Paper", OKLCH(0.93, 0.017, 80), lightInk: false),
        solid("Moss", OKLCH(0.38, 0.075, 155), lightInk: true),
        solid("Rose", OKLCH(0.44, 0.11, 15), lightInk: true),
        solid("Dusk", OKLCH(0.36, 0.085, 285), lightInk: true),
        solid("Sea", OKLCH(0.40, 0.075, 230), lightInk: true),
    ]

    static let gradients: [QuoteStyle] = [
        ("Ember", "#7a1f16", "#a24c16", true),
        ("Dusk", "#2e2660", "#9a4060", true),
        ("Lagoon", "#0b4a5a", "#26357f", true),
        ("Grove", "#183f2a", "#7a5c18", true),
        ("Dawn", "#f7e1c8", "#eeb0a8", false),
    ].compactMap { QuoteStyle.gradient($0.0, from: $0.1, to: $0.2, lightInk: $0.3) }

    /// A picked colour as a solid; its ink follows the ground's contrast.
    static func customSolid(_ base: OKLCH) -> QuoteStyle {
        let lightInk = prefersLightInk(
            over: [base],
            light: OKLCH(0.95, 0.012, base.h),
            dark: OKLCH(0.24, 0.02, base.h)
        )
        return solid("Custom colour", base, lightInk: lightInk)
    }

    static func customGradient(from: OKLCH, to: OKLCH, angle: Int) -> QuoteStyle {
        let lightInk = prefersLightInk(over: [from, to], light: lightHexInk, dark: darkHexInk)
        return QuoteStyle(
            name: "Custom gradient",
            kind: .gradient,
            from: from,
            to: to,
            inkTone: lightInk ? lightHexInk : darkHexInk,
            angle: angle
        )
    }

    // The web's `LIGHT_INK` and its dark counterpart.
    private static let lightHexInk = OKLCH.fromSRGB(r: 0xf5 / 255.0, g: 0xf0 / 255.0, b: 0xe8 / 255.0)
    private static let darkHexInk = OKLCH.fromSRGB(r: 0x22 / 255.0, g: 0x1d / 255.0, b: 0x18 / 255.0)

    /// Whether light ink reads better than dark over every stop: the ink
    /// whose weakest contrast against any stop is the higher one wins, and a
    /// tie goes to light.
    static func prefersLightInk(over stops: [OKLCH], light: OKLCH, dark: OKLCH) -> Bool {
        func weakest(_ ink: OKLCH) -> Double {
            stops.map { ink.contrast(with: $0) }.min() ?? 0
        }
        return weakest(light) >= weakest(dark)
    }

    /// The gradient line for a CSS-style angle (0 up, 90 right), in 45° steps.
    static func points(_ angle: Int) -> (start: UnitPoint, end: UnitPoint) {
        switch ((angle % 360) + 360) % 360 / 45 {
        case 0: return (start: .bottom, end: .top)
        case 1: return (start: .bottomLeading, end: .topTrailing)
        case 2: return (start: .leading, end: .trailing)
        case 3: return (start: .topLeading, end: .bottomTrailing)
        case 4: return (start: .top, end: .bottom)
        case 5: return (start: .topTrailing, end: .bottomLeading)
        case 6: return (start: .trailing, end: .leading)
        default: return (start: .bottomTrailing, end: .topLeading)
        }
    }
}

extension OKLCH {
    /// WCAG relative luminance of the colour as it lands in sRGB.
    var luminance: Double {
        func linear(_ channel: Double) -> Double {
            channel <= 0.03928 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
        }
        let (r, g, b) = components
        return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
    }

    /// WCAG contrast ratio against `other`, from 1 up to 21.
    func contrast(with other: OKLCH) -> Double {
        let lighter = max(luminance, other.luminance)
        let darker = min(luminance, other.luminance)
        return (lighter + 0.05) / (darker + 0.05)
    }

    /// A `ColorPicker` result. It can be extended-range or P3, so each channel
    /// is clamped into sRGB first.
    static func from(_ color: Color) -> OKLCH {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        _ = UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a)
        func clamped(_ channel: CGFloat) -> Double { Double(min(1, max(0, channel))) }
        return fromSRGB(r: clamped(r), g: clamped(g), b: clamped(b))
    }

    /// Lowercase `#rrggbb`.
    var hex: String {
        let (r, g, b) = components
        return String(format: "#%02x%02x%02x", Int((r * 255).rounded()), Int((g * 255).rounded()), Int((b * 255).rounded()))
    }
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

    var label: String { rawValue.capitalized }
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
    /// so the rest are synthesised. Sans italic is skewed inside the font, so
    /// it survives `ImageRenderer`, which drops `Font.italic()` on a custom face.
    func font(_ size: CGFloat) -> Font {
        switch face {
        case .serif:
            if italic {
                let base = Font.displayItalic(size)
                return bold ? base.bold() : base
            }
            return .display(size, weight: bold ? .semibold : .regular)
        case .sans:
            if let font = sansFont(size) { return Font(font) }
            return .ui(size, weight: bold ? .semibold : .regular)
        case .mono:
            let base = Font.system(size: size, weight: bold ? .bold : .regular, design: .monospaced)
            return italic ? base.italic() : base
        }
    }
}

extension QuoteType {
    /// The `.sans` passage face; italic is a skewed descriptor since no Instrument Sans italic is bundled.
    func sansFont(_ size: CGFloat) -> UIFont? {
        let name = Font.UIFace.name(for: bold ? .semibold : .regular)
        // The descriptor initialiser substitutes a system font for an unknown name.
        guard UIFont(name: name, size: size) != nil else { return nil }
        // Glyph space is y-up, so a positive `c` leans right (~11°).
        let skew = italic ? CGAffineTransform(a: 1, b: 0, c: 0.2, d: 1, tx: 0, ty: 0) : .identity
        return UIFont(descriptor: UIFontDescriptor(name: name, matrix: skew), size: size)
    }
}

/// The colour pairs the server pulls from a book's cover. The endpoint is
/// optional: an older server answers 404 and the Gradient row goes without.
struct CoverPalette: Decodable, Sendable {
    struct Pair: Decodable, Sendable {
        var from: String
        var to: String
        var ink: String
    }

    var pairs: [Pair]

    /// One gradient swatch per readable pair, numbered over the pairs kept.
    var styles: [QuoteStyle] {
        var styles: [QuoteStyle] = []
        for pair in pairs {
            let name = "Cover \(styles.count + 1)"
            if let style = QuoteStyle.gradient(name, from: pair.from, to: pair.to, lightInk: pair.ink != "dark") {
                styles.append(style)
            }
        }
        return styles
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
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(title)
                    .font(.displayItalic(width * 0.033))
                    .foregroundStyle(style.ink.opacity(0.62))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
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
