//! Unit tests for `auth::login` — covers the success path that clears
//! failure counters, the per-account lockout schedule after repeated
//! failures, the post-cooldown reset that prevents instant re-lock, and
//! the unknown-user path that returns `InvalidCredentials` without
//! leaking existence via response timing.

use super::*;
use crate::auth::test_support::pool;
use crate::auth::users::create_user;
use crate::test_support::lock_account;

#[tokio::test]
async fn login_success_clears_failures() {
    let p = pool().await;
    create_user(&p, "alice", "hunter2-real-long").await.unwrap();

    // Record 2 failures, then a success, then assert counter == 0.
    let _ = verify_login(&p, "alice", "wrong!").await;
    let _ = verify_login(&p, "alice", "wrong!").await;
    let u = verify_login(&p, "alice", "hunter2-real-long")
        .await
        .unwrap();
    assert_eq!(u.username, "alice");

    let failed: i64 = sqlx::query_scalar("SELECT failed_login_count FROM users WHERE id = ?")
        .bind(u.id)
        .fetch_one(&p)
        .await
        .unwrap();
    assert_eq!(failed, 0);
}

#[tokio::test]
async fn login_locks_after_five_failures() {
    let p = pool().await;
    create_user(&p, "alice", "hunter2-real-long").await.unwrap();
    for _ in 0..5 {
        let _ = verify_login(&p, "alice", "wrong!").await;
    }
    let err = verify_login(&p, "alice", "hunter2-real-long")
        .await
        .unwrap_err();
    assert!(matches!(err, AuthError::AccountLocked { .. }));
}

#[tokio::test]
async fn login_lockout_resets_after_cooldown_elapses() {
    // Regression: once the lockout window passes, a single subsequent
    // failed attempt must NOT immediately re-lock the account (the
    // monotonic counter would otherwise stay >= LOCKOUT_MIN_AFTER).
    let p = pool().await;
    let u = create_user(&p, "alice", "hunter2-real-long").await.unwrap();
    for _ in 0..5 {
        let _ = verify_login(&p, "alice", "wrong!").await;
    }
    // Simulate lockout window elapsing by rewriting the row.
    sqlx::query("UPDATE users SET locked_until = 1 WHERE id = ?")
        .bind(u.id)
        .execute(&p)
        .await
        .unwrap();
    // One more wrong attempt must NOT relock: effective counter is 0,
    // becomes 1, still well below LOCKOUT_MIN_AFTER.
    let err = verify_login(&p, "alice", "still-wrong").await.unwrap_err();
    assert!(matches!(err, AuthError::InvalidCredentials));
    let locked: Option<i64> = sqlx::query_scalar("SELECT locked_until FROM users WHERE id = ?")
        .bind(u.id)
        .fetch_one(&p)
        .await
        .unwrap();
    assert!(locked.is_none(), "single failure must not relock");
    // And a subsequent correct password works.
    let ok = verify_login(&p, "alice", "hunter2-real-long")
        .await
        .unwrap();
    assert_eq!(ok.id, u.id);
}

#[tokio::test]
async fn login_unknown_user_returns_invalid_credentials() {
    let p = pool().await;
    create_user(&p, "alice", "hunter2-real-long").await.unwrap();
    let err = verify_login(&p, "nobody", "any-long-password")
        .await
        .unwrap_err();
    assert!(matches!(err, AuthError::InvalidCredentials));
}

/// #2596: a wrong password against a *locked* account must be
/// indistinguishable from an unknown username — same variant, so the same
/// status downstream. Otherwise five guesses reveal that the username exists.
#[tokio::test]
async fn login_on_a_locked_account_returns_invalid_credentials_for_a_wrong_password() {
    let p = pool().await;
    let u = create_user(&p, "alice", "hunter2-real-long").await.unwrap();
    lock_account(&p, u.id).await;

    let locked_wrong = verify_login(&p, "alice", "not-the-password")
        .await
        .unwrap_err();
    let unknown_user = verify_login(&p, "nobody", "not-the-password")
        .await
        .unwrap_err();

    assert!(matches!(locked_wrong, AuthError::InvalidCredentials));
    assert!(matches!(unknown_user, AuthError::InvalidCredentials));
}

/// The lockout is still enforced — it is just only *disclosed* to a caller
/// that already proved it holds the password.
#[tokio::test]
async fn login_on_a_locked_account_returns_account_locked_only_for_the_correct_password() {
    let p = pool().await;
    let u = create_user(&p, "alice", "hunter2-real-long").await.unwrap();
    let until = lock_account(&p, u.id).await;

    let err = verify_login(&p, "alice", "hunter2-real-long")
        .await
        .unwrap_err();

    assert!(
        matches!(err, AuthError::AccountLocked { until_unix } if until_unix == until),
        "got {err:?}"
    );
}

/// A guess against a locked account is counted (so the disclosure cap can be
/// reached) but must not push the window out — otherwise an attacker can keep
/// a victim locked out indefinitely.
#[tokio::test]
async fn login_on_a_locked_account_counts_the_attempt_but_never_moves_the_window() {
    let p = pool().await;
    let u = create_user(&p, "alice", "hunter2-real-long").await.unwrap();
    let until = lock_account(&p, u.id).await;

    let _ = verify_login(&p, "alice", "not-the-password").await;

    let (failed, locked): (i64, Option<i64>) =
        sqlx::query_as("SELECT failed_login_count, locked_until FROM users WHERE id = ?")
            .bind(u.id)
            .fetch_one(&p)
            .await
            .unwrap();
    assert_eq!(locked, Some(until), "the window must not move");
    assert_eq!(
        failed,
        LOCKOUT_MIN_AFTER + 1,
        "the attempt must still be counted"
    );
}

/// Past the disclosure cap, even the correct password answers generically —
/// otherwise the window itself becomes brute-forceable by exhausting the
/// disclosure budget with wrong guesses first.
#[tokio::test]
async fn login_stops_disclosing_a_lockout_after_the_disclosure_cap() {
    let p = pool().await;
    let u = create_user(&p, "alice", "hunter2-real-long").await.unwrap();

    // Spend the whole disclosure budget on wrong guesses against a fresh
    // lock, then even the correct password answers generically. The
    // pre-cap disclosure itself is covered by
    // `login_on_a_locked_account_returns_account_locked_only_for_the_correct_password`.
    lock_account(&p, u.id).await;
    for _ in 0..LOCKOUT_DISCLOSURE_ATTEMPTS {
        let _ = verify_login(&p, "alice", "still-wrong").await;
    }
    let err = verify_login(&p, "alice", "hunter2-real-long")
        .await
        .unwrap_err();
    assert!(matches!(err, AuthError::InvalidCredentials), "got {err:?}");
}

#[tokio::test]
async fn login_corrupted_password_hash_returns_crypto_error() {
    // Regression: a corrupted `password_hash` column (e.g. disk
    // corruption, a bad migration) must surface as a deliberate
    // `Crypto` error rather than panicking or silently granting access.
    let p = pool().await;
    let u = create_user(&p, "alice", "hunter2-real-long").await.unwrap();
    sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?")
        .bind("not-a-valid-phc-string")
        .bind(u.id)
        .execute(&p)
        .await
        .unwrap();
    let err = verify_login(&p, "alice", "hunter2-real-long")
        .await
        .unwrap_err();
    assert!(matches!(err, AuthError::Crypto(_)));
}

/// The disclosure cap is reserved atomically, so a batch of concurrent
/// correct-password attempts against a fresh lock learns of it exactly
/// `LOCKOUT_DISCLOSURE_ATTEMPTS` times, whatever the interleaving.
#[tokio::test]
async fn login_disclosure_cap_holds_under_concurrent_attempts() {
    let p = pool().await;
    let u = create_user(&p, "alice", "hunter2-real-long").await.unwrap();
    lock_account(&p, u.id).await;

    let attempts = (LOCKOUT_DISCLOSURE_ATTEMPTS + 5) as usize;
    let handles: Vec<_> = (0..attempts)
        .map(|_| {
            let p = p.clone();
            tokio::spawn(async move { verify_login(&p, "alice", "hunter2-real-long").await })
        })
        .collect();
    let mut disclosed = 0;
    for h in handles {
        if matches!(h.await.unwrap(), Err(AuthError::AccountLocked { .. })) {
            disclosed += 1;
        }
    }
    assert_eq!(disclosed as i64, LOCKOUT_DISCLOSURE_ATTEMPTS);
}
