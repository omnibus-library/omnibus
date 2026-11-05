//  SpreadPages.swift
//  A long page of sections laid as two pages where the screen holds them, and
//  the steady geometry every one-or-two-pane choice is made from.
//
//  The choice reads the size the view has with the keyboard down. A field's
//  keyboard shrinks the live size, which on an iPad held upright made it wider
//  than tall: the page flipped to two panes, the field was rebuilt in the other
//  layout, lost focus, the keyboard closed, and the page flipped back.

import SwiftUI

/// A view's size and the fold across it, as the keyboard leaves them.
struct PaneGeometry: Equatable {
    var size: CGSize
    var fold: Fold?
}

/// A `GeometryReader` that also hands its content the `PaneGeometry` to choose a layout from.
struct PaneGeometryReader<Content: View>: View {
    @ViewBuilder let content: (PaneGeometry, GeometryProxy) -> Content

    @State private var steady: PaneGeometry?

    var body: some View {
        GeometryReader { proxy in
            // The live size until the steady one is measured: equal while the keyboard is down.
            content(steady ?? PaneGeometry(size: proxy.size, fold: proxy.activeFold), proxy)
        }
        .background {
            // Reaches under the keyboard, so the content above it still avoids it.
            Color.clear
                .ignoresSafeArea(.keyboard)
                .onGeometryChange(for: PaneGeometry.self) {
                    PaneGeometry(size: $0.size, fold: $0.activeFold)
                } action: { steady = $0 }
        }
    }
}

/// Two scrolling pages side by side where `PaneSplit.spread` finds room, else one column.
struct SpreadPages<Leading: View, Trailing: View, Column: View>: View {
    /// Whether the content can spread at all, room or not.
    var spreads = true
    @ViewBuilder let leading: () -> Leading
    /// Given the leading page's header height, which the trailing page starts below.
    @ViewBuilder let trailing: (CGFloat) -> Trailing
    @ViewBuilder let column: () -> Column

    @State private var headerHeight: CGFloat = 0

    var body: some View {
        PaneGeometryReader { pane, _ in
            if spreads, let split = PaneSplit.spread(size: pane.size, fold: pane.fold) {
                HStack(spacing: 0) {
                    leading()
                        .frame(width: split.leading)
                        .environment(\.spreadHeaderHeight, $headerHeight)
                    Color.clear.frame(width: split.gap)
                    trailing(headerHeight)
                        .frame(width: split.trailing)
                }
            } else {
                column()
            }
        }
    }
}

extension View {
    /// Marks the leading page's header, so the trailing page lines up with what follows it.
    func spreadHeader() -> some View {
        modifier(SpreadHeaderReport())
    }
}

extension EnvironmentValues {
    /// Where a spread's leading page reports its header's height; nil outside a spread.
    @Entry var spreadHeaderHeight: Binding<CGFloat>? = nil
}

private struct SpreadHeaderReport: ViewModifier {
    @Environment(\.spreadHeaderHeight) private var height

    func body(content: Content) -> some View {
        content.onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height?.wrappedValue = $0 }
    }
}
