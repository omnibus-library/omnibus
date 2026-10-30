//  RemoteTransport.swift
//  What the system's seek buttons do to an audiobook: all four seek, none changes chapter.
//
//  Steering-wheel buttons, AirPods presses and most head units arrive as
//  next/previous-track; the lock screen and CarPlay's on-screen buttons as
//  skip-forward/back (and some head units send those instead). In an
//  audiobook every one of them seeks, as Audible's do — a hardware press that
//  jumps a whole chapter loses the listener's place with no screen to show
//  where it went. Chapters change only from a control that names them.

import Foundation

/// A remote command that moves the position.
enum RemoteTransport: CaseIterable {
    case skipForward
    case skipBackward
    case nextTrack
    case previousTrack

    /// The interval the forward commands seek, and the skip button draws.
    static let forwardSeconds: Double = 30
    /// The interval the backward commands seek, and the skip button draws.
    static let backSeconds: Double = 15

    /// Signed seconds to move the position by.
    var seekDelta: Double {
        switch self {
        case .skipForward, .nextTrack: return Self.forwardSeconds
        case .skipBackward, .previousTrack: return -Self.backSeconds
        }
    }
}
