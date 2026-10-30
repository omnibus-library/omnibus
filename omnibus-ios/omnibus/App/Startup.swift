//  Startup.swift
//  Once-per-process setup any scene awaits before touching the replica: open the store, hydrate downloads.
//
//  CarPlay can launch the app with no phone window at all, and the phone's
//  `AppState.bootstrap()` runs from that window's `RootView`. Until the store
//  is open every cache read misses and every outbox write is dropped, and
//  until downloads are hydrated every book streams — so the work lives here,
//  where the phone window, the CarPlay scene and the player can each await it
//  and it still runs exactly once.

import Foundation

@MainActor
enum Startup {
    private static var preparing: Task<Void, Never>?

    /// Open the offline store and hydrate the download registry; later calls
    /// await the first one's work rather than repeating it.
    static func prepare() async {
        let task = preparing ?? Task {
            await OfflineStore.shared.open()
            await DownloadManager.shared.hydrate()
        }
        preparing = task
        await task.value
    }
}
