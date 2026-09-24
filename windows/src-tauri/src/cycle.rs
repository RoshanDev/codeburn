//! Per-provider totals for the quota window the Capacity Dock's ball measures, from the
//! moment that window last reset. The dock works out the start from the window's label and
//! reset time; this runs `codeburn status --format providers-json --since <start>` for it.
//!
//! A run parses the whole window, which takes seconds, so answers are kept per start for a
//! few minutes and runs go one at a time: two cards opened in a row never race two parses.

use serde_json::Value;
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// How long an answer stands in for a fresh run. A cycle is hours to weeks long, so a few
/// minutes of lag is invisible, while a run per hover would not be.
const FRESH_FOR: Duration = Duration::from_secs(180);

#[derive(Default)]
pub struct CycleCache {
    entries: Mutex<HashMap<String, (Instant, Value)>>,
}

impl CycleCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// The cached answer for `since` when it is still fresh, else the result of `run`. The
    /// lock is held across the run on purpose: it is what serialises the parses, and a
    /// second caller for the same start finds the first one's answer when it gets in.
    pub async fn get_or_run<F, Fut>(&self, since: &str, run: F) -> Result<Value, String>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<Value, String>>,
    {
        let mut entries = self.entries.lock().await;
        if let Some((at, value)) = entries.get(since) {
            if at.elapsed() < FRESH_FOR {
                return Ok(value.clone());
            }
        }
        let value = run().await?;
        // A reset moves every start on, so older starts are never asked for again.
        entries.retain(|_, (at, _)| at.elapsed() < FRESH_FOR * 4);
        entries.insert(since.to_string(), (Instant::now(), value.clone()));
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn a_fresh_answer_is_served_without_another_run() {
        let cache = CycleCache::new();
        let runs = AtomicUsize::new(0);
        for _ in 0..3 {
            let value = cache
                .get_or_run("2026-09-19T03:00:00Z", || async {
                    runs.fetch_add(1, Ordering::SeqCst);
                    Ok(json!({ "providerDetails": [] }))
                })
                .await
                .unwrap();
            assert!(value["providerDetails"].is_array());
        }
        assert_eq!(runs.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn each_start_has_its_own_answer_and_a_failure_is_not_kept() {
        let cache = CycleCache::new();
        let err = cache
            .get_or_run("2026-09-19T03:00:00Z", || async { Err("boom".to_string()) })
            .await;
        assert!(err.is_err());
        let a = cache
            .get_or_run("2026-09-19T03:00:00Z", || async { Ok(json!(1)) })
            .await
            .unwrap();
        let b = cache
            .get_or_run("2026-09-01T00:00:00Z", || async { Ok(json!(2)) })
            .await
            .unwrap();
        assert_eq!((a, b), (json!(1), json!(2)));
    }

    #[test]
    fn only_a_whole_utc_minute_reaches_the_cli() {
        use crate::cli::is_utc_minute;
        assert!(is_utc_minute("2026-09-19T03:00:00Z"));
        assert!(!is_utc_minute("2026-09-19T03:00:59Z"));
        assert!(!is_utc_minute("2026-09-19T03:00:00+08:00"));
        assert!(!is_utc_minute("2026-09-19"));
        assert!(!is_utc_minute("2026-09-19T03:00:00Z; rm"));
    }
}
