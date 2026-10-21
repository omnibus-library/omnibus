//! The A–Z rail beside a browse list: every letter on one even rhythm, so
//! the column reads as an alphabet rather than a scatter of the letters that
//! happen to have rows. Present letters are same-page anchors to their
//! group (`#letter-L`), so the jump is the browser's own scroll; absent ones
//! are dimmed text. The pane's row's letter is marked.

use dioxus::prelude::*;

use super::letters::letter_frag;

/// A–Z then `#`; `present` are the letters with a group, `active` the shown
/// row's. Each present letter's test id is `{testid}-letter-{L}`.
#[component]
pub fn LetterRail(present: Vec<char>, active: Option<char>, testid: &'static str) -> Element {
    let alphabet = ('A'..='Z').chain(std::iter::once('#'));
    rsx! {
        nav { class: "au-rail", "aria-label": "Jump to letter",
            for l in alphabet {
                {
                    let frag = letter_frag(l);
                    let has = present.contains(&l);
                    let on = has && active == Some(l);
                    // One element type either way (rule 07): an `a` without
                    // an `href` is plain, unfocusable text.
                    let class = match (has, on) {
                        (_, true) => "au-rail-letter is-active",
                        (true, false) => "au-rail-letter",
                        (false, _) => "au-rail-letter is-empty",
                    };
                    rsx! {
                        a {
                            key: "{l}",
                            class,
                            href: has.then(|| format!("#letter-{frag}")),
                            "aria-current": on.then_some("location"),
                            "aria-hidden": (!has).then_some("true"),
                            "data-testid": has.then(|| format!("{testid}-letter-{frag}")),
                            "{l}"
                        }
                    }
                }
            }
        }
    }
}
