//  SiriAnswers.swift
//  The sentences Siri speaks and the text a review hands to other apps.
//
//  Pure functions over the wire models, so what Siri says is unit-tested
//  without a store, a session or a device.

import Foundation

enum SiriAnswers {
    /// "You're reading X, 42% through." for one book, a list for several.
    static func currentlyReading(_ points: [ResumePoint]) -> String {
        switch points.count {
        case 0:
            return "You don't have anything in progress."
        case 1:
            let point = points[0]
            let title = point.book.displayTitle
            let verb = point.isAudio ? "listening to" : "reading"
            guard let percent = percent(of: point) else { return "You're \(verb) \(title)." }
            return "You're \(verb) \(title), \(percent)% through."
        default:
            let titles = points.map(\.book.displayTitle)
            let list = ListFormatter.localizedString(byJoining: titles)
            return "You're in the middle of \(points.count) books: \(list)."
        }
    }

    /// How far along one book is. `finished` wins over any saved position.
    static func progress(title: String, point: ResumePoint?, finished: Bool) -> String {
        if finished { return "You've finished \(title)." }
        guard let point else { return "You haven't started \(title)." }
        guard let percent = percent(of: point) else {
            return "You've started \(title), but Omnibus doesn't know how far along you are yet."
        }
        let verb = point.isAudio ? "listened to" : "read"
        return "You've \(verb) \(percent)% of \(title)."
    }

    /// Whole percent, rounded down so Siri never claims more than was read.
    static func percent(of point: ResumePoint) -> Int? {
        point.fraction.map { Int(($0 * 100).rounded(.down)) }
    }

    /// The review as one block of text: who it's about, the rating, then the
    /// review. Private notes never leave the app this way.
    static func reviewText(_ review: Review, book: Book?) -> String {
        var heading = book.map { "\($0.displayTitle) by \($0.authorDisplay)" } ?? "My review"
        if let stars = review.stars { heading += " — \(starsPhrase(stars))" }
        var parts = [heading]
        if review.spoiler { parts.append("Contains spoilers.") }
        if let body = review.bodyMd?.trimmingCharacters(in: .whitespacesAndNewlines), !body.isEmpty {
            parts.append(body)
        }
        return parts.joined(separator: "\n\n")
    }

    /// "4 out of 5 stars", "4.5 out of 5 stars".
    static func starsPhrase(_ stars: Double) -> String {
        let value = stars.rounded() == stars ? String(Int(stars)) : String(format: "%.1f", stars)
        return "\(value) out of 5 stars"
    }

    /// The readings of a spoken request to search the library with, strictest
    /// first: as said, then each trailing "audiobook" or "book" dropped in
    /// turn — each its own reading, since "book" can be the title's last word
    /// — then the part before " by " of each, since the mirror matches a title
    /// or an author, not both.
    static func searchCandidates(for spoken: String) -> [String] {
        var forms = [spoken.trimmingCharacters(in: .whitespacesAndNewlines)]
        for suffix in [" audiobook", " audio book", " book"]
        where forms[forms.count - 1].lowercased().hasSuffix(suffix) {
            forms.append(String(forms[forms.count - 1].dropLast(suffix.count)))
        }
        let titles = forms.compactMap { form in
            form.range(of: " by ", options: [.caseInsensitive, .backwards])
                .map { String(form[..<$0.lowerBound]) }
        }
        var candidates: [String] = []
        for text in forms + titles {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty, !candidates.contains(trimmed) { candidates.append(trimmed) }
        }
        return candidates
    }

    /// The most recent written review, else the most recent rating. "Send my
    /// latest review" means words when there are any.
    static func latest(of reviews: [Review]) -> Review? {
        let newestFirst = reviews.sorted { $0.updatedAt > $1.updatedAt }
        return newestFirst.first { $0.bodyMd?.nilIfBlank != nil } ?? newestFirst.first
    }
}
