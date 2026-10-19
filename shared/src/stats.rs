//! Reading-stats aggregate wire types.
//!
//! Produced by `db::stats` and served to the `/stats` page. One
//! [`StatsSummary`] carries the headline numbers, daily-activity heatmap,
//! top-authors/top-tags rankings, and finished-books rail for one user.
//!
//! Every completion metric on [`StatsSummary`] shares the "finished" definition in its
//! doc, never the session tables (no progress there), so they can't drift apart.
//!
//! `LibrarySize` and `LibraryComposition` stay off it: they only move on a reindex.

use serde::{Deserialize, Serialize};

mod query;
#[cfg(test)]
mod tests;

pub use query::*;

/// Per-user aggregate cache TTL for `db::stats::user_stats`, in seconds.
/// Lives here (rather than only in `omnibus-db`) so the `/stats` page's
/// footer freshness note can reference the real value instead of a second
/// hardcoded copy — see `db::stats::STATS_TTL_SECS`, which re-exports this.
pub const STATS_TTL_SECS: i64 = 60;

/// The period reading stats cover. Each calendar period runs from its start to now, in
/// your time zone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum StatsRange {
    /// This week so far, from Monday at midnight.
    Week,
    /// This month so far, from the 1st. The default.
    #[default]
    Month,
    /// This year so far, from January 1.
    Year,
    /// Every session on record.
    AllTime,
}

impl StatsRange {
    /// Every range in switcher order.
    pub const ALL: [StatsRange; 4] = [
        StatsRange::Week,
        StatsRange::Month,
        StatsRange::Year,
        StatsRange::AllTime,
    ];

    /// Wire name matching the serde snake_case rename, for query strings.
    pub fn as_query(&self) -> &'static str {
        match self {
            StatsRange::Week => "week",
            StatsRange::Month => "month",
            StatsRange::Year => "year",
            StatsRange::AllTime => "all_time",
        }
    }

    /// Human label for the period switcher.
    pub fn label(&self) -> &'static str {
        match self {
            StatsRange::Week => "Week",
            StatsRange::Month => "Month",
            StatsRange::Year => "Year",
            StatsRange::AllTime => "Lifetime",
        }
    }
}

/// The seconds read and listened on one day.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct DayActivity {
    /// The day, as `YYYY-MM-DD` in your time zone.
    pub day: String,
    pub seconds: i64,
}

/// An author or tag, with the seconds spent in its books during the period.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct RankedEntity {
    pub name: String,
    pub seconds: i64,
}

// Aggregated from the same session tables as `StatsSummary`, for one
// `(user, book_uuid)`. The RPC wraps it in `Option`: `None` means no live
// book for the uuid or no sitting worth reporting.
/// One user's reading and listening in one book.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct BookInsights {
    /// When the first session in the book started, in Unix seconds.
    pub started_at: i64,
    /// Seconds read and listened in the book, including sittings too short to count in
    /// `sessions`.
    pub seconds_total: i64,
    /// How many sittings the book had, which is how often it was picked up. A sitting is
    /// recorded time on the book with no break over 15 minutes, in either format. Sittings
    /// under a minute don't count.
    pub sessions: i64,
    /// Seconds in the sittings `sessions` counts. Divide it by `sessions` for the mean
    /// sitting, which `seconds_total` would skew. Never more than `seconds_total`.
    #[serde(default)]
    pub sitting_seconds: i64,
    /// Seconds in the longest sitting.
    pub longest_seconds: i64,
    /// When the longest sitting started, in Unix seconds.
    pub longest_started_at: i64,
    /// Seconds per day in the book, active days only, oldest first. Days are in your time
    /// zone. Fill the gaps up to `as_of_day`.
    pub daily: Vec<DayActivity>,
    /// Today, as `YYYY-MM-DD` in your time zone. It is the last day `daily` could cover.
    pub as_of_day: String,
}

/// A genre and how many books with it were read or listened to in the period. It counts
/// books, not seconds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct GenreShare {
    pub name: String,
    pub books: i64,
}

/// A book finished in the period. A book counts as finished when its read status is set
/// to `finished`, or a journal entry on it says 100 percent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct FinishedBook {
    pub book_uuid: String,
    pub title: String,
    /// The book's first author. Null when it has none.
    pub author: Option<String>,
    /// When the book was finished, in Unix seconds. The latest time, if it was finished
    /// more than once.
    pub finished_at: i64,
    /// The same moment as `finished_at`, as an ISO 8601 string in UTC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at_iso: Option<String>,
    /// `/api/covers/{uuid}` when the book has a cover. Null when it has none.
    #[serde(default)]
    pub cover_url: Option<String>,
    /// The reader's star rating of the book, from 0.5 to 5. Null when they haven't rated
    /// it.
    #[serde(default)]
    pub rating: Option<f64>,
}

/// How many books were finished in one calendar month.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct MonthCount {
    /// The month, as `YYYY-MM` in your time zone.
    pub month: String,
    pub books: i64,
}

/// A day or a month on a trend, and a figure's value over it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct TrendPoint {
    /// The day as `YYYY-MM-DD`, or the month as `YYYY-MM`, depending on the trend.
    pub label: String,
    pub value: f64,
}

/// One step of the rating spread: a rating and how many books were given it in the period.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct RatingBucket {
    /// The rating in half stars, from 1 to 10. Divide by 2 for stars, so 10 is 5 stars.
    pub half_stars: i64,
    pub books: i64,
}

impl RatingBucket {
    /// This bucket in stars (0.5 ..= 5.0) — the scale the UI displays.
    pub fn stars(&self) -> f64 {
        // Buckets are 1..=10 by construction, far inside f64's exact range.
        #[allow(clippy::cast_precision_loss)]
        let stars = self.half_stars as f64 / 2.0;
        stars
    }
}

/// One step of the book-length spread: a page range and how many books finished in the
/// period fall in it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct LengthBucket {
    /// The page range, labelled by the server. The `Unknown` bucket holds books whose
    /// length can't be measured, such as audiobooks. Show it too, or the spread covers
    /// fewer books than were finished.
    pub label: String,
    pub books: i64,
}

/// A library-wide total and how many books it was measured over. Read the two together,
/// since a total over part of the library is not the size of the whole. Zero `books` means
/// nothing has been measured yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct MeasuredTotal {
    pub total: i64,
    /// How many books `total` covers. Never more than the library's book count.
    pub books: i64,
}

impl MeasuredTotal {
    /// True when nothing in the library has been measured for this figure.
    pub fn is_empty(&self) -> bool {
        self.books == 0
    }
}

/// How big the library is in words, pages and seconds of audio, as
/// `GET /api/library-size` returns it. It covers the whole library, so it is the same for
/// every user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct LibrarySize {
    /// Books with at least one file. Each figure's `books` is out of this number. Books
    /// whose files are all gone count nowhere, since nothing can measure them.
    pub books: i64,
    /// Total words, over the books whose word count is known.
    #[serde(default)]
    pub words: MeasuredTotal,
    /// Total pages. A book's length in pages is its print page count when known, else a
    /// comic's page images, else its word count divided by 275.
    #[serde(default)]
    pub pages: MeasuredTotal,
    /// Total seconds of audio. Each audiobook counts once, in the audio format the server
    /// plays, over all its files in that format. A book with any file of unknown length is
    /// left out rather than partly counted.
    #[serde(default)]
    pub listening_seconds: MeasuredTotal,
}

impl LibrarySize {
    /// True when no figure here has been measured for a single book — the
    /// surfaces' signal to render an empty state rather than three zeroes.
    pub fn is_empty(&self) -> bool {
        self.words.is_empty() && self.pages.is_empty() && self.listening_seconds.is_empty()
    }
}

/// One hour of the day and the seconds read and listened in it during the period.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct HourBucket {
    /// The hour, from 0 to 23, on the clock where each session happened. The server reads
    /// it from the UTC offset the session recorded, not from your time zone.
    pub hour: i64,
    pub seconds: i64,
}

/// One day of the week and the seconds read and listened on it during the period.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct WeekdayBucket {
    /// The weekday where each session happened, from 0 for Monday to 6 for Sunday.
    pub weekday: i64,
    /// The weekday's short name, such as `Mon`.
    pub label: String,
    pub seconds: i64,
}

/// Recorded time a book needs before it can be crowned the window's fastest
/// read, in seconds. The metric measures *tracked* reading, so a book read mostly
/// on another device shows only its tail. Lives here so the surfaces can state
/// the floor without a second copy drifting from `db::stats::superlatives`'s.
pub const FASTEST_READ_MIN_SECS: i64 = 1800;

/// A book that holds one of the period's records, and the figure it holds it with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct BookSuperlative {
    pub book_uuid: String,
    pub title: String,
    /// The book's first author. Null when it has none.
    pub author: Option<String>,
    /// The figure. Its unit depends on the `Superlatives` field that holds it: pages,
    /// seconds or days.
    pub value: i64,
}

/// The period's records, such as its longest book and its longest sitting. Every field
/// is optional. A period without enough data for a record leaves it out rather than
/// naming its only book.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct Superlatives {
    /// The longest book finished in the period, in pages. Absent when no book finished in
    /// the period has a known length.
    #[serde(default)]
    pub longest_book: Option<BookSuperlative>,
    /// The shortest book finished in the period, in pages. Absent when it would be the same
    /// book as `longest_book`, or have the same page count.
    #[serde(default)]
    pub shortest_book: Option<BookSuperlative>,
    /// The day with the most seconds read and listened in the period. A tie goes to the
    /// earliest day.
    #[serde(default)]
    pub biggest_day: Option<DayActivity>,
    /// The longest sitting in the period, in seconds of recorded time.
    #[serde(default)]
    pub longest_sit: Option<BookSuperlative>,
    /// The book finished in the period in the fewest days from its first recorded session.
    /// A book read within one day counts as one day. Only books with at least 30 minutes of
    /// recorded time qualify. Reading the server never recorded doesn't count, so the real
    /// time can be longer. Present it as at least that many days.
    #[serde(default)]
    pub fastest_read: Option<BookSuperlative>,
}

impl Superlatives {
    /// True when none of the five server-computed figures is present. Deliberately
    /// **not** the card's render gate: both surfaces also draw rows off
    /// `StatsSummary` fields outside this struct (busiest week, top author and
    /// subject), so the gate is the assembled row list.
    pub fn is_empty(&self) -> bool {
        self.longest_book.is_none()
            && self.shortest_book.is_none()
            && self.biggest_day.is_none()
            && self.longest_sit.is_none()
            && self.fastest_read.is_none()
    }
}

/// What `pages_read` could and couldn't measure in the period. It tells three empty
/// states apart: no activity, listening only, where zero pages is correct, and reading in
/// books of unknown length.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct PagesReadDetail {
    /// The day the server began recording page progress, as `YYYY-MM-DD` in UTC. Reading
    /// before it can't be measured.
    #[serde(default)]
    pub since_day: Option<String>,
    /// Books whose page progress in the period was measured.
    pub measured_books: i64,
    /// Books read in the period whose length is unknown, so the total can't include them.
    pub unmeasured_books: i64,
    /// Books listened to in the period. Audiobooks add no pages, so this tells a
    /// listening-only period apart from an empty one.
    pub audio_books: i64,
    /// Pages read per day in the period, in your time zone, active days only, oldest
    /// first.
    #[serde(default)]
    pub daily: Vec<TrendPoint>,
    /// Whether the period starts before `since_day`, so part of it can't be measured. Use
    /// this rather than working it out from `range`, since only the server knows where the
    /// period starts.
    #[serde(default)]
    pub window_predates_ledger: bool,
}

impl PagesReadDetail {
    /// True when the window holds listening and no reading at all — the one
    /// empty state whose honest headline is `0`, not an em-dash.
    pub fn audio_only(&self) -> bool {
        self.audio_books > 0 && self.measured_books == 0 && self.unmeasured_books == 0
    }

    /// True when the window starts before the ledger did, so part of it is
    /// unmeasurable no matter what the reader did — and there is an epoch to
    /// name in the disclosure.
    pub fn predates_ledger(&self) -> bool {
        self.since_day.is_some() && self.window_predates_ledger
    }
}

/// The same figures for the matching stretch of the previous period. The current period
/// runs to now, so this month so far compares with the same days at the start of last
/// month, not with all of it. For `all_time`, every figure is zero and `avg_stars` is
/// null.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct PeriodComparison {
    pub books_finished: i64,
    pub avg_stars: Option<f64>,
    pub listening_seconds: i64,
    /// Pages read in that stretch. It counts whole days in your time zone, so it includes
    /// all of the stretch's last day.
    #[serde(default)]
    pub pages_read: i64,
}

/// One reader's stats for one period, as `GET /api/stats` returns them. Days are cut on
/// the request's `utc_offset_minutes`. A book counts as finished when its read status is
/// set to `finished` or a journal entry on it says 100 percent. It counts once if both
/// happen, and only while the book is still in the library. Every finished-book figure
/// uses this rule. `pages_read` measures ground covered instead.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct StatsSummary {
    pub range: StatsRange,
    /// Seconds spent reading in the period.
    pub reading_seconds: i64,
    /// Seconds spent listening in the period.
    pub listening_seconds: i64,
    // `f64` keeps the struct `PartialEq`-only.
    /// The mean of the ratings given in the period, from 0.5 to 5. Null when nothing was
    /// rated.
    #[serde(default)]
    pub avg_stars: Option<f64>,
    /// Sittings in the period. A sitting is recorded time on one book with no break over 15
    /// minutes. Sittings under a minute don't count here, though their seconds still count
    /// in the totals.
    pub sessions: i64,
    /// Days in the period with any reading or listening.
    pub active_days: i64,
    /// The longest run of consecutive active days in the period.
    pub longest_streak_days: i64,
    /// The run of consecutive active days still going on `as_of_day`. A run that ended
    /// yesterday still counts. One that ended earlier gives zero. Unlike most figures here,
    /// it doesn't depend on `range`.
    #[serde(default)]
    pub current_streak_days: i64,
    /// The Monday that starts the busiest week, as `YYYY-MM-DD`, even when nothing was read
    /// that Monday. It can fall before the period starts. Null when the period has no
    /// activity.
    pub busiest_week_start: Option<String>,
    /// Seconds read and listened in the busiest week, counting only its days inside the
    /// period.
    pub busiest_week_seconds: i64,
    /// Books finished in the period.
    pub books_finished: i64,
    /// Books with any reading or listening in the period.
    #[serde(default)]
    pub books_active: i64,
    /// Books with a genre and any activity in the period. `genre_share` counts these books.
    /// Never more than `books_active`. The difference is reading the genres can't describe.
    #[serde(default)]
    pub genre_tagged_books: i64,
    /// Today, as `YYYY-MM-DD` in your time zone, when the stats were computed. Use it as the
    /// last day of the heatmap instead of the device's clock.
    #[serde(default)]
    pub as_of_day: String,
    /// Seconds read and listened per day in the period, active days only, oldest first.
    pub heatmap: Vec<DayActivity>,
    /// Up to 8 authors with the most time spent in their books in the period, most first.
    pub top_authors: Vec<RankedEntity>,
    /// Up to 8 tags with the most time spent in their books in the period, most first.
    pub top_tags: Vec<RankedEntity>,
    /// Every genre read in the period, not only the largest.
    #[serde(default)]
    pub genre_share: Vec<GenreShare>,
    /// Books finished in the period, newest first, up to 100. `books_finished` has the full
    /// count.
    pub finished_books: Vec<FinishedBook>,
    /// Books finished in each of the last 12 calendar months, oldest first, ending with the
    /// current month so far. It doesn't depend on `range`.
    #[serde(default)]
    pub books_per_month: Vec<MonthCount>,
    /// The same figures for the matching stretch of the previous period.
    #[serde(default)]
    pub previous: PeriodComparison,
    /// Seconds listened per day in the period, active days only, oldest first.
    #[serde(default)]
    pub listening_daily: Vec<DayActivity>,
    /// The mean rating given in each of the last 12 calendar months, oldest first. It
    /// doesn't depend on `range`. A month with no ratings carries 0, which no real mean can
    /// be, so show it as empty rather than as a low rating.
    #[serde(default)]
    pub rating_monthly: Vec<TrendPoint>,
    /// How the period's ratings spread across the ten half-star steps. All ten are present,
    /// zeros included. An empty list means no ratings in the period. It counts the same
    /// ratings `avg_stars` averages.
    #[serde(default)]
    pub rating_histogram: Vec<RatingBucket>,
    /// Pages read in the period. It is how far each book was carried during it, measured
    /// against the book's length in pages. Exact for some books and an estimate for others.
    /// A book of unknown length adds nothing. Null when no book read in the period has a
    /// known length, so read `pages_detail` before showing that as no data.
    #[serde(default)]
    pub pages_read: Option<i64>,
    /// Estimated reading speed, in pages per hour. It is a mean over the books finished in
    /// the period that have a known length and recorded reading time, weighted by reading
    /// time. It is not `pages_read` divided by `reading_seconds`, which cover different
    /// books. It counts reading time only, so a book partly listened to looks faster than
    /// it was. Null when no finished book qualifies.
    #[serde(default)]
    pub pages_per_hour: Option<f64>,
    /// Books finished in the period, by length, plus the `Unknown` bucket. Every bucket is
    /// present, zeros included. All zeros means nothing was finished.
    #[serde(default)]
    pub length_buckets: Vec<LengthBucket>,
    /// Seconds read and listened in the period by hour of the day, for all 24 hours in
    /// order, zeros included. Each session is placed by the UTC offset it recorded. Sessions
    /// without one aren't counted here, and `unzoned_seconds` reports them instead.
    #[serde(default)]
    pub hour_of_day: Vec<HourBucket>,
    /// Seconds read and listened in the period by weekday, for all 7, Monday first, zeros
    /// included. It counts the same sessions as `hour_of_day`, so the two add up to the same
    /// total.
    #[serde(default)]
    pub day_of_week: Vec<WeekdayBucket>,
    /// Seconds in the period from sessions that recorded no UTC offset, such as older ones,
    /// so they can't be placed on a local clock. Above zero, it means `hour_of_day` and
    /// `day_of_week` cover less than the whole period. It is not an error.
    #[serde(default)]
    pub unzoned_seconds: i64,
    // `Superlatives::is_empty` is a predicate over these five, not the card's
    // render gate: the surfaces draw rows off fields outside it too.
    /// The period's records.
    #[serde(default)]
    pub superlatives: Superlatives,
    /// The reader's goal for the current calendar year. Null when none is set. It doesn't
    /// depend on `range`.
    #[serde(default)]
    pub goal: Option<ReadingGoal>,
    /// Books finished in the current calendar year, whether or not a yearly goal is set. It
    /// is the same count as `current` in `goal`, so setting a goal never changes it. It
    /// doesn't depend on `range`.
    #[serde(default)]
    pub books_this_year: Option<i64>,
    /// The reader's daily goals and today's progress toward them. They don't depend on
    /// `range`.
    #[serde(default)]
    pub daily_goals: DailyGoals,
    /// What `pages_read` could and couldn't measure in the period, and the day the server
    /// began recording page progress.
    #[serde(default)]
    pub pages_detail: PagesReadDetail,
}

impl StatsSummary {
    /// Total active seconds — reading plus listening.
    pub fn total_seconds(&self) -> i64 {
        self.reading_seconds + self.listening_seconds
    }

    /// True when the user has no activity to show, driving the empty state.
    ///
    /// Tested on recorded seconds rather than [`Self::sessions`], a *filtered* count:
    /// a reader whose every sitting was a glance still has time read, active days, a
    /// heatmap and top authors to render.
    pub fn is_empty(&self) -> bool {
        self.total_seconds() == 0 && self.books_finished == 0
    }

    /// Whether the time-pattern strips have anything to draw.
    ///
    /// Both strips are zero-filled to a fixed width, so "no data" and "a full day of
    /// nothing" render identically; this predicate tells them apart. Checks the hour
    /// strip alone: both rollups run over one set of sessions.
    pub fn has_time_patterns(&self) -> bool {
        self.hour_of_day.iter().any(|b| b.seconds > 0)
    }
}

/// The annual goal kind: distinct books finished in the calendar year. The
/// wire carries the string so a further kind is an added value rather than a
/// breaking shape change.
pub const GOAL_KIND_BOOKS: &str = "books";

/// Daily goal kind — estimated pages covered, read off the forward-progress
/// ledger. `books` has no daily analogue worth offering: a book-a-day target
/// is not what a daily goal is for, and the ledger measures the same reading
/// far more finely.
pub const GOAL_KIND_PAGES: &str = "pages";

/// Daily goal kind — minutes spent reading *and* listening, the same union
/// every other time figure on [`StatsSummary`] sums.
pub const GOAL_KIND_MINUTES: &str = "minutes";

/// Inclusive upper bound on a daily pages target. Like [`MAX_GOAL_TARGET`]
/// this is not a judgement about how much anyone can read — it exists so the
/// progress bar's arithmetic stays bounded by something other than what a
/// client happened to send.
pub const MAX_DAILY_PAGES: i64 = 2_000;

/// Inclusive upper bound on a daily minutes target — the number of minutes in
/// a day. Unlike the pages bound this one is not arbitrary: a larger target
/// could not be met by a reader who did nothing else.
pub const MAX_DAILY_MINUTES: i64 = 1_440;

/// Inclusive upper bound on a stored goal target. Not a judgement about how
/// much anyone can read — it exists so the progress bar's arithmetic and the
/// column's width stay bounded by something other than what a client happened
/// to POST.
pub const MAX_GOAL_TARGET: i64 = 10_000;

/// Earliest goal year the write path accepts. Bounds the column at both ends
/// so a typo'd year can't file a row no surface will ever read.
pub const MIN_GOAL_YEAR: i64 = 1900;
/// Latest goal year the write path accepts.
pub const MAX_GOAL_YEAR: i64 = 2999;

/// A reader's goal of books to finish in one calendar year, with progress toward it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct ReadingGoal {
    /// What the goal counts. Always `books`.
    pub kind: String,
    /// The number to reach. At least 1. A cleared goal is null, never a zero target.
    pub target: i64,
    /// Books finished in `year`, counted like every other finished-book figure. It can be
    /// more than `target`.
    pub current: i64,
    /// The calendar year the goal is for.
    pub year: i64,
}

impl ReadingGoal {
    /// Progress as a 0..=100 percentage, clamped for rendering. Use
    /// [`Self::current`] against [`Self::target`] for the honest ratio; this
    /// is only the bar's width.
    pub fn percent(&self) -> i64 {
        if self.target <= 0 {
            return 0;
        }
        let pct = self.current.saturating_mul(100) / self.target;
        pct.clamp(0, 100)
    }

    /// Books still to go, `0` once the goal is met or passed.
    pub fn remaining(&self) -> i64 {
        (self.target - self.current).max(0)
    }

    /// Whether the reader has reached the target.
    pub fn is_met(&self) -> bool {
        self.current >= self.target
    }
}

/// A reader's daily goal of one kind, with today's progress toward it. Today is in the
/// time zone of the request's `utc_offset_minutes`, else of the reader's latest session,
/// else UTC.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct DailyGoal {
    /// What the goal counts: `pages` or `minutes`. Minutes count reading and listening.
    pub kind: String,
    /// The number to reach each day. At least 1. A cleared goal is null, never a zero
    /// target.
    pub target: i64,
    /// Progress toward `target` on `day`. It can be more than `target`.
    pub current: i64,
    /// The day `current` covers, as `YYYY-MM-DD`.
    pub day: String,
}

impl DailyGoal {
    /// Progress as a 0..=100 percentage, clamped for rendering. Use
    /// [`Self::current`] against [`Self::target`] for the honest ratio; this is
    /// only the bar's width.
    pub fn percent(&self) -> i64 {
        if self.target <= 0 {
            return 0;
        }
        let pct = self.current.saturating_mul(100) / self.target;
        pct.clamp(0, 100)
    }

    /// Pages or minutes still to go, `0` once the goal is met or passed.
    pub fn remaining(&self) -> i64 {
        (self.target - self.current).max(0)
    }

    /// Whether the reader has reached today's target.
    pub fn is_met(&self) -> bool {
        self.current >= self.target
    }
}

/// A reader's daily goals, at most one of each kind. Each is separate from the other and
/// from the yearly `ReadingGoal`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct DailyGoals {
    /// The pages goal. Null when none is set.
    pub pages: Option<DailyGoal>,
    /// The minutes goal. Null when none is set.
    pub minutes: Option<DailyGoal>,
    /// Pages read today, whether or not a pages goal is set. It is the same figure as the
    /// pages goal's `current`, so setting a goal never changes it. Null only when the
    /// server couldn't measure it, never in place of zero.
    #[serde(default)]
    pub pages_today: Option<i64>,
    /// Minutes read and listened today, whether or not a minutes goal is set, over the same
    /// day as `pages_today`. Rounded down, so 59 seconds is not yet a minute.
    #[serde(default)]
    pub minutes_today: Option<i64>,
    // The day is placed by the reader's current offset, not each session's,
    // so every session counts toward `minutes_today` and nothing is left
    // unplaced to disclose.
    /// Always 0. Kept so clients built against an older response still decode it.
    #[serde(default)]
    pub unzoned_seconds: i64,
}

impl DailyGoals {
    /// Whether the reader has any daily goal at all, driving the band's invite
    /// state.
    pub fn is_empty(&self) -> bool {
        self.pages.is_none() && self.minutes.is_none()
    }
}

// A separate route and type from `ReadingGoalUpdate`, whose
// `Option<ReadingGoal>` response shipped iOS builds already decode.
/// The daily goal `PUT /api/stats/goal/daily` sets or clears.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct DailyGoalUpdate {
    /// Which goal: `pages` or `minutes`.
    pub kind: String,
    /// The number to reach each day: 1 to 2,000 pages, or 1 to 1,440 minutes. Null or
    /// absent clears the goal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<i64>,
}

impl DailyGoalUpdate {
    /// A set-this-daily-goal update.
    pub fn set(kind: &str, target: i64) -> Self {
        Self {
            kind: kind.to_string(),
            target: Some(target),
        }
    }

    /// A clear-this-daily-goal update.
    pub fn clear(kind: &str) -> Self {
        Self {
            kind: kind.to_string(),
            target: None,
        }
    }

    /// The inclusive upper bound for a kind, `None` when the kind is not a
    /// daily one. The bound is per-kind because the units are: 2,000 is a
    /// generous day of pages and an impossible day of minutes.
    pub fn max_target(kind: &str) -> Option<i64> {
        match kind {
            GOAL_KIND_PAGES => Some(MAX_DAILY_PAGES),
            GOAL_KIND_MINUTES => Some(MAX_DAILY_MINUTES),
            _ => None,
        }
    }

    /// Reject an unsupported kind or an out-of-range target. Handlers
    /// translate `Err(_)` into 400; the db layer re-checks the same bounds,
    /// since it is also reachable from the RPC.
    pub fn validate(&self) -> Result<(), String> {
        let Some(max) = Self::max_target(&self.kind) else {
            return Err(format!("unsupported daily goal kind: {}", self.kind));
        };
        if let Some(target) = self.target {
            if !(1..=max).contains(&target) {
                return Err(format!("{} target must be between 1 and {max}", self.kind));
            }
        }
        Ok(())
    }
}

/// The yearly goal `PUT /api/stats/goal` sets or clears. The usual body is
/// `{"target": 24}`. There is no DELETE route. Send no `target` to clear the goal.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ReadingGoalUpdate {
    /// The goal's year, from 1900 to 2999. Defaults to this year.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<i64>,
    /// What the goal counts. Only `books`, the default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    // Omitted rather than sent as `null` when clearing: the two decode
    // identically, and an omitted key keeps the wire honest about how little
    // the usual write carries.
    /// How many books to finish, from 1 to 10,000. Null or absent clears the goal for
    /// `year`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<i64>,
}

impl ReadingGoalUpdate {
    /// A set-this-year's-books-goal update — the shape every surface sends.
    pub fn books(target: i64) -> Self {
        Self {
            year: None,
            kind: None,
            target: Some(target),
        }
    }

    /// A clear-this-year's-books-goal update.
    pub fn clear_books() -> Self {
        Self {
            year: None,
            kind: None,
            target: None,
        }
    }

    /// The kind this update names, defaulting to [`GOAL_KIND_BOOKS`].
    pub fn kind_or_default(&self) -> &str {
        self.kind.as_deref().unwrap_or(GOAL_KIND_BOOKS)
    }

    /// Reject an unsupported kind, an out-of-range target, or an out-of-range
    /// year. Handlers translate `Err(_)` into 400; the db layer re-checks the
    /// same bounds as typed variants, since it is also reachable from the RPC.
    pub fn validate(&self) -> Result<(), String> {
        if self.kind_or_default() != GOAL_KIND_BOOKS {
            return Err(format!("unsupported goal kind: {}", self.kind_or_default()));
        }
        if let Some(target) = self.target {
            if !(1..=MAX_GOAL_TARGET).contains(&target) {
                return Err(format!("target must be between 1 and {MAX_GOAL_TARGET}"));
            }
        }
        if let Some(year) = self.year {
            if !(MIN_GOAL_YEAR..=MAX_GOAL_YEAR).contains(&year) {
                return Err(format!(
                    "year must be between {MIN_GOAL_YEAR} and {MAX_GOAL_YEAR}"
                ));
            }
        }
        Ok(())
    }
}

/// One bucket of a `LibraryComposition` dimension: a label and how many books are in it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CompositionSlice {
    pub label: String,
    pub books: i64,
}

/// One way of dividing up the library, such as by format: its buckets and the coverage
/// behind them. `coverage.total` is the sum of every bucket's `books`, and
/// `coverage.books` is how many different books the dimension describes. The two differ
/// when a book falls in more than one bucket. Zero `coverage.books` means no book has
/// this property.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CompositionDimension {
    #[serde(default)]
    pub slices: Vec<CompositionSlice>,
    #[serde(default)]
    pub coverage: MeasuredTotal,
}

impl CompositionDimension {
    /// True when no live book carries this dimension at all.
    pub fn is_empty(&self) -> bool {
        self.coverage.books == 0 || self.slices.is_empty()
    }

    /// Books that land in more than one bucket — the overlap a reader needs
    /// to reconcile the slices against the library total. Zero for every
    /// dimension whose buckets are mutually exclusive.
    pub fn overlap(&self) -> i64 {
        (self.coverage.total - self.coverage.books).max(0)
    }

    /// Live books this dimension has nothing to say about — no language link,
    /// no publisher, no genre override. `library_books` is
    /// [`LibraryComposition::books`].
    pub fn uncovered(&self, library_books: i64) -> i64 {
        (library_books - self.coverage.books).max(0)
    }
}

/// What the library is made of: its formats, languages, publishers, publication decades
/// and genres, as `GET /api/library-composition` returns it. It covers the whole library,
/// so it is the same for every user. Every count is of books, not files.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct LibraryComposition {
    /// Books with at least one file. Each dimension's coverage is out of this number. It is
    /// the same count as `books` in `LibrarySize`.
    pub books: i64,
    /// Books whose files are all gone. They have no format, so no format bucket holds them.
    /// `books` plus `ghosted_books` is every book the library knows of.
    #[serde(default)]
    pub ghosted_books: i64,
    /// Books by file format, most first. A book in two formats counts once in each, so the
    /// buckets add up to `formats.coverage.total`, which is more than `books` by the number
    /// of books held in two formats.
    #[serde(default)]
    pub formats: CompositionDimension,
    /// Books by language, with the smallest folded into "Other". A book whose file declares
    /// no language is left out rather than counted as unknown.
    #[serde(default)]
    pub languages: CompositionDimension,
    /// Books by publisher, with the smallest folded into "Other".
    #[serde(default)]
    pub publishers: CompositionDimension,
    /// Books by decade of publication, oldest first, with nothing folded. The year is read
    /// the way smart shelf rules read it, so a decade bucket and a `year >= 1990` shelf
    /// agree. There is no unknown bucket. A book with no readable publication date is left
    /// out, and `coverage` shows how many are left out.
    #[serde(default)]
    pub decades: CompositionDimension,
    /// Books by genre, with the smallest folded into "Other". Read its coverage first.
    /// Genres come only from metadata someone edited by hand, so this describes only those
    /// books, not the whole library.
    #[serde(default)]
    pub genres: CompositionDimension,
}

impl LibraryComposition {
    /// True when the library has nothing to describe — no live books, or no
    /// dimension carrying a single one. The surfaces' signal to render
    /// nothing rather than five empty charts.
    pub fn is_empty(&self) -> bool {
        self.books == 0
            || (self.formats.is_empty()
                && self.languages.is_empty()
                && self.publishers.is_empty()
                && self.decades.is_empty()
                && self.genres.is_empty())
    }
}

// `Mixed` is not a fallback: a dual-format book read and listened to in one
// stretch stitches into a single sitting (see `db::stats::sessionize`), and
// naming either format alone would misreport it.
/// Whether a sitting was reading, listening, or both. `mixed` is a book read and listened
/// to in one stretch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum SessionFormat {
    Reading,
    Listening,
    Mixed,
}

impl SessionFormat {
    /// Human label for a log row — past tense, since a logged sitting is over.
    pub fn label(&self) -> &'static str {
        match self {
            SessionFormat::Reading => "Read",
            SessionFormat::Listening => "Listened",
            SessionFormat::Mixed => "Read & listened",
        }
    }
}

/// One sitting in the session log. A sitting is recorded time on one book with no break
/// over 15 minutes. Sittings under a minute are left out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct SessionLogEntry {
    pub book_uuid: String,
    pub title: String,
    pub format: SessionFormat,
    /// When the sitting began, in Unix seconds.
    pub started_at: i64,
    /// When the sitting ended, in Unix seconds.
    pub ended_at: i64,
    /// Seconds recorded in the sitting. A sitting with pauses records less than
    /// `ended_at` minus `started_at`.
    pub seconds: i64,
    // Absent only on a value a client built itself.
    /// The same moment as `started_at`, as an ISO 8601 string in UTC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at_iso: Option<String>,
    // Absent only on a value a client built itself.
    /// The same moment as `ended_at`, as an ISO 8601 string in UTC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at_iso: Option<String>,
}

impl SessionLogEntry {
    /// Fill the ISO siblings from the epochs already on the entry.
    #[must_use]
    pub fn with_iso(mut self) -> Self {
        self.started_at_iso = Some(crate::to_iso8601(self.started_at));
        self.ended_at_iso = Some(crate::to_iso8601(self.ended_at));
        self
    }

    /// This entry's cursor — what a caller passes as `before` to fetch the
    /// page that continues after it.
    pub fn cursor(&self) -> SessionCursor {
        SessionCursor {
            started_at: self.started_at,
            book_uuid: self.book_uuid.clone(),
        }
    }
}

/// A keyset cursor into the session log: the last-seen sitting's start plus
/// its book, ordered `(started_at DESC, book_uuid DESC)`.
///
/// The book uuid breaks ties: two books can start a sitting in the same second,
/// and a cursor with only `started_at` drops or repeats the remainder.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct SessionCursor {
    pub started_at: i64,
    pub book_uuid: String,
}

impl SessionCursor {
    /// Wire form, `"{started_at}:{book_uuid}"` — split on the **first** colon,
    /// so the uuid half is taken verbatim even if it contains one of its own.
    pub fn encode(&self) -> String {
        format!("{}:{}", self.started_at, self.book_uuid)
    }

    /// Parse [`Self::encode`]'s output. `None` on anything else — the handler
    /// turns that into a 400 rather than silently serving page one, which
    /// would loop a paging client.
    pub fn parse(raw: &str) -> Option<Self> {
        let (started, uuid) = raw.split_once(':')?;
        if uuid.is_empty() {
            return None;
        }
        Some(SessionCursor {
            started_at: started.parse().ok()?,
            book_uuid: uuid.to_string(),
        })
    }
}

/// One page of the session log, newest first, as `GET /api/stats/sessions` returns it.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct SessionLogPage {
    pub entries: Vec<SessionLogEntry>,
    /// The `before` value for the next page. Null at the end of the log. Send it back
    /// unchanged, without parsing it.
    #[serde(default)]
    pub next_before: Option<String>,
}

impl FinishedBook {
    /// Fill [`Self::finished_at_iso`] from the epoch already on the row.
    #[must_use]
    pub fn with_iso(mut self) -> Self {
        self.finished_at_iso = Some(crate::to_iso8601(self.finished_at));
        self
    }
}
