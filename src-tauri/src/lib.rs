mod db;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let database = db::Db::open(&handle)?;
            app.manage(database);

            // WebView2 数据目录同样放到项目/工作目录下，避开 AppData 拦截
            let webview_dir = std::env::current_dir()
                .map_err(|e| e.to_string())?
                .join("webview2-data");
            std::fs::create_dir_all(&webview_dir)?;

            tauri::WebviewWindowBuilder::new(
                &handle,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("kiko")
            .inner_size(1280.0, 860.0)
            .min_inner_size(900.0, 600.0)
            .center()
            .data_directory(webview_dir)
            .build()?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::load_meta,
            db::get_body,
            db::save_diary,
            db::delete_diary,
            db::search_diaries,
            db::load_config,
            db::save_config,
            db::get_data_dir,
            db::set_data_dir,
            db::inspect_data_dir,
            db::write_text_file,
            db::remove_data_dir,
            db::list_empty_dirs,
            db::remove_empty_dirs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
