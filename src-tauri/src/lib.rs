// Sitcomify Tauri 2 shell.
//
// All real product logic lives in the React app. This Rust side only
// wires plugins (fs, dialog, opener, http) so the frontend's Publisher
// can write the local outbox to disk under $APPDATA/sitcomify/outbox.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .run(tauri::generate_context!())
        .expect("error while running Sitcomify");
}
