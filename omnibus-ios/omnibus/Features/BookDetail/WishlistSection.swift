//  WishlistSection.swift
//  The wording behind a wishlisted book on the page: where the entry came from,
//  and what removing it costs. The way off the wishlist lives in the page's More
//  menu, behind a confirmation the web button doesn't ask for, since a mis-tap
//  here has nothing to undo it with.

import Foundation

enum WishlistCopy {
    /// Human phrase for where an entry came from. Mirrors `source_label` on
    /// the web page.
    static func sourceLabel(_ source: WishlistSource) -> String {
        switch source {
        case .scan: "a scan"
        case .detail: "this page"
        case .manual: "an ISBN you entered"
        case .search: "a title search"
        }
    }

    /// What the confirmation warns about, which differs by what else the
    /// library holds. A book with files keeps everything but the tracking. One
    /// without is reachable *because* of the entry: browse hides a fileless
    /// book with no physical copy, and the add-to-shelf picker reads that same
    /// listing, so the wishlist is the only place it surfaces.
    static func confirmMessage(hasFiles: Bool) -> String {
        hasFiles
            ? "This stops tracking a physical copy. The book stays in your library."
            : "Your library holds no files for this book, so the wishlist is the only place it shows up."
    }
}
