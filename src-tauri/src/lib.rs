mod db;

use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 只输出到控制台，不再写入 kiko.log 文件。
    let log_plugin = tauri_plugin_log::Builder::new()
        .clear_targets()
        .target(Target::new(TargetKind::Stdout))
        .level(tauri_plugin_log::log::LevelFilter::Info)
        .build();

    tauri::Builder::default()
        .plugin(log_plugin)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            tauri_plugin_log::log::info!("kiko 启动");

            let handle = app.handle().clone();
            let database = db::Db::open(&handle)?;
            app.manage(database);

            // dev 缓存放到 target 下：Tauri 的 dev watcher 监视 src-tauri，
            // 缓存文件的读写会触发无限重建；target 目录被 watcher 忽略。
            let webview_dir = if cfg!(debug_assertions) {
                std::env::current_dir()
                    .map_err(|e| e.to_string())?
                    .join("target")
                    .join("webview2-data-dev")
            } else {
                let base = std::env::var_os("LOCALAPPDATA")
                    .map(std::path::PathBuf::from)
                    .unwrap_or_else(|| {
                        std::env::current_dir()
                            .unwrap_or_else(|_| std::path::PathBuf::from("."))
                    });
                base.join("kiko").join("webview2-data")
            };
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
