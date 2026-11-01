//  ArtworkRetrySchedule.swift
//  When a book's Now Playing cover may be fetched again after a failed fetch.
//
//  Now Playing updates twice a second while a book plays, and a plate standing
//  in for art that didn't load would ask the server each time. Free of the
//  player so it can be tested without one: `AudioPlayer` reports what happened
//  and asks whether a fetch is due.
//
//  A returning connection lifts only a first failure's wait: that failure may
//  have been the outage, while one more says the connection wasn't the cure.
//  A route that alone drops its connections flips the app offline with each
//  fetch and the probe brings it back seconds later, so lifting every wait
//  would keep fetching at the probe's pace for as long as the book plays.
//
//  Any `play()` lifts a wait: a listener's tap, an interruption's end, a load's
//  owed start. `AudioPlayer` reports it rather than the schedule inferring it
//  from `isPlaying`: a stream that keeps failing restarts itself with each
//  rebuild, through `startPlayback` rather than `play()`, and inferring would
//  then fetch every time.

/// One book's exponential wait between failed cover fetches.
struct ArtworkRetrySchedule {
    /// The wait after one failure, doubling with each failure in a row.
    static let firstDelay: Duration = .seconds(15)
    /// The longest wait, however many failures.
    static let longestDelay: Duration = .seconds(240)

    private var uuid: String?
    private var failures = 0
    private var retryAt: ContinuousClock.Instant?

    /// The wait after `failures` failures in a row, at least one.
    static func delay(afterFailures failures: Int) -> Duration {
        // The doubling stops well past the cap, so a long failure run can't overflow.
        min(firstDelay * (1 << min(failures - 1, 8)), longestDelay)
    }

    /// What Now Playing is showing. A book other than the last starts clean.
    mutating func noteCurrent(uuid: String) {
        guard uuid != self.uuid else { return }
        self.uuid = uuid
        failures = 0
        retryAt = nil
    }

    /// Any `play()` lifts the wait; the failures so far still count towards the next.
    mutating func noteResumed() {
        retryAt = nil
    }

    /// Whether the current book's cover may be fetched at `now`.
    func fetchIsDue(at now: ContinuousClock.Instant) -> Bool {
        guard let retryAt else { return true }
        return now >= retryAt
    }

    /// A request for the current book's cover brought no art.
    mutating func noteFailure(at now: ContinuousClock.Instant) {
        failures += 1
        retryAt = now + Self.delay(afterFailures: failures)
    }

    /// The connection came back after being lost.
    mutating func noteConnectionReturned() {
        if failures == 1 { retryAt = nil }
    }
}
