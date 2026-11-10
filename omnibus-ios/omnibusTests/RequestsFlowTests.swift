//  RequestsFlowTests.swift
//  The Requests list's pure decisions, ported from the web's `requestGroups.test.ts`
//  (phone cases only): how books group, what each row says, and the counts line.

import Foundation
import Testing

@testable import omnibus

/// Each group's key and its books' uuids, in order: `needs_you=a,b`.
private func shape(_ groups: [RequestGroup]) -> [String] {
    groups.map { "\($0.key.rawValue)=" + $0.items.map(\.book.uuid).joined(separator: ",") }
}

struct RequestsFlowTests {
    struct Grouping {
        @Test func ordersTheGroupsNeedsYouOnItsWayLookingStuckReadyThenCancelled() {
            let groups = RequestsFlow.groups(
                [
                    listing("gone", id: 0, state: .cancelled),
                    listing("ready", id: 1, state: .ready),
                    listing("stuck", id: 2, state: .stuck, stuckReason: .notFound),
                    listing("looking", id: 3, state: .looking),
                    listing("coming", id: 4, state: .onItsWay),
                    listing("yours", id: 5, state: .choose),
                ],
                viewer: adaViewer
            )
            #expect(
                shape(groups) == [
                    "needs_you=yours", "on_its_way=coming", "looking=looking", "stuck=stuck", "ready=ready",
                    "cancelled=gone",
                ])
        }

        @Test func listsAPickedVersionAsOnItsWay() {
            #expect(shape(RequestsFlow.groups([listing("b", state: .chosen)], viewer: adaViewer)) == ["on_its_way=b"])
        }

        @Test func listsAPickStillToMakeAsLookingToAReaderWhoCantPickVersions() {
            let mine = listing("mine", id: 1, userID: 1, state: .choose)
            let theirs = listing("theirs", id: 2, userID: 2, state: .choose)
            #expect(shape(RequestsFlow.groups([mine, theirs], viewer: askerViewer)) == ["looking=mine,theirs"])
        }

        @Test func listsAnyReadersPickStillToMakeAsNeedingAReaderWhoCanPickVersions() {
            let mine = listing("mine", id: 1, userID: 1, state: .choose)
            let theirs = listing("theirs", id: 2, userID: 2, state: .choose)
            #expect(shape(RequestsFlow.groups([mine, theirs], viewer: adaViewer)) == ["needs_you=mine,theirs"])
        }

        @Test func filesABookWhoseEveryRequestWasCancelledUnderCancelled() {
            #expect(shape(RequestsFlow.groups([listing("gone", state: .cancelled)], viewer: adaViewer)) == ["cancelled=gone"])
        }

        @Test func filesABookUnderItsLiveRequestWhenANewerOneWasCancelled() {
            let groups = RequestsFlow.groups(
                [listing("b", id: 4, state: .cancelled), listing("b", id: 3, state: .stuck, stuckReason: .notFound)],
                viewer: adaViewer
            )
            #expect(shape(groups) == ["stuck=b"])
        }

        @Test func filesAnAllCancelledBookUnderTheRequestCancelledLast() {
            let groups = RequestsFlow.groups(
                [
                    listing("b", id: 5, state: .cancelled, updatedAt: 1000),
                    listing("b", id: 3, state: .cancelled, updatedAt: 2000),
                ],
                viewer: adaViewer
            )
            #expect(groups.first?.items.first?.request.id == 3)
        }

        @Test func filesABookUnderItsMostUrgentRequest() {
            let groups = RequestsFlow.groups(
                [
                    listing("b", id: 3, userID: 2, state: .looking),
                    listing("b", id: 2, state: .onItsWay),
                    listing("b", id: 1, state: .cancelled),
                ],
                viewer: adaViewer
            )
            #expect(shape(groups) == ["on_its_way=b"])
            #expect(groups.first?.items.first?.request.id == 2)
        }

        @Test func filesABookUnderItsNewestRequestWhenTwoAreAsUrgent() {
            let groups = RequestsFlow.groups(
                [listing("b", id: 3, userID: 2, state: .looking), listing("b", id: 2, state: .looking)],
                viewer: adaViewer
            )
            #expect(groups.first?.items.first?.request.id == 3)
        }

        @Test func listsEveryReadersRequestsAndDropsEmptyGroups() {
            let groups = RequestsFlow.groups(
                [listing("a", id: 1, userID: 2, state: .ready), listing("b", id: 2, userID: 3, state: .ready)],
                viewer: adaViewer
            )
            #expect(shape(groups) == ["ready=a,b"])
        }
    }

    struct ItemLine {
        @Test(arguments: [
            (RequestGroupKey.needsYou, RequestState.choose, nil, nil, "Ebook · choose a version"),
            (.looking, .choose, nil, nil, "Ebook · choosing a version"),
            (.looking, .looking, nil, nil, "Ebook · looking for a version"),
            (.onItsWay, .chosen, nil, nil, "Ebook · on its way"),
            (.onItsWay, .onItsWay, nil, nil, "Ebook · on its way"),
            (.onItsWay, .onItsWay, 0.62, nil, "Ebook · 62%"),
            (.stuck, .stuck, nil, StuckReason.notFound, "Ebook · couldn\u{2019}t find it"),
            (.stuck, .stuck, nil, .searchFailed, "Ebook · couldn\u{2019}t find it"),
            (.stuck, .stuck, nil, .stoppedMoving, "Ebook · stopped moving"),
            (.stuck, .stuck, nil, .couldntAdd, "Ebook · couldn\u{2019}t add it"),
            (.ready, .ready, nil, nil, "Ebook · ready to read"),
            (.cancelled, .cancelled, nil, nil, "Ebook · cancelled"),
        ] as [(RequestGroupKey, RequestState, Double?, StuckReason?, String)])
        func readsEachStateAsAPhoneDoes(
            group: RequestGroupKey, state: RequestState, progress: Double?, reason: StuckReason?, expected: String
        ) {
            let item = listing("b", state: state, stuckReason: reason, progress: progress)
            #expect(RequestsFlow.itemLine(item, group: group) == expected)
        }

        @Test func namesAnAudiobooksFormatAndItsListeningReadiness() {
            #expect(RequestsFlow.itemLine(listing("b", kind: .audiobook, state: .ready), group: .ready) == "Audiobook \u{b7} ready to listen")
            #expect(RequestsFlow.itemLine(listing("b", kind: .audiobook, state: .looking), group: .looking) == "Audiobook \u{b7} looking for a version")
        }

        @Test func readsAFinishedDownloadAsOnItsWayRatherThanOneHundredPercent() {
            let item = listing("b", state: .onItsWay, progress: 1)
            #expect(RequestsFlow.itemLine(item, group: .onItsWay) == "Ebook \u{b7} on its way")
        }
    }

    @MainActor
    struct Counts {
        private func groupsOf(_ states: RequestState...) -> [RequestGroup] {
            RequestsFlow.groups(
                states.enumerated().map { listing("b\($0.offset)", id: Int64($0.offset + 1), state: $0.element) },
                viewer: adaViewer
            )
        }

        @Test func countsEachShapeOfList() {
            #expect(RequestsFlow.countsLine(groupsOf(.choose, .looking)) == "2 books \u{b7} 1 needs you")
            #expect(RequestsFlow.countsLine(groupsOf(.choose, .choose)) == "2 books \u{b7} 2 need you")
            #expect(RequestsFlow.countsLine(groupsOf(.looking)) == "1 book")
            #expect(RequestsFlow.countsLine(groupsOf(.cancelled)) == "0 books")
            #expect(RequestsFlow.countsLine(groupsOf(.looking, .cancelled)) == "1 book")
        }

        @Test func theNeedsYouPillIsAbsentForNoneAndSaysNeedOrNeedsOtherwise() {
            #expect(RequestsFlow.needsYouPill(0) == nil)
            #expect(RequestsFlow.needsYouPill(1) == "1 needs you")
            #expect(RequestsFlow.needsYouPill(2) == "2 need you")
        }

        @Test func countsTheBooksNeedingTheViewer() {
            let listings = [listing("a", id: 1, state: .choose), listing("b", id: 2, state: .choose), listing("c", id: 3, state: .looking)]
            #expect(RequestsFlow.needsYouCount(listings, viewer: adaViewer) == 2)
            #expect(RequestsFlow.needsYouCount(listings, viewer: askerViewer) == 0)
        }
    }

    struct Presentation {
        @Test func labelsEachGroup() {
            #expect(RequestGroupKey.allCases.map(\.label) == ["Needs you", "On its way", "Looking", "Stuck", "Ready", "Cancelled"])
        }

        @Test func tonesEachGroupsDot() {
            #expect(RequestGroupKey.needsYou.tone == .accent)
            #expect(RequestGroupKey.stuck.tone == .bad)
            #expect(RequestGroupKey.ready.tone == .ok)
            #expect(RequestGroupKey.cancelled.tone == .ink3)
            #expect([RequestGroupKey.onItsWay, .looking].map(\.tone) == [.ink1, .ink1])
        }

        @Test func foldsOnlyCancelledByDefault() {
            #expect(RequestGroupKey.allCases.filter { RequestsFlow.defaultFolds[$0] == true } == [.cancelled])
        }

        @Test func pollsEveryTenSecondsWhileAnyRequestIsMoving() {
            #expect(RequestsFlow.listPollInterval([listing("a", state: .ready), listing("b", id: 2, state: .looking)]) == .seconds(10))
            #expect(RequestsFlow.listPollInterval([listing("a", state: .chosen)]) == .seconds(10))
            #expect(RequestsFlow.listPollInterval([listing("a", state: .onItsWay)]) == .seconds(10))
        }

        @Test func stopsPollingWhenNothingIsMovingOrNothingHasLoaded() {
            #expect(RequestsFlow.listPollInterval([listing("a", state: .choose), listing("b", id: 2, state: .stuck)]) == nil)
            #expect(RequestsFlow.listPollInterval([]) == nil)
            #expect(RequestsFlow.listPollInterval(nil) == nil)
        }

        @Test func buildsTheViewerFromTheSessionUser() {
            var user = UserSummary(id: 4, username: "ada", isAdmin: false, canUpload: false, canEdit: false, canDownload: true)
            user.canStartRequests = true
            #expect(RequestViewer(user) == RequestViewer(id: 4, canStart: true, canChoose: false))
        }
    }

    struct AddSheet {
        @Test func namesEveryBookWithAnEbookRequestStillGoing() {
            let listings = [
                listing("choosing", id: 1, state: .choose), listing("looking", id: 2, state: .looking),
                listing("picked", id: 3, state: .chosen), listing("coming", id: 4, state: .onItsWay, progress: 0.6),
                listing("stuck", id: 5, state: .stuck, stuckReason: .notFound),
            ]
            #expect(RequestsFlow.requestedBooks(listings) == ["choosing", "looking", "picked", "coming", "stuck"])
        }

        @Test func leavesOutAFinishedOrCancelledRequestAndAnAudiobookOne() {
            let listings = [
                listing("cancelled", id: 1, state: .cancelled), listing("ready", id: 2, state: .ready),
                listing("audio", id: 3, kind: .audiobook, state: .looking),
            ]
            #expect(RequestsFlow.requestedBooks(listings).isEmpty)
        }

        @Test func opensABookThatIsAlreadyRequestedEvenWhenTheLibraryHoldsAnEbook() {
            #expect(RequestsFlow.addAction(uuid: "b", formats: ["EPUB"], hasFiles: true, requested: ["b"]) == .open)
        }

        @Test func holdsABookWhoseFormatsIncludeAnEbook() {
            #expect(RequestsFlow.addAction(uuid: "b", formats: ["EPUB", "M4B"], hasFiles: false, requested: []) == .held)
            #expect(RequestsFlow.addAction(uuid: "b", formats: ["pdf"], hasFiles: false, requested: []) == .held)
        }

        @Test func startsForABookWithOnlyAnAudiobookOrPrintInTheLibrary() {
            #expect(RequestsFlow.addAction(uuid: "b", formats: ["M4B"], hasFiles: true, requested: []) == .start)
            #expect(RequestsFlow.addAction(uuid: "b", formats: ["PRINT"], hasFiles: false, requested: []) == .start)
            #expect(RequestsFlow.addAction(uuid: "b", formats: [], hasFiles: false, requested: []) == .start)
        }

        @Test func readsAnIsbnLookupsBookByWhetherItHasAnyFile() {
            #expect(RequestsFlow.addAction(uuid: "b", formats: nil, hasFiles: true, requested: []) == .held)
            #expect(RequestsFlow.addAction(uuid: "b", formats: nil, hasFiles: false, requested: []) == .start)
        }
    }
}
