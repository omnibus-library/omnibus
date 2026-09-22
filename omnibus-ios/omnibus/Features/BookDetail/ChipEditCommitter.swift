//  ChipEditCommitter.swift
//  The save policy behind the chip editor's per-change writes: the full-list
//  POSTs for one (book, kind) leave in tap order, only the newest answer is
//  painted, and a refused save resyncs from the server before giving up.
//  Shared across sheet presentations, so dismissing and reopening the sheet
//  mid-request cannot start a second chain that reorders against the first.

import Foundation

@MainActor
final class ChipEditCommitter {
    static let shared = ChipEditCommitter()

    typealias Save = @MainActor (String, ChipEditKind, [String]) async throws -> Book
    typealias Resync = @MainActor (String) async throws -> Book
    typealias Persist = @MainActor (String, Book) async -> Void

    /// What a commit came to, for the sheet to paint.
    enum Outcome: Equatable {
        /// The server took the list; the record is its answer.
        case saved(Book)
        /// A newer commit for the same list was issued before this one
        /// settled, so its answer is the one to paint, not this.
        case superseded
        /// The save was refused; the record is what the server holds now.
        case resynced(Book, error: String)
        /// The save was refused and the server could not be asked, so the
        /// list should go back to what it was.
        case reverted(error: String)
    }

    private struct Key: Hashable {
        let uuid: String
        let kind: ChipEditKind
    }

    /// The last commit issued per list — the one the next commit waits on.
    private var tails: [Key: Task<Outcome, Never>] = [:]
    /// Bumped per commit per list; a commit whose number has been passed
    /// is superseded, wherever it is in its life.
    private var generations: [Key: Int] = [:]

    private let save: Save
    private let resync: Resync
    private let persist: Persist

    /// The production wiring: the override POST, the settled book read, and
    /// the replica write. Tests inject all three.
    init(
        save: @escaping Save = { try await BookChipEdits.save(uuid: $0, kind: $1, values: $2) },
        resync: @escaping Resync = { try await LibraryService.settledBook(uuid: $0) },
        persist: @escaping Persist = { await Cache.write(CacheKey.book($0), $1) }
    ) {
        self.save = save
        self.resync = resync
        self.persist = persist
    }

    /// File `values` as the whole of `kind`'s list on the book.
    ///
    /// A superseded commit never issues its request — the newer commit's
    /// full list replaces it — but one that has already succeeded is still
    /// written to the replica, since the chain keeps those writes in order.
    func commit(uuid: String, kind: ChipEditKind, values: [String]) async -> Outcome {
        let key = Key(uuid: uuid, kind: kind)
        let mine = (generations[key] ?? 0) + 1
        generations[key] = mine
        let previous = tails[key]

        let task = Task<Outcome, Never> {
            _ = await previous?.value
            guard generations[key] == mine else { return .superseded }
            do {
                let merged = try await save(uuid, kind, values)
                await persist(uuid, merged)
                guard generations[key] == mine else { return .superseded }
                return .saved(merged)
            } catch {
                let message = (error as? APIError)?.errorDescription ?? error.localizedDescription
                guard generations[key] == mine else { return .superseded }
                if let current = try? await resync(uuid) {
                    guard generations[key] == mine else { return .superseded }
                    return .resynced(current, error: message)
                }
                guard generations[key] == mine else { return .superseded }
                return .reverted(error: message)
            }
        }
        tails[key] = task
        let outcome = await task.value
        if tails[key] == task { tails[key] = nil }
        return outcome
    }
}
