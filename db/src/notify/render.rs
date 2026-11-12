//! Turning a notice into the HTTP request one connection's provider takes. Pure: no I/O and
//! no clock, so the outbox, the test route and the tests all see the same request. Each
//! provider owns one render function from a [`Notice`]; this module only dispatches.

use std::fmt;

use super::event::Event;
use super::ntfy;
use super::settings::ConnectionSettings;

/// What a message says, whatever carries it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notice {
    pub title: String,
    pub message: String,
    /// The page a tap opens; `None` when no public URL is set.
    pub click: Option<String>,
}

impl Notice {
    /// The test message, linking to the public URL when one is set.
    pub fn test(public_url: Option<&str>) -> Self {
        Self {
            title: "Test notification from Omnibus".to_string(),
            message: "This is a test. Notifications from Omnibus will arrive here.".to_string(),
            click: public_url.map(str::to_string),
        }
    }
}

/// One HTTP request to a provider, ready to send.
#[derive(Clone)]
pub struct Outgoing {
    /// The provider's name as an admin-facing message says it, such as `ntfy`.
    pub provider: &'static str,
    pub method: reqwest::Method,
    pub url: String,
    pub headers: Vec<(&'static str, String)>,
    pub body: String,
    /// Every form of the credentials this request carries that a provider might echo back,
    /// so none reaches the log line a failed send writes.
    pub secrets: Vec<String>,
}

impl Outgoing {
    /// The value of header `name`, matched without regard to case.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

// Hand-written: a header can carry a credential, and a later provider's URL may be one.
impl fmt::Debug for Outgoing {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let names: Vec<&str> = self.headers.iter().map(|(name, _)| *name).collect();
        f.debug_struct("Outgoing")
            .field("provider", &self.provider)
            .field("method", &self.method)
            .field("headers", &names)
            .field("body_len", &self.body.len())
            .finish_non_exhaustive()
    }
}

/// The request telling `settings`' provider about `event`, linking under `public_url`.
pub fn render(settings: &ConnectionSettings, event: &Event, public_url: Option<&str>) -> Outgoing {
    match settings {
        ConnectionSettings::Ntfy(ntfy) => {
            ntfy::render(ntfy, &event.notice(ntfy.include_details, public_url))
        }
    }
}

/// The request sending `settings`' provider the test message.
pub fn render_test(settings: &ConnectionSettings, public_url: Option<&str>) -> Outgoing {
    match settings {
        ConnectionSettings::Ntfy(ntfy) => ntfy::render(ntfy, &Notice::test(public_url)),
    }
}
