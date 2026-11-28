// 监听数据目录：外部脚本 / 同步工具直接往 diaries 里写日记、或者自己维护 meta.json 时，
// 更新索引并广播 kiko:data-changed 让界面刷新。
// 两层监听：diaries 递归（正文增删改），数据根目录非递归（meta.json / search.json 被外部改写）。
use crate::db::Db;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// 事件静默多久后统一扫描一次
const DEBOUNCE: Duration = Duration::from_millis(500);
/// 等待事件的心跳：顺便检查数据目录有没有被 set_data_dir 换掉
const HEARTBEAT: Duration = Duration::from_millis(800);

/// 发给界面的事件内容。reason 用来区分「正文变了」和「只有索引被外部改过」。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChangePayload {
    added: Vec<u64>,
    removed: Vec<u64>,
    changed: Vec<u64>,
    reason: &'static str,
}

pub fn start(app: AppHandle) {
    std::thread::Builder::new()
        .name("kiko-data-watch".into())
        .spawn(move || run(app))
        .ok();
}

fn run(app: AppHandle) {
    let (tx, rx) = channel();
    let mut watcher = match RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            let _ = tx.send(res);
        },
        Config::default(),
    ) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("[watch] 初始化失败: {e}");
            return;
        }
    };

    let mut watched: Option<PathBuf> = None;
    loop {
        // 数据目录可能被切换，监听到目标变化就重新 watch
        let root = app.state::<Db>().root();
        let needs_rebind = watched
            .as_ref()
            .map(|old| old.as_path() != root.as_path())
            .unwrap_or(true);
        if needs_rebind {
            if let Some(old_root) = watched.take() {
                let _ = watcher.unwatch(&old_root);
            }
            let _ = std::fs::create_dir_all(&root);
            // 整个数据目录递归监听：meta.json、search.json、diaries 下任意层级都能收到
            match watcher.watch(&root, RecursiveMode::Recursive) {
                Ok(()) => watched = Some(root),
                Err(e) => {
                    eprintln!("[watch] 监听数据目录失败: {e}");
                    // 数据目录可能还没建好，等下一轮
                    std::thread::sleep(HEARTBEAT);
                    continue;
                }
            }
        }

        match rx.recv_timeout(HEARTBEAT) {
            Ok(Ok(event)) => {
                // 图片目录、临时文件、设置文件都不算数据变化
                if event.paths.iter().all(|p| is_noise(p)) {
                    continue;
                }
                // 防抖：连续事件全部静默下来再扫一次
                while rx.recv_timeout(DEBOUNCE).is_ok() {}
                publish(&app);
            }
            Ok(Err(e)) => eprintln!("[watch] {e}"),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn is_noise(path: &Path) -> bool {
    if path
        .components()
        .any(|c| c.as_os_str().to_string_lossy().starts_with("imageFiles_"))
    {
        return true;
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    // 自己写的 *.tmp 中转文件、以及设置文件（config.json）不触发扫描
    name.ends_with(".tmp") || name == "config.json"
}

fn publish(app: &AppHandle) {
    let Some(state) = app.try_state::<Db>() else { return };
    // 先记指纹：scan_and_sync 可能重写 meta.json，写完后指纹会被记成“自己写的”
    let manifest = state.manifest_changed();
    let report = match state.scan_and_sync() {
        Ok(report) => report,
        Err(e) => {
            eprintln!("[watch] 扫描失败: {e}");
            return;
        }
    };
    let empty = report.is_empty();
    if empty && !manifest {
        return;
    }
    let payload = ChangePayload {
        added: report.added,
        removed: report.removed,
        changed: report.changed,
        reason: if empty { "manifest" } else { "body" },
    };
    eprintln!(
        "[watch] 数据变化: reason={} added={} removed={} changed={}",
        payload.reason,
        payload.added.len(),
        payload.removed.len(),
        payload.changed.len()
    );
    let _ = app.emit("kiko:data-changed", payload);
}
