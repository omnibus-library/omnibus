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
        #expect(RemoteTransport.seekForward.isSamePress(as: .nextTrack, after: .milliseconds(100)))
        #expect(RemoteTransport.nextTrack.isSamePress(as: .seekForward, after: .milliseconds(100)))
        #expect(RemoteTransport.seekBackward.isSamePress(as: .previousTrack, after: .milliseconds(100)))
    }

    @Test func repeatingACommandIsASecondPress() {
        #expect(!RemoteTransport.nextTrack.isSamePress(as: .nextTrack, after: .milliseconds(100)))
        #expect(!RemoteTransport.seekForward.isSamePress(as: .seekForward, after: .milliseconds(100)))
    }

    @Test func commandsInOppositeDirectionsAreSeparatePresses() {
        #expect(!RemoteTransport.previousTrack.isSamePress(as: .seekForward, after: .milliseconds(100)))
    }

    @Test func aCommandPastTheWindowIsASecondPress() {
        let window = RemoteTransport.samePressWindow
        #expect(!RemoteTransport.seekForward.isSamePress(as: .nextTrack, after: window))
    }

    @Test func aCommandDuringTheHoldIsTheSamePress() {
        #expect(RemoteTransport.seekForward.isSamePress(as: .nextTrack, after: .milliseconds(-500)))
    }
}

struct RemotePressFilterTests {
    private enum Step {
        case began(RemoteTransport, at: Double)
        case sent(RemoteTransport, at: Double)
    }

    /// Plays `steps` through one filter: whether each `sent` moved, in order.
    private func moves(_ steps: [Step]) -> [Bool] {
        let start = ContinuousClock.now
        var filter = RemotePressFilter()
        var moved: [Bool] = []
        for step in steps {
            switch step {
            case let .began(transport, seconds):
                filter.began(transport, at: start + .seconds(seconds))
            case let .sent(transport, seconds):
                moved.append(filter.shouldMove(transport, at: start + .seconds(seconds)))
            }
        }
        return moved
    }

    @Test func theSameCommandRepeatedMovesEveryTime() {
        let steps: [Step] = [.sent(.nextTrack, at: 0), .sent(.nextTrack, at: 0.1), .sent(.nextTrack, at: 0.2)]
        #expect(moves(steps) == [true, true, true])
    }

    @Test func onePressSendingTwoCommandsMovesOnce() {
        #expect(moves([.sent(.nextTrack, at: 0), .sent(.seekForward, at: 0.1)]) == [true, false])
    }

    @Test func consecutivePairedPressesEachMoveOnce() {
        let steps: [Step] = [
            .sent(.nextTrack, at: 0), .sent(.seekForward, at: 0.1),
            .sent(.nextTrack, at: 0.2), .sent(.seekForward, at: 0.3),
        ]
        #expect(moves(steps) == [true, false, true, false])
    }

    @Test func aPairConsumesAtMostTwoCommands() {
        let steps: [Step] = [.sent(.nextTrack, at: 0), .sent(.seekForward, at: 0.1), .sent(.seekForward, at: 0.2)]
        #expect(moves(steps) == [true, false, true])
    }

    @Test func aHoldOutlastingTheWindowAfterATrackCommandMovesOnce() {
        let steps: [Step] = [.sent(.nextTrack, at: 0), .began(.seekForward, at: 0.1), .sent(.seekForward, at: 1.6)]
        #expect(moves(steps) == [true, false])
    }

    @Test func aTrackCommandArrivingDuringAHoldMovesOnce() {
        let steps: [Step] = [.began(.seekForward, at: 0), .sent(.nextTrack, at: 0.5), .sent(.seekForward, at: 1.5)]
        #expect(moves(steps) == [true, false])
    }

    @Test func aTrackCommandJustAfterAHoldsReleaseMovesOnce() {
        let steps: [Step] = [.began(.seekForward, at: 0), .sent(.seekForward, at: 1.5), .sent(.nextTrack, at: 1.6)]
        #expect(moves(steps) == [true, false])
    }

    @Test func aCommandPastTheWindowAfterAMoveMoves() {
        #expect(moves([.sent(.nextTrack, at: 0), .sent(.seekForward, at: 1)]) == [true, true])
    }

    @Test func aBeginWithNoEndIsOverwrittenByTheNextBegin() {
        let steps: [Step] = [
            .began(.seekForward, at: 0), .sent(.nextTrack, at: 5),
            .began(.seekForward, at: 20), .sent(.seekForward, at: 20.1),
        ]
        #expect(moves(steps) == [true, true])
    }
}
