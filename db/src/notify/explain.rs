//! The sentence an admin reads when a send fails: in a connection's last delivery and in a
//! failed test. One per case, worded around the provider's label so a later provider reuses
//! them; never a status line or a provider's raw body. Clients show the sentence verbatim,
//! so the wording is part of the API. `deliver` picks the case; the detail behind it goes to
//! the server log instead.

use reqwest::StatusCode;

/// The longest reason of a provider's own that a 400's sentence quotes.
const PROVIDER_ERROR_MAX_CHARS: usize = 80;

/// Why a provider couldn't be reached at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unreachable {
    Timeout,
    Connect,
    Dns,
    Tls,
    /// Anything the error doesn't let us tell apart.
    Other,
}

/// What `provider`'s answer of `status` means. `provider_error` is the provider's own short
/// reason, quoted only for a 400.
pub fn refusal(provider: &str, status: StatusCode, provider_error: Option<&str>) -> String {
    let code = status.as_u16();
    match code {
        401 => format!(
            "{provider} refused the sign-in. Check the access token, or the username and password."
        ),
        403 => format!(
            "{provider} didn't let this sign-in post to the topic. Check that the token or account can write to it."
        ),
        404 => format!("Nothing at that address takes {provider} messages. Check the server URL."),
        413 => format!("{provider} refused the message as too large."),
        429 => format!("{provider} is limiting how often Omnibus can post."),
        400 => match provider_error {
            Some(reason) => format!("{provider} couldn't read the message: {reason}."),
            None => format!("{provider} couldn't read the message."),
        },
        500..=599 => format!(
            "The {provider} server had a problem and couldn't take the message (HTTP {code})."
        ),
        300..=399 => {
            "The server URL redirects elsewhere. Use the address it redirects to.".to_string()
        }
        _ => format!("{provider} refused the message (HTTP {code})."),
    }
}

/// Why `provider` couldn't be reached.
pub fn unreachable(provider: &str, why: Unreachable) -> String {
    match why {
        Unreachable::Timeout => format!("The {provider} server didn't answer in time."),
        Unreachable::Connect => format!(
            "Couldn't connect to the {provider} server. Check the server URL and that the server is running."
        ),
        Unreachable::Dns => format!("Couldn't find the {provider} server. Check the server URL."),
        Unreachable::Tls => format!(
            "Couldn't make a secure connection to the {provider} server. Check its certificate, or use http:// if the server doesn't use HTTPS."
        ),
        Unreachable::Other => format!("Couldn't reach the {provider} server."),
    }
}

/// A provider's own reason from a body that is a JSON object with a string `error`, when
/// it is a short plain phrase: at most 80 letters, digits, spaces and `,.'-`, its trailing
/// period trimmed. `None` for anything else, and for an `error` holding any of `secrets`.
pub fn provider_error(body: &str, secrets: &[String]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    let raw = value.get("error")?.as_str()?;
    let reason = raw.trim();
    let reason = reason.strip_suffix('.').unwrap_or(reason);
    let plain = |c: char| c.is_ascii_alphanumeric() || matches!(c, ' ' | ',' | '.' | '\'' | '-');
    let fits = !reason.is_empty()
        && reason.chars().count() <= PROVIDER_ERROR_MAX_CHARS
        && reason.chars().all(plain);
    // Checked before trimming: a secret ending in a space or a period, echoed last, would
    // otherwise be quoted all but its end. The quoted text is part of `raw`, so this covers it.
    let echoes_a_secret = secrets
        .iter()
        .any(|secret| !secret.is_empty() && raw.contains(secret.as_str()));
    (fits && !echoes_a_secret).then(|| reason.to_string())
}
