//  BarEdgeFade.swift
//  A scroll view's content fading out where it passes under a bar that lays no
//  slab of its own, so it dissolves there rather than butting into the bar.
//  iOS 26's scroll edge effect is meant to draw this; beside a two-pane book
//  page's bars it drew nothing, as `TopEdgeScrim` found at the tab roots' top.
//
//  A mask is laid out in its view's safe area, which a `safeAreaInset` bar has
//  already taken its band from, so the fade sits on that edge without measuring.

import SwiftUI

extension View {
    /// Fades this scroll view's content out at `edges` of its safe area, where its inset bars begin.
    func barEdgeFade(_ edges: VerticalEdge.Set) -> some View {
        mask {
            VStack(spacing: 0) {
                if edges.contains(.top) {
                    LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom)
                        .frame(height: BarEdgeFade.length)
                }
                Rectangle()
                if edges.contains(.bottom) {
                    LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
                        .frame(height: BarEdgeFade.length)
                }
            }
            // An edge left unfaded reaches far past the safe area, so nothing is cut there.
            .padding(.top, -(edges.contains(.top) ? BarEdgeFade.reach : BarEdgeFade.overhang))
            .padding(.bottom, -(edges.contains(.bottom) ? BarEdgeFade.reach : BarEdgeFade.overhang))
            .padding(.horizontal, -BarEdgeFade.overhang)
        }
    }
}

enum BarEdgeFade {
    /// How far the fade runs.
    static let length: CGFloat = 24
    /// How far into the bar's band the content lasts before it is gone: barely,
    /// so nothing ghosts behind a bar's labels.
    static let reach: CGFloat = 4
    /// Room past the safe area for what a scroll view lets spill, like the cover's halo.
    static let overhang: CGFloat = 400
}
