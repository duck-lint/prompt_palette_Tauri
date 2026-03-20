mod windows_palette;

use std::{
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WebviewWindow, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_SHOW_ID: &str = "tray-show";
const TRAY_QUIT_ID: &str = "tray-quit";

#[derive(Clone, Default)]
pub(crate) struct AppState {
    pub invoking_window: Arc<Mutex<Option<isize>>>,
}

#[tauri::command]
fn hide_palette(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

fn show_main_window<M: Manager<tauri::Wry>>(manager: &M) {
    if let Some(window) = manager.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("palette://show", ());
    }
}

fn build_tray(app: &tauri::App<tauri::Wry>) -> tauri::Result<()> {
    let show_item =
        MenuItem::with_id(app, TRAY_SHOW_ID, "Show Prompt Palette", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, TRAY_QUIT_ID, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &separator, &quit_item])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("Prompt Palette")
        .show_menu_on_left_click(false);

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.on_menu_event(|app, event| {
        if event.id() == TRAY_SHOW_ID {
            show_main_window(app);
        } else if event.id() == TRAY_QUIT_ID {
            app.exit(0);
        }
    })
    .on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            show_main_window(tray.app_handle());
        }
    })
    .build(app)?;

    Ok(())
}

#[tauri::command]
fn paste_rendered_prompt(
    rendered: String,
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&rendered)
        .map_err(|error| format!("JSON validation failed: {error}"))?;

    #[cfg(windows)]
    {
        windows_palette::captured_target(state.inner())?;

        window.hide().map_err(|error| error.to_string())?;
        thread::sleep(Duration::from_millis(60));

        if let Err(error) = windows_palette::paste_to_captured_window(state.inner(), &rendered) {
            let _ = window.show();
            let _ = window.set_focus();
            return Err(error);
        }

        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("External paste handoff is currently only implemented on Windows.".into())
}

#[tauri::command]
fn copy_rendered_prompt(rendered: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&rendered)
        .map_err(|error| format!("JSON validation failed: {error}"))?;

    #[cfg(windows)]
    {
        windows_palette::copy_text_to_clipboard(&rendered)?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Clipboard copy is currently only implemented on Windows.".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::default();
    let hotkey_state = state.clone();

    tauri::Builder::default()
        .manage(state)
        .on_window_event(|window, event| {
            if window.label() != MAIN_WINDOW_LABEL {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(move |app| {
            #[cfg(windows)]
            windows_palette::spawn_hotkey_listener(app.handle().clone(), hotkey_state.clone());

            build_tray(app)?;

            #[cfg(debug_assertions)]
            show_main_window(app);

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            hide_palette,
            copy_rendered_prompt,
            paste_rendered_prompt
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
