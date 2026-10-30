//  AudioSessionEvent.swift
//  The player's policy for calls and lost outputs, parsed from `AVAudioSession` notifications.
//
//  A call or another app's audio interrupts the session, and losing CarPlay,
//  Bluetooth or headphones changes its route; both stop AVPlayer underneath
//  `AudioPlayer`, which used to go on claiming it was playing until the next
//  toggle paused a player that was already silent. This is the decision half,
//  kept to plain values so it is testable without a live session;
//  `AudioPlayer` parses the notification and applies the response.
//
//  A start that hasn't fired yet — a rebuild in flight, a load awaiting its
//  item, a play command still finding the book to resume — counts as playing:
//  a disconnect cancels it, and a call holds it, handing it back when it ends
//  to whichever rebuild, load or resume owes it by then.

import AVFoundation

/// An audio-session change the player responds to.
enum AudioSessionEvent: Equatable {
    case interruptionBegan
    case interruptionEnded(shouldResume: Bool)
    /// The output playback was using went away — CarPlay, Bluetooth, or
    /// headphones disconnected.
    case outputLost

    /// Parse an `interruptionNotification`'s `userInfo`.
    init?(interruption info: [AnyHashable: Any]?) {
        guard let raw = info?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw)
        else { return nil }
        switch type {
        case .began:
            self = .interruptionBegan
        case .ended:
            let options = AVAudioSession.InterruptionOptions(
                rawValue: info?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            )
            self = .interruptionEnded(shouldResume: options.contains(.shouldResume))
        @unknown default:
            return nil
        }
    }

    /// Parse a `routeChangeNotification`'s `userInfo`; only a lost output is
    /// an event — a newly connected one leaves playback as it was.
    init?(routeChange info: [AnyHashable: Any]?) {
        guard let raw = info?[AVAudioSessionRouteChangeReasonKey] as? UInt,
            AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable
        else { return nil }
        self = .outputLost
    }

    /// What the player should do, given whether it is playing and whether an
    /// earlier interruption left a resume pending.
    func response(isPlaying: Bool, pendingResume: Bool) -> AudioSessionResponse {
        switch self {
        case .interruptionBegan:
            return isPlaying ? .pauseUntilResumed : .ignore
        case .interruptionEnded(let shouldResume):
            guard pendingResume else { return .ignore }
            return shouldResume ? .resume : .pause
        case .outputLost:
            // Also cancels a pending resume: a car switched off mid-call must
            // not have the book start on the phone's speaker when the call ends.
            return isPlaying || pendingResume ? .pause : .ignore
        }
    }
}

/// What `AudioPlayer` does about an `AudioSessionEvent`.
enum AudioSessionResponse: Equatable {
    /// Pause, and resume when the interruption ends.
    case pauseUntilResumed
    /// Pause if playing, and drop any pending resume.
    case pause
    case resume
    case ignore
}

/// The starts `AudioPlayer` owes the listener but has not made yet, and how a
/// session event leaves them.
struct PendingStarts: Equatable {
    /// A rebuild in flight resumes playback when it lands.
    var afterRecovery = false
    /// The generation of the load that starts playback once it has its item
    /// and opening position. Owned by one load, so a load superseded by
    /// another can't take the newer one's start.
    var afterLoad: Int?
    /// A play command with nothing playable is still finding the book to
    /// load, and plays it once loaded.
    var afterResume = false
    /// An interruption paused playback, or cancelled a start above, and
    /// playback comes back when it ends.
    var afterInterruption = false

    /// Whether audio is about to start without the listener pressing anything.
    var startIsPending: Bool { afterRecovery || afterLoad != nil || afterResume }

    /// Whether a resume still finding its book goes on to load it: it is owed,
    /// or a call holds it — the same as a call holds a load in flight.
    var resumeIsOwed: Bool { afterResume || afterInterruption }

    /// A remote play with nothing playable: owe the resume, overruling a
    /// call's hold the way a play press does.
    mutating func armResume() {
        afterInterruption = false
        afterResume = true
    }

    /// The starts once a load of `generation` has torn down the last book's:
    /// its autoplay, or — when a call holds the resume that asked for it — the
    /// call's, which `settled` hands back to the load when the call ends.
    static func opening(load generation: Int, autoplay: Bool, heldByCall: Bool) -> PendingStarts {
        guard autoplay else { return PendingStarts() }
        return heldByCall ? PendingStarts(afterInterruption: true) : PendingStarts(afterLoad: generation)
    }

    /// Whether a play/pause toggle pauses; a pending start counts as playing.
    func togglePauses(isPlaying: Bool) -> Bool { isPlaying || startIsPending }

    /// The response to `event`; a pending start counts as playing.
    func response(to event: AudioSessionEvent, isPlaying: Bool) -> AudioSessionResponse {
        event.response(isPlaying: isPlaying || startIsPending, pendingResume: afterInterruption)
    }

    /// The starts still owed once `response` is carried out. `loading` is the
    /// generation of the load in flight, `recovering` whether a rebuild is and
    /// `resuming` whether a play command is still finding its book: with no
    /// item to play yet, a resume hands the start back to whichever owes it,
    /// and only a resume left owing nothing calls for a play.
    func settled(
        by response: AudioSessionResponse, loading: Int?, recovering: Bool, resuming: Bool
    ) -> PendingStarts {
        switch response {
        case .pauseUntilResumed: return PendingStarts(afterInterruption: true)
        case .pause: return PendingStarts()
        case .resume:
            return PendingStarts(afterRecovery: recovering, afterLoad: loading, afterResume: resuming)
        case .ignore: return self
        }
    }
}
