//  PatchCoalescing.swift
//  How two queued field-level PATCH bodies for one target fold into one.
//
//  A position or a rate is one value, so a later write replaces an earlier one
//  outright. A merge patch is not: each body names only the fields it changes,
//  so replacing a queued `{"stars":4}` with a later `{"body_md":"…"}` would drop
//  the stars. Folding keeps every field either body names, the later body
//  winning wherever both name the same field — an explicit `null` included,
//  since that is a clear, not an absence.

import Foundation

enum PatchCoalescing {
    /// `newer` laid over `older`, or `nil` when either is not a JSON object —
    /// the caller then queues the two separately rather than lose a field.
    static func folded(_ older: Data?, under newer: Data?) -> Data? {
        guard let older = object(older), let newer = object(newer) else { return nil }
        let merged = older.merging(newer) { _, later in later }
        // Sorted so the stored body is stable for a given set of fields.
        return try? JSONSerialization.data(withJSONObject: merged, options: [.sortedKeys])
    }

    private static func object(_ data: Data?) -> [String: Any]? {
        guard let data else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
}
