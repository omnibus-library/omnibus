//  StatsReaderPickerTests.swift
//  The household picker's presentation: who it lists, when it shows, what a
//  reader's own title reads, and how a failed read is classified.

import Foundation
import Testing

@testable import omnibus

private func reader(_ id: Int64, _ name: String, isYou: Bool = false) -> HouseholdReader {
    HouseholdReader(id: id, name: name, hasAvatar: false, isYou: isYou)
}

struct StatsReaderPickerTests {
    @Test func optionsLeadsWithYouThenEverySharingReaderInServerOrder() {
        let ada = reader(1, "Ada")
        let ben = reader(2, "Ben")
        #expect(StatsSubject.options(from: []) == [.you])
        #expect(StatsSubject.options(from: [reader(0, "You", isYou: true)]) == [.you])
        #expect(StatsSubject.options(from: [ada, ben]) == [.you, .reader(ada), .reader(ben)])
    }

    @Test func optionsExcludesTheIsYouRowAndStillLeadsWithYouWhenListedLast() {
        let ada = reader(1, "Ada")
        let you = reader(0, "You", isYou: true)
        #expect(StatsSubject.options(from: [ada, you]) == [.you, .reader(ada)])
    }

    @Test func pickerHidesWhenNobodyElseSharesAndShowsOnceSomeoneDoes() {
        #expect(!StatsSubject.pickerIsVisible(readers: [], current: .you))
        #expect(!StatsSubject.pickerIsVisible(readers: [reader(0, "You", isYou: true)], current: .you))
        #expect(StatsSubject.pickerIsVisible(readers: [reader(1, "Ada")], current: .you))
    }

    @Test func pickerStaysVisibleWhileViewingAReaderEvenWithNobodyElseSharing() {
        #expect(StatsSubject.pickerIsVisible(readers: [], current: .reader(reader(1, "Ada"))))
    }

    @Test func titleAndMenuLabelNameYouOrTheReader() {
        let ada = reader(1, "Ada")
        #expect(StatsSubject.you.title == "Stats")
        #expect(StatsSubject.you.menuLabel == "You")
        #expect(StatsSubject.reader(ada).title == "Ada\u{2019}s stats")
        #expect(StatsSubject.reader(ada).menuLabel == "Ada")
    }

    @Test func onlyYouCanEditGoals() {
        #expect(StatsSubject.you.canEditGoals)
        #expect(!StatsSubject.reader(reader(1, "Ada")).canEditGoals)
    }
}

struct StatsReadFailureTests {
    private let ada = StatsSubject.reader(HouseholdReader(id: 1, name: "Ada", hasAvatar: false, isYou: false))

    @Test func aNotFoundForAnotherReaderIsARefusalRegardlessOfMessage() {
        #expect(
            StatsReadFailure(
                APIError.http(status: 404, message: "this reader isn't sharing their stats"), subject: ada
            ) == .notSharing
        )
        #expect(StatsReadFailure(APIError.http(status: 404, message: ""), subject: ada) == .notSharing)
    }

    @Test func aNotFoundForYourOwnStatsIsAPlainError() {
        #expect(
            StatsReadFailure(APIError.http(status: 404, message: "gone"), subject: .you) == .error("gone")
        )
    }

    @Test func anOfflineFailureForAnotherReaderIsAnError() {
        #expect(StatsReadFailure(APIError.offline, subject: ada) == .error("You're offline."))
    }

    @Test func aServerErrorForAnotherReaderCarriesItsMessage() {
        #expect(StatsReadFailure(APIError.http(status: 500, message: "boom"), subject: ada) == .error("boom"))
    }
}
