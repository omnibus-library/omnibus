//  Household.swift
//  A household reader's row (`GET /api/users`), and which reader a stats read
//  is about.

import Foundation

/// `omnibus_shared::HouseholdReader` — one row of `GET /api/users`.
struct HouseholdReader: Codable, Hashable, Sendable, Identifiable {
    var id: Int64
    var name: String
    var hasAvatar: Bool
    var isYou: Bool

    enum CodingKeys: String, CodingKey {
        case id, name
        case hasAvatar = "has_avatar"
        case isYou = "is_you"
    }
}

/// Whose stats a read is about.
enum StatsSubject: Hashable, Sendable {
    case you
    case reader(HouseholdReader)

    /// `nil` for you, so your own request is byte-for-byte unchanged.
    var userID: Int64? {
        switch self {
        case .you: nil
        case let .reader(reader): reader.id
        }
    }

    /// `nil` for another reader: their stats are online-only (AC4).
    func cacheKey(_ range: StatsRange) -> String? {
        switch self {
        case .you: CacheKey.stats(range)
        case .reader: nil
        }
    }
}
