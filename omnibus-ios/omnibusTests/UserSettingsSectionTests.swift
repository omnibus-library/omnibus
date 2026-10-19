//  UserSettingsSectionTests.swift
//  The You tab's "User settings" captions: what each switch says about its
//  current state, and that a failed save replaces it. The wording mirrors the
//  web Account card so the two surfaces describe the same setting alike.

import Testing

@testable import omnibus

@Suite("User settings copy")
struct UserSettingsSectionTests {
    @Test("says how book grids look for each stack-series state")
    func stackSeriesCaptionDescribesEachState() {
        #expect(
            UserSettingsSection.caption(.stackSeries, isOn: true, error: nil)
                == "Each series folds into one stack wherever books are listed.")
        #expect(
            UserSettingsSection.caption(.stackSeries, isOn: false, error: nil)
                == "Every book in a series keeps its own cover.")
    }

    @Test("says how book details behave for each scroll-stops state")
    func scrollStopsCaptionDescribesEachState() {
        #expect(
            UserSettingsSection.caption(.scrollStops, isOn: true, error: nil)
                == "Book details snap through one panel at a time.")
        #expect(
            UserSettingsSection.caption(.scrollStops, isOn: false, error: nil)
                == "Book details scroll continuously, top to bottom.")
    }

    @Test("says who can see the stats page for each share-stats state")
    func shareStatsCaptionDescribesEachState() {
        #expect(
            UserSettingsSection.caption(.shareStats, isOn: true, error: nil)
                == "Other readers on this server can see your stats page.")
        #expect(
            UserSettingsSection.caption(.shareStats, isOn: false, error: nil)
                == "Only you can see your stats page.")
    }

    @Test("shows the error instead of the caption, for any row and state")
    func anErrorReplacesAnyRowsCaption() {
        for row in [UserSettingsSection.Row.stackSeries, .scrollStops, .shareStats] {
            for isOn in [true, false] {
                #expect(
                    UserSettingsSection.caption(row, isOn: isOn, error: "Couldn't reach the server.")
                        == "Couldn't reach the server.")
            }
        }
    }
}
