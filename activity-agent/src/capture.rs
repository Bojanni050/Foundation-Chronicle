pub struct FocusSnapshot {
    pub app_name: String,
    pub window_title: String,
    pub texts: Vec<String>,
}

#[cfg(windows)]
pub use windows_impl::{init, snapshot_foreground};

#[cfg(not(windows))]
pub fn init() -> Result<(), String> {
    Err("activity-agent only supports Windows (UI Automation is a Win32 API)".to_string())
}

#[cfg(not(windows))]
pub fn snapshot_foreground() -> Option<FocusSnapshot> {
    None
}

#[cfg(windows)]
mod windows_impl {
    use super::FocusSnapshot;
    use windows::Win32::Foundation::{CloseHandle, HWND, MAX_PATH};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::System::ProcessStatus::K32GetModuleBaseNameW;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, TreeScope_Descendants};
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};

    // UI Automation elements can number in the thousands on a complex window
    // (browsers, IDEs) — capped so one poll can't turn into a multi-second
    // tree walk or an unbounded text collection.
    const MAX_ELEMENTS: usize = 500;

    pub fn init() -> Result<(), String> {
        // COINIT_MULTITHREADED because this whole agent is single-threaded
        // and never touches a message loop — no need for an STA.
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|e| format!("CoInitializeEx failed: {e}"))
    }

    pub fn snapshot_foreground() -> Option<FocusSnapshot> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.0.is_null() {
            return None;
        }

        let window_title = window_text(hwnd);
        let app_name = process_name(hwnd).unwrap_or_else(|| "Onbekende app".to_string());
        let texts = ui_automation_texts(hwnd).unwrap_or_default();

        Some(FocusSnapshot { app_name, window_title, texts })
    }

    fn window_text(hwnd: HWND) -> String {
        let mut buf = [0u16; 512];
        let len = unsafe { GetWindowTextW(hwnd, &mut buf) };
        if len <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..len as usize])
    }

    fn process_name(hwnd: HWND) -> Option<String> {
        let mut pid: u32 = 0;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid == 0 {
            return None;
        }

        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; MAX_PATH as usize];
            let len = K32GetModuleBaseNameW(handle, None, &mut buf);
            let _ = CloseHandle(handle);
            if len == 0 {
                return None;
            }
            Some(String::from_utf16_lossy(&buf[..len as usize]))
        }
    }

    // Walks every descendant of the foreground window via UI Automation and
    // collects each element's Name property — the same "just grab the
    // visible strings" approach as the original uiautomation-based Python
    // sketch this agent replaces, just via the raw Win32 UIA COM API instead
    // of a wrapper library.
    fn ui_automation_texts(hwnd: HWND) -> Option<Vec<String>> {
        unsafe {
            let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
            let root = automation.ElementFromHandle(hwnd).ok()?;
            let condition = automation.CreateTrueCondition().ok()?;
            let elements = root.FindAll(TreeScope_Descendants, &condition).ok()?;

            let count = elements.Length().unwrap_or(0).max(0) as usize;
            let mut texts = Vec::new();
            for i in 0..count.min(MAX_ELEMENTS) {
                let Ok(element) = elements.GetElement(i as i32) else { continue };
                let Ok(name) = element.CurrentName() else { continue };
                let name = name.to_string();
                let trimmed = name.trim();
                if !trimmed.is_empty() {
                    texts.push(trimmed.to_string());
                }
            }
            Some(texts)
        }
    }
}
