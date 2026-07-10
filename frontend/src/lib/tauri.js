// Best-effort bridge to Tauri's Rust backend — a no-op outside the desktop
// app (e.g. hosted preview in a plain browser), same fail-silent convention
// as the rest of Chronicle's optional local features. Dynamic import (not a
// static top-level one) so this module loads fine even when
// @tauri-apps/api's runtime pieces aren't available at all.
export async function invokeTauri(cmd, args) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke(cmd, args);
  } catch {
    return null;
  }
}
