//  RemoteTransportTests.swift
//  Every remote seek command seeks; none of them changes chapter.
//
//  Hardware previous/next — a steering wheel, AirPods — arrive as the track
//  commands, which used to jump whole chapters. These pin that they now seek
//  by the same intervals the on-screen skip buttons draw.

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

    @Test func intervalsAreBackFifteenForwardThirty() {
        // The same pair the in-app transport and Car Mode draw.
        #expect(RemoteTransport.backSeconds == 15)
        #expect(RemoteTransport.forwardSeconds == 30)
    }
}
