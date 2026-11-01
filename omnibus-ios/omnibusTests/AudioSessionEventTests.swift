//  AudioSessionEventTests.swift
//  What a call or a lost output does to playback.
//
//  Both stop AVPlayer underneath `AudioPlayer`, which went on claiming it was
//  playing until the next toggle paused a player that was already silent.
//  These pin the parsing of the session's notifications and the response to
//  each: a call pauses and comes back, a disconnect pauses and stays paused —
//  and a start not yet made (a rebuild, a load, a resume) counts as playing,
//  and is handed back to whichever owes it when a call ends.

import AVFoundation
import Testing

@testable import omnibus

struct AudioSessionEventTests {
    private func interruption(
        _ type: AVAudioSession.InterruptionType,
        options: AVAudioSession.InterruptionOptions = []
    ) -> [AnyHashable: Any] {
        [
            AVAudioSessionInterruptionTypeKey: type.rawValue,
            AVAudioSessionInterruptionOptionKey: options.rawValue,
        ]
    }

    private func routeChange(_ reason: AVAudioSession.RouteChangeReason) -> [AnyHashable: Any] {
        [AVAudioSessionRouteChangeReasonKey: reason.rawValue]
    }

    @Test func interruptionInfoParsesBeganAndEnded() {
        #expect(AudioSessionEvent(interruption: interruption(.began)) == .interruptionBegan)
        #expect(
            AudioSessionEvent(interruption: interruption(.ended, options: .shouldResume))
                == .interruptionEnded(shouldResume: true)
        )
        #expect(
            AudioSessionEvent(interruption: interruption(.ended))
                == .interruptionEnded(shouldResume: false)
        )
        #expect(AudioSessionEvent(interruption: nil) == nil)
    }

    @Test func routeChangeIsAnEventOnlyWhenTheOutputWasLost() {
        #expect(AudioSessionEvent(routeChange: routeChange(.oldDeviceUnavailable)) == .outputLost)
        // Connecting CarPlay or headphones leaves playback as it was.
        #expect(AudioSessionEvent(routeChange: routeChange(.newDeviceAvailable)) == nil)
        #expect(AudioSessionEvent(routeChange: routeChange(.categoryChange)) == nil)
    }

    @Test func aCallPausesPlaybackAndResumesWhenItEnds() {
        #expect(
            AudioSessionEvent.interruptionBegan.response(isPlaying: true, pendingResume: false)
                == .pauseUntilResumed
        )
        #expect(
            AudioSessionEvent.interruptionEnded(shouldResume: true)
                .response(isPlaying: false, pendingResume: true) == .resume
        )
    }

    @Test func anInterruptionWhilePausedLeavesPlaybackAlone() {
        #expect(
            AudioSessionEvent.interruptionBegan.response(isPlaying: false, pendingResume: false)
                == .ignore
        )
        // The listener paused before the call; its end must not start the book.
        #expect(
            AudioSessionEvent.interruptionEnded(shouldResume: true)
                .response(isPlaying: false, pendingResume: false) == .ignore
        )
    }

    @Test func anInterruptionEndingWithoutShouldResumeDropsThePendingResume() {
        #expect(
            AudioSessionEvent.interruptionEnded(shouldResume: false)
                .response(isPlaying: false, pendingResume: true) == .pause
        )
    }

    @Test func losingTheOutputPausesPlayback() {
        #expect(AudioSessionEvent.outputLost.response(isPlaying: true, pendingResume: false) == .pause)
        #expect(AudioSessionEvent.outputLost.response(isPlaying: false, pendingResume: false) == .ignore)
    }

    @Test func losingTheOutputMidCallCancelsTheResume() {
        // The car switched off during a call: the book must not start on the
        // phone's speaker when the call ends.
        #expect(AudioSessionEvent.outputLost.response(isPlaying: false, pendingResume: true) == .pause)
    }

    @Test func losingTheOutputCancelsAPendingStart() {
        // The car switched off during a rebuild's back-off, a load or a
        // resume: the book must not start on the phone's speaker when it lands.
        for pending in [
            PendingStarts(afterRecovery: true), PendingStarts(afterLoad: 1),
            PendingStarts(afterResume: true),
        ] {
            let response = pending.response(to: .outputLost, isPlaying: false)
            #expect(response == .pause)
            #expect(pending.settled(by: response, loading: 1, recovering: true, resuming: true) == PendingStarts())
        }
    }

    @Test func aCallHoldsAPendingStartUntilItEnds() {
        // A call arriving during a rebuild's back-off or a load: the start
        // waits for the call instead of sounding over it.
        let held: [(PendingStarts, PendingStarts)] = [
            (PendingStarts(afterRecovery: true), PendingStarts(afterInterruption: true)),
            (PendingStarts(afterLoad: 1), PendingStarts(afterInterruption: true, callHoldsLoad: true)),
        ]
        for (pending, expected) in held {
            let response = pending.response(to: .interruptionBegan, isPlaying: false)
            #expect(response == .pauseUntilResumed)
            #expect(pending.settled(by: response, loading: nil, recovering: false, resuming: false) == expected)
        }
    }

    @Test func aCallPausingPlaybackLeavesOnlyTheResumePending() {
        let pending = PendingStarts()
        let response = pending.response(to: .interruptionBegan, isPlaying: true)
        #expect(
            pending.settled(by: response, loading: nil, recovering: false, resuming: false)
                == PendingStarts(afterInterruption: true)
        )
    }

    @Test func aCallEndingMidLoadHandsTheStartBackToTheLoadInFlight() {
        // No item to play yet, so the load's own autoplay makes the start —
        // owned by that load's generation, not by one it superseded.
        let pending = PendingStarts(afterInterruption: true)
        let response = pending.response(to: .interruptionEnded(shouldResume: true), isPlaying: false)
        #expect(response == .resume)
        let settled = pending.settled(by: response, loading: 7, recovering: false, resuming: false)
        #expect(settled == PendingStarts(afterLoad: 7))
        #expect(settled.startIsPending)
    }

    @Test func aCallEndingMidRebuildHandsTheStartBackToTheRebuild() {
        // A call that began during a rebuild's back-off: playing here would
        // refill the budget of the rebuild still running.
        let pending = PendingStarts(afterInterruption: true)
        let response = pending.response(to: .interruptionEnded(shouldResume: true), isPlaying: false)
        #expect(response == .resume)
        let settled = pending.settled(by: response, loading: nil, recovering: true, resuming: false)
        #expect(settled == PendingStarts(afterRecovery: true))
        #expect(settled.startIsPending)
    }

    @Test func aCallEndingWithNothingInFlightOwesNoStartSoThePlayerResumes() {
        let pending = PendingStarts(afterInterruption: true)
        let response = pending.response(to: .interruptionEnded(shouldResume: true), isPlaying: false)
        let settled = pending.settled(by: response, loading: nil, recovering: false, resuming: false)
        #expect(settled == PendingStarts())
        #expect(!settled.startIsPending)
    }

    @Test func aCallEndingWithoutShouldResumeDropsEveryPendingStart() {
        let pending = PendingStarts(afterInterruption: true)
        let response = pending.response(to: .interruptionEnded(shouldResume: false), isPlaying: false)
        #expect(response == .pause)
        #expect(pending.settled(by: response, loading: 1, recovering: true, resuming: true) == PendingStarts())
    }

    @Test func aCallHoldsAResumeStillFindingItsBook() {
        // The same as a load in flight: the call holds the start, and the
        // resume goes on finding its book rather than giving up.
        let pending = PendingStarts(afterResume: true)
        let response = pending.response(to: .interruptionBegan, isPlaying: false)
        #expect(response == .pauseUntilResumed)
        let settled = pending.settled(by: response, loading: nil, recovering: false, resuming: true)
        #expect(settled == PendingStarts(afterInterruption: true, callHoldsLoad: true))
        #expect(settled.resumeIsOwed)
        #expect(!settled.startIsPending)
    }

    @Test func aCallEndingHandsTheStartBackToAResumeStillFindingItsBook() {
        let pending = PendingStarts(afterInterruption: true)
        let response = pending.response(to: .interruptionEnded(shouldResume: true), isPlaying: false)
        #expect(response == .resume)
        let settled = pending.settled(by: response, loading: nil, recovering: false, resuming: true)
        #expect(settled == PendingStarts(afterResume: true))
        #expect(settled.startIsPending)
    }

    @Test func aResumeACallHoldsLoadsWithoutPlayingUntilTheCallEnds() {
        let opened = PendingStarts.opening(load: 3, autoplay: true, heldByCall: true)
        #expect(opened == PendingStarts(afterInterruption: true, callHoldsLoad: true))
        #expect(!opened.startIsPending)
        let response = opened.response(to: .interruptionEnded(shouldResume: true), isPlaying: false)
        #expect(
            opened.settled(by: response, loading: 3, recovering: false, resuming: false)
                == PendingStarts(afterLoad: 3)
        )
    }

    @Test func aLoadNoCallHoldsOwesItsOwnAutoplay() {
        #expect(PendingStarts.opening(load: 3, autoplay: true, heldByCall: false) == PendingStarts(afterLoad: 3))
        #expect(PendingStarts.opening(load: 3, autoplay: false, heldByCall: true) == PendingStarts())
    }

    @Test func aDisconnectOrACallEndingWithoutResumeDropsAHeldResume() {
        let held = PendingStarts(afterInterruption: true)
        for event in [AudioSessionEvent.outputLost, .interruptionEnded(shouldResume: false)] {
            let response = held.response(to: event, isPlaying: false)
            #expect(response == .pause)
            let settled = held.settled(by: response, loading: nil, recovering: false, resuming: true)
            #expect(!settled.resumeIsOwed)
        }
    }

    @Test func aPlayPressedDuringACallIsNotLostWhenItEnds() {
        // The press overrules the call's hold, so its end has nothing to
        // settle and leaves the resume owed.
        var pending = PendingStarts(afterInterruption: true, callHoldsLoad: true)
        pending.armResume()
        #expect(pending == PendingStarts(afterResume: true))
        let response = pending.response(to: .interruptionEnded(shouldResume: true), isPlaying: false)
        #expect(response == .ignore)
        #expect(pending.settled(by: response, loading: nil, recovering: false, resuming: true) == pending)
    }

    @Test func anIgnoredEventLeavesPendingStartsAlone() {
        // A call ending when nothing was paused for it must not cancel a load.
        let pending = PendingStarts(afterLoad: 1)
        let response = pending.response(to: .interruptionEnded(shouldResume: true), isPlaying: false)
        #expect(response == .ignore)
        #expect(pending.settled(by: response, loading: 1, recovering: false, resuming: false) == pending)
    }

    @Test func aToggleDuringAPendingStartPausesRatherThanReArmingIt() {
        // Play/pause pressed while an autoplay load is in flight cancels it.
        #expect(PendingStarts(afterLoad: 1).togglePauses(isPlaying: false))
        #expect(PendingStarts(afterRecovery: true).togglePauses(isPlaying: false))
        // So does one pressed while a remote play is still finding its book.
        #expect(PendingStarts(afterResume: true).togglePauses(isPlaying: false))
        #expect(PendingStarts().togglePauses(isPlaying: true))
        // A call's held resume is not a start in flight: the toggle plays.
        #expect(!PendingStarts(afterInterruption: true).togglePauses(isPlaying: false))
        #expect(!PendingStarts().togglePauses(isPlaying: false))
    }

    @Test func aToggleDuringACallHoldingALoadCancelsItRatherThanStartingIt() {
        // A steering-wheel press mid-call, while the call holds a load or a
        // resume finding its book: the press takes the held start back.
        for pending in [PendingStarts(afterLoad: 1), PendingStarts(afterResume: true)] {
            let held = pending.settled(
                by: pending.response(to: .interruptionBegan, isPlaying: false),
                loading: nil, recovering: false, resuming: false
            )
            #expect(held.togglePauses(isPlaying: false))
        }
        // A held rebuild is playback the call paused: the toggle plays it.
        let rebuild = PendingStarts(afterRecovery: true)
        let heldRebuild = rebuild.settled(
            by: rebuild.response(to: .interruptionBegan, isPlaying: false),
            loading: nil, recovering: false, resuming: false
        )
        #expect(!heldRebuild.togglePauses(isPlaying: false))
    }

    @Test func aPlayPressOverrulesTheCallsHoldOnALoad() {
        var pending = PendingStarts(afterInterruption: true, callHoldsLoad: true)
        pending.overruleCall()
        #expect(pending == PendingStarts())
        #expect(!pending.togglePauses(isPlaying: false))
    }

    /// A load a call holds, by each route there: the call arriving mid-load,
    /// and a resume the call was already holding when it found its book.
    private var heldLoads: [PendingStarts] {
        let midLoad = PendingStarts(afterLoad: 1)
        return [
            midLoad.settled(
                by: midLoad.response(to: .interruptionBegan, isPlaying: false),
                loading: 1, recovering: false, resuming: false
            ),
            PendingStarts.opening(load: 1, autoplay: true, heldByCall: true),
        ]
    }

    @Test func aHeldLoadThatLandsStartsOnTheNextPress() {
        for var pending in heldLoads {
            #expect(pending.togglePauses(isPlaying: false))
            pending.loadEnded()
            #expect(pending == PendingStarts(afterInterruption: true))
            // The press reaches `play()`, which starts the item the load built.
            #expect(!pending.togglePauses(isPlaying: false))
            #expect(!pending.startIsPending)
        }
    }

    @Test func aHeldLoadThatFailsRetriesOnTheNextPress() {
        for var pending in heldLoads {
            pending.loadEnded()
            // The press reaches `play()`, whose load is the retry; it overrules
            // the call, so the retry's start is the listener's own.
            #expect(!pending.togglePauses(isPlaying: false))
            pending.armResume()
            #expect(pending == PendingStarts(afterResume: true))
            #expect(pending.togglePauses(isPlaying: false))
        }
    }

    @Test func aCallEndingAfterAHeldLoadEndedStillResumesOnce() {
        // Nothing is in flight, so `respond` calls `play()`: it starts a load
        // that landed and retries one that failed. Nothing is left to do it twice.
        for var pending in heldLoads {
            pending.loadEnded()
            let ended = AudioSessionEvent.interruptionEnded(shouldResume: true)
            let response = pending.response(to: ended, isPlaying: false)
            #expect(response == .resume)
            let settled = pending.settled(by: response, loading: nil, recovering: false, resuming: false)
            #expect(settled == PendingStarts())
            #expect(settled.response(to: ended, isPlaying: false) == .ignore)
        }
    }

    @Test func aCallEndingWithoutResumeOrALostOutputAfterAHeldLoadEndedDropsIt() {
        for var pending in heldLoads {
            pending.loadEnded()
            for event in [AudioSessionEvent.outputLost, .interruptionEnded(shouldResume: false)] {
                let response = pending.response(to: event, isPlaying: false)
                #expect(response == .pause)
                #expect(
                    pending.settled(by: response, loading: nil, recovering: false, resuming: false)
                        == PendingStarts()
                )
            }
        }
    }

    @Test func everyOutcomeThatEndsAStartLeavesTheControlsOnPlay() {
        let owed = [
            PendingStarts(afterRecovery: true), PendingStarts(afterLoad: 1),
            PendingStarts(afterResume: true), PendingStarts(afterInterruption: true, callHoldsLoad: true),
        ]
        for pending in owed {
            #expect(pending.togglePauses(isPlaying: false))
            // A lost output, whatever is still in flight.
            let response = pending.response(to: .outputLost, isPlaying: false)
            #expect(
                !pending.settled(by: response, loading: 1, recovering: true, resuming: true)
                    .togglePauses(isPlaying: false)
            )
        }
        // A call's end without a resume takes back what it was holding.
        for held in heldLoads {
            let response = held.response(to: .interruptionEnded(shouldResume: false), isPlaying: false)
            #expect(
                !held.settled(by: response, loading: 1, recovering: false, resuming: false)
                    .togglePauses(isPlaying: false)
            )
        }
    }

    @MainActor @Test func aControlHearsAWriteToPendingStarts() {
        final class Flag: @unchecked Sendable { var raised = false }
        let changed = Flag()
        let player = AudioPlayer.shared
        withObservationTracking {
            _ = player.isPlayingOrStarting
        } onChange: {
            changed.raised = true
        }
        // With no book loaded this only writes `pendingStarts`, with the value it holds.
        player.play()
        #expect(changed.raised)
    }
}
