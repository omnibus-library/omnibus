//! The crengine V2 XPointer dialect KOReader reads and writes for EPUBs:
//! `/body/DocFragment[N]/body/name[i]/…/text()[k].offset`. A pure parser and
//! formatter; deciding whether a pointer is provable against a book is the
//! caller's job. Anything off the dialect parses to `None`.

/// One element step: a name and its 1-based index among same-name siblings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Step {
    pub name: String,
    pub index: u32,
}

/// The text step closing a pointer: the k-th text node and a character offset.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct TextStep {
    pub index: u32,
    pub offset: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct XPointer {
    /// 1-based spine item; `None` for the bare `DocFragment` of a one-item spine.
    pub fragment: Option<u32>,
    /// Element steps below the document's `<body>`.
    pub steps: Vec<Step>,
    /// `None` for an element-final pointer.
    pub text: Option<TextStep>,
}

/// Parse a pointer; `None` for anything outside the dialect.
pub(super) fn parse(raw: &str) -> Option<XPointer> {
    let rest = raw.strip_prefix("/body/DocFragment")?;
    let (fragment, rest) = match rest.strip_prefix('[') {
        Some(bracketed) => {
            let (n, rest) = bracketed.split_once(']')?;
            (Some(positive(n)?), rest)
        }
        None => (None, rest),
    };
    let rest = rest.strip_prefix("/body")?;
    if rest.is_empty() {
        return Some(XPointer {
            fragment,
            steps: Vec::new(),
            text: None,
        });
    }
    let mut segments: Vec<&str> = rest.strip_prefix('/')?.split('/').collect();
    let last = segments.pop()?;
    let (last, offset) = match last.split_once('.') {
        Some((head, off)) => (head, Some(digits(off)?)),
        None => (last, None),
    };
    let mut steps = segments
        .into_iter()
        .map(parse_step)
        .collect::<Option<Vec<_>>>()?;
    let text = match last.strip_prefix("text()") {
        Some(index) => Some(TextStep {
            index: bracket_index(index)?,
            offset: offset.unwrap_or(0),
        }),
        None => {
            // An element can only end in `.0`; any other offset is a point inside it.
            if offset.unwrap_or(0) != 0 {
                return None;
            }
            steps.push(parse_step(last)?);
            None
        }
    };
    Some(XPointer {
        fragment,
        steps,
        text,
    })
}

/// Format the canonical pointer: the caller decides which indexes are omitted.
pub(super) fn format(
    fragment: Option<u32>,
    steps: &[(String, Option<u32>)],
    text: Option<(Option<u32>, u32)>,
) -> String {
    let mut out = String::from("/body/DocFragment");
    if let Some(n) = fragment {
        out.push_str(&format!("[{n}]"));
    }
    out.push_str("/body");
    for (name, index) in steps {
        out.push_str(&format!("/{name}"));
        if let Some(i) = index {
            out.push_str(&format!("[{i}]"));
        }
    }
    if let Some((index, offset)) = text {
        out.push_str("/text()");
        if let Some(k) = index {
            out.push_str(&format!("[{k}]"));
        }
        out.push_str(&format!(".{offset}"));
    }
    out
}

fn parse_step(segment: &str) -> Option<Step> {
    let (name, index) = match segment.split_once('[') {
        Some((name, rest)) => (name, positive(rest.strip_suffix(']')?)?),
        None => (segment, 1),
    };
    is_name(name).then(|| Step {
        name: name.to_owned(),
        index,
    })
}

/// An element name the dialect can carry: a letter, then letters and digits.
pub(super) fn is_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric())
}

/// `""` is index 1; `"[k]"` is k.
fn bracket_index(rest: &str) -> Option<u32> {
    if rest.is_empty() {
        return Some(1);
    }
    positive(rest.strip_prefix('[')?.strip_suffix(']')?)
}

fn positive(s: &str) -> Option<u32> {
    digits(s).filter(|n| *n > 0)
}

/// Unsigned decimal digits only, so `+3` and `-0` never parse.
fn digits(s: &str) -> Option<u32> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}
