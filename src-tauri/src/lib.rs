use tauri::Manager;

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![read_file_bytes])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            let rgba = include_bytes!("../icons/icon.png");
            let img = image::load_from_memory(rgba).unwrap().to_rgba8();
            let (w, h) = img.dimensions();
            let icon = tauri::image::Image::new_owned(img.into_raw(), w, h);
            window.set_icon(icon).unwrap();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
