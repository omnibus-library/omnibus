//! The fake ntfy at `/ntfy`: JSON publishing, as an ntfy server under that sub-path takes
//! it, so a notification connection points at `<mock>/ntfy`. Every publish is recorded with
//! what it carried and how it was answered, refused ones included, so a developer, a tour or
//! a test reads exactly what the server sent; the control API lists the record and can make
//! the next publishes fail. A publish must sign in with [`NTFY_TOKEN`] or the fake clients'
//! login, as on a server that requires sign-in: none is refused 403, a wrong one 401.
//! Refusals carry ntfy's own JSON error shape, and a refused body's readable fields are
//! still recorded.

use std::collections::VecDeque;
use std::num::NonZeroU32;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::{Shared, CLIENT_PASSWORD, CLIENT_USERNAME, NTFY_TOKEN};

/// Where the fake ntfy is served, so a connection's server URL is the mock's origin plus this.
pub const PATH: &str = "/ntfy";

/// The most publishes the record keeps; the oldest go first.
pub const MAX_RECORDED: usize = 200;

/// The publish route, with and without a trailing slash.
pub fn routes() -> Router<Shared> {
    Router::new()
        .route(PATH, post(publish))
        .route(&format!("{PATH}/"), post(publish))
}

/// A failure the control API can make publishes answer with.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Failure {
    /// A 500, which the server retries.
    ServerError,
    /// A 429, which the server retries.
    RateLimited,
    /// A 401, which the server gives up on at once.
    Unauthorized,
}

/// What publishes are answered with, as the control API last set it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Forcing {
    /// The failure to answer with; `None` answers normally.
    pub fail: Option<Failure>,
    /// How many more publishes get it; `None` for every one until reset.
    pub times: Option<NonZeroU32>,
    /// Seconds sent as `Retry-After` with the failure.
    pub retry_after: Option<u32>,
}

/// How a publish signed in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Scheme {
    /// No `Authorization` header.
    None,
    /// `Bearer <token>`.
    Bearer,
    /// `Basic <base64 of user:password>`.
    Basic,
    /// An `Authorization` header of any other scheme.
    Other,
}

/// The sign-in a publish carried.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Auth {
    /// The `Authorization` header's scheme.
    pub scheme: Scheme,
    /// Whether it is [`NTFY_TOKEN`] or the fake clients' login.
    pub matched: bool,
    /// The `Authorization` header as sent: reading exactly what arrived is what the fake is for.
    pub header: Option<String>,
}

/// One publish as received, and how it was answered.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Published {
    /// The message id, also given to a refused publish.
    pub id: String,
    /// When it arrived, in Unix seconds.
    pub at: i64,
    /// The status it was answered with.
    pub status: u16,
    /// The `error` of a refusal; `None` when it was accepted.
    pub error: Option<String>,
    /// The sign-in it carried.
    pub auth: Auth,
    /// The body's `topic`. Each body field is `None` when the body didn't hold it, or held
    /// something of the wrong type there.
    pub topic: Option<String>,
    /// The body's `title`.
    pub title: Option<String>,
    /// The body's `message`.
    pub message: Option<String>,
    /// The body's `priority`, kept even when it is out of ntfy's range.
    pub priority: Option<i64>,
    /// The body's `tags`.
    pub tags: Option<Vec<String>>,
    /// The body's `click` link.
    pub click: Option<String>,
}

/// The fake ntfy's state: the publishes received, oldest first, and what the next are
/// answered with.
#[derive(Debug, Default)]
pub struct Inbox {
    received: VecDeque<Published>,
    forcing: Forcing,
    next_id: u64,
}

impl Inbox {
    /// Every publish kept, oldest first.
    pub fn received(&self) -> &VecDeque<Published> {
        &self.received
    }

    /// What publishes are answered with now.
    pub fn forcing(&self) -> Forcing {
        self.forcing
    }

    /// Answer publishes as `forcing` says; one with no `fail` answers them normally again.
    pub fn force(&mut self, forcing: Forcing) {
        self.forcing = if forcing.fail.is_some() {
            forcing
        } else {
            Forcing::default()
        };
    }

    /// Forget every publish received; what they are answered with stays.
    pub fn clear(&mut self) {
        self.received.clear();
    }

    /// The failure this publish is answered with and its `Retry-After`, counted off `times`.
    pub fn take_failure(&mut self) -> Option<(Failure, Option<u32>)> {
        let Forcing {
            fail,
            times,
            retry_after,
        } = self.forcing;
        let fail = fail?;
        if let Some(times) = times {
            self.forcing.times = NonZeroU32::new(times.get() - 1);
            if self.forcing.times.is_none() {
                self.forcing = Forcing::default();
            }
        }
        Some((fail, retry_after))
    }

    /// Keep `published`, dropping the oldest past [`MAX_RECORDED`].
    pub fn record(&mut self, published: Published) {
        if self.received.len() == MAX_RECORDED {
            self.received.pop_front();
        }
        self.received.push_back(published);
    }

    /// A message id no earlier publish was given.
    pub fn next_id(&mut self) -> String {
        self.next_id += 1;
        format!("mock{:08}", self.next_id)
    }
}

/// The publish JSON fields the fake reads; ntfy's others are taken and ignored.
#[derive(Default)]
struct Body {
    topic: Option<String>,
    title: Option<String>,
    message: Option<String>,
    priority: Option<i64>,
    tags: Option<Vec<String>>,
    click: Option<String>,
}

impl Body {
    /// The fields of `bytes`, and how ntfy refuses them, if it does. A field of the wrong type
    /// is left out and the rest still read, so the record shows what arrived.
    fn read(bytes: &[u8]) -> (Self, Option<Refusal>) {
        let Ok(Value::Object(fields)) = serde_json::from_slice(bytes) else {
            return (Self::default(), Some(NOT_JSON));
        };
        let text = |v: &Value| v.as_str().map(str::to_string);
        let tags = |v: &Value| {
            let tags = v.as_array()?.iter().map(|t| t.as_str().map(str::to_string));
            tags.collect::<Option<Vec<_>>>()
        };
        let topic = field(&fields, "topic", text);
        let title = field(&fields, "title", text);
        let message = field(&fields, "message", text);
        let priority = field(&fields, "priority", Value::as_i64);
        let tags = field(&fields, "tags", tags);
        let click = field(&fields, "click", text);
        let wrong_type = topic.is_err()
            || title.is_err()
            || message.is_err()
            || priority.is_err()
            || tags.is_err()
            || click.is_err();
        let body = Self {
            topic: topic.ok().flatten(),
            title: title.ok().flatten(),
            message: message.ok().flatten(),
            priority: priority.ok().flatten(),
            tags: tags.ok().flatten(),
            click: click.ok().flatten(),
        };
        let refusal = if wrong_type {
            Some(NOT_JSON)
        } else if !body.topic.as_deref().is_some_and(topic_ok) {
            Some(BAD_TOPIC)
        } else if body.priority.is_some_and(|p| !(0..=5).contains(&p)) {
            Some(BAD_PRIORITY)
        } else {
            None
        };
        (body, refusal)
    }
}

/// Field `name` of `fields` read by `read`: `Ok(None)` when absent or null, `Err` when it
/// holds something `read` can't take.
fn field<T>(
    fields: &Map<String, Value>,
    name: &str,
    read: impl Fn(&Value) -> Option<T>,
) -> Result<Option<T>, ()> {
    match fields.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => read(value).map(Some).ok_or(()),
    }
}

/// A refusal, with the code and words ntfy answers it with.
struct Refusal {
    status: StatusCode,
    code: u32,
    error: &'static str,
}

const UNAUTHORIZED: Refusal = Refusal {
    status: StatusCode::UNAUTHORIZED,
    code: 40101,
    error: "unauthorized",
};
const FORBIDDEN: Refusal = Refusal {
    status: StatusCode::FORBIDDEN,
    code: 40301,
    error: "forbidden",
};
const RATE_LIMITED: Refusal = Refusal {
    status: StatusCode::TOO_MANY_REQUESTS,
    code: 42901,
    error: "limit reached: too many requests",
};
const SERVER_ERROR: Refusal = Refusal {
    status: StatusCode::INTERNAL_SERVER_ERROR,
    code: 50001,
    error: "internal server error",
};
const NOT_JSON: Refusal = Refusal {
    status: StatusCode::BAD_REQUEST,
    code: 40017,
    error: "invalid request: request body must be message JSON",
};
const BAD_TOPIC: Refusal = Refusal {
    status: StatusCode::BAD_REQUEST,
    code: 40009,
    error: "invalid request: topic invalid",
};
const BAD_PRIORITY: Refusal = Refusal {
    status: StatusCode::BAD_REQUEST,
    code: 40007,
    error: "invalid request: priority invalid",
};

/// `POST /ntfy`: record the publish, then answer it as forced, else as ntfy would.
async fn publish(State(mock): State<Shared>, headers: HeaderMap, body: Bytes) -> Response {
    let auth = auth_of(&headers);
    let (body, body_refusal) = Body::read(&body);
    let mut inbox = mock.ntfy();
    let forced = inbox.take_failure();
    // ntfy signs a publish in before it reads the body.
    let refusal = match forced {
        Some((Failure::ServerError, _)) => Some(SERVER_ERROR),
        Some((Failure::RateLimited, _)) => Some(RATE_LIMITED),
        Some((Failure::Unauthorized, _)) => Some(UNAUTHORIZED),
        None if auth.scheme == Scheme::None => Some(FORBIDDEN),
        None if !auth.matched => Some(UNAUTHORIZED),
        None => body_refusal,
    };
    let published = Published {
        id: inbox.next_id(),
        at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs() as i64),
        status: refusal.as_ref().map_or(200, |r| r.status.as_u16()),
        error: refusal.as_ref().map(|r| r.error.to_string()),
        auth,
        topic: body.topic,
        title: body.title,
        message: body.message,
        priority: body.priority,
        tags: body.tags,
        click: body.click,
    };
    inbox.record(published.clone());
    drop(inbox);
    match refusal {
        Some(refusal) => refused(&refusal, forced.and_then(|(_, after)| after)),
        None => Json(echo(&published)).into_response(),
    }
}

/// ntfy's error body for `refusal`, with `Retry-After` when one is set.
fn refused(refusal: &Refusal, retry_after: Option<u32>) -> Response {
    let body = Json(json!({
        "code": refusal.code,
        "http": refusal.status.as_u16(),
        "error": refusal.error,
    }));
    let mut response = (refusal.status, body).into_response();
    if let Some(secs) = retry_after {
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, secs.into());
    }
    response
}

/// The message as ntfy answers a publish with it, leaving out what the body didn't set.
fn echo(published: &Published) -> Value {
    let mut echo = Map::new();
    echo.insert("id".into(), json!(published.id));
    echo.insert("time".into(), json!(published.at));
    echo.insert("event".into(), json!("message"));
    let fields = [
        ("topic", json!(published.topic)),
        ("title", json!(published.title)),
        ("message", json!(published.message)),
        ("priority", json!(published.priority)),
        ("tags", json!(published.tags)),
        ("click", json!(published.click)),
    ];
    for (name, value) in fields.into_iter().filter(|(_, v)| !v.is_null()) {
        echo.insert(name.into(), value);
    }
    Value::Object(echo)
}

/// ntfy's topic rule: 1 to 64 of `A-Z`, `a-z`, `0-9`, `-` and `_`.
fn topic_ok(topic: &str) -> bool {
    let allowed = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_';
    (1..=64).contains(&topic.len()) && topic.chars().all(allowed)
}

fn auth_of(headers: &HeaderMap) -> Auth {
    let header = headers
        .get(header::AUTHORIZATION)
        .map(|v| String::from_utf8_lossy(v.as_bytes()).into_owned());
    let (scheme, matched) = match header.as_deref().map(|h| h.split_once(' ')) {
        None => (Scheme::None, false),
        Some(Some((scheme, value))) if scheme.eq_ignore_ascii_case("bearer") => {
            (Scheme::Bearer, value.trim() == NTFY_TOKEN)
        }
        Some(Some((scheme, value))) if scheme.eq_ignore_ascii_case("basic") => {
            let login = format!("{CLIENT_USERNAME}:{CLIENT_PASSWORD}");
            let decoded = STANDARD.decode(value.trim()).unwrap_or_default();
            (Scheme::Basic, decoded == login.as_bytes())
        }
        Some(_) => (Scheme::Other, false),
    };
    Auth {
        scheme,
        matched,
        header,
    }
}

#[cfg(test)]
mod tests;
