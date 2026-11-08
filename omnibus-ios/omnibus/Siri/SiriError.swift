//  SiriError.swift
//  What Siri says when an action can't answer, in the reader's words.

import AppIntents
import Foundation

enum SiriError: Error, CustomLocalizedStringResourceConvertible {
    case signedOut
    case libraryNotLoaded
    /// Offline, with nothing on the device to answer from.
    case unavailable
    case bookNotFound
    case noAudiobook(title: String)
    case notPlayable(title: String)
    case nothingToResume
    case noReview(title: String?)

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .signedOut:
            "Open Omnibus to sign in first."
        case .libraryNotLoaded:
            "Your library hasn't loaded on this iPhone yet. Open Omnibus while you're online, then try again."
        case .unavailable:
            "Omnibus can't reach your server, and that isn't saved on this iPhone yet."
        case .bookNotFound:
            "That book isn't in your Omnibus library."
        case let .noAudiobook(title):
            "\(title) doesn't have an audiobook."
        case let .notPlayable(title):
            "\(title) isn't downloaded, and Omnibus can't reach your server right now."
        case .nothingToResume:
            "You haven't started an audiobook in Omnibus yet."
        case let .noReview(title?):
            "You haven't reviewed \(title)."
        case .noReview(nil):
            "You haven't written any reviews in Omnibus yet."
        }
    }
}
