// Native Windows UI Automation activity capture — replaces PureMemory's
// external collector-agent (see server/purememoryIngest.js) with a pipeline
// built directly into Chronicle's own Tauri shell. No external process, no
// SQLite hop: this walks the UIA tree in-process and emits results straight
// to the frontend over a Tauri event.
//
// Win32 event hooks (SetWinEventHook) require a real message pump on the
// thread that registered them — that's why this runs on a dedicated OS
// thread with its own GetMessage loop, not a tokio task via
// tauri::async_runtime::spawn (which never pumps Win32 messages). This is
// the one and only precedent for a long-running background task in this
// Rust code besides the fire-and-forget llama-server sidecar, and that
// sidecar is a separate process talking over HTTP, not in-process COM.
use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::core::{Interface, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, WPARAM};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
use windows::Win32::System::Threading::{
    GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTreeWalker,
    IUIAutomationValuePattern, SetWinEventHook, UnhookWinEvent,
    HWINEVENTHOOK, UIA_DocumentControlTypeId, UIA_EditControlTypeId, UIA_TextControlTypeId,
    UIA_ValuePatternId,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    PostThreadMessageW, TranslateMessage, EVENT_SYSTEM_FOREGROUND, MSG, WINEVENT_OUTOFCONTEXT,
    WM_QUIT,
};

// Bounded so a pathological window (a huge spreadsheet, a long web page)
// can't turn one capture into a multi-second tree walk or a multi-MB
// payload. 200 nodes is generous for "what's visibly in this window" while
// staying fast.
const MAX_NODES: usize = 200;
// Re-walk the same focused window periodically, not just on focus change —
// otherwise typing more content into an already-focused app is invisible to
// this capture. Matches PureMemory's own ingest cadence (purememoryIngest.js).
const REFRESH_INTERVAL: Duration = Duration::from_secs(30);
// Skip emitting for windows focused only briefly (alt-tabbing through
// several apps) — avoids flooding the frontend with noise nobody asked for.
const MIN_FOCUS_DURATION: Duration = Duration::from_millis(800);

// A single all-caps/mixed-case/digit/symbol token with no spaces is the same
// "password-shaped" heuristic already described in this codebase's own
// clipboard-capture copy (SettingsDialog.jsx's "Store clipboard text
// content" section). No equivalent exists in Rust yet — PureMemory's version
// of this logic lives entirely in the external Go agent being replaced.
fn looks_like_password(token: &str) -> bool {
    if token.len() < 8 || token.contains(char::is_whitespace) {
        return false;
    }
    let has_upper = token.chars().any(|c| c.is_ascii_uppercase());
    let has_lower = token.chars().any(|c| c.is_ascii_lowercase());
    let has_digit = token.chars().any(|c| c.is_ascii_digit());
    let has_symbol = token.chars().any(|c| !c.is_alphanumeric());
    [has_upper, has_lower, has_digit, has_symbol]
        .iter()
        .filter(|&&b| b)
        .count()
        >= 3
}

fn redact(text: &str) -> String {
    text.split_whitespace()
        .map(|tok| if looks_like_password(tok) { "[redacted]" } else { tok })
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Serialize, Clone)]
struct UiaCapturePayload {
    app_name: String,
    window_title: String,
    captured_text: Vec<String>,
    timestamp_ms: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn get_window_text(hwnd: HWND) -> String {
    let mut buf = [0u16; 512];
    let len = unsafe { GetWindowTextW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..len.max(0) as usize])
}

// Resolves a window's owning process id to its executable's base filename
// ("chrome.exe"). Returns None for processes that can't be queried
// (protected/system processes, access denied) — same limitation PureMemory's
// equivalent Go code accepts (appwindow_windows.go's getProcessExeName).
fn get_process_name(hwnd: HWND) -> Option<String> {
    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 {
        return None;
    }
    unsafe {
        let handle: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 260];
        let mut size = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);
        if ok.is_err() {
            return None;
        }
        let full = String::from_utf16_lossy(&buf[..size as usize]);
        full.rsplit(['\\', '/']).next().map(|s| s.to_string())
    }
}

// Walks the control-view subtree of `root` breadth-first, collecting Name/
// Value text from Text/Edit/Document elements that are actually on-screen
// (non-empty BoundingRectangle). Capped at MAX_NODES so this always
// terminates quickly regardless of how large the window's UI tree is.
fn walk_visible_text(automation: &IUIAutomation, root: &IUIAutomationElement) -> Vec<String> {
    let mut results = Vec::new();
    let walker: IUIAutomationTreeWalker = match unsafe { automation.ControlViewWalker() } {
        Ok(w) => w,
        Err(_) => return results,
    };

    let mut queue: Vec<IUIAutomationElement> = vec![root.clone()];
    let mut visited = 0usize;

    while let Some(el) = queue.pop() {
        if visited >= MAX_NODES {
            break;
        }
        visited += 1;

        if let Ok(rect) = unsafe { el.CurrentBoundingRectangle() } {
            let on_screen = rect.right > rect.left && rect.bottom > rect.top;
            if on_screen {
                if let Ok(control_type) = unsafe { el.CurrentControlType() } {
                    let is_text_like = control_type == UIA_TextControlTypeId
                        || control_type == UIA_EditControlTypeId
                        || control_type == UIA_DocumentControlTypeId;
                    if is_text_like {
                        if let Ok(pattern) = unsafe { el.GetCurrentPattern(UIA_ValuePatternId) } {
                            if let Ok(value_pattern) = pattern.cast::<IUIAutomationValuePattern>() {
                                if let Ok(value) = unsafe { value_pattern.CurrentValue() } {
                                    let text = value.to_string();
                                    if !text.trim().is_empty() {
                                        results.push(redact(text.trim()));
                                    }
                                }
                            }
                        } else if let Ok(name) = unsafe { el.CurrentName() } {
                            let text: String = name.to_string();
                            if !text.trim().is_empty() {
                                results.push(redact(text.trim()));
                            }
                        }
                    }
                }
            }
        }

        // Breadth-first-ish: push children, keep going until MAX_NODES.
        if let Ok(mut child) = unsafe { walker.GetFirstChildElement(&el) } {
            loop {
                let next_sibling = unsafe { walker.GetNextSiblingElement(&child) };
                queue.push(child.clone());
                match next_sibling {
                    Ok(sibling) => child = sibling,
                    Err(_) => break,
                }
                if visited + queue.len() >= MAX_NODES {
                    break;
                }
            }
        }
    }

    results
}

fn capture_foreground(automation: &IUIAutomation, include_text: bool) -> Option<UiaCapturePayload> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_invalid() {
        return None;
    }
    let window_title = get_window_text(hwnd);
    let app_name = get_process_name(hwnd).unwrap_or_else(|| "unknown".to_string());

    let captured_text = if include_text {
        match unsafe { automation.ElementFromHandle(hwnd) } {
            Ok(root) => walk_visible_text(automation, &root),
            Err(_) => Vec::new(),
        }
    } else {
        Vec::new()
    };

    Some(UiaCapturePayload {
        app_name,
        window_title,
        captured_text,
        timestamp_ms: now_ms(),
    })
}

// Thread id of the running capture loop, so stop_uia_capture can post it a
// WM_QUIT to unwind the GetMessage loop cleanly — SetWinEventHook has no
// separate "cancel from another thread" API, the standard way to stop an
// out-of-context hook's message pump is exactly this.
static CAPTURE_THREAD_ID: AtomicU32 = AtomicU32::new(0);
static CAPTURE_RUNNING: AtomicBool = AtomicBool::new(false);
static INCLUDE_TEXT: AtomicBool = AtomicBool::new(false);
// WinEventProc has no user-data parameter, so the AppHandle has to live
// somewhere the free-function callback can reach — set once right before
// entering the message loop on the capture thread itself.
static APP_HANDLE: Mutex<Option<AppHandle>> = Mutex::new(None);
static LAST_FOCUS_AT: Mutex<Option<Instant>> = Mutex::new(None);
static LAST_HWND: AtomicU32 = AtomicU32::new(0);

thread_local! {
    // IUIAutomation (and every COM interface reachable from it) is only ever
    // created and used on the single dedicated capture thread — apartment-
    // threaded COM objects aren't safe to move across threads without
    // marshaling, so this is thread_local rather than a global static, which
    // also sidesteps needing IUIAutomation to be Send (it isn't).
    static AUTOMATION: RefCell<Option<IUIAutomation>> = const { RefCell::new(None) };
}

unsafe extern "system" fn win_event_proc(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    _id_object: i32,
    _id_child: i32,
    _id_event_thread: u32,
    _dwms_event_time: u32,
) {
    if event != EVENT_SYSTEM_FOREGROUND || hwnd.is_invalid() {
        return;
    }
    // Debounce rapid alt-tabbing: require the new window to hold focus for
    // MIN_FOCUS_DURATION before it's worth a capture. Cheap approximation:
    // sleep is not viable inside a WinEventProc (must return promptly), so
    // instead just record focus-changed-at and let the periodic tick below
    // decide whether it was held long enough.
    LAST_HWND.store(hwnd.0 as u32, Ordering::SeqCst);
    if let Ok(mut last) = LAST_FOCUS_AT.lock() {
        *last = Some(Instant::now());
    }
    emit_if_stable();
}

fn emit_if_stable() {
    let stable_since = match LAST_FOCUS_AT.lock() {
        Ok(g) => *g,
        Err(_) => return,
    };
    let Some(since) = stable_since else { return };
    if since.elapsed() < MIN_FOCUS_DURATION {
        return;
    }
    do_capture();
}

fn do_capture() {
    let include_text = INCLUDE_TEXT.load(Ordering::Relaxed);
    let payload = AUTOMATION.with(|cell| {
        let borrow = cell.borrow();
        borrow.as_ref().and_then(|automation| capture_foreground(automation, include_text))
    });
    let Some(payload) = payload else { return };

    if let Ok(app_guard) = APP_HANDLE.lock() {
        if let Some(app) = app_guard.as_ref() {
            let _ = app.emit("uia-capture", payload);
        }
    }
}

/// Starts the dedicated capture thread. Idempotent — a second call while
/// already running is a no-op rather than spawning a duplicate hook.
pub fn start(app: AppHandle, include_text: bool) {
    if CAPTURE_RUNNING.swap(true, Ordering::SeqCst) {
        // Already running — just update the text-capture flag in place.
        INCLUDE_TEXT.store(include_text, Ordering::Relaxed);
        return;
    }
    INCLUDE_TEXT.store(include_text, Ordering::Relaxed);
    if let Ok(mut guard) = APP_HANDLE.lock() {
        *guard = Some(app);
    }

    thread::spawn(|| {
        unsafe {
            if CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_err() {
                log::warn!("[UIA] CoInitializeEx failed — activity capture unavailable this session.");
                CAPTURE_RUNNING.store(false, Ordering::SeqCst);
                return;
            }
        }

        let automation: windows::core::Result<IUIAutomation> =
            unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) };
        let automation = match automation {
            Ok(a) => a,
            Err(err) => {
                log::warn!("[UIA] Could not create IUIAutomation instance: {err}. Activity capture unavailable this session.");
                unsafe { CoUninitialize() };
                CAPTURE_RUNNING.store(false, Ordering::SeqCst);
                return;
            }
        };
        AUTOMATION.with(|cell| *cell.borrow_mut() = Some(automation));

        CAPTURE_THREAD_ID.store(unsafe { GetCurrentThreadId() }, Ordering::SeqCst);

        let hook = unsafe {
            SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(win_event_proc),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            )
        };

        // Capture whatever's already focused at startup, don't wait for the
        // first focus-change event.
        if let Ok(mut last) = LAST_FOCUS_AT.lock() {
            *last = Some(Instant::now() - MIN_FOCUS_DURATION);
        }
        emit_if_stable();

        // GetMessageW blocks, but WM_QUIT (posted by stop()) unblocks it and
        // returns 0, ending the loop. A 30s timer for the "still focused,
        // re-capture" refresh piggybacks on GetMessageW's built-in timeout
        // behavior by using a real timer message instead of a plain sleep,
        // since sleeping here would also block WM_QUIT from being noticed
        // promptly.
        let mut msg = MSG::default();
        let mut last_refresh = Instant::now();
        loop {
            // Bound the wait so the loop can also check the 30s refresh
            // window even with no window messages arriving.
            let timeout_hit = !wait_for_message_or_timeout(&mut msg, Duration::from_secs(1));
            if !timeout_hit {
                if msg.message == WM_QUIT {
                    break;
                }
                unsafe {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
            if last_refresh.elapsed() >= REFRESH_INTERVAL {
                last_refresh = Instant::now();
                do_capture();
            }
        }

        if !hook.is_invalid() {
            unsafe {
                let _ = UnhookWinEvent(hook);
            }
        }
        AUTOMATION.with(|cell| *cell.borrow_mut() = None);
        unsafe { CoUninitialize() };
        CAPTURE_RUNNING.store(false, Ordering::SeqCst);
        CAPTURE_THREAD_ID.store(0, Ordering::SeqCst);
    });
}

// PeekMessage-based wait with a timeout, since GetMessageW itself has no
// timeout parameter. Returns true if a message was retrieved into `msg`,
// false if the timeout elapsed with nothing pending.
fn wait_for_message_or_timeout(msg: &mut MSG, timeout: Duration) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{PeekMessageW, PM_REMOVE};
    let deadline = Instant::now() + timeout;
    loop {
        let has_message = unsafe { PeekMessageW(msg, None, 0, 0, PM_REMOVE) };
        if has_message.as_bool() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(50));
    }
}

/// Stops the capture thread if running. Safe to call when not running.
pub fn stop() {
    let thread_id = CAPTURE_THREAD_ID.load(Ordering::SeqCst);
    if thread_id != 0 {
        unsafe {
            let _ = PostThreadMessageW(thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
    }
}

#[tauri::command]
pub fn start_uia_capture(app: AppHandle, include_text: bool) {
    start(app, include_text);
}

#[tauri::command]
pub fn stop_uia_capture() {
    stop();
}
