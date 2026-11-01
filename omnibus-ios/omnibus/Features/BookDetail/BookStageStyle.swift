//  BookStageStyle.swift
//  The book page's visual vocabulary: the steps of a book's own color, the
//  ribbon, the tab strip, and the round and pill controls the page and its
//  sheets share.

import SwiftUI

extension Palette {
    private var isLightGround: Bool { bg0.l > 0.5 }

    /// The ribbon and a filled division of the progress bar.
    var bookRibbon: Color { OKLCH(isLightGround ? 0.55 : 0.62, accent.c, accent.h).color }
    /// Stars and links: the accent as text, readable on this theme's ground.
    var bookText: Color { OKLCH(isLightGround ? 0.42 : 0.80, accent.c, accent.h).color }
    /// The primary action's ground. Dark enough for white at every hue.
    var bookDeep: Color { OKLCH(0.44, accent.c, accent.h).color }
    /// The covered part of the primary action.
    var bookFill: Color { OKLCH(0.52, accent.c, accent.h).color }
    /// A tint of the book's color behind a quiet control.
    var bookWash: Color { OKLCH(0.62, accent.c, accent.h, 0.16).color }
    /// The rim on a washed control.
    var bookRim: Color { OKLCH(isLightGround ? 0.42 : 0.80, accent.c, accent.h, 0.22).color }
    /// A control's ground where only ink shows through.
    var quietFill: Color { ink0Color.opacity(0.1) }
}

extension HighlightColor {
    var tint: Color {
        switch self {
        case .amber: OKLCH(0.80, 0.14, 80).color
        case .green: OKLCH(0.78, 0.13, 150).color
        case .blue: OKLCH(0.72, 0.12, 250).color
        case .rose: OKLCH(0.72, 0.15, 15).color
        case .violet: OKLCH(0.70, 0.14, 300).color
        }
    }
}

/// A bookmark's silhouette, with the notch at its foot.
struct RibbonShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.minY + rect.height * 38 / 46))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

/// The ribbon hanging from the tab strip: a shaded top where it folds over and
/// a stitched line down each side.
private struct HangingRibbon: View {
    @Environment(\.palette) private var palette

    var body: some View {
        RibbonShape()
            .fill(palette.bookRibbon)
            .overlay(alignment: .top) {
                Rectangle().fill(.black.opacity(0.35)).frame(height: 3.5)
            }
            .overlay {
                HStack {
                    stitch
                    Spacer()
                    stitch
                }
                .padding(.horizontal, 3)
                .padding(.top, 5)
                .padding(.bottom, 4)
            }
            .clipShape(RibbonShape())
            .shadow(color: .black.opacity(0.5), radius: 2, x: 1, y: 3)
    }

    private var stitch: some View {
        Rectangle()
            .stroke(.white.opacity(0.18), style: StrokeStyle(lineWidth: 1, dash: [2, 2]))
            .frame(width: 0.5)
    }
}

/// The page's four tabs, and the ribbon that swings across them.
struct BookTabStrip: View {
    let selected: BookTab
    var onPick: (BookTab) -> Void

    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Which way the ribbon last travelled, for the way it swings to rest.
    @State private var direction: Double = 1
    @State private var swings = 0

    private static let inset: CGFloat = 16
    private static let ribbonWidth: CGFloat = 20

    var body: some View {
        HStack(spacing: 0) {
            ForEach(BookTab.allCases) { tab in
                Button {
                    guard tab != selected else { return }
                    Haptics.select()
                    direction = tab.rawValue > selected.rawValue ? 1 : -1
                    swings += 1
                    onPick(tab)
                } label: {
                    Text(tab.label)
                        .font(.ui(16, weight: tab == selected ? .semibold : .medium))
                        .foregroundStyle(tab == selected ? palette.ink0Color : palette.ink1Color)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(tab == selected ? .isSelected : [])
                .accessibilityIdentifier("book-tab-\(tab.label.lowercased())")
            }
        }
        .padding(.horizontal, Self.inset)
        .background {
            ZStack {
                Rectangle().fill(.ultraThinMaterial)
                palette.bg0Color.opacity(0.78)
            }
        }
        .overlay(alignment: .bottom) { Hairline() }
        .overlay(alignment: .bottomLeading) { ribbon }
    }

    private var ribbon: some View {
        GeometryReader { geometry in
            let cell = (geometry.size.width - Self.inset * 2) / CGFloat(BookTab.allCases.count)
            let x = Self.inset + cell * (CGFloat(selected.rawValue) + 0.5) - Self.ribbonWidth / 2

            HangingRibbon()
                .frame(width: Self.ribbonWidth, height: 38)
                .keyframeAnimator(initialValue: 0.0, trigger: swings) { view, angle in
                    view.rotationEffect(.degrees(reduceMotion ? 0 : angle), anchor: .top)
                } keyframes: { _ in
                    KeyframeTrack {
                        CubicKeyframe(direction * -10, duration: 0.2)
                        CubicKeyframe(direction * 4, duration: 0.32)
                        CubicKeyframe(0, duration: 0.38)
                    }
                }
                .offset(x: x, y: geometry.size.height + 1)
                .animation(Motion.glide, value: selected)
        }
        .frame(height: 0)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// How a tab's panel arrives: a shallow turn in from the side it lies on.
struct PanelTurn: ViewModifier {
    /// Signed progress: 0 at rest, ±1 fully off to that side.
    var amount: CGFloat

    func body(content: Content) -> some View {
        content
            .opacity(1 - abs(amount))
            .rotation3DEffect(
                .degrees(Double(amount) * -6), axis: (x: 0, y: 1, z: 0), perspective: 0.3
            )
            .offset(x: amount * 40)
    }
}

extension AnyTransition {
    /// A tab's panel coming in from `direction`, and the old one simply gone:
    /// two panels crossing would read as a slide rather than a turn.
    static func panelTurn(from direction: CGFloat, reduceMotion: Bool) -> AnyTransition {
        guard !reduceMotion else { return .identity }
        return .asymmetric(
            insertion: .modifier(
                active: PanelTurn(amount: direction), identity: PanelTurn(amount: 0)
            ),
            removal: .identity
        )
    }
}

// MARK: - Controls

/// The top bar's round control: glass, so it reads over a cover or over the
/// page once the bar has filled in behind it.
struct DiscButtonStyle: ButtonStyle {
    @Environment(\.palette) private var palette

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(palette.bg0.l > 0.5 ? palette.ink0Color : .white)
            .frame(width: 44, height: 44)
            .background {
                ZStack {
                    Circle().fill(.ultraThinMaterial)
                    Circle().fill(palette.bg0Color.opacity(0.42))
                }
            }
            .overlay { Circle().strokeBorder(palette.ink0Color.opacity(0.1), lineWidth: 1) }
            .contentShape(Circle())
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(Motion.lift, value: configuration.isPressed)
    }
}

/// The one thing to do: a full pill in the book's deep tone, with white ink.
struct BarCTAStyle: ButtonStyle {
    @Environment(\.palette) private var palette
    /// The covered part of the pill, 0...1 — how far through the book you are.
    var covered: Double = 0

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.ui(17, weight: .semibold))
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background {
                Capsule()
                    .fill(palette.bookDeep)
                    .overlay {
                        if covered > 0 {
                            GeometryReader { geometry in
                                let soft = 36 / max(1, geometry.size.width)
                                LinearGradient(
                                    stops: [
                                        .init(color: palette.bookFill, location: 0),
                                        .init(
                                            color: palette.bookFill,
                                            location: max(0, covered - soft)
                                        ),
                                        .init(
                                            color: palette.bookFill.opacity(0),
                                            location: min(1, covered + soft)
                                        ),
                                    ],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            }
                            .clipShape(Capsule())
                        }
                    }
            }
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(Motion.lift, value: configuration.isPressed)
    }
}

/// A secondary pill beside or under the primary one.
struct QuietPillStyle: ButtonStyle {
    @Environment(\.palette) private var palette
    var height: CGFloat = 52
    /// Whether it takes its share of a row rather than its label's width.
    var fills = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.ui(17, weight: .semibold))
            .foregroundStyle(palette.ink0Color)
            .lineLimit(1)
            .padding(.horizontal, 18)
            .frame(maxWidth: fills ? .infinity : nil)
            .frame(height: height)
            .background(Capsule().fill(palette.quietFill))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(Motion.lift, value: configuration.isPressed)
    }
}

/// The round control beside the primary action. `washed` takes the book's tone
/// for the format the book also comes in.
struct BarRoundStyle: ButtonStyle {
    @Environment(\.palette) private var palette
    var washed = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(palette.ink0Color)
            .frame(width: 52, height: 52)
            .background(Circle().fill(washed ? palette.bookWash : palette.quietFill))
            .overlay { if washed { Circle().strokeBorder(palette.bookRim, lineWidth: 1) } }
            .contentShape(Circle())
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(Motion.lift, value: configuration.isPressed)
    }
}

/// Four level bars: what stands for listening on the page's controls.
struct AudioBarsMark: View {
    /// The bars' resting heights, as fractions of the mark's.
    var levels: [CGFloat] = [0.45, 1, 0.6, 0.8]
    var height: CGFloat = 16
    /// Bumped to set the bars moving for a moment.
    var pulse = 0

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(alignment: .bottom, spacing: 2) {
            ForEach(Array(levels.enumerated()), id: \.offset) { index, level in
                Capsule()
                    .frame(width: 3, height: height)
                    .keyframeAnimator(initialValue: level, trigger: pulse) { view, scale in
                        view.scaleEffect(y: reduceMotion ? level : scale, anchor: .bottom)
                    } keyframes: { _ in
                        KeyframeTrack {
                            // A jump, not a 1 ms ramp: restarted mid-flight, a
                            // ramp's speed carries into the next keyframe.
                            MoveKeyframe(level)
                            LinearKeyframe(level, duration: 0.001 + Double(index) * 0.09)
                            CubicKeyframe(0.2, duration: 0.2)
                            CubicKeyframe(1, duration: 0.2)
                            CubicKeyframe(0.2, duration: 0.2)
                            CubicKeyframe(1, duration: 0.2)
                            CubicKeyframe(0.2, duration: 0.2)
                            CubicKeyframe(1, duration: 0.2)
                            CubicKeyframe(level, duration: 0.2)
                        }
                    }
            }
        }
        .frame(height: height, alignment: .bottom)
    }
}

/// The immersive-read glyph: a page beside sound bars, drawn to match the
/// design's mark — no SF Symbol says "read along".
struct ImmersiveReadMark: View {
    var size: CGFloat = 21

    var body: some View {
        // Laid out on the mark's 24pt grid, scaled to `size`.
        let unit = size / 24
        let stroke = 1.9 * unit

        HStack(alignment: .center, spacing: 3.5 * unit) {
            RoundedRectangle(cornerRadius: 2 * unit, style: .continuous)
                .strokeBorder(lineWidth: stroke)
                .frame(width: 8 * unit, height: 14 * unit)
            HStack(alignment: .center, spacing: 1.1 * unit) {
                bar(8, unit: unit, stroke: stroke)
                bar(12, unit: unit, stroke: stroke)
                bar(5, unit: unit, stroke: stroke)
            }
        }
        .frame(width: size, height: size)
    }

    private func bar(_ height: CGFloat, unit: CGFloat, stroke: CGFloat) -> some View {
        Capsule()
            .frame(width: stroke, height: height * unit)
    }
}

/// The small note the sheets not yet moved to the page's voice still use.
struct MonoNote: View {
    let text: String
    var color: Color?

    @Environment(\.palette) private var palette

    var body: some View {
        Text(text)
            .font(.monoUI(9.5))
            .foregroundStyle(color ?? palette.ink3Color)
            .lineSpacing(3)
    }
}

/// A short-lived message above the action bar, with room for one action.
struct StageToast: View {
    let text: String
    var actionLabel: String?
    var action: (() -> Void)?
    var onDismiss: (() -> Void)?

    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: Spacing.md) {
            Text(text)
                .font(.ui(15))
                .foregroundStyle(palette.ink0Color)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if let actionLabel, let action {
                Button(actionLabel, action: action)
                    .font(.ui(15, weight: .semibold))
                    .foregroundStyle(palette.bookText)
                    .frame(minHeight: 44)
                    .padding(.horizontal, 10)
            }
            if let onDismiss {
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(palette.ink2Color)
                        .frame(width: 32, height: 44)
                }
                .accessibilityLabel("Dismiss")
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .padding(.vertical, 3)
        .frame(minHeight: 50)
        .background {
            ZStack {
                RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                    .fill(.ultraThinMaterial)
                RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                    .fill(palette.bg3Color.opacity(0.8))
            }
            .shadow(color: .black.opacity(0.5), radius: 15, y: 12)
        }
        .overlay {
            RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                .strokeBorder(palette.ink0Color.opacity(0.08), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("book-toast")
    }
}
