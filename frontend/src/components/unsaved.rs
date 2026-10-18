//! Unsaved-edit tracking for the settings shells. Each form reports whether it
//! holds edits through [`use_unsaved_guard`]; the shell asks [`UnsavedChanges`]
//! before a section switch would unmount them, and on web the browser's
//! `beforeunload` prompt is armed only while something is dirty. Outside a
//! shell (no context) the guard is a no-op.

use std::collections::BTreeSet;

use dioxus::prelude::*;

/// The forms currently holding edits, keyed by a stable per-form id.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DirtyForms(BTreeSet<&'static str>);

impl DirtyForms {
    /// Record whether the form `id` holds edits.
    pub fn mark(&mut self, id: &'static str, dirty: bool) {
        if dirty {
            self.0.insert(id);
        } else {
            self.0.remove(id);
        }
    }

    /// Drop a form that has unmounted.
    pub fn forget(&mut self, id: &'static str) {
        self.0.remove(id);
    }

    /// Whether any form holds edits.
    pub fn any(&self) -> bool {
        !self.0.is_empty()
    }
}

/// Context the settings shells provide over their sections.
#[derive(Clone, Copy)]
pub struct UnsavedChanges(pub Signal<DirtyForms>);

impl UnsavedChanges {
    /// Whether leaving now would drop edits.
    pub fn is_dirty(&self) -> bool {
        self.0.read().any()
    }
}

/// Provide [`UnsavedChanges`] to the calling component's subtree and keep the
/// browser's leave prompt armed while it is dirty.
pub fn provide_unsaved_changes() -> UnsavedChanges {
    let changes = use_context_provider(|| UnsavedChanges(Signal::new(DirtyForms::default())));
    use_effect(move || arm_leave_prompt(changes.is_dirty()));
    use_drop(move || arm_leave_prompt(false));
    changes
}

/// Report form `id`'s dirtiness to the enclosing shell, clearing it on unmount.
pub fn use_unsaved_guard(id: &'static str, dirty: Memo<bool>) {
    let changes = try_use_context::<UnsavedChanges>();
    use_effect(move || {
        if let Some(mut changes) = changes {
            changes.0.write().mark(id, dirty());
        }
    });
    use_drop(move || {
        if let Some(mut changes) = changes {
            changes.0.write().forget(id);
        }
    });
}

/// Guard form `id` against leaving with edits: it is dirty while `current()`
/// differs from the returned snapshot, which the form sets to what it loaded
/// and then to each value it saves. `None` (not loaded yet) is never dirty.
pub fn use_saved_snapshot<T: Clone + PartialEq + 'static>(
    id: &'static str,
    current: impl Fn() -> T + 'static,
) -> Signal<Option<T>> {
    let saved = use_signal(|| None::<T>);
    let dirty = use_memo(move || {
        saved
            .read()
            .as_ref()
            .is_some_and(|saved| *saved != current())
    });
    use_unsaved_guard(id, dirty);
    saved
}

#[cfg(feature = "web")]
fn arm_leave_prompt(dirty: bool) {
    let js = if dirty {
        "window.onbeforeunload = (e) => { e.preventDefault(); e.returnValue = ''; };"
    } else {
        "window.onbeforeunload = null;"
    };
    let _ = dioxus::document::eval(js);
}

#[cfg(not(feature = "web"))]
fn arm_leave_prompt(_dirty: bool) {}

#[cfg(test)]
mod tests;
