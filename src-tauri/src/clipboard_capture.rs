// Native Windows clipboard capture — polls GetClipboardSequenceNumber
// (a counter the OS bumps on every clipboard change) on its own thread
// instead of the message-only-window + AddClipboardFormatListener dance,
// since a numeric compare on a cheap system call needs none of the WndProc/
// RegisterClass plumbing uia_capture.rs needs SetWinEventHook for. Sub-
// second latency on a background capture feature is not observable.
//
// Off by default, same as every other capture source — see Settings for the
// opt-in toggle. Raw clipboard content is the single most sensitive thing
// this app could passively collect (password managers, banking details,
// one-time codes all pass through it), so this is deliberately more
// cautious than UIA text capture:
//   - Skips any clip carrying the "ExcludeClipboardContentFromMonitoring"
//     format, which password managers (Windows' own suggestions, Bitwarden,
//     1Password, KeePass, ...) register specifically so clipboard
//     monitors/history tools leave that clip alone.
//   - Text only — never touches CF_BITMAP/CF_HDROP/other clipboard formats.
//   - Same password-shaped-token redaction as UIA (crate::capture_redact),
//     applied before the payload is ever constructed.
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::core::PCWSTR;
use windows::Win32::Foundation::HGLOBAL;
use windows::Win32::System::DataExchange::{
    CloseClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable,
    OpenClipboard, RegisterClipboardFormatW,
};
use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
use windows::Win32::System::Ole::CF_UNICODETEXT;

use crate::capture_redact::redact;

const POLL_INTERVAL: Duration = Duration::from_millis(500);
const EXCLUDE_FORMAT_NAME: &str = "ExcludeClipboardContentFromMonitorProcessing";

#[derive(Serialize, Clone)]
struct ClipboardCapturePayload {
    content: String,
    timestamp_ms: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// Reads CF_UNICODETEXT off the clipboard, if present and not marked
// exclude-from-monitoring. None covers every "nothing to capture" case
// (no text on the clipboard, clipboard busy/locked by another app, the
// owning app opted this clip out) so the caller doesn't need to distinguish
// them — none of them are errors worth logging.
fn read_clipboard_text(exclude_format: u32) -> Option<String> {
    unsafe {
        if IsClipboardFormatAvailable(exclude_format).is_ok() {
            return None;
        }
        OpenClipboard(None).ok()?;
        let result = (|| {
            let handle = GetClipboardData(CF_UNICODETEXT.0 as u32).ok()?;
            let hglobal = HGLOBAL(handle.0 as *mut core::ffi::c_void);
            let ptr = GlobalLock(hglobal) as *const u16;
            if ptr.is_null() {
                return None;
            }
            let mut len = 0usize;
            while *ptr.add(len) != 0 {
                len += 1;
            }
            let text = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
            let _ = GlobalUnlock(hglobal);
            Some(text)
        })();
        let _ = CloseClipboard();
        result
    }
}

static CAPTURE_RUNNING: AtomicBool = AtomicBool::new(false);
static STOP_REQUESTED: AtomicBool = AtomicBool::new(false);
static LAST_SEQUENCE: AtomicU32 = AtomicU32::new(0);
static APP_HANDLE: Mutex<Option<AppHandle>> = Mutex::new(None);

/// Starts the polling thread. Idempotent — a second call while already
/// running is a no-op.
pub fn start(app: AppHandle) {
    if CAPTURE_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    STOP_REQUESTED.store(false, Ordering::SeqCst);
    if let Ok(mut guard) = APP_HANDLE.lock() {
        *guard = Some(app);
    }
    // Start from whatever's already on the clipboard as the baseline —
    // otherwise the very first poll would treat pre-existing clipboard
    // content as a brand-new change and emit it.
    LAST_SEQUENCE.store(unsafe { GetClipboardSequenceNumber() }, Ordering::SeqCst);

    thread::spawn(|| {
        let exclude_format_name: Vec<u16> = EXCLUDE_FORMAT_NAME
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let exclude_format =
            unsafe { RegisterClipboardFormatW(PCWSTR(exclude_format_name.as_ptr())) };

        while !STOP_REQUESTED.load(Ordering::SeqCst) {
            thread::sleep(POLL_INTERVAL);

            let seq = unsafe { GetClipboardSequenceNumber() };
            if seq == LAST_SEQUENCE.load(Ordering::SeqCst) {
                continue;
            }
            LAST_SEQUENCE.store(seq, Ordering::SeqCst);

            let Some(text) = read_clipboard_text(exclude_format) else {
                continue;
            };
            let trimmed = text.trim();
            if trimmed.is_empty() {
                continue;
            }

            let payload = ClipboardCapturePayload {
                content: redact(trimmed),
                timestamp_ms: now_ms(),
            };
            if let Ok(app_guard) = APP_HANDLE.lock() {
                if let Some(app) = app_guard.as_ref() {
                    let _ = app.emit("clipboard-capture", payload);
                }
            }
        }

        CAPTURE_RUNNING.store(false, Ordering::SeqCst);
    });
}

/// Stops the polling thread if running. Safe to call when not running —
/// the thread notices STOP_REQUESTED on its next wake (at most
/// POLL_INTERVAL later) and exits on its own.
pub fn stop() {
    STOP_REQUESTED.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn start_clipboard_capture(app: AppHandle) {
    start(app);
}

#[tauri::command]
pub fn stop_clipboard_capture() {
    stop();
}
