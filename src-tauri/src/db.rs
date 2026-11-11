use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiaryMeta {
    pub id: u64,
    pub title: String,
    pub date: String,
    pub tags: Vec<String>,
    pub word_count: usize,
    pub excerpt: String,
    #[serde(default)]
    pub dir_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInput {
    pub name: String,
    pub data: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDiaryInput {
    pub id: u64,
    pub title: String,
    pub date: String,
    pub tags: Vec<String>,
    pub content: serde_json::Value,
    pub text: String,
    pub word_count: usize,
    pub excerpt: String,
    #[serde(default)]
    pub images: Vec<ImageInput>,
    #[serde(default)]
    pub keep_images: Vec<String>,
}

pub struct Db {
    dir: Mutex<PathBuf>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn data_config_path() -> PathBuf {
    std::env::current_dir()
        .unwrap_or_default()
        .join("kiko.config.json")
}

/// 数据目录（data 目录，不含 kiko 子目录），默认在运行目录下
fn data_root() -> Result<PathBuf, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    if let Ok(s) = fs::read_to_string(data_config_path()) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
            if let Some(p) = v.get("dataDir").and_then(|x| x.as_str()) {
                let p = p.trim();
                if !p.is_empty() {
                    return Ok(PathBuf::from(p));
                }
            }
        }
    }
    Ok(cwd.join("data"))
}

/// 应用数据目录：若 dataDir 本身已是数据目录则直接用，否则用 dataDir/kiko
fn resolve_data_dir() -> Result<PathBuf, String> {
    let root = data_root()?;
    if root.join("meta.json").exists() {
        return Ok(root);
    }
    Ok(root.join("kiko"))
}

/// 判断目录是否是合法的 kiko 数据目录：
/// - meta.json 必须存在且能解析为数组，元素含 id(number)/date(string)/dirName(string)
/// - diaries 子目录必须存在
/// - config.json 若存在必须是 JSON 对象
fn is_kiko_data(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    let Ok(s) = fs::read_to_string(dir.join("meta.json")) else {
        return false;
    };
    let Ok(serde_json::Value::Array(arr)) = serde_json::from_str::<serde_json::Value>(&s) else {
        return false;
    };
    let items_ok = arr.iter().all(|v| {
        v.get("id").map(|x| x.is_number()).unwrap_or(false)
            && v.get("date").map(|x| x.is_string()).unwrap_or(false)
            && v.get("dirName").map(|x| x.is_string()).unwrap_or(false)
    });
    if !items_ok {
        return false;
    }
    if !dir.join("diaries").is_dir() {
        return false;
    }
    if let Ok(cs) = fs::read_to_string(dir.join("config.json")) {
        if !matches!(
            serde_json::from_str::<serde_json::Value>(&cs),
            Ok(serde_json::Value::Object(_))
        ) {
            return false;
        }
    }
    true
}

impl Db {
    pub fn open(_app: &AppHandle) -> Result<Self, String> {
        // 数据目录默认在运行目录下，可在设置里自定义
        let dir = resolve_data_dir()?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        fs::create_dir_all(dir.join("diaries")).map_err(|e| e.to_string())?;
        Ok(Self {
            dir: Mutex::new(dir),
        })
    }

    fn root(&self) -> PathBuf {
        self.dir.lock().unwrap().clone()
    }

    fn meta_path(&self) -> PathBuf {
        self.root().join("meta.json")
    }
    fn search_path(&self) -> PathBuf {
        self.root().join("search.json")
    }
    fn config_path(&self) -> PathBuf {
        self.root().join("config.json")
    }
    fn date_dir(&self, date: &str) -> PathBuf {
        let mut parts = date.split('-');
        let year = parts.next().unwrap_or("0000");
        let month = parts.next().unwrap_or("00");
        self.root()
            .join("diaries")
            .join(year)
            .join(month)
            .join(date)
    }

    fn diary_dir(&self, date: &str, dir_name: &str) -> PathBuf {
        self.date_dir(date).join(dir_name)
    }

    fn diary_json_path(&self, date: &str, dir_name: &str) -> PathBuf {
        self.diary_dir(date, dir_name)
            .join(format!("{}.json", dir_name))
    }

    fn read_meta(&self) -> Vec<DiaryMeta> {
        let s = fs::read_to_string(self.meta_path()).unwrap_or_default();
        serde_json::from_str(&s).unwrap_or_default()
    }

    fn read_meta_if_initialized(&self) -> Option<Vec<DiaryMeta>> {
        if self.meta_path().exists() {
            Some(self.read_meta())
        } else {
            None
        }
    }

    fn write_meta(&self, list: &[DiaryMeta]) -> Result<(), String> {
        let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
        fs::write(self.meta_path(), json).map_err(|e| e.to_string())
    }

    fn read_search(&self) -> HashMap<String, String> {
        let s = fs::read_to_string(self.search_path()).unwrap_or_default();
        serde_json::from_str(&s).unwrap_or_default()
    }

    fn write_search(&self, map: &HashMap<String, String>) -> Result<(), String> {
        let json = serde_json::to_string(map).map_err(|e| e.to_string())?;
        fs::write(self.search_path(), json).map_err(|e| e.to_string())
    }
}

/// 递归把 content 里 image 节点的 src（临时名）替换成磁盘绝对路径
fn replace_image_src(node: &mut serde_json::Value, replacements: &HashMap<String, String>) {
    if let Some(obj) = node.as_object_mut() {
        if let Some(attrs) = obj.get_mut("attrs").and_then(|a| a.as_object_mut()) {
            if let Some(src) = attrs.get("src").and_then(|s| s.as_str()) {
                if let Some(new_src) = replacements.get(src) {
                    attrs.insert(
                        "src".to_string(),
                        serde_json::Value::String(new_src.clone()),
                    );
                }
            }
        }
        if let Some(children) = obj.get_mut("content").and_then(|c| c.as_array_mut()) {
            for child in children {
                replace_image_src(child, replacements);
            }
        }
    }
}

/// 日记目录随日期移动后，同步更新正文中已有图片的绝对路径。
fn rebase_image_src(node: &mut serde_json::Value, old_dir: &Path, new_dir: &Path) {
    if let Some(obj) = node.as_object_mut() {
        if obj.get("type").and_then(|t| t.as_str()) == Some("image") {
            if let Some(attrs) = obj.get_mut("attrs").and_then(|a| a.as_object_mut()) {
                if let Some(src) = attrs.get("src").and_then(|s| s.as_str()) {
                    if let Ok(relative) = Path::new(src).strip_prefix(old_dir) {
                        let new_src = new_dir.join(relative).to_string_lossy().to_string();
                        attrs.insert("src".to_string(), serde_json::Value::String(new_src));
                    }
                }
            }
        }
        if let Some(children) = obj.get_mut("content").and_then(|c| c.as_array_mut()) {
            for child in children {
                rebase_image_src(child, old_dir, new_dir);
            }
        }
    }
}

#[tauri::command]
pub fn load_meta(state: State<'_, Db>) -> Result<Option<Vec<DiaryMeta>>, String> {
    Ok(state.read_meta_if_initialized())
}

#[tauri::command]
pub fn get_body(state: State<'_, Db>, id: u64) -> Result<Option<serde_json::Value>, String> {
    let list = state.read_meta();
    let Some(m) = list.iter().find(|m| m.id == id) else {
        return Ok(None);
    };
    let p = state.diary_json_path(&m.date, &m.dir_name);
    if !p.exists() {
        return Ok(None);
    }
    let s = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    Ok(serde_json::from_str(&s).ok())
}

#[tauri::command]
pub fn save_diary(state: State<'_, Db>, diary: SaveDiaryInput) -> Result<(u64, String), String> {
    let mut list = state.read_meta();

    let (new_id, dir_name, old_date) = if diary.id == 0 {
        (
            list.iter().map(|m| m.id).max().unwrap_or(0) + 1,
            now_ms().to_string(),
            None,
        )
    } else {
        let existing = list.iter().find(|m| m.id == diary.id);
        let dir_name = existing
            .map(|m| m.dir_name.clone())
            .unwrap_or_else(|| now_ms().to_string());
        let old_date = existing.map(|m| m.date.clone());
        (diary.id, dir_name, old_date)
    };

    let date_dir = state.date_dir(&diary.date);
    fs::create_dir_all(&date_dir).map_err(|e| e.to_string())?;

    let diary_dir = date_dir.join(&dir_name);

    // 编辑且日期变化：把整个日记目录移动到新日期目录
    let old_diary_dir = match old_date.as_ref() {
        Some(old_date) if old_date != &diary.date => Some(state.diary_dir(old_date, &dir_name)),
        _ => None,
    };
    if let Some(old_diary_dir) = &old_diary_dir {
        if old_diary_dir.exists() && !diary_dir.exists() {
            let _ = fs::rename(old_diary_dir, &diary_dir);
        }
    }
    fs::create_dir_all(&diary_dir).map_err(|e| e.to_string())?;

    // 只在有图片时才创建 imageFiles_{时间戳} 目录
    let image_dir = diary_dir.join(format!("imageFiles_{}", dir_name));
    let mut replacements: HashMap<String, String> = HashMap::new();
    let mut kept: Vec<String> = diary.keep_images.clone();
    if !diary.images.is_empty() {
        fs::create_dir_all(&image_dir).map_err(|e| e.to_string())?;
        for img in &diary.images {
            let bytes = general_purpose::STANDARD
                .decode(&img.data)
                .map_err(|e| e.to_string())?;
            // 最终文件名 = 日记时间戳_序号
            let new_name = format!("{}_{}", dir_name, img.name);
            let path = image_dir.join(&new_name);
            fs::write(&path, &bytes).map_err(|e| e.to_string())?;
            replacements.insert(img.name.clone(), path.to_string_lossy().to_string());
            kept.push(new_name);
        }
    }

    // 没有图片时删除整个 imageFiles 目录；否则清理不再被引用的旧文件
    if kept.is_empty() {
        let _ = fs::remove_dir_all(&image_dir);
    } else if let Ok(entries) = fs::read_dir(&image_dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_string();
            if !kept.contains(&fname) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    // 正文里的图片 src 换成磁盘绝对路径
    let mut content = diary.content;
    replace_image_src(&mut content, &replacements);
    if let Some(old_diary_dir) = &old_diary_dir {
        rebase_image_src(&mut content, old_diary_dir, &diary_dir);
    }

    let body_json = serde_json::to_string(&content).map_err(|e| e.to_string())?;
    fs::write(diary_dir.join(format!("{}.json", dir_name)), body_json)
        .map_err(|e| e.to_string())?;

    let meta = DiaryMeta {
        id: new_id,
        title: diary.title.clone(),
        date: diary.date.clone(),
        tags: diary.tags.clone(),
        word_count: diary.word_count,
        excerpt: diary.excerpt.clone(),
        dir_name: dir_name.clone(),
    };
    if let Some(m) = list.iter_mut().find(|m| m.id == new_id) {
        *m = meta;
    } else {
        list.push(meta);
    }
    state.write_meta(&list)?;

    let mut search = state.read_search();
    search.insert(new_id.to_string(), diary.text);
    state.write_search(&search)?;

    Ok((new_id, dir_name))
}

#[tauri::command]
pub fn delete_diary(state: State<'_, Db>, id: u64) -> Result<(), String> {
    let mut list = state.read_meta();
    let found = list
        .iter()
        .find(|m| m.id == id)
        .map(|m| (m.date.clone(), m.dir_name.clone()));
    list.retain(|m| m.id != id);
    state.write_meta(&list)?;

    if let Some((date, dir_name)) = found {
        let _ = fs::remove_dir_all(state.diary_dir(&date, &dir_name));
    }

    let mut search = state.read_search();
    search.remove(&id.to_string());
    state.write_search(&search)?;

    Ok(())
}

#[tauri::command]
pub fn search_diaries(state: State<'_, Db>, query: String) -> Result<Vec<u64>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let list = state.read_meta();
    let search = state.read_search();
    let mut ids = Vec::new();
    for m in &list {
        if m.title.to_lowercase().contains(&q) {
            ids.push(m.id);
            continue;
        }
        if let Some(t) = search.get(&m.id.to_string()) {
            if t.to_lowercase().contains(&q) {
                ids.push(m.id);
            }
        }
    }
    Ok(ids)
}

#[tauri::command]
pub fn load_config(state: State<'_, Db>) -> Result<Option<serde_json::Value>, String> {
    let p = state.config_path();
    if !p.exists() {
        return Ok(None);
    }
    let s = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    Ok(serde_json::from_str(&s).ok())
}

#[tauri::command]
pub fn save_config(state: State<'_, Db>, config: serde_json::Value) -> Result<(), String> {
    let json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    fs::write(state.config_path(), json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_data_dir() -> Result<String, String> {
    Ok(data_root()?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn data_dir_size(state: State<'_, Db>) -> Result<u64, String> {
    fn walk(dir: &Path) -> u64 {
        let Ok(entries) = fs::read_dir(dir) else { return 0 };
        let mut total = 0;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                total += walk(&path);
            } else if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
        }
        total
    }
    Ok(walk(&state.root()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataDirInfo {
    pub status: String,
    pub path: String,
}

/// 检查用户选择的目录：empty（空）/ kiko（本应用数据）/ other（非本应用数据）
/// 兼容两种布局：{path}/kiko（父目录）或 {path} 本身（直接选中数据目录）
#[tauri::command]
pub fn inspect_data_dir(path: String) -> Result<DataDirInfo, String> {
    let p = PathBuf::from(path.trim());
    let nested = p.join("kiko");
    if is_kiko_data(&nested) {
        return Ok(DataDirInfo {
            status: "kiko".into(),
            path: nested.to_string_lossy().to_string(),
        });
    }
    if is_kiko_data(&p) {
        return Ok(DataDirInfo {
            status: "kiko".into(),
            path: p.to_string_lossy().to_string(),
        });
    }
    let empty = match fs::read_dir(&p) {
        Ok(mut it) => it.next().is_none(),
        Err(_) => true,
    };
    Ok(DataDirInfo {
        status: if empty { "empty" } else { "other" }.into(),
        path: p.to_string_lossy().to_string(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDataDirResult {
    pub root: String,
    pub old_dir: String,
}

/// mode: migrate（迁移当前数据到空目录）/ overwrite（清理目标后迁移）/ keep（直接使用目标数据）
#[tauri::command]
pub fn set_data_dir(
    state: State<'_, Db>,
    path: String,
    mode: String,
) -> Result<SetDataDirResult, String> {
    let p = path.trim();
    let new_root = if p.is_empty() {
        std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join("data")
    } else {
        PathBuf::from(p)
    };
    // 兼容：用户直接选中数据目录本身（目录下有 meta.json），否则用 {dir}/kiko
    let new_dir = if new_root.join("meta.json").exists() {
        new_root.clone()
    } else {
        new_root.join("kiko")
    };
    let old_dir = state.root();
    let old_dir_str = old_dir.to_string_lossy().to_string();

    if new_dir == old_dir {
        return Ok(SetDataDirResult {
            root: new_root.to_string_lossy().to_string(),
            old_dir: old_dir_str,
        });
    }

    match mode.as_str() {
        "keep" => {
            // 直接使用目标目录现有数据，不迁移
            if !new_dir.exists() {
                fs::create_dir_all(&new_dir).map_err(|e| e.to_string())?;
            }
        }
        "overwrite" => {
            // 清理目标数据（失败要报错，不能静默忽略）
            if new_dir.exists() {
                fs::remove_dir_all(&new_dir)
                    .map_err(|e| format!("清理目标目录失败（文件可能被占用）：{}", e))?;
            }
            fs::create_dir_all(&new_dir).map_err(|e| e.to_string())?;
            if old_dir.exists() {
                copy_dir_all(&old_dir, &new_dir)?;
            }
        }
        _ => {
            // migrate：目标不存在时迁移当前数据
            if new_dir.exists() {
                return Err("目标目录已有数据".into());
            }
            fs::create_dir_all(&new_root).map_err(|e| e.to_string())?;
            if old_dir.exists() {
                copy_dir_all(&old_dir, &new_dir)?;
            }
        }
    }

    // 立即切换到新目录
    *state.dir.lock().unwrap() = new_dir;

    // 写入配置
    let config = serde_json::json!({ "dataDir": new_root.to_string_lossy().to_string() });
    let json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    fs::write(data_config_path(), json).map_err(|e| e.to_string())?;

    Ok(SetDataDirResult {
        root: new_root.to_string_lossy().to_string(),
        old_dir: old_dir_str,
    })
}

/// 删除原数据目录（用户确认清理后调用）
#[tauri::command]
pub fn remove_data_dir(path: String) -> Result<(), String> {
    let p = PathBuf::from(path.trim());
    if p.as_os_str().is_empty() {
        return Err("路径为空".into());
    }
    if !p.is_dir() {
        return Ok(());
    }
    fs::remove_dir_all(&p).map_err(|e| format!("清理原数据目录失败（文件可能被占用）：{}", e))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmptyDirInfo {
    pub path: String,
    pub rel: String,
}

/// 递归收集 dir 下的空目录（无文件且子目录也为空），返回 dir 是否为空
fn collect_empty_dirs(dir: &Path, root: &Path, out: &mut Vec<EmptyDirInfo>) -> bool {
    let mut has_file = false;
    let mut subdirs: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                subdirs.push(p);
            } else {
                has_file = true;
            }
        }
    }
    let mut all_sub_empty = true;
    for p in &subdirs {
        if !collect_empty_dirs(p, root, out) {
            all_sub_empty = false;
        }
    }
    let is_empty = !has_file && all_sub_empty;
    if is_empty {
        let rel = dir
            .strip_prefix(root)
            .unwrap_or(dir)
            .to_string_lossy()
            .to_string();
        out.push(EmptyDirInfo {
            path: dir.to_string_lossy().to_string(),
            rel,
        });
    }
    is_empty
}

/// 列出数据目录 diaries/ 下的空目录
#[tauri::command]
pub fn list_empty_dirs(state: State<'_, Db>) -> Result<Vec<EmptyDirInfo>, String> {
    let root = state.root();
    let diaries = root.join("diaries");
    let mut out = Vec::new();
    if diaries.is_dir() {
        collect_empty_dirs(&diaries, &root, &mut out);
    }
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok(out)
}

/// 自底向上删除空目录，返回删除数量
fn clean_empty_dirs(dir: &Path, keep: &Path) -> usize {
    let mut count = 0;
    let mut subdirs: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                subdirs.push(p);
            }
        }
    }
    for p in &subdirs {
        count += clean_empty_dirs(p, keep);
    }
    if dir != keep && fs::remove_dir(dir).is_ok() {
        count += 1;
    }
    count
}

/// 清理数据目录 diaries/ 下的所有空目录
#[tauri::command]
pub fn remove_empty_dirs(state: State<'_, Db>) -> Result<usize, String> {
    let root = state.root();
    let diaries = root.join("diaries");
    if !diaries.is_dir() {
        return Ok(0);
    }
    Ok(clean_empty_dirs(&diaries, &diaries))
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 把文本写入用户指定的路径（用于导出数据）
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    let p = PathBuf::from(path.trim());
    if p.as_os_str().is_empty() {
        return Err("路径为空".into());
    }
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::write(&p, content).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{now_ms, rebase_image_src, Db};
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Mutex;

    #[test]
    fn rebase_image_src_after_date_change_preserves_relative_paths() {
        let old_dir = PathBuf::from("data")
            .join("diaries/2026/10/2026-10-01")
            .join("123");
        let new_dir = PathBuf::from("data")
            .join("diaries/2026/11/2026-11-04")
            .join("123");
        let old_src = old_dir.join("imageFiles_123/123_hash.png");
        let external_src = PathBuf::from("other/image.png");
        let mut content = json!({
            "type": "doc",
            "content": [
                {
                    "type": "blockquote",
                    "content": [{
                        "type": "image",
                        "attrs": { "src": old_src.to_string_lossy() }
                    }]
                },
                {
                    "type": "image",
                    "attrs": { "src": external_src.to_string_lossy() }
                }
            ]
        });

        rebase_image_src(&mut content, &old_dir, &new_dir);

        let expected = new_dir.join("imageFiles_123/123_hash.png");
        assert_eq!(
            content
                .pointer("/content/0/content/0/attrs/src")
                .and_then(|v| v.as_str()),
            expected.to_str()
        );
        assert_eq!(
            content
                .pointer("/content/1/attrs/src")
                .and_then(|v| v.as_str()),
            external_src.to_str()
        );
    }

    #[test]
    fn load_meta_distinguishes_missing_file_from_empty_list() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-data")
            .join(format!(
                "kiko-meta-test-{}-{}",
                std::process::id(),
                now_ms()
            ));
        fs::create_dir_all(&root).unwrap();
        let db = Db {
            dir: Mutex::new(root.clone()),
        };

        assert!(db.read_meta_if_initialized().is_none());

        db.write_meta(&[]).unwrap();
        let meta = db
            .read_meta_if_initialized()
            .expect("an existing empty meta.json means initialized");
        assert!(meta.is_empty());

        fs::remove_dir_all(root).unwrap();
    }
}
