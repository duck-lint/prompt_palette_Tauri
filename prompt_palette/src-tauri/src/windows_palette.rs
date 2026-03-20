use crate::AppState;
use std::{ffi::c_void, mem::size_of, thread, time::Duration};
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::{
    Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND},
    System::{
        DataExchange::{
            CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable,
            OpenClipboard, SetClipboardData,
        },
        Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE},
        Ole::CF_UNICODETEXT,
        Threading::{AttachThreadInput, GetCurrentThreadId},
    },
    UI::{
        Input::KeyboardAndMouse::{
            GetAsyncKeyState, RegisterHotKey, SendInput, UnregisterHotKey, INPUT, INPUT_0,
            INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, MOD_ALT, MOD_CONTROL, VIRTUAL_KEY,
            VK_CONTROL, VK_MENU, VK_SPACE,
        },
        WindowsAndMessaging::{
            GetForegroundWindow, GetMessageW, GetWindowThreadProcessId, IsIconic, IsWindow,
            SetForegroundWindow, ShowWindow, MSG, SW_RESTORE, WM_HOTKEY,
        },
    },
};

const HOTKEY_ID: i32 = 0x5041;
const MAIN_WINDOW_LABEL: &str = "main";
const SHOW_EVENT: &str = "palette://show";
const HOTKEY_ERROR_EVENT: &str = "palette://hotkey-error";
const HIDE_SETTLE_DELAY: Duration = Duration::from_millis(80);
const CLIPBOARD_RESTORE_DELAY: Duration = Duration::from_millis(220);
const HOTKEY_RELEASE_POLL_DELAY: Duration = Duration::from_millis(12);

pub fn spawn_hotkey_listener(app: AppHandle, state: AppState) {
    thread::spawn(move || {
        if let Err(error) = run_hotkey_loop(app.clone(), state) {
            let fallback_handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Some(window) = fallback_handle.get_webview_window(MAIN_WINDOW_LABEL) {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit(SHOW_EVENT, ());
                    let _ = window.emit(HOTKEY_ERROR_EVENT, error);
                }
            });
        }
    });
}

pub fn captured_target(state: &AppState) -> Result<HWND, String> {
    let stored = state
        .invoking_window
        .lock()
        .map_err(|_| "Window state lock poisoned.".to_string())?;

    let hwnd = HWND(stored.ok_or_else(|| {
        "Open the palette from another app so there is a target window to paste back into."
            .to_string()
    })? as *mut c_void);

    if !unsafe { IsWindow(Some(hwnd)).as_bool() } {
        return Err(
            "Paste canceled because the original target window is no longer available.".to_string(),
        );
    }

    Ok(hwnd)
}

pub fn paste_to_captured_window(state: &AppState, text: &str) -> Result<(), String> {
    let target = captured_target(state)?;
    let previous_text = read_clipboard_text()?;

    write_clipboard_text(text)?;

    let paste_result = (|| {
        thread::sleep(HIDE_SETTLE_DELAY);
        reactivate_target_window(target)?;
        send_ctrl_v()?;
        thread::sleep(CLIPBOARD_RESTORE_DELAY);
        Ok(())
    })();

    if let Some(previous_text) = previous_text {
        let _ = write_clipboard_text(&previous_text);
    }

    paste_result
}

pub fn copy_text_to_clipboard(text: &str) -> Result<(), String> {
    write_clipboard_text(text)
}

fn run_hotkey_loop(app: AppHandle, state: AppState) -> Result<(), String> {
    unsafe {
        RegisterHotKey(
            None,
            HOTKEY_ID,
            MOD_CONTROL | MOD_ALT,
            u32::from(VK_SPACE.0),
        )
    }
    .map_err(|error| format!("Unable to register Ctrl+Alt+Space: {error}"))?;

    let mut message = MSG::default();

    loop {
        let result = unsafe { GetMessageW(&mut message, None, 0, 0) };
        if result.0 == -1 || result.0 == 0 {
            break;
        }

        if message.message == WM_HOTKEY && message.wParam.0 as i32 == HOTKEY_ID {
            capture_invoking_window(&app, &state);
            wait_for_hotkey_release();
            let _ = show_palette_window(&app);
        }
    }

    let _ = unsafe { UnregisterHotKey(None, HOTKEY_ID) };
    Ok(())
}

fn capture_invoking_window(app: &AppHandle, state: &AppState) {
    let foreground = unsafe { GetForegroundWindow() };
    if foreground.0.is_null() {
        return;
    }

    let palette_window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .and_then(|window| window.hwnd().ok());

    let next_target = match palette_window {
        Some(palette_hwnd) if foreground == palette_hwnd => state
            .invoking_window
            .lock()
            .ok()
            .and_then(|stored| stored.map(|raw| HWND(raw as *mut c_void))),
        _ => Some(foreground),
    };

    if let Some(target) = next_target {
        if let Ok(mut stored) = state.invoking_window.lock() {
            *stored = Some(target.0 as isize);
        }
    }
}

fn show_palette_window(app: &AppHandle) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window(MAIN_WINDOW_LABEL) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit(SHOW_EVENT, ());
        }
    })
    .map_err(|error| error.to_string())
}

fn wait_for_hotkey_release() {
    for _ in 0..40 {
        if !is_virtual_key_down(VK_CONTROL)
            && !is_virtual_key_down(VK_MENU)
            && !is_virtual_key_down(VK_SPACE)
        {
            break;
        }

        thread::sleep(HOTKEY_RELEASE_POLL_DELAY);
    }
}

fn is_virtual_key_down(key: VIRTUAL_KEY) -> bool {
    (unsafe { GetAsyncKeyState(i32::from(key.0)) }) < 0
}

fn reactivate_target_window(target: HWND) -> Result<(), String> {
    if !unsafe { IsWindow(Some(target)).as_bool() } {
        return Err(
            "Paste canceled because the original target window is no longer available.".to_string(),
        );
    }

    let foreground = unsafe { GetForegroundWindow() };
    let current_thread = unsafe { GetCurrentThreadId() };
    let foreground_thread = if foreground.0.is_null() {
        0
    } else {
        unsafe { GetWindowThreadProcessId(foreground, None) }
    };
    let target_thread = unsafe { GetWindowThreadProcessId(target, None) };

    let mut attached_threads = Vec::new();
    for thread_id in [foreground_thread, target_thread] {
        if thread_id != 0
            && thread_id != current_thread
            && !attached_threads.contains(&thread_id)
            && unsafe { AttachThreadInput(current_thread, thread_id, true).as_bool() }
        {
            attached_threads.push(thread_id);
        }
    }

    if unsafe { IsIconic(target).as_bool() } {
        let _ = unsafe { ShowWindow(target, SW_RESTORE) };
    }
    let _ = unsafe { SetForegroundWindow(target) };

    for thread_id in attached_threads {
        let _ = unsafe { AttachThreadInput(current_thread, thread_id, false) };
    }

    thread::sleep(Duration::from_millis(80));

    if unsafe { GetForegroundWindow() } != target {
        return Err(
            "Paste canceled because the original target window could not be reactivated."
                .to_string(),
        );
    }

    Ok(())
}

fn send_ctrl_v() -> Result<(), String> {
    let inputs = [
        keyboard_input(VK_CONTROL, false),
        keyboard_input(VIRTUAL_KEY(b'V' as u16), false),
        keyboard_input(VIRTUAL_KEY(b'V' as u16), true),
        keyboard_input(VK_CONTROL, true),
    ];

    let sent = unsafe { SendInput(&inputs, size_of::<INPUT>() as i32) };
    if sent != inputs.len() as u32 {
        return Err(
            "Paste canceled because Ctrl+V could not be sent to the target window.".to_string(),
        );
    }

    Ok(())
}

fn keyboard_input(key: VIRTUAL_KEY, key_up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                dwFlags: if key_up {
                    KEYEVENTF_KEYUP
                } else {
                    Default::default()
                },
                ..Default::default()
            },
        },
    }
}

fn read_clipboard_text() -> Result<Option<String>, String> {
    let _clipboard = ClipboardGuard::acquire()?;

    if unsafe { IsClipboardFormatAvailable(CF_UNICODETEXT.0 as u32) }.is_err() {
        return Ok(None);
    }

    let handle = unsafe { GetClipboardData(CF_UNICODETEXT.0 as u32) }
        .map_err(|error| format!("Unable to read clipboard text: {error}"))?;

    let memory = HGLOBAL(handle.0);
    let pointer = unsafe { GlobalLock(memory) } as *const u16;
    if pointer.is_null() {
        return Err("Unable to lock clipboard text.".to_string());
    }

    let size_in_bytes = unsafe { GlobalSize(memory) };
    if size_in_bytes == 0 {
        let _ = unsafe { GlobalUnlock(memory) };
        return Err("Clipboard text was empty or unreadable.".to_string());
    }

    let slice = unsafe { std::slice::from_raw_parts(pointer, size_in_bytes / size_of::<u16>()) };
    let end = slice
        .iter()
        .position(|character| *character == 0)
        .unwrap_or(slice.len());
    let text = String::from_utf16_lossy(&slice[..end]);

    let _ = unsafe { GlobalUnlock(memory) };
    Ok(Some(text))
}

fn write_clipboard_text(text: &str) -> Result<(), String> {
    let utf16: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = utf16.len() * size_of::<u16>();

    let memory = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes) }
        .map_err(|error| format!("Unable to allocate clipboard memory: {error}"))?;

    let pointer = unsafe { GlobalLock(memory) } as *mut u16;
    if pointer.is_null() {
        let _ = unsafe { GlobalFree(Some(memory)) };
        return Err("Unable to lock clipboard memory.".to_string());
    }

    unsafe {
        std::ptr::copy_nonoverlapping(utf16.as_ptr(), pointer, utf16.len());
    }

    let _ = unsafe { GlobalUnlock(memory) };

    let _clipboard = ClipboardGuard::acquire()?;
    unsafe { EmptyClipboard() }
        .map_err(|error| format!("Unable to clear the clipboard: {error}"))?;

    if let Err(error) = unsafe { SetClipboardData(CF_UNICODETEXT.0 as u32, Some(HANDLE(memory.0))) }
    {
        let _ = unsafe { GlobalFree(Some(memory)) };
        return Err(format!(
            "Unable to write prompt text to the clipboard: {error}"
        ));
    }

    Ok(())
}

struct ClipboardGuard;

impl ClipboardGuard {
    fn acquire() -> Result<Self, String> {
        for _ in 0..20 {
            if unsafe { OpenClipboard(None) }.is_ok() {
                return Ok(Self);
            }
            thread::sleep(Duration::from_millis(25));
        }

        Err("Unable to access the clipboard right now.".to_string())
    }
}

impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        let _ = unsafe { CloseClipboard() };
    }
}
