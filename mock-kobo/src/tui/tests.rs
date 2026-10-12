//! `take_finished_jobs`: how the loop takes in the jobs that ended since the last tick.

use super::*;

#[test]
fn take_finished_jobs_finishes_app_with_status() {
    let mut app = App {
        busy: true,
        ..App::default()
    };
    let (sender, receiver) = mpsc::channel::<Finished>();
    sender
        .send(Ok(Status::Info("sync complete".to_owned())))
        .unwrap();

    take_finished_jobs(&mut app, &receiver).unwrap();

    assert_eq!(app.status, Some(Status::Info("sync complete".to_owned())));
    assert!(!app.busy);
}

#[tokio::test]
async fn take_finished_jobs_returns_error_when_job_panicked() {
    let mut app = App {
        busy: true,
        ..App::default()
    };
    let panicked = tokio::spawn(async {
        panic!("job blew up");
    })
    .await
    .unwrap_err();
    let (sender, receiver) = mpsc::channel::<Finished>();
    sender.send(Err(panicked)).unwrap();

    let error = take_finished_jobs(&mut app, &receiver).unwrap_err();

    assert!(error.to_string().starts_with("a job failed: "), "{error}");
}
