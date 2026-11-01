//  BookDetailDerivations.swift
//  The copy and numbers the book page derives from its records — pure, so the
//  suite can assert them without a screen.

import Foundation

/// The four sections under the stage.
enum BookTab: Int, CaseIterable, Identifiable {
    case overview, reviews, highlights, files

    var id: Int { rawValue }

    var label: String {
        switch self {
        case .overview: "Overview"
        case .reviews: "Reviews"
        case .highlights: "Highlights"
        case .files: "Files"
        }
    }

    /// How far the stage's backdrop pans for this tab, in fractions of its
    /// width, so changing tab moves the room rather than swapping a panel.
    var backdropPan: CGFloat { (1.5 - CGFloat(rawValue)) * 0.11 }

    /// How strongly the warm glow behind the cover shows on this tab.
    var warmth: Double {
        switch self {
        case .overview, .reviews: 0.5
        case .highlights: 1
        case .files: 0.1
        }
    }
}

enum DetailFormat {
    /// `4 h 49 m`, `48 m` — how the page states a span of time.
    static func duration(_ seconds: Int64) -> String {
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        if h > 0 { return String(format: "%d h %02d m", h, m) }
        return m > 0 ? "\(m) m" : "under a minute"
    }

    /// `October 12`, with the year once it isn't this one.
    static func day(
        unix: Int64, now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current
    ) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(unix))
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
        return formatted(
            date, template: sameYear ? "MMMMd" : "yMMMMd", calendar: calendar, locale: locale
        )
    }

    /// `Oct 12`, with the year once it isn't this one.
    static func shortDay(
        unix: Int64, now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current
    ) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(unix))
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
        return formatted(
            date, template: sameYear ? "MMMd" : "yMMMd", calendar: calendar, locale: locale
        )
    }

    /// `Today, 08:02`, `Yesterday, 22:14`, `October 12, 22:14`.
    static func lastRead(
        unix: Int64, now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current
    ) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(unix))
        let time = formatted(date, template: "jmm", calendar: calendar, locale: locale)
        if calendar.isDate(date, inSameDayAs: now) { return "Today, \(time)" }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
           calendar.isDate(date, inSameDayAs: yesterday)
        {
            return "Yesterday, \(time)"
        }
        return "\(day(unix: unix, now: now, calendar: calendar, locale: locale)), \(time)"
    }

    private static func formatted(
        _ date: Date, template: String, calendar: Calendar, locale: Locale
    ) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = locale
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter.string(from: date)
    }
}

/// Where a read that can fail has got to. Empty only means empty once it has
/// answered, which is what keeps a slow or failed read from saying "none yet".
enum ReadAnswer: Equatable, Sendable {
    case waiting
    case known
    case failed
}

enum DetailRead {
    /// Whether a kept line can open in the EPUB reader. A mixed EPUB and PDF book
    /// shares one list, and a `pdf-page:` anchor means nothing to that reader.
    static func opensInBook(hasEpub: Bool, anchor: String?) -> Bool {
        hasEpub && anchor.map(ReaderController.isEpubCFI) == true
    }

    /// The line above the title of a wishlisted book with no files.
    static func wishlistLine(source: String) -> String {
        "On your wishlist · added from \(source)"
    }

    /// The creators an author page can be opened for, in credit order — one
    /// per author id, skipping a name the server could not link.
    static func linkedCreators(_ creators: [Contributor]) -> [DetailCreatorLink] {
        var seen = Set<Int64>()
        return creators.compactMap { creator in
            guard let id = creator.id, let name = creator.name.nilIfBlank,
                  seen.insert(id).inserted
            else { return nil }
            return DetailCreatorLink(id: id, name: name)
        }
    }

    /// Whether the page offers a read status. A record with nothing to read —
    /// no file, no paper copy, nothing being tracked — has no reading to mark;
    /// a paper copy keeps it, since the status is the only record of reading
    /// one, and a wishlisted book may well be one you have already read.
    static func showsReadStatus(hasFile: Bool, hasPhysical: Bool, wishlisted: Bool) -> Bool {
        hasFile || hasPhysical || wishlisted
    }

    /// Whether the page leaves once the wishlist entry is removed. A book that
    /// stayed but has neither files nor a paper copy is hidden from browse,
    /// so the page would be showing a record the reader can no longer reach.
    static func leavesAfterWishlistRemoval(
        bookDeleted: Bool, hasFile: Bool, hasPhysical: Bool
    ) -> Bool {
        bookDeleted || (!hasFile && !hasPhysical)
    }

    /// The primary action's label, which states what the tap does next.
    static func actionLabel(
        status: ReadStatus, hasPosition: Bool, toPlayer: Bool, chapter: Int64?
    ) -> String {
        if status == .finished { return toPlayer ? "Listen again" : "Read again" }
        guard status == .reading || hasPosition else {
            return toPlayer ? "Start listening" : "Start reading"
        }
        if toPlayer { return "Continue listening" }
        return chapter.map { "Continue · Chapter \($0)" } ?? "Continue reading"
    }

    /// Whether the primary action opens the player rather than the reader —
    /// kept in lockstep with `actionLabel`, so a label speaking of listening
    /// never opens the reader at page one.
    static func resumesIntoPlayer(
        hasEbook: Bool, hasAudiobook: Bool, epubStarted: Bool, audioSeconds: Double?
    ) -> Bool {
        guard hasAudiobook else { return false }
        guard hasEbook else { return true }
        return !epubStarted && (audioSeconds ?? 0) > 1
    }

    /// Whole-book fraction for the progress bar. The reading percent wins;
    /// with no reading record at all the listening position stands in.
    /// `nil` when no honest fraction exists — a bare CFI carries no percent,
    /// and audio needs a measured duration.
    static func fraction(
        epubStarted: Bool, epubPercent: Int64?, audioSeconds: Double?, audioDuration: Double?
    ) -> Double? {
        if let epubPercent {
            return min(1, max(0, Double(epubPercent) / 100))
        }
        // A CFI-only save means reading is underway somewhere the percent
        // can't say — drawing the (older) audio position would misplace it.
        guard !epubStarted else { return nil }
        guard let audioSeconds, let audioDuration, audioDuration > 0 else { return nil }
        return min(1, max(0, audioSeconds / audioDuration))
    }

    /// A row shows for its chips, or for the "+" that would add the first.
    static func showsChipRow(values: [String], canEdit: Bool) -> Bool {
        !values.isEmpty || canEdit
    }

    /// What the Files tab's link row states per link state. Every state opens
    /// the alignment sheet — link, re-confirm and unlink all live there.
    static func syncRow(state: CrossFormatResumeState?) -> DetailSyncCopy {
        switch state {
        case .linkStale:
            DetailSyncCopy(
                title: "Check the book and audiobook link",
                detail: "The files changed since you linked them",
                linked: false
            )
        case .notLinked, nil:
            DetailSyncCopy(
                title: "Link book and audiobook",
                detail: "Carry your place across, chapter by chapter",
                linked: false
            )
        default:
            DetailSyncCopy(
                title: "Book and audiobook linked",
                detail: "Your place carries across, chapter by chapter",
                linked: true
            )
        }
    }

    /// `Ebook · 180 pages · Audiobook · 4 h 49 m`, for a book not yet begun.
    /// A format's length is left out when the record doesn't know it.
    static func runtimeLine(
        hasEbook: Bool, printPages: Int64?, hasAudiobook: Bool, audioDuration: Double?
    ) -> String {
        var parts: [String] = []
        if hasEbook {
            parts.append("Ebook")
            if let printPages, printPages > 0 { parts.append("\(printPages) pages") }
        }
        if hasAudiobook {
            parts.append("Audiobook")
            if let audioDuration, audioDuration > 0 {
                parts.append(DetailFormat.duration(Int64(audioDuration)))
            }
        }
        return parts.joined(separator: " · ")
    }

    /// The bar's flag: the chapter once it is known, the listening position or
    /// the percent otherwise.
    static func flagLabel(chapter: Int64?, audioSeconds: Double?, percent: Int) -> String {
        if let chapter { return "Ch. \(chapter)" }
        if let audioSeconds { return DetailFormat.duration(Int64(audioSeconds)) }
        return "\(percent)%"
    }
}

/// A creator with an author page to open.
struct DetailCreatorLink: Equatable {
    var id: Int64
    var name: String
}

/// The Files tab's link row copy, plus whether it wears the linked look.
struct DetailSyncCopy: Equatable {
    var title: String
    var detail: String
    var linked: Bool
}

// MARK: - The progress bar

/// One division of the progress bar: its share of the bar and how much of it
/// the reader has covered, 0...1.
struct StageSegment: Equatable {
    var weight: Double
    var fill: Double
}

enum StageProgress {
    /// Past this the gaps between divisions take more room than the divisions,
    /// and a long book's bar reads as a dotted line.
    static let maxSegments = 24

    /// A division thinner than this share of the bar folds into the next one:
    /// a title page reads as a stray tick rather than as part of the book.
    static let minShare = 0.015

    /// Division widths from where each chapter starts, in percent of the book.
    static func weights(starts: [Double]) -> [Double] {
        let inside = starts.filter { $0 > 0 && $0 < 100 }.sorted()
        let edges = [0] + inside + [100]
        let widths = zip(edges, edges.dropFirst()).map { $1 - $0 }.filter { $0 > 0.01 }
        return merged(widths.isEmpty ? [1] : widths)
    }

    /// Division widths from each chapter's length.
    static func weights(durations: [Double]) -> [Double] {
        let widths = durations.filter { $0 > 0 }
        return merged(widths.isEmpty ? [1] : widths)
    }

    /// Folds neighbouring divisions together: slivers into what follows them,
    /// then evenly until the count fits.
    private static func merged(_ widths: [Double]) -> [Double] {
        let floor = widths.reduce(0, +) * minShare
        var kept: [Double] = []
        var carried = 0.0
        for width in widths {
            if width + carried < floor {
                carried += width
            } else {
                kept.append(width + carried)
                carried = 0
            }
        }
        if carried > 0 {
            if kept.isEmpty { kept.append(carried) } else { kept[kept.count - 1] += carried }
        }
        guard kept.count > maxSegments else { return kept }
        let size = Int((Double(kept.count) / Double(maxSegments)).rounded(.up))
        return stride(from: 0, to: kept.count, by: size).map { start in
            kept[start..<min(start + size, kept.count)].reduce(0, +)
        }
    }

    /// The divisions with `fraction` of the whole bar filled.
    static func segments(weights: [Double], fraction: Double) -> [StageSegment] {
        let total = weights.reduce(0, +)
        guard total > 0 else { return [] }
        let reached = min(1, max(0, fraction)) * total
        var run = 0.0
        return weights.map { weight in
            let start = run
            run += weight
            return StageSegment(weight: weight, fill: min(1, max(0, (reached - start) / weight)))
        }
    }
}

// MARK: - Your reading

/// What the page states about this read, folded from the session log.
struct DetailReadRecord: Equatable {
    var startedAt: Int64
    var daysIn: Int
    var totalSeconds: Int64
    var sessions: Int
    var averageSeconds: Int64
    var longestSeconds: Int64
    var longestAt: Int64
    var lastEndedAt: Int64
    var readSeconds: Int64
    var listenSeconds: Int64
}

/// One row of the Your reading card.
struct DetailStatRow: Equatable, Identifiable {
    var key: String
    var value: String

    var id: String { key }
}

enum DetailStats {
    /// Folds a per-book session log (any order) into the card's record.
    /// `nil` when there are no sittings — the card states that instead.
    static func record(
        from sessions: [SessionLogEntry], now: Date = Date()
    ) -> DetailReadRecord? {
        guard !sessions.isEmpty else { return nil }

        let started = sessions.map(\.startedAt).min() ?? 0
        let total = sessions.reduce(0) { $0 + $1.seconds }
        let longest = sessions.max { $0.seconds < $1.seconds }
        let read = sessions.filter { $0.format != .listening }.reduce(0) { $0 + $1.seconds }
        let listen = sessions.filter { $0.format != .reading }.reduce(0) { $0 + $1.seconds }
        let days = max(
            1, Int((now.timeIntervalSince1970 - Double(started)) / 86_400.0)
        )
        return DetailReadRecord(
            startedAt: started,
            daysIn: days,
            totalSeconds: total,
            sessions: sessions.count,
            averageSeconds: total / Int64(sessions.count),
            longestSeconds: longest?.seconds ?? 0,
            longestAt: longest?.startedAt ?? 0,
            lastEndedAt: sessions.map(\.endedAt).max() ?? 0,
            readSeconds: read,
            listenSeconds: listen
        )
    }

    /// How long the rest of the book takes at the pace so far. `nil` until
    /// there is a pace to go on, and for a book at either end.
    static func secondsLeft(record: DetailReadRecord?, percent: Int?) -> Int64? {
        guard let record, let percent, percent > 0, percent < 100, record.totalSeconds > 0
        else { return nil }
        return record.totalSeconds * Int64(100 - percent) / Int64(percent)
    }

    /// The line under the progress bar, after the percent.
    static func leftLine(
        record: DetailReadRecord?, percent: Int, isAudio: Bool,
        audioSeconds: Double?, audioDuration: Double?
    ) -> String? {
        if isAudio, let audioSeconds, let audioDuration, audioDuration > 0 {
            let left = Int64(max(0, audioDuration - audioSeconds))
            return "\(DetailFormat.duration(left)) left of \(DetailFormat.duration(Int64(audioDuration)))"
        }
        return secondsLeft(record: record, percent: percent).map {
            "about \(DetailFormat.duration($0)) left at your pace"
        }
    }

    /// The sentence under the card's heading.
    static func readingLine(
        status: ReadStatus, wishlistOnly: Bool, hasFile: Bool, hasPhysical: Bool,
        hasPosition: Bool, record: DetailReadRecord?, finishedAt: Int64?,
        history: ReadAnswer = .known, now: Date = Date()
    ) -> String {
        if wishlistOnly {
            return "Add an ebook or an audiobook to start tracking your reading stats for this book."
        }
        if status == .finished, let finishedAt {
            return "Finished \(DetailFormat.day(unix: finishedAt, now: now))"
        }
        if let record {
            return "Reading since \(DetailFormat.day(unix: record.startedAt, now: now))"
        }
        if hasPosition || hasFile {
            // An unanswered read says nothing about whether there is a history.
            switch history {
            case .waiting: return ""
            case .failed: return "Your reading history couldn\u{2019}t be loaded."
            case .known: break
            }
        }
        // The session log counts only sittings of a minute or more, and trails
        // a position this device just wrote.
        if hasPosition { return "Sittings of a minute or more show here once they sync." }
        if hasFile {
            return "No reading recorded yet. Time, sessions and pace appear after you open the book."
        }
        if hasPhysical {
            return "Stats come from reading in the app. A paper copy is tracked by its read status."
        }
        return "The library holds no copy of this book, so there is nothing to track yet."
    }

    /// The card's rows. A finished book has no time left to state.
    static func rows(
        record: DetailReadRecord, percent: Int?, status: ReadStatus, now: Date = Date()
    ) -> [DetailStatRow] {
        let sessions = StatsFormat.counted(Int64(record.sessions), "session")
        var rows = [
            DetailStatRow(
                key: record.readSeconds > 0 ? "Time read" : "Time listened",
                value: "\(DetailFormat.duration(record.totalSeconds)) · \(sessions)"
            )
        ]
        if let percent, percent > 0, record.totalSeconds > 0 {
            let perHour = (Double(percent) / (Double(record.totalSeconds) / 3600)).rounded()
            rows.append(DetailStatRow(key: "Pace", value: "About \(Int(perHour))% an hour"))
        }
        rows.append(DetailStatRow(
            key: "Last read", value: DetailFormat.lastRead(unix: record.lastEndedAt, now: now)
        ))
        rows.append(DetailStatRow(
            key: "Longest sitting",
            value: "\(DetailFormat.duration(record.longestSeconds)), "
                + DetailFormat.day(unix: record.longestAt, now: now)
        ))
        if status != .finished, let left = secondsLeft(record: record, percent: percent) {
            rows.append(DetailStatRow(key: "Time left", value: "About \(DetailFormat.duration(left))"))
        }
        return rows
    }

    /// One row of the household's activity on this book.
    static func activityLine(_ reader: BookHouseholdReader, now: Date = Date()) -> String {
        let sittings = StatsFormat.counted(reader.sessions, "session")
        return "Last read \(DetailFormat.day(unix: reader.lastSessionAt, now: now))"
            + " · \(DetailFormat.duration(reader.seconds)) · \(sittings)"
    }
}

// MARK: - Chapters

/// Which chapter a saved place sits in, from its CFI — the iOS twin of the web
/// page's `chapter_ref`, so both clients name the same chapter for a kept line.
enum ChapterLocator {
    /// 0-based spine document a CFI points into: `14` in `/6/14[chap3]!…` is
    /// the seventh child, so the sixth document. Odd or zero steps address no
    /// element, and halving those would be a fabrication.
    static func spineIndex(cfi: String) -> Int64? {
        guard let inner = inner(cfi),
              let package = inner.split(separator: "!", omittingEmptySubsequences: false).first,
              let step = package.split(separator: "/").last,
              let digits = step.split(separator: "[", omittingEmptySubsequences: false).first,
              let raw = Int64(digits), raw > 0, raw % 2 == 0
        else { return nil }
        return raw / 2 - 1
    }

    /// Index of the chapter a CFI sits in; `chapters` are in TOC order. By
    /// spine document first, then by place inside it when several chapters
    /// share one. `nil` when the CFI has no readable step or falls before the
    /// first chapter.
    static func chapterIndex(chapters: [AlignmentEbookChapter], cfi: String) -> Int? {
        guard let spine = spineIndex(cfi: cfi) else { return nil }
        guard let first = chapters.firstIndex(where: { $0.spineIndex == spine }),
              let last = chapters.lastIndex(where: { $0.spineIndex == spine })
        else {
            return chapters.lastIndex { ($0.spineIndex ?? .max) <= spine }
        }
        guard first != last else { return first }
        guard let position = documentSteps(cfi: cfi) else { return last }
        // A chapter with no anchor counts as opening the document.
        let within = (first...last).reversed().first { index in
            guard chapters[index].spineIndex == spine else { return false }
            guard let anchor = chapters[index].anchorPath.flatMap(steps) else { return true }
            return anchor.lexicographicallyPrecedes(position) || anchor == position
        }
        return within ?? first
    }

    /// `Chapter 5`, when the place can be found.
    static func label(chapters: [AlignmentEbookChapter], cfi: String?) -> String? {
        guard let cfi, let index = chapterIndex(chapters: chapters, cfi: cfi) else { return nil }
        return "Chapter \(index + 1)"
    }

    private static func inner(_ cfi: String) -> String? {
        let trimmed = cfi.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("epubcfi("), trimmed.hasSuffix(")") else { return nil }
        return String(trimmed.dropFirst("epubcfi(".count).dropLast())
    }

    /// A CFI's in-document steps, after the `!`, to the start of a range.
    private static func documentSteps(cfi: String) -> [Int]? {
        guard let inner = inner(cfi) else { return nil }
        let bare = strippingAssertions(inner)
        guard let bang = bare.firstIndex(of: "!") else { return nil }
        let parts = bare[bare.index(after: bang)...]
            .split(separator: ",", omittingEmptySubsequences: false)
        let parent = parts.first.map(String.init) ?? ""
        let start = parts.count > 1 ? String(parts[1]) : ""
        return steps(parent + start)
    }

    /// `/4/2:5` → `[4, 2]`: each step's leading number, its offset dropped.
    private static func steps(_ path: String) -> [Int]? {
        let numbers = path.split(separator: "/").map { step in
            Int(step.prefix { $0.isASCII && $0.isNumber })
        }
        guard !numbers.contains(where: { $0 == nil }) else { return nil }
        return numbers.compactMap { $0 }
    }

    /// A CFI without its `[…]` assertions, whose text may hold `,` or `/`.
    private static func strippingAssertions(_ cfi: String) -> String {
        var out = ""
        var depth = 0
        for character in cfi {
            switch character {
            case "[": depth += 1
            case "]": depth = max(0, depth - 1)
            default: if depth == 0 { out.append(character) }
            }
        }
        return out
    }
}

// MARK: - Journal

enum DetailJournal {
    /// Whether `viewerId` wrote this entry.
    static func isOwn(_ entry: JournalEntry, viewerId: Int64?) -> Bool {
        viewerId.map { $0 == entry.authorId } ?? false
    }

    /// The line over an entry: who, unless it is yours, when, and draft state.
    static func byline(_ entry: JournalEntry, viewerId: Int64?, now: Date = Date()) -> String {
        var parts: [String] = []
        if !isOwn(entry, viewerId: viewerId) { parts.append(entry.authorName) }
        parts.append(DetailFormat.day(unix: entry.createdAt, now: now))
        if entry.status == .draft { parts.append("Draft") }
        return parts.joined(separator: " · ")
    }

    /// The opening line as plain text. Parsed as markdown rather than
    /// regex-stripped, so prose that happens to contain `#` or `_` (C#,
    /// snake_case) keeps its characters while real syntax is dropped.
    ///
    /// The row is always visible, so a `||spoiler||` is swapped for filler
    /// before anything else runs — the same guard the web ladder row applies.
    static func preview(_ md: String) -> [MaskedRun] {
        guard let first = md.split(separator: "\n").first else { return [] }
        let masked = JournalMarkdown.masked(String(first))
        let line = masked.line
            // A leading list, heading or quote marker is block syntax the
            // inline parser would pass through verbatim.
            .replacingOccurrences(
                of: #"^\s*([-*+]\s+|\d{1,9}[.)]\s+|#{1,6}\s+|>\s?)"#,
                with: "", options: .regularExpression)
        let parsed = String(JournalMarkdown.inline(line).characters)
            // An image parses to an attachment character there is nothing to
            // draw for.
            .replacingOccurrences(of: "\u{FFFC}", with: "")
        return JournalMarkdown.runs(
            parsed.trimmingCharacters(in: .whitespaces), fillers: masked.fillers
        )
    }
}

// MARK: - Small shared extensions

extension String {
    /// Book descriptions arrive as OPF HTML fragments.
    var strippingHTML: String {
        replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
