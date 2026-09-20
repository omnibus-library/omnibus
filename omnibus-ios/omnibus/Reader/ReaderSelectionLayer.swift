//  ReaderSelectionLayer.swift
//  The selection the reader actually sees.
//
//  WebKit's own touch selection is disabled inside the section (see the
//  baseline stylesheet in `epub-reader-glue.js`): its handles and loupe are
//  laid out against an iframe as wide as the whole chapter, so in a paginated
//  book they land in the wrong column, and its long-press recogniser fights
//  the drag-to-turn handler for the same touch. The glue owns the *range* and
//  reports geometry; everything below is drawn by the app, at the app's frame
//  rate, in the app's colours.

import SwiftUI

/// Reading-theme colours.
///
/// The page is its own ground: chrome, selection, and handles sit on it rather
/// than on the app's background, so they resolve against the theme the *book*
/// is set in, not the one the app is in.
enum ReaderTheme {
    static func palette(_ token: String) -> Palette {
        switch token {
        case "light": Palette.light
        case "sepia": Palette.sepia
        case "black": Palette.black
        default: Palette.atrium
        }
    }

    /// Whether the page ground is light, which is what ink and wash contrast
    /// have to be picked against.
    static func isLightPage(_ token: String) -> Bool {
        token == "light" || token == "sepia"
    }

    static func pageColor(_ token: String) -> Color {
        palette(token).readerPage
    }

    /// Ink for anything the app draws on the page.
    static func ink(_ token: String) -> Color {
        isLightPage(token) ? Palette.light.ink0Color : Palette.atrium.ink0Color
    }

    /// The selection tone: cool and desaturated, deliberately outside the
    /// highlight palette. A selection is chrome and a highlight is content —
    /// tint the two alike and a wash reads as a mark you already made.
    static func selectionTint(_ token: String) -> Color {
        isLightPage(token)
            ? OKLCH(0.52, 0.06, 255).color
            : OKLCH(0.74, 0.06, 255).color
    }

    /// The wash under the words. Enough to read as selected at a glance, light
    /// enough that the prose underneath is still prose — the layer sits *over*
    /// the text, where the system would paint behind it.
    static func selectionWashOpacity(_ token: String) -> Double {
        isLightPage(token) ? 0.24 : 0.30
    }
}

/// The tint, the handles, and the touches that move them.
struct ReaderSelectionLayer: View {
    let selection: SelectionData
    let theme: String
    var onEdgeDragBegan: (SelectionEdge) -> Void
    /// The caret the finger is carrying, and the finger itself — both in
    /// window coordinates, which the web view fills.
    var onEdgeDragChanged: (_ caret: CGPoint, _ finger: CGPoint) -> Void
    var onEdgeDragEnded: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// A handle under a finger: which edge, and where its caret was when the
    /// finger went down. Every target is that point plus the gesture's own
    /// translation, so the caret tracks the finger one-to-one with no jump at
    /// grab time — and the maths never depends on which coordinate space the
    /// gesture reports in.
    private struct Grab: Equatable {
        let edge: SelectionEdge
        let origin: CGPoint
    }

    @State private var grab: Grab?

    private static let knobRadius: CGFloat = 5.5
    private static let barWidth: CGFloat = 2
    private static let touchSize: CGFloat = 40

    var body: some View {
        ZStack(alignment: .topLeading) {
            wash
            handle(.start)
            handle(.end)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ignoresSafeArea()
        // The layer can leave mid-drag — the selection cleared under it — and
        // a handle removed mid-gesture never gets `onEnded`. Close the drag
        // here, so the glue stops turning pages for a finger it can no longer
        // see and the passage menu is not pinned shut.
        .onDisappear {
            guard grab != nil else { return }
            grab = nil
            onEdgeDragEnded()
        }
    }

    /// Drawn in one pass rather than as a stack of shapes: the rects are
    /// replaced wholesale on every frame of a drag, and view identity churn at
    /// that rate is what would put the tint a frame behind the finger.
    private var wash: some View {
        Canvas { context, _ in
            let tint = ReaderTheme.selectionTint(theme)
                .opacity(ReaderTheme.selectionWashOpacity(theme))
            for rect in selection.rects {
                context.fill(
                    Path(roundedRect: rect.cgRect.insetBy(dx: -1, dy: -0.5), cornerRadius: 3.5),
                    with: .color(tint)
                )
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// The handle for one edge, if that edge is on the page.
    ///
    /// The handle under the finger outlives its caret. A page turning under
    /// the drag puts the dragged edge off the page for a frame or two, and a
    /// view removed mid-gesture takes the gesture with it — no `onEnded`, the
    /// menu pinned shut, the glue still turning pages. So while it is held
    /// the handle stays in the tree, parked offstage and invisible, with only
    /// its gesture left to do.
    @ViewBuilder
    private func handle(_ edge: SelectionEdge) -> some View {
        let live = edge == .start ? selection.start : selection.end
        if let caret = live ?? (grab?.edge == edge ? SelectionCaret.offstage : nil) {
            grabber(edge, at: caret, present: live != nil)
        }
    }

    /// One grabber: a bar the height of the line with a knob at the outer end
    /// — above the first line, below the last — so the knob is never over the
    /// word it marks and the two are told apart at a glance.
    ///
    /// Everything is placed relative to the caret's mid-point, which is where
    /// the whole handle is positioned.
    private func grabber(
        _ edge: SelectionEdge, at caret: SelectionCaret, present: Bool
    ) -> some View {
        let dragging = grab?.edge == edge
        let height = max(12, CGFloat(caret.height))
        let knobY = edge == .start
            ? -(height / 2 + Self.knobRadius + 1)
            : height / 2 + Self.knobRadius + 1
        let tint = ReaderTheme.selectionTint(theme)

        return ZStack {
            Capsule()
                .fill(tint)
                .frame(width: Self.barWidth, height: height)
            Circle()
                .fill(tint)
                .frame(width: Self.knobRadius * 2, height: Self.knobRadius * 2)
                .shadow(color: .black.opacity(0.22), radius: 2, y: 1)
                .scaleEffect(dragging ? 1.35 : 1)
                .offset(y: knobY)
        }
        // Shifted back by the same amount the touch box is biased below, so
        // the bar still sits exactly on the caret — only the touch box moves.
        .offset(x: -Self.touchBias(edge))
        // The grabbable area is far larger than the mark — a fingertip aiming
        // at a 5pt dot needs the slop — and biased outward, which is what
        // keeps the two apart when the whole selection is one short word.
        .frame(
            width: Self.touchSize,
            height: max(Self.touchSize, height + Self.knobRadius * 4)
        )
        .contentShape(Rectangle())
        .opacity(present ? 1 : 0)
        .animation(reduceMotion ? nil : Motion.snap, value: dragging)
        .position(
            x: CGFloat(caret.x) + Self.touchBias(edge),
            y: CGFloat(caret.y) + height / 2
        )
        .gesture(dragGesture(edge, caret: caret, height: height))
        .accessibilityHidden(true)
    }

    /// How far a handle's touch box sits outside its mark.
    private static func touchBias(_ edge: SelectionEdge) -> CGFloat {
        edge == .start ? -touchSize / 4 : touchSize / 4
    }

    private func dragGesture(
        _ edge: SelectionEdge, caret: SelectionCaret, height: CGFloat
    ) -> some Gesture {
        // Global, so the finger's location can be handed over as-is: the
        // caret is derived from the translation alone, but the page's edge is
        // a place on screen, and the finger has to be the thing that reaches
        // it — the caret it carries trails behind by the grab offset.
        DragGesture(minimumDistance: 0, coordinateSpace: .global)
            .onChanged { value in
                let origin: CGPoint
                if let grab {
                    origin = grab.origin
                } else {
                    // The caret itself. A handle moves by the character, and
                    // the glue resolves the boundary nearest the point — which
                    // at the caret is the boundary the handle already marks,
                    // so the range does not move until the finger does.
                    origin = CGPoint(x: CGFloat(caret.x), y: CGFloat(caret.y) + height / 2)
                    grab = Grab(edge: edge, origin: origin)
                    onEdgeDragBegan(edge)
                    Haptics.tap()
                }
                onEdgeDragChanged(
                    CGPoint(
                        x: origin.x + value.translation.width,
                        y: origin.y + value.translation.height
                    ),
                    value.location
                )
            }
            .onEnded { _ in
                grab = nil
                onEdgeDragEnded()
            }
    }
}

private extension SelectionCaret {
    /// Where a held handle waits while its edge is off the page: out of sight,
    /// and out of reach of any other touch.
    static let offstage = SelectionCaret(x: -1000, y: -1000, height: 24)
}

// MARK: - Anchoring

/// Where a panel's tail should point, in the panel's own terms.
struct PanelTail: Equatable {
    /// True when the panel sits above the passage, so the tail is on its
    /// bottom edge.
    var pointsDown: Bool
    /// The tail's centre, as a fraction across the panel's width.
    var offset: CGFloat
    /// False when there is no passage to point at — a panel that fell back to
    /// the bottom bar. A tail aimed at nothing is worse than no tail.
    var isPresent = true

    static let none = PanelTail(pointsDown: true, offset: 0.5, isPresent: false)

    /// The tail's tip, as the unit point a menu should grow out of — so it
    /// appears to come from the passage it speaks for.
    ///
    /// Centre when there is no tail: that panel fell back to the bottom bar
    /// and points at nothing, so growing it from an edge it never drew is an
    /// entrance from a place the reader can't see.
    var anchorPoint: UnitPoint {
        isPresent ? UnitPoint(x: offset, y: pointsDown ? 1 : 0) : .center
    }
}

/// Where a floating panel goes, relative to the passage it acts on.
///
/// Pure geometry, kept out of the view so the rules — never cover the text,
/// stay on screen, keep clear of the reader's own chrome — can be pinned in
/// tests rather than eyeballed on a phone.
struct PanelPlacement: Equatable {
    var center: CGPoint
    var tail: PanelTail

    /// Distance between the panel and the passage.
    static let gap: CGFloat = 8
    /// Closest the panel may come to the side of the screen.
    static let screenEdge: CGFloat = 10
    /// Room reserved at both ends of the page for the reader's own floating
    /// chrome.
    static let chromeBand: CGFloat = 64

    /// Above the passage when it fits, below it otherwise.
    static func resolve(
        rects: [PageRect], panel: CGSize, in bounds: CGSize
    ) -> PanelPlacement {
        let minY = panel.height / 2 + chromeBand
        let maxY = max(minY, bounds.height - panel.height / 2 - chromeBand)

        // No geometry — a tap epub.js couldn't place. Fall back to the bottom
        // rather than dropping the panel entirely, and point at nothing.
        guard let first = rects.first, let last = rects.last else {
            return PanelPlacement(
                center: CGPoint(x: bounds.width / 2, y: maxY), tail: .none
            )
        }

        let union = rects.dropFirst().reduce(first.cgRect) { $0.union($1.cgRect) }
        let x = min(
            max(union.midX, panel.width / 2 + screenEdge),
            max(panel.width / 2 + screenEdge, bounds.width - panel.width / 2 - screenEdge)
        )
        let above = union.minY - gap - panel.height / 2
        let fitsAbove = above >= minY
        let below = union.maxY + gap + panel.height / 2
        let y = min(max(fitsAbove ? above : below, minY), maxY)

        // The tail points between the first and last line rather than at the
        // middle of a selection whose far end may be half a page away.
        let anchor = (first.cgRect.midX + last.cgRect.midX) / 2
        // Kept clear of the rounded corners, where a tail reads as a chipped
        // edge rather than as a pointer.
        let inset = Radius.lg + 12
        let tailX = min(max(anchor - (x - panel.width / 2), inset), panel.width - inset)
        return PanelPlacement(
            center: CGPoint(x: x, y: y),
            tail: PanelTail(pointsDown: fitsAbove, offset: tailX / panel.width)
        )
    }
}

/// Places a floating panel beside the passage it acts on.
///
/// Anchoring it to the prose rather than pinning it to the bottom of the
/// screen is what makes it read as acting *on that sentence* — the Apple Books
/// model — instead of as a global toolbar that happens to be showing. The tail
/// is the rest of that sentence: without it the panel is merely nearby.
struct PassageAnchor<Content: View>: View {
    /// The passage, one rect per line. Empty falls back to the bottom bar.
    let rects: [PageRect]
    let width: CGFloat
    let height: CGFloat
    @ViewBuilder var content: (PanelTail) -> Content

    var body: some View {
        GeometryReader { geometry in
            let place = PanelPlacement.resolve(
                rects: rects,
                panel: CGSize(width: width, height: height),
                in: geometry.size
            )
            content(place.tail)
                .frame(width: width)
                .position(place.center)
        }
        // Without this the panel is laid out inside the safe area while the
        // rects arrive in web-view coordinates, which start at the top of the
        // screen — every menu would sit a notch's height too low.
        .ignoresSafeArea()
    }
}

/// A panel outline: a rounded rectangle with a tail, as one path so the fill
/// has no seam where the two meet.
struct PanelShape: Shape {
    var tail: PanelTail
    var corner: CGFloat = Radius.lg
    var tailWidth: CGFloat = 24
    var tailHeight: CGFloat = 8

    func path(in rect: CGRect) -> Path {
        let body = CGRect(
            x: rect.minX,
            y: rect.minY + (tail.pointsDown ? 0 : tailHeight),
            width: rect.width,
            height: rect.height - tailHeight
        )
        var path = Path(roundedRect: body, cornerRadius: corner, style: .continuous)
        guard tail.isPresent else { return path }

        let centre = rect.minX + rect.width * tail.offset
        let baseY = tail.pointsDown ? body.maxY - 1 : body.minY + 1
        let tipY = tail.pointsDown ? rect.maxY : rect.minY
        path.move(to: CGPoint(x: centre - tailWidth / 2, y: baseY))
        path.addLine(to: CGPoint(x: centre, y: tipY))
        path.addLine(to: CGPoint(x: centre + tailWidth / 2, y: baseY))
        path.closeSubpath()
        return path
    }
}
