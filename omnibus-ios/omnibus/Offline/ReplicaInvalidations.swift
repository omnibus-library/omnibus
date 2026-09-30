//  ReplicaInvalidations.swift
//  Announces a write to the screens already showing what it changed.
//
//  A mounted surface reads its keys once and holds the answer, so a write made
//  elsewhere left the Library home showing the state before it: a finished
//  book still on the Continue rail, a deleted shelf still on the Shelves rail.
//  `OutboxScope` already declares which keys each write kind moves; the same
//  declaration decides which surfaces re-read, whether the write queued or
//  landed.

import Foundation
import Observation

@MainActor @Observable
final class ReplicaInvalidations {
    static let shared = ReplicaInvalidations()

    /// The keys a mounted surface re-reads when a write moves them.
    static let watched = [CacheKey.recentProgress, CacheKey.shelfPreviews]

    private(set) var generations: [String: Int] = [:]

    func generation(of key: String) -> Int { generations[key, default: 0] }

    /// A write of `kind` was recorded, its optimistic patch already applied.
    func note(kind: String) {
        note(keys: Self.watched.filter { OutboxScope.isBlocked($0, by: [kind]) })
    }

    /// A direct write — one the outbox never sees — changed `keys`.
    func note(keys: [String]) {
        for key in keys { generations[key, default: 0] &+= 1 }
    }
}
