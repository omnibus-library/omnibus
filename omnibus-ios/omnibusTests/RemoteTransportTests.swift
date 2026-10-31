//  RemoteTransportTests.swift
//  Every remote seek command seeks; none of them changes chapter.
//
//  Hardware buttons — a steering wheel, AirPods — arrive as track or seek
//  commands, and the track commands used to jump whole chapters. These pin that
//  they all seek by the same intervals the on-screen skip buttons draw, and
//  that one press sending two of them moves only once.

import Testing

@testable import omnibus

struct RemoteTransportTests {
    @Test func nextTrackSeeksForwardLikeSkipForward() {
        #expect(RemoteTransport.nextTrack.seekDelta == RemoteTransport.forwardSeconds)
        #expect(RemoteTransport.skipForward.seekDelta == RemoteTransport.forwardSeconds)
    }

    @Test func previousTrackSeeksBackLikeSkipBackward() {
        #expect(RemoteTransport.previousTrack.seekDelta == -RemoteTransport.backSeconds)
        #expect(RemoteTransport.skipBackward.seekDelta == -RemoteTransport.backSeconds)
    }

    @Test func seekCommandsSeekLikeTheSkipCommands() {
        #expect(RemoteTransport.seekForward.seekDelta == RemoteTransport.skipForward.seekDelta)
        #expect(RemoteTransport.seekBackward.seekDelta == RemoteTransport.skipBackward.seekDelta)
    }

    @Test func intervalsAreBackFifteenForwardThirty() {
        // The same pair the in-app transport and Car Mode draw.
        #expect(RemoteTransport.backSeconds == 15)
        #expect(RemoteTransport.forwardSeconds == 30)
    }

    @Test func differentCommandsInOneDirectionAreOnePress() {
        #expect(RemoteTransport.seekForward.isSamePress(as: .nextTrack, after: 0.1))
        #expect(RemoteTransport.nextTrack.isSamePress(as: .seekForward, after: 0.1))
        #expect(RemoteTransport.seekBackward.isSamePress(as: .previousTrack, after: 0.1))
    }

    @Test func repeatingACommandIsASecondPress() {
        #expect(!RemoteTransport.nextTrack.isSamePress(as: .nextTrack, after: 0.1))
        #expect(!RemoteTransport.seekForward.isSamePress(as: .seekForward, after: 0.1))
    }

    @Test func commandsInOppositeDirectionsAreSeparatePresses() {
        #expect(!RemoteTransport.previousTrack.isSamePress(as: .seekForward, after: 0.1))
    }

    @Test func aCommandPastTheWindowIsASecondPress() {
        let window = RemoteTransport.samePressWindow
        #expect(!RemoteTransport.seekForward.isSamePress(as: .nextTrack, after: window))
    }
}
