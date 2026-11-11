//  StrandedScroll.swift
//  Puts back a scroll view the system left pulled past its edge.
//
//  A drag the system takes over — a swipe from the top edge that becomes
//  Notification Center — is cancelled as the app leaves the foreground, and
//  UIKit skips the bounce-back it would normally run then. The view stays
//  pulled down at rest, the refresh control's spinner showing still through
//  the gap, until the next drag. The app calls this each time a window scene
//  becomes active, to finish the bounce UIKit dropped. It watches each scene
//  rather than the app's scene phase: a car or a second iPad window can stay
//  active while the swiped window drops out, so the app as a whole never
//  leaves the foreground.

import UIKit

extension UIScrollView {
    /// Where this view should be resting, if it is idle outside its scrollable
    /// range with nothing left to bring it back; nil otherwise.
    ///
    /// Only a view a finger can drag past its edge can be stranded, and a
    /// finger, a fling, a zoom or a running refresh each settles the view on
    /// its own, so any of them leaves it alone.
    var strandedRest: CGPoint? {
        // A view that doesn't scroll or bounce can't be dragged out of range,
        // so one out of range got there on purpose: a reader's web view or a
        // framework's internal scroller.
        guard isScrollEnabled, bounces else { return nil }
        guard !isTracking, !isDecelerating, !isZooming, !isZoomBouncing,
              refreshControl?.isRefreshing != true else { return nil }
        let inset = adjustedContentInset
        let minX = -inset.left
        let minY = -inset.top
        let maxX = max(minX, contentSize.width + inset.right - bounds.width)
        let maxY = max(minY, contentSize.height + inset.bottom - bounds.height)
        let rest = CGPoint(
            x: min(max(contentOffset.x, minX), maxX),
            y: min(max(contentOffset.y, minY), maxY)
        )
        // Half a point of slack: layout rounding leaves resting views a hair off.
        guard abs(rest.x - contentOffset.x) > 0.5 || abs(rest.y - contentOffset.y) > 0.5 else {
            return nil
        }
        return rest
    }
}

/// Settle every stranded scroll view under `root` back to its rest.
@MainActor
func settleStrandedScrollViews(in root: UIView, animated: Bool = true) {
    if let scroll = root as? UIScrollView, let rest = scroll.strandedRest {
        scroll.setContentOffset(rest, animated: animated)
    }
    for child in root.subviews {
        settleStrandedScrollViews(in: child, animated: animated)
    }
}

/// Settle the stranded scroll views in every window of `scene`.
@MainActor
func settleStrandedScrollViews(in scene: UIWindowScene) {
    for window in scene.windows {
        settleStrandedScrollViews(in: window)
    }
}

/// Settle each window scene's stranded scroll views as that scene becomes
/// active. Call once, at launch: each call adds another observer.
@MainActor
func settleStrandedScrollViewsOnActivation() {
    _ = NotificationCenter.default.addObserver(
        forName: UIScene.didActivateNotification, object: nil, queue: .main
    ) { note in
        guard let scene = note.object as? UIWindowScene else { return }
        MainActor.assumeIsolated { settleStrandedScrollViews(in: scene) }
    }
}
