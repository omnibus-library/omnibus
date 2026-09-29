//  StatsReaderPicker.swift
//  The masthead control that switches whose stats the tab is showing, and how
//  a failed read for another reader is told apart from a genuine error.

import SwiftUI

extension StatsSubject {
    /// "You" first, then each sharing reader in the server's order. The
    /// server's own `is_you` row is dropped — `.you` already stands for it.
    static func options(from readers: [HouseholdReader]) -> [StatsSubject] {
        [.you] + readers.filter { !$0.isYou }.map(StatsSubject.reader)
    }

    /// Someone else shares, or you are already viewing someone — so the
    /// control stays reachable even if that reader stops sharing mid-visit.
    static func pickerIsVisible(readers: [HouseholdReader], current: StatsSubject) -> Bool {
        if case .reader = current { return true }
        return readers.contains { !$0.isYou }
    }

    var title: String {
        switch self {
        case .you: "Stats"
        case let .reader(reader): "\(reader.name)\u{2019}s stats"
        }
    }

    var menuLabel: String {
        switch self {
        case .you: "You"
        case let .reader(reader): reader.name
        }
    }

    /// Only your own goals are yours to edit.
    var canEditGoals: Bool {
        if case .you = self { return true }
        return false
    }
}

/// Why a stats read produced no figures, as the screen tells it.
enum StatsReadFailure: Equatable {
    case notSharing
    case error(String)

    static let notSharingTitle = "This reader isn\u{2019}t sharing their stats"

    /// A 404 reads as a refusal only when it's about another reader — your
    /// own stats never 404 for that reason, so it stays a plain error.
    init(_ error: Error, subject: StatsSubject) {
        if case .reader = subject, case .some(.http(404, _)) = error as? APIError {
            self = .notSharing
        } else {
            self = .error((error as? APIError)?.errorDescription ?? error.localizedDescription)
        }
    }
}

/// The masthead's trailing control: a system menu of every sharing reader,
/// labelled with the selected subject's avatar and a chevron. Text rows only
/// inside the menu — it can't draw a remote image, so the avatar lives on the
/// label instead.
struct StatsReaderPicker: View {
    @Binding var subject: StatsSubject
    let readers: [HouseholdReader]

    var body: some View {
        Menu {
            Picker("Whose stats", selection: $subject) {
                ForEach(StatsSubject.options(from: readers), id: \.self) { option in
                    Text(option.menuLabel).tag(option)
                }
            }
        } label: {
            HStack(spacing: 4) {
                avatar
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
            }
        }
        .accessibilityLabel("Whose stats")
        .accessibilityValue(subject.menuLabel)
    }

    @ViewBuilder
    private var avatar: some View {
        switch subject {
        case .you:
            if let you = readers.first(where: { $0.isYou }) {
                UserAvatar(id: you.id, name: you.name, hasAvatar: you.hasAvatar, size: 28)
            } else {
                Image(systemName: "person.crop.circle").font(.system(size: 28))
            }
        case let .reader(reader):
            UserAvatar(id: reader.id, name: reader.name, hasAvatar: reader.hasAvatar, size: 28)
        }
    }
}
