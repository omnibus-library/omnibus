//  OmnibusShortcuts.swift
//  The phrases Siri knows with no setup, and the actions the Shortcuts app lists.
//
//  Every phrase has to name the app. A phrase naming a book only matches the
//  books `BookEntityQuery.suggestedEntities` offers, so
//  `updateAppShortcutParameters()` runs whenever the library is re-indexed.

import AppIntents

struct OmnibusShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CurrentlyReadingIntent(),
            phrases: [
                "What am I reading in \(.applicationName)",
                "What am I reading on \(.applicationName)",
                "What's in progress in \(.applicationName)",
            ],
            shortTitle: "What Am I Reading",
            systemImageName: "books.vertical"
        )
        AppShortcut(
            intent: BookProgressIntent(),
            phrases: [
                "How far am I in \(\.$book) in \(.applicationName)",
                "Check my progress in \(.applicationName)",
            ],
            shortTitle: "Book Progress",
            systemImageName: "chart.bar"
        )
        AppShortcut(
            intent: ResumeAudiobookIntent(),
            phrases: [
                "Resume my audiobook in \(.applicationName)",
                "Continue listening in \(.applicationName)",
                "Resume listening in \(.applicationName)",
            ],
            shortTitle: "Resume Audiobook",
            systemImageName: "headphones"
        )
        AppShortcut(
            intent: PlayAudiobookIntent(),
            phrases: [
                "Play \(\.$book) in \(.applicationName)",
                "Listen to \(\.$book) in \(.applicationName)",
                "Play an audiobook in \(.applicationName)",
            ],
            shortTitle: "Play Audiobook",
            systemImageName: "play.circle"
        )
        AppShortcut(
            intent: OpenBookIntent(),
            phrases: [
                "Open \(\.$target) in \(.applicationName)",
                "Read \(\.$target) in \(.applicationName)",
                "Open a book in \(.applicationName)",
            ],
            shortTitle: "Open Book",
            systemImageName: "book"
        )
        AppShortcut(
            intent: LatestReviewIntent(),
            phrases: [
                "Get my latest review from \(.applicationName)",
                "Read my latest review in \(.applicationName)",
            ],
            shortTitle: "Get My Review",
            systemImageName: "star.bubble"
        )
    }
}
