// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "macos")]
mod badge {
    use objc2_app_kit::NSApplication;
    use objc2_foundation::{MainThreadMarker, NSString};

    pub fn set_badge(count: u32) {
        if let Some(mtm) = MainThreadMarker::new() {
            let app = NSApplication::sharedApplication(mtm);
            let dock_tile = app.dockTile();
            if count == 0 {
                dock_tile.setBadgeLabel(None);
            } else {
                let label = NSString::from_str(&count.to_string());
                dock_tile.setBadgeLabel(Some(&label));
            }
        }
    }
}

#[tauri::command]
fn set_badge_count(count: u32) {
    #[cfg(target_os = "macos")]
    badge::set_badge(count);
    #[cfg(not(target_os = "macos"))]
    let _ = count;
}

#[tauri::command]
fn clear_badge() {
    #[cfg(target_os = "macos")]
    badge::set_badge(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![set_badge_count, clear_badge])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
