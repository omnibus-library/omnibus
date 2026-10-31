//  RemoteTransport.swift
//  What the system's seek buttons do to an audiobook: all six seek, none changes chapter.
//
//  AirPods presses and many head units arrive as next/previous-track; the lock
//  screen and CarPlay's on-screen buttons as skip-forward/back; a held button
//  as a begin and an end of seek-forward/back. Apple doesn't document which of
//  them a car's wheel sends, so all of them are handled. In an audiobook every
//  one of them seeks, as Audible's do — a hardware press that jumps a whole
//  chapter loses the listener's place with no screen to show where it went.
//  Chapters change only from a control that names them.

import Foundation

/// A remote command that moves the position.
enum RemoteTransport: String {
    case skipForward
    case skipBackward
    case nextTrack
    case previousTrack
    case seekForward
    case seekBackward

    /// The interval the forward commands seek, and the skip button draws.
    static let forwardSeconds: Double = 30
    /// The interval the backward commands seek, and the skip button draws.
    static let backSeconds: Double = 15
    /// How long after one command another in its direction can be the same press.
    static let samePressWindow: TimeInterval = 1

    /// Signed seconds to move the position by.
    var seekDelta: Double {
        switch self {
        case .skipForward, .nextTrack, .seekForward: return Self.forwardSeconds
        case .skipBackward, .previousTrack, .seekBackward: return -Self.backSeconds
        }
    }

    /// Whether this is the second command of the press that sent `previous`,
    /// which would otherwise move twice as far. A repeat of one command is a
    /// second press, so tapping a button quickly still adds up.
    func isSamePress(as previous: RemoteTransport, after elapsed: TimeInterval) -> Bool {
        self != previous && (seekDelta > 0) == (previous.seekDelta > 0)
            && elapsed < Self.samePressWindow
    }
}
