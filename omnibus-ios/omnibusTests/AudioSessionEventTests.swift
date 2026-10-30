//  AudioSessionEventTests.swift
//  What a call or a lost output does to playback.
//
//  Both stop AVPlayer underneath `AudioPlayer`, which went on claiming it was
//  playing until the next toggle paused a player that was already silent.
//  These pin the parsing of the session's notifications and the response to
//  each: a call pauses and comes back, a disconnect pauses and stays paused.

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
}
