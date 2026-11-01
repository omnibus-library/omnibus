//  MetadataFetch.swift
//  The fetch view's stage machine and its pure decision logic: which screen
//  follows what, which candidate leads the list, and which rows an edition's
//  comparison holds.
//
//  Kept out of the view for the same reason `MetadataDraft` is: the copyable
//  fields are *data* here, so the comparison is built from
//  `MetadataFetchField.allCases` and no row is written by hand.

import Foundation

/// Which screen the fetch view is showing.
enum MetadataFetchStage: Equatable {
    case asking
    /// The search ran. An empty list is a search that found nothing, with a
    /// per-source line saying why.
    case results
    /// The search itself failed.
    case failed
    case compare(ProviderEdition)
}

/// One field a source can offer and the editor can take.
///
/// Adding one is: a case here, and the arms `label`, `current`, `sourceValue`
/// and `apply` then refuse to build without. Nothing in the comparison changes:
/// it is built from `allCases` and nothing else.
///
/// **Tags are deliberately absent.** A provider's subject list lands on
/// `genres` in this codebase; `subjects` is whatever the EPUB's own
/// `<dc:subject>` entries were, and overwriting that with a provider's
/// vocabulary would destroy the one field that describes *this file*.
enum MetadataFetchField: String, CaseIterable, Identifiable, Sendable {
    case title
    case authors
    case publisher
    case published
    case series
    case seriesIndex
    case isbn13
    case isbn10
    case printPages
    case genres
    case description

    var id: String { rawValue }

    /// The heading of this field's row in the comparison.
    var label: String {
        switch self {
        case .title: "Title"
        case .authors: "Author(s)"
        case .publisher: "Publisher"
        case .published: "Published"
        case .series: "Series"
        case .seriesIndex: "Number in series"
        case .isbn13: "ISBN-13"
        case .isbn10: "ISBN-10"
        case .printPages: "Print pages"
        case .genres: "Genres"
        case .description: "Description"
        }
    }

    /// What the *draft* currently holds — the staged value, not the saved one,
    /// so the comparison reads against what a save would write.
    func current(_ draft: MetadataDraft) -> String {
        switch self {
        case .title: draft.title
        case .authors: Self.list(draft.authors)
        case .publisher: draft.publisher
        case .published: draft.published
        case .series: draft.series
        case .seriesIndex: draft.seriesIndex
        case .isbn13: draft.isbn13
        case .isbn10: draft.isbn10
        case .printPages: draft.printPages
        case .genres: Self.list(draft.genres)
        case .description: draft.description
        }
    }

    /// What the source offers, or the empty string when it offers nothing.
    ///
    /// The empty string is the whole safety property of this view: it is
    /// what `isAvailable` reads, and an unavailable field can't be taken — so
    /// a provider that doesn't know a field can never blank out a value the
    /// reader already has.
    func sourceValue(_ edition: ProviderEdition) -> String {
        func text(_ value: String?) -> String {
            value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        }
        switch self {
        case .title: return text(edition.title)
        case .authors: return Self.list(edition.authors)
        case .publisher: return text(edition.publisher)
        case .published: return text(edition.year)
        case .series: return text(edition.series)
        case .seriesIndex: return text(edition.seriesIndex)
        case .isbn13: return text(edition.isbn13)
        case .isbn10: return text(edition.isbn10)
        // A provider reporting 0 pages is normalized to `nil` upstream, so
        // anything here is a real count.
        // Bounded to what `MetadataOverrides` will accept. Providers only
        // filter `> 0`, and `save()` validates before it does anything else —
        // so one absurd page count staged from a candidate would refuse the
        // whole save, discarding every other field taken with it. Out of range
        // is treated as "this source has nothing", which the rest of the
        // screen already knows how to render.
        case .printPages:
            return edition.pages
                .flatMap { (1...MetadataDraft.printPagesMax).contains($0) ? String($0) : nil }
                ?? ""
        case .genres: return Self.list(edition.genres)
        case .description: return text(edition.description)
        }
    }

    /// Whether this source has anything to offer for this field.
    func isAvailable(_ edition: ProviderEdition) -> Bool {
        !sourceValue(edition).isEmpty
    }

    /// Whether the source would actually change this field.
    ///
    /// A field the source has no value for is *not* a difference: it can't be
    /// taken, so a row for it would only be a dash beside a dead control.
    func differs(draft: MetadataDraft, edition: ProviderEdition) -> Bool {
        let source = sourceValue(edition)
        return !source.isEmpty && source != current(draft)
    }

    /// Stage the source's value into the draft.
    ///
    /// Staging only: the editor's Save button stays the single writer, so
    /// dirty tracking, validation, and the changed-fields-only payload keep
    /// working untouched. A field the source lacks is a no-op.
    func apply(to draft: inout MetadataDraft, from edition: ProviderEdition) {
        guard isAvailable(edition) else { return }
        switch self {
        case .title: draft.title = sourceValue(edition)
        // The list fields write the source's own array rather than the joined
        // string the row displays.
        case .authors: draft.authors = Self.nonBlank(edition.authors)
        case .publisher: draft.publisher = sourceValue(edition)
        case .published: draft.published = sourceValue(edition)
        case .series: draft.series = sourceValue(edition)
        case .seriesIndex: draft.seriesIndex = sourceValue(edition)
        case .isbn13: draft.isbn13 = sourceValue(edition)
        case .isbn10: draft.isbn10 = sourceValue(edition)
        case .printPages: draft.printPages = sourceValue(edition)
        case .genres: draft.genres = Self.nonBlank(edition.genres)
        case .description: draft.description = sourceValue(edition)
        }
    }

    /// How a list-valued field reads in the comparison.
    ///
    /// Blank entries are dropped before joining, so a list of them reads as
    /// absent rather than as the separator string — `["", ""]` would otherwise
    /// render, and stage, as ", ". Used by both sides so they compare on equal
    /// terms.
    private static func list(_ values: [String]) -> String {
        nonBlank(values).joined(separator: ", ")
    }

    /// The list a list-valued field actually stages: trimmed, blanks dropped,
    /// so what is written matches what the row displayed.
    private static func nonBlank(_ values: [String]) -> [String] {
        values
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}

/// One row of an edition's comparison: a field or the cover it would change.
struct MetadataDiffRow: Identifiable, Equatable {
    enum Kind: Equatable {
        case field(MetadataFetchField)
        case cover(url: String)
    }

    let kind: Kind
    let label: String
    let before: String
    let after: String
    /// You have nothing there, so taking it costs nothing: on by default.
    let fills: Bool

    var id: String {
        switch kind {
        case let .field(field): field.rawValue
        case .cover: "cover"
        }
    }
}

/// One heading's worth of comparison rows.
struct MetadataDiffGroup: Identifiable, Equatable {
    let head: String
    let note: String
    let rows: [MetadataDiffRow]

    var id: String { note }
}

/// Pure builders and gates, separated from the view so they're testable
/// without a server — the same split `CheckInFlow` makes.
enum MetadataFetchFlow {
    // MARK: - Asking

    /// The request the search box and author field describe, or `nil` when
    /// both are blank. A query shaped like an ISBN asks for that printing
    /// rather than for a title of digits.
    static func searchRequest(query: String, author: String) -> EditionSearchRequest? {
        let isISBN = looksLikeISBN(query)
        return searchRequest(
            title: isISBN ? "" : query, author: author, isbn: isISBN ? query : ""
        )
    }

    /// Ten or thirteen characters once its hyphens and spaces are gone: digits,
    /// with an ISBN-10's check digit allowed to be an X.
    static func looksLikeISBN(_ text: String) -> Bool {
        let bare = text.filter { !$0.isWhitespace && $0 != "-" }
        guard bare.count == 10 || bare.count == 13 else { return false }
        let digits = bare.dropLast().allSatisfy { $0.isASCII && $0.isNumber }
        let check = bare.last.map { ($0.isASCII && $0.isNumber) || (bare.count == 10 && "xX".contains($0)) }
        return digits && check == true
    }

    /// The request the three fields describe, or `nil` when they are all
    /// blank.
    ///
    /// No inference: what the reader can see in the fields is exactly what
    /// each provider is asked for. `query` still carries the composed phrase,
    /// because the REST front door accepts free text from clients that have no
    /// picker — but nothing here depends on it round-tripping.
    static func searchRequest(title: String, author: String, isbn: String) -> EditionSearchRequest? {
        let title = title.nilIfBlank
        let author = author.nilIfBlank
        let isbn = isbn.nilIfBlank
        guard title != nil || author != nil || isbn != nil else { return nil }
        // Truncated because `EditionSearchRequest::validate` caps `query` and
        // checks it *first* — so a long historical title 400s with "query
        // exceeds 200 characters", naming a field this form has no control
        // for. Safe: nothing reads `query` back. `search_query` on the server
        // ignores it entirely whenever the structured fields are present, and
        // they always are here.
        let composed = [title, author].compactMap { $0 }.joined(separator: " ")
        return EditionSearchRequest(
            query: String(composed.prefix(searchQueryMaxLength)),
            title: title,
            author: author,
            isbn: isbn
        )
    }

    /// `omnibus_shared::scan::SEARCH_QUERY_MAX_LEN`, which
    /// `EditionSearchRequest::validate` measures in Unicode scalar values.
    /// Duplicated rather than fetched — it is a compile-time constant on a type
    /// this app never sees, and the server still enforces it if the two drift.
    static let searchQueryMaxLength = 200

    /// A slow hydrate must not overwrite a candidate the reader has since
    /// replaced, or reappear after they went back to the list.
    ///
    /// Keyed on `(source, providerRef)` rather than on the whole value,
    /// because the record that comes back is by definition not the one that
    /// went out.
    static func hydrateShouldApply(stage: MetadataFetchStage, asked: ProviderEdition) -> Bool {
        guard case let .compare(showing) = stage else { return false }
        return showing.source == asked.source && showing.providerRef == asked.providerRef
    }

    /// Fill this record's empty fields from the thinner search hit that named
    /// it, keeping every value the fetched record already carries.
    ///
    /// The detail record a provider serves for one edition is richer in some
    /// fields and *poorer* in others than the hit that named it — Open
    /// Library's edition record has the publisher and the printing's own page
    /// count but no subjects or first-publish year, and its search document is
    /// the mirror image. Re-fetching would otherwise blank whatever the list
    /// row had shown, which is the one thing a picker must never do. Mirrors
    /// `ProviderEdition::fill_missing_from` on the server.
    static func merged(fetched: ProviderEdition, thinner: ProviderEdition) -> ProviderEdition {
        var out = fetched
        // Both sides are checked for content, not just presence: providers
        // don't consistently trim these, and filling an absent field with a
        // blank one turns "this source didn't say" into "this source said
        // nothing", which renders as a present-but-empty value.
        func fill(_ slot: inout String?, _ from: String?) {
            guard slot?.nilIfBlank == nil, let value = from?.nilIfBlank else { return }
            slot = value
        }
        fill(&out.isbn13, thinner.isbn13)
        fill(&out.isbn10, thinner.isbn10)
        fill(&out.year, thinner.year)
        fill(&out.publisher, thinner.publisher)
        fill(&out.description, thinner.description)
        fill(&out.coverURL, thinner.coverURL)
        fill(&out.series, thinner.series)
        // A book number is a position *in* a series, so it may only cross over
        // when both records name the same one. A provider that files a book
        // under two series can answer two queries in two row orders, and
        // pairing one series' name with another's number is worse than
        // reporting no number at all.
        if out.series?.nilIfBlank == thinner.series?.nilIfBlank {
            fill(&out.seriesIndex, thinner.seriesIndex)
        }
        if out.title.nilIfBlank == nil { out.title = thinner.title }
        if out.authors.isEmpty { out.authors = thinner.authors }
        if out.pages == nil { out.pages = thinner.pages }
        if out.firstPublishYear == nil { out.firstPublishYear = thinner.firstPublishYear }
        if out.genres.isEmpty { out.genres = thinner.genres }
        // The handle the reader selected by, not the one this lookup happened
        // to mint: the sheet keys its selection on the value it already holds.
        out.providerRef = thinner.providerRef
        return out
    }

    // MARK: - Ordering

    /// Put candidates in an order derived from the candidates themselves.
    ///
    /// Two problems, one key. The fan-out answers provider by provider, so the
    /// raw list is "everything Open Library found, then everything Google
    /// Books found" — a source being slow, newly configured, or briefly down
    /// reshuffles the whole list under the reader. And within a provider the
    /// order is whatever it felt like, which for a well-known title is
    /// reliably four study guides above the novel.
    ///
    /// The server's relevance score leads when it sent one: it is computed
    /// from the candidate and the query alone — never from which provider
    /// answered — so a source dropping out removes its rows and moves nothing
    /// else. Word coverage is the tiebreak, and the whole order for a response
    /// that carries no scores. Mirrors `in_stable_order` in the web picker.
    static func ordered(_ editions: [ProviderEdition], query: String) -> [ProviderEdition] {
        let words = queryWords(query)
        return editions
            .map { OrderKey(edition: $0, words: words) }
            .sorted()
            .map(\.edition)
    }

    /// The sort key, as a comparable value — Swift has no `sort_by_cached_key`,
    /// and recomputing a lowercased title per comparison is what makes a naive
    /// `sorted(by:)` quadratic in string work rather than in comparisons.
    private struct OrderKey: Comparable {
        let edition: ProviderEdition
        /// Negated so the *highest* score sorts first, and defaulted so a
        /// candidate with no score sorts below every scored one rather than
        /// above them.
        let score: Int
        let incomplete: Bool
        let titleLength: Int
        let title: String
        let isbn: String
        let source: String
        let ref: String

        init(edition: ProviderEdition, words: [String]) {
            let title = edition.title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            self.edition = edition
            // Widened to `Int` before negating: `Int32.min` has no positive
            // counterpart, and a value that came off the wire must not be able
            // to trap.
            score = edition.relevance.map { -Int($0) } ?? Int(Int32.max)
            incomplete = !coversEveryWord(haystack(edition), words)
            titleLength = title.count
            self.title = title
            isbn = edition.isbn13 ?? ""
            source = edition.source.rawValue
            ref = edition.providerRef
        }

        /// Compared key by key rather than as one tuple: Swift's tuple
        /// comparison operators stop at six elements, and this key has seven.
        static func < (lhs: OrderKey, rhs: OrderKey) -> Bool {
            if lhs.score != rhs.score { return lhs.score < rhs.score }
            // `false` sorts first, so this reads "not a full match" — the rows
            // that account for the whole query lead.
            if lhs.incomplete != rhs.incomplete { return !lhs.incomplete }
            if lhs.titleLength != rhs.titleLength { return lhs.titleLength < rhs.titleLength }
            if lhs.title != rhs.title { return lhs.title < rhs.title }
            if lhs.isbn != rhs.isbn { return lhs.isbn < rhs.isbn }
            if lhs.source != rhs.source { return lhs.source < rhs.source }
            return lhs.ref < rhs.ref
        }

        static func == (lhs: OrderKey, rhs: OrderKey) -> Bool {
            lhs.score == rhs.score
                && lhs.incomplete == rhs.incomplete
                && lhs.titleLength == rhs.titleLength
                && lhs.title == rhs.title
                && lhs.isbn == rhs.isbn
                && lhs.source == rhs.source
                && lhs.ref == rhs.ref
        }
    }

    /// The text a query is matched against: title **and** authors.
    ///
    /// The seeded query is "title + primary author", so matching the title
    /// alone would rank every candidate that merely names the author in its
    /// title — a study guide — above the book itself, which of course doesn't
    /// repeat its own author in its title.
    private static func haystack(_ edition: ProviderEdition) -> String {
        "\(edition.title) \(edition.authors.joined(separator: " "))".lowercased()
    }

    /// Words that appear in so many titles that requiring them ranks nothing.
    /// Listed rather than inferred from length: "The" and "Ida" are both three
    /// letters and only one of them is noise.
    private static let stopWords: Set<String> = [
        "a", "an", "and", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with",
    ]

    /// The query's words, lowercased and stripped of punctuation, minus the
    /// stop words and the initials a name leaves behind.
    static func queryWords(_ query: String) -> [String] {
        query
            .split(whereSeparator: \.isWhitespace)
            .map { word in
                String(word)
                    .trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
                    .lowercased()
            }
            .filter { $0.count > 1 && !stopWords.contains($0) }
    }

    /// Whether `haystack` accounts for every word. An empty word list matches
    /// nothing, so a blank query leaves the order to the later keys rather
    /// than declaring every row a perfect match.
    private static func coversEveryWord(_ haystack: String, _ words: [String]) -> Bool {
        !words.isEmpty && words.allSatisfy { haystack.contains($0) }
    }

    // MARK: - Reading a candidate

    /// The candidate's cover URL, or `nil` when the provider gave nothing
    /// usable. Blank-but-present is the case worth catching: handed to an
    /// image loader it resolves against nothing and quietly fails.
    static func coverURL(_ edition: ProviderEdition) -> String? {
        guard let url = edition.coverURL?.nilIfBlank else { return nil }
        return CheckInFlow.isExternalURL(url) ? url : nil
    }

    /// An edition's line of particulars, with what the provider left empty
    /// dropped rather than rendered as a gap.
    static func metaLine(_ edition: ProviderEdition) -> String {
        let imprint = [edition.publisher, edition.year]
            .compactMap { $0?.nilIfBlank }
            .joined(separator: " ")
        return [
            edition.authorDisplay.nilIfBlank,
            imprint.nilIfBlank,
            edition.pages.map { "\($0) pages" },
        ]
        .compactMap { $0 }
        .joined(separator: " \u{b7} ")
    }

    // MARK: - The comparison

    /// What taking this edition could change, against the draft as it stands.
    ///
    /// A lower bound on a list row, and honestly so: a search hit is thinner
    /// than the record behind it, and hydrate-on-select can only add fields.
    static func diffRows(
        edition: ProviderEdition, draft: MetadataDraft, hasCover: Bool, staged: StagedCover?
    ) -> [MetadataDiffRow] {
        var rows: [MetadataDiffRow] = []
        // A provider's address can't be compared with bytes we hold, so a book
        // with art always gets the row. Staying off by default keeps that safe.
        if let url = coverURL(edition), staged != .url(url) {
            let fills = !hasCover && staged == nil
            rows.append(
                MetadataDiffRow(kind: .cover(url: url), label: "Cover", before: "", after: url, fills: fills)
            )
        }
        for field in MetadataFetchField.allCases where field.differs(draft: draft, edition: edition) {
            let before = field.current(draft)
            rows.append(
                MetadataDiffRow(
                    kind: .field(field),
                    label: field.label,
                    before: before,
                    after: field.sourceValue(edition),
                    fills: before.nilIfBlank == nil
                )
            )
        }
        return rows
    }

    /// Whether a row is ticked: what the reader said, else its default.
    static func isOn(_ row: MetadataDiffRow, marks: [String: Bool]) -> Bool {
        marks[row.id] ?? row.fills
    }

    /// The rows under their two headings, the empty one left out.
    static func groups(_ rows: [MetadataDiffRow]) -> [MetadataDiffGroup] {
        let fills = rows.filter(\.fills)
        let replaces = rows.filter { !$0.fills }
        var groups: [MetadataDiffGroup] = []
        if !fills.isEmpty {
            groups.append(
                MetadataDiffGroup(
                    head: "Fills \(fills.count) \(fills.count == 1 ? "blank" : "blanks")",
                    note: "On by default, because you have nothing there.",
                    rows: fills
                )
            )
        }
        if !replaces.isEmpty {
            groups.append(
                MetadataDiffGroup(
                    head: "Would replace \(replaces.count)",
                    note: "Off by default. Tick one to take it instead of what you have.",
                    rows: replaces
                )
            )
        }
        return groups
    }

    /// Stage every ticked row: fields into the draft, a cover beside it. Save
    /// stays the only thing that writes.
    static func apply(
        _ rows: [MetadataDiffRow],
        marks: [String: Bool],
        edition: ProviderEdition,
        draft: inout MetadataDraft,
        staged: inout StagedCover?
    ) {
        for row in rows where isOn(row, marks: marks) {
            switch row.kind {
            case let .field(field): field.apply(to: &draft, from: edition)
            case let .cover(url): staged = .url(url)
            }
        }
    }

    /// The word on a list row for how much an edition would change.
    static func changesLabel(_ count: Int) -> String {
        switch count {
        case 0: "Matches yours"
        case 1: "1 change"
        default: "\(count) changes"
        }
    }

    static func applyLabel(chosen: Int) -> String {
        switch chosen {
        case 0: "Tick a change to apply it"
        case 1: "Apply 1 change"
        default: "Apply \(chosen) changes"
        }
    }

    // MARK: - Per-source status

    /// What one source contributed, in as few words as the distinction
    /// allows, and whether it reads as a problem.
    static func sourceStatus(_ status: ProviderSearchStatus) -> (text: String, isProblem: Bool) {
        switch status {
        case .answered(0): ("nothing", false)
        case let .answered(count): ("\(count)", false)
        case .notConfigured: ("not set up", false)
        case .failed: ("unavailable", true)
        // Worded as what *we* are doing, not as a promise about the source.
        // "retry in 10m" reads as advice — wait and it will work — and for the
        // commonest case that is false: a keyless Google Books answers 429 for
        // a quota metric of "queries per day", so it refuses until midnight
        // Pacific however long anyone waits. What is true either way is that
        // this source sits the next few minutes out.
        case let .throttled(secs): ("rate limited, skipping for \(humanWait(secs))", true)
        case .unknown: ("\u{2014}", false)
        }
    }

    /// A cooldown as a reader would say it. Rounded up, and never "0s" — the
    /// point of the number is roughly how long this source sits out, not its
    /// precision.
    static func humanWait(_ seconds: UInt64) -> String {
        seconds <= 90 ? "\(max(1, seconds))s" : "\((seconds + 59) / 60)m"
    }
}
