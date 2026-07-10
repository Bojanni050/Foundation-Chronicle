use std::time::Duration;

mod capture;

use capture::FocusSnapshot;

const POLL_INTERVAL: Duration = Duration::from_secs(2);
// Safety flush for long-lived sessions (e.g. hours in the same editor
// window) — otherwise a session's text would only ever reach Chronicle once
// the user switches away, same reasoning as PureMemory's batch-on-poll
// semantics, just time-based instead of poll-based since this agent has no
// intermediate SQLite buffer to batch from.
const SAFETY_FLUSH_INTERVAL: Duration = Duration::from_secs(60);
// Keeps payloads (and the UI-Automation walk itself) bounded — a very
// text-heavy window (a long document, a giant terminal buffer) shouldn't
// balloon into a multi-megabyte POST.
const MAX_CONTENT_CHARS: usize = 20_000;

struct Session {
    app_name: String,
    window_title: String,
    lines: Vec<String>,
    started_flushing_since: std::time::Instant,
}

impl Session {
    fn new(app_name: String, window_title: String) -> Self {
        Self {
            app_name,
            window_title,
            lines: Vec::new(),
            started_flushing_since: std::time::Instant::now(),
        }
    }

    // Dedups consecutive identical lines — UI-Automation re-reports the same
    // visible text on every poll while nothing has actually changed, same
    // problem PureMemory's groupByFocusSession() worked around.
    fn absorb(&mut self, texts: Vec<String>) {
        for text in texts {
            if self.lines.last() != Some(&text) {
                self.lines.push(text);
            }
        }
    }

    fn content(&self) -> String {
        let joined = self.lines.join("\n");
        if joined.chars().count() > MAX_CONTENT_CHARS {
            joined.chars().take(MAX_CONTENT_CHARS).collect()
        } else {
            joined
        }
    }

    fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }
}

fn main() {
    let api_url = std::env::var("CHRONICLE_API_URL").unwrap_or_else(|_| "http://127.0.0.1:4577".to_string());
    let token = match std::env::var("CHRONICLE_TOKEN") {
        Ok(t) if !t.is_empty() => t,
        _ => {
            eprintln!("[activity-agent] CHRONICLE_TOKEN not set — exiting.");
            std::process::exit(1);
        }
    };

    if let Err(err) = capture::init() {
        eprintln!("[activity-agent] Capture init failed: {err} — exiting.");
        std::process::exit(1);
    }

    let mut current: Option<Session> = None;

    loop {
        std::thread::sleep(POLL_INTERVAL);

        let snapshot = match capture::snapshot_foreground() {
            Some(s) => s,
            None => continue, // no foreground window, or it failed to read — just retry next tick
        };

        let FocusSnapshot { app_name, window_title, texts } = snapshot;

        let window_changed = current
            .as_ref()
            .map(|s| s.app_name != app_name || s.window_title != window_title)
            .unwrap_or(true);

        if window_changed {
            flush(&api_url, &token, current.take());
            current = Some(Session::new(app_name, window_title));
        }

        if let Some(session) = current.as_mut() {
            session.absorb(texts);

            if session.started_flushing_since.elapsed() >= SAFETY_FLUSH_INTERVAL {
                let app_name = session.app_name.clone();
                let window_title = session.window_title.clone();
                flush(&api_url, &token, current.take());
                current = Some(Session::new(app_name, window_title));
            }
        }
    }
}

fn flush(api_url: &str, token: &str, session: Option<Session>) {
    let Some(session) = session else { return };
    if session.is_empty() {
        return;
    }

    let occurred_at = now_rfc3339();
    let body = serde_json::json!({
        "appName": session.app_name,
        "windowTitle": session.window_title,
        "content": session.content(),
        "occurredAt": occurred_at,
    });

    let url = format!("{}/api/activity/import", api_url.trim_end_matches('/'));
    let result = ureq::post(&url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Content-Type", "application/json")
        .send_json(body);

    if let Err(err) = result {
        eprintln!("[activity-agent] Failed to post activity: {err}");
    }
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}
