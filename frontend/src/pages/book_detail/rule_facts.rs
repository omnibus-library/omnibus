//! A counter the book page's writers bump after saving something a smart
//! shelf's rules read (read status, rating, tags, genres), so the shelves block
//! re-reads which shelves hold the book and the Reviews section re-reads
//! whether you finished it. Provided by the marquee stage and the mobile page.

use dioxus::prelude::*;

/// Bumped after every save of a fact a shelf rule can match on. Starts at zero
/// for SSR parity (rule 07).
#[derive(Copy, Clone, PartialEq)]
pub(super) struct RuleFactsSaved(Signal<u32>);

impl RuleFactsSaved {
    /// A fresh counter at zero, for the stage that provides it.
    pub(super) fn new() -> Self {
        Self(Signal::new(0))
    }

    /// Saves so far; reading it subscribes the caller.
    pub(super) fn count(self) -> u32 {
        (self.0)()
    }

    /// Count one save.
    pub(super) fn note(mut self) {
        self.0.with_mut(|n| *n += 1);
    }
}

/// The page's [`RuleFactsSaved`], or a local one that never moves where no
/// page provides it (a component rendered on its own).
pub(super) fn use_rule_facts_saved() -> RuleFactsSaved {
    let local = use_signal(|| 0u32);
    try_use_context::<RuleFactsSaved>().unwrap_or(RuleFactsSaved(local))
}
