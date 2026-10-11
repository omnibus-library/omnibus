//! Outbox coalescing, temp-id lifecycle, and optimistic-apply tests. Tests
//! that touch the process-global store/queue serialize on
//! `sync::test_state_lock` and start by clearing the ops table.

// The state-lock guard is deliberately held across awaits: it serializes
// whole async test bodies against process-global state, and each test owns
// its own thread + runtime, so there is no interleaving to deadlock on.
#![allow(clippy::await_holding_lock)]

use crate::offline::store;
use crate::offline::sync::test_state_lock;

use super::*;

mod account;
mod bookmarks;
mod highlights;
mod journals;
mod ops;
mod shelf_filters;
mod shelves;

async fn clear_ops() {
    let st = store::store().expect("test store");
    let ids: Vec<i64> = st.ops_list().await.into_iter().map(|o| o.id).collect();
    st.ops_delete_many(ids).await;
}
