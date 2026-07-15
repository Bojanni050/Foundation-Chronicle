use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

mod capture_redact;
mod clipboard_capture;
mod ocr_capture;
mod uia_capture;
use clipboard_capture::{start_clipboard_capture, stop_clipboard_capture};
use uia_capture::{start_uia_capture, stop_uia_capture};

// Local model config — a small JSON file in the app's own config dir, since
// this is the bridge between the React settings UI (localStorage, browser
// side) and the Rust process that actually spawns the sidecar. Kept
// deliberately tiny: one field, one purpose.
#[derive(Serialize, Deserialize, Default)]
struct LocalModelConfig {
  gguf_path: Option<String>,
}

fn config_path(app: &tauri::AppHandle) -> Option<PathBuf> {
  app
    .path()
    .app_config_dir()
    .ok()
    .map(|dir| dir.join("local-model.json"))
}

fn read_config(app: &tauri::AppHandle) -> LocalModelConfig {
  config_path(app)
    .and_then(|p| fs::read_to_string(p).ok())
    .and_then(|s| serde_json::from_str(&s).ok())
    .unwrap_or_default()
}

fn write_config(app: &tauri::AppHandle, cfg: &LocalModelConfig) -> Result<(), String> {
  let path = config_path(app).ok_or("could not resolve app config dir")?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  let json = serde_json::to_string(cfg).map_err(|e| e.to_string())?;
  fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_local_model_path(app: tauri::AppHandle) -> Option<String> {
  read_config(&app).gguf_path
}

// Saves the path for next launch. Does not restart the sidecar immediately —
// take effect on next app start, same as most local-model-path settings in
// comparable tools. Kept simple on purpose.
#[tauri::command]
fn set_local_model_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
  write_config(&app, &LocalModelConfig { gguf_path: Some(path) })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Registered first, per plugin docs — if a second copy of Chronicle is
    // launched, this focuses the existing window instead of starting a
    // second instance (which would otherwise be a second, independent
    // IndexedDB consumer racing the first for the same local inbox).
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
      }
    }))
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![
      get_local_model_path,
      set_local_model_path,
      start_uia_capture,
      stop_uia_capture,
      start_clipboard_capture,
      stop_clipboard_capture
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Optional local model server (llama-server, GPU-accelerated via
      // Vulkan). Only spawns if a GGUF path has actually been configured via
      // Settings and the file exists — best-effort, opt-in, never required
      // for the rest of Chronicle to run.
      let gguf_path = read_config(app.handle()).gguf_path;
      match gguf_path {
        Some(path) if std::path::Path::new(&path).exists() => {
          match app.shell().sidecar("llama-server") {
            Ok(sidecar) => {
              if let Err(err) = sidecar.args(["-m", &path, "--port", "8080"]).spawn() {
                log::warn!("Local model sidecar failed to start: {err}. Local models will be unavailable until this is resolved.");
              }
            }
            Err(err) => {
              log::warn!("Local model sidecar not configured: {err}. Local models will be unavailable.");
            }
          }
        }
        Some(path) => {
          log::warn!("Configured GGUF model path does not exist: {path}. Set a valid path in Settings to enable the local model.");
        }
        None => {
          log::info!("No local GGUF model configured — local model support stays off until one is set in Settings.");
        }
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
