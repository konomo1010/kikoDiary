use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
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
    /// 复制日记时：需要从原目录复制过来的图片绝对路径
    #[serde(default)]
    pub copy_images: Vec<String>,
}

pub struct Db {
    dir: Mutex<PathBuf>,
    /// 已索引正文文件的修改时间，用来判断「外部改动」
    stamps: Mutex<HashMap<PathBuf, SystemTime>>,
    /// 本进程刚写过的文件：短时间内的事件不算外部改动
    recent: Mutex<HashMap<PathBuf, SystemTime>>,
    /// meta.json 的指纹（大小 + 修改时间）：外部工具自己维护索引时，靠它发现变化
    manifest: Mutex<Stamp>,
    /// 串行化「读索引 → 改文件 → 写索引」，防止监听线程和界面保存互相覆盖
    io_lock: Mutex<()>,
}

/// 文件指纹。外部脚本写完 meta.json 后，正文和索引可能都对得上，
/// 只有「索引文件本身被改过」这一条线索能说明界面需要重新读一次。
#[derive(Clone, Copy, PartialEq, Eq, Default)]
struct Stamp {
    len: u64,
    mtime_nanos: u128,
}

fn file_stamp(path: &Path) -> Stamp {
    let Ok(meta) = fs::metadata(path) else {
        return Stamp::default();
    };
    let mtime_nanos = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    Stamp {
        len: meta.len(),
        mtime_nanos,
    }
}

/// 先写临时文件再改名，避免外部工具在写 meta.json 的半截状态被读到
fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let tmp = path.with_file_name(format!("{}.tmp", name));
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    match fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(_) => {
            // 极少数情况下改名失败（比如被占用），退回直接覆盖，保证不丢数据
            fs::write(path, contents).map_err(|e| e.to_string())?;
            let _ = fs::remove_file(&tmp);
            Ok(())
        }
    }
}

/// 逐层删文件再删目录。
/// 不用 std 的 remove_dir_all：在带实时防护的 Windows 上它偶尔会卡住不返回。
fn remove_dir_safe(dir: &Path) -> std::io::Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            remove_dir_safe(&path)?;
        } else {
            fs::remove_file(&path)?;
        }
    }
    // 刚清空的目录偶尔还会被判定「不是空的」，短重试几次
    for _ in 0..5 {
        match fs::remove_dir(dir) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::DirectoryNotEmpty => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(e),
        }
    }
    fs::remove_dir(dir)
}

/// 一次目录扫描的结果，会作为事件 payload 发给前端
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub added: Vec<u64>,
    pub removed: Vec<u64>,
    pub changed: Vec<u64>,
}

impl ScanReport {
    pub fn is_empty(&self) -> bool {
        self.added.is_empty() && self.removed.is_empty() && self.changed.is_empty()
    }
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
        let db = Self {
            dir: Mutex::new(dir),
            stamps: Mutex::new(HashMap::new()),
            recent: Mutex::new(HashMap::new()),
            manifest: Mutex::new(Stamp::default()),
            io_lock: Mutex::new(()),
        };
        // 启动即扫描一次：外部工具直接写进数据目录的日记，开 app 就能看到
        let _ = db.scan_and_sync();
        // 记下启动后的索引指纹，之后只把「真正被外部改过」的报给界面
        db.sync_manifest_stamp();
        Ok(db)
    }

    pub fn root(&self) -> PathBuf {
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
        write_atomic(&self.meta_path(), &json)?;
        // 自己的写入立刻记账，避免被当成「外部改动」再刷一次界面
        self.sync_manifest_stamp();
        Ok(())
    }

    fn meta_stamp(&self) -> Stamp {
        file_stamp(&self.meta_path())
    }

    fn sync_manifest_stamp(&self) {
        let stamp = self.meta_stamp();
        *self.manifest.lock().unwrap() = stamp;
    }

    /// meta.json 是否被外部改过（调用即更新记账，同一次变化只返回一次 true）
    pub fn manifest_changed(&self) -> bool {
        let current = self.meta_stamp();
        let mut last = self.manifest.lock().unwrap();
        if *last == current {
            return false;
        }
        *last = current;
        true
    }

    fn read_search(&self) -> HashMap<String, String> {
        let s = fs::read_to_string(self.search_path()).unwrap_or_default();
        serde_json::from_str(&s).unwrap_or_default()
    }

    fn write_search(&self, map: &HashMap<String, String>) -> Result<(), String> {
        let json = serde_json::to_string(map).map_err(|e| e.to_string())?;
        write_atomic(&self.search_path(), &json)
    }

    /// 记一笔「本进程刚写的文件」，用于过滤自己触发的监听事件
    fn mark_self_write(&self, path: &Path) {
        self.recent
            .lock()
            .unwrap()
            .insert(path.to_path_buf(), SystemTime::now());
    }

    fn is_self_write(&self, path: &Path) -> bool {
        // 6 秒内的自身写入视为自己造成的，避免边打字边重载
        let mut recent = self.recent.lock().unwrap();
        let Some(at) = recent.get(path).copied() else {
            return false;
        };
        let fresh = at.elapsed().map(|d| d < Duration::from_secs(6)).unwrap_or(true);
        if !fresh {
            recent.remove(path);
        }
        fresh
    }

    /// 扫描 diaries 目录，把「索引里没有 / 多了 / 正文被外面改过」的日记同步进 meta.json + search.json。
    /// 只做增量：已有条目的标题、标签、id 都不动，避免覆盖界面里编辑过的内容。
    pub fn scan_and_sync(&self) -> Result<ScanReport, String> {
        // 与界面保存串行，避免两边的「读索引 → 写索引」互相覆盖
        let _io = self.io_lock.lock().map_err(|e| e.to_string())?;
        let root = self.root();
        let bodies = scan_bodies(&root);
        let mut report = ScanReport::default();
        let mut list = self.read_meta();
        let mut search = self.read_search();
        let mut dirty = false;

        // 1) 已索引的日记：看正文 mtime，判断是否被外部改写
        for body in &bodies {
            let Some(idx) = list
                .iter()
                .position(|m| !m.dir_name.is_empty() && m.dir_name == body.dir_name && m.date == body.date)
            else {
                continue;
            };
            let Ok(mtime) = fs::metadata(&body.path).and_then(|m| m.modified()) else {
                continue;
            };
            let previous = self.stamps.lock().unwrap().insert(body.path.clone(), mtime);
            if previous.is_none() || previous == Some(mtime) {
                continue; // 第一次见到，或没变化
            }
            if self.is_self_write(&body.path) {
                continue; // 自己刚保存的，不算外部改动
            }
            let Ok(raw) = fs::read_to_string(&body.path) else { continue };
            let Ok(doc) = serde_json::from_str::<serde_json::Value>(&raw) else { continue };
            let plain = doc_to_text(&doc);
            let id = list[idx].id;
            list[idx].word_count = word_count(&plain);
            list[idx].excerpt = excerpt(&plain);
            if list[idx].title.trim().is_empty() {
                if let Some(t) = first_heading(&doc) {
                    list[idx].title = t;
                }
            }
            search.insert(id.to_string(), plain);
            report.changed.push(id);
            dirty = true;
        }

        // 2) 目录里有、索引里没有的：新增（标题取正文第一个标题，标签留空）
        let mut next_id = list.iter().map(|m| m.id).max().unwrap_or(0);
        for body in &bodies {
            if list
                .iter()
                .any(|m| !m.dir_name.is_empty() && m.dir_name == body.dir_name && m.date == body.date)
            {
                continue;
            }
            let Ok(raw) = fs::read_to_string(&body.path) else { continue };
            let Ok(doc) = serde_json::from_str::<serde_json::Value>(&raw) else { continue };
            let plain = doc_to_text(&doc);
            next_id += 1;
            if let Ok(mtime) = fs::metadata(&body.path).and_then(|m| m.modified()) {
                self.stamps.lock().unwrap().insert(body.path.clone(), mtime);
            }
            search.insert(next_id.to_string(), plain.clone());
            report.added.push(next_id);
            list.push(DiaryMeta {
                id: next_id,
                title: first_heading(&doc).unwrap_or_default(),
                date: body.date.clone(),
                tags: Vec::new(),
                word_count: word_count(&plain),
                excerpt: excerpt(&plain),
                dir_name: body.dir_name.clone(),
            });
            dirty = true;
        }

        // 3) 索引里有、目录已经没了的（外部删除）：移除。
        //    目录还在但正文暂时缺失（外部正在写）时先留着，避免误删。
        list.retain(|m| {
            if m.dir_name.is_empty() {
                return true; // 老数据没有 dirName，不动
            }
            if self.diary_dir(&m.date, &m.dir_name).exists() {
                return true;
            }
            report.removed.push(m.id);
            false
        });
        if !report.removed.is_empty() {
            for id in &report.removed {
                search.remove(&id.to_string());
            }
            dirty = true;
        }

        if dirty {
            self.write_meta(&list)?;
            self.write_search(&search)?;
        }
        Ok(report)
    }
}

/// 递归收集 content 里的图片绝对路径
fn collect_image_srcs(node: &serde_json::Value, out: &mut Vec<String>) {
    if node.get("type").and_then(|t| t.as_str()) == Some("image") {
        if let Some(src) = node
            .get("attrs")
            .and_then(|a| a.get("src"))
            .and_then(|s| s.as_str())
        {
            out.push(src.to_string());
        }
    }
    if let Some(children) = node.get("content").and_then(|c| c.as_array()) {
        for child in children {
            collect_image_srcs(child, out);
        }
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

/// 一条磁盘上真实存在的日记正文
struct ScannedBody {
    date: String,
    dir_name: String,
    path: PathBuf,
}

fn is_date_str(s: &str) -> bool {
    let b = s.as_bytes();
    s.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && s.chars().filter(|c| c.is_ascii_digit()).count() == 8
}

/// 扫描 <root>/diaries/YYYY/MM/YYYY-MM-DD/<dirName>/<dirName>.json
fn scan_bodies(root: &Path) -> Vec<ScannedBody> {
    let mut out = Vec::new();
    let base = root.join("diaries");
    let Ok(years) = fs::read_dir(&base) else { return out };
    for year in years.flatten() {
        if !year.path().is_dir() {
            continue;
        }
        let Ok(months) = fs::read_dir(year.path()) else { continue };
        for month in months.flatten() {
            if !month.path().is_dir() {
                continue;
            }
            let Ok(days) = fs::read_dir(month.path()) else { continue };
            for day in days.flatten() {
                let day_path = day.path();
                if !day_path.is_dir() {
                    continue;
                }
                let date = day.file_name().to_string_lossy().to_string();
                if !is_date_str(&date) {
                    continue;
                }
                let Ok(entries) = fs::read_dir(&day_path) else { continue };
                for entry in entries.flatten() {
                    let dir_path = entry.path();
                    if !dir_path.is_dir() {
                        continue;
                    }
                    let dir_name = entry.file_name().to_string_lossy().to_string();
                    if dir_name.starts_with("imageFiles_") {
                        continue;
                    }
                    let exact = dir_path.join(format!("{}.json", dir_name));
                    let path = if exact.exists() {
                        exact
                    } else {
                        // 兜底：目录里第一个 json，兼容外部工具用别的文件名
                        let found = fs::read_dir(&dir_path).ok().and_then(|files| {
                            files
                                .flatten()
                                .map(|f| f.path())
                                .find(|p| {
                                    p.is_file()
                                        && p.extension().and_then(|e| e.to_str()) == Some("json")
                                })
                        });
                        match found {
                            Some(p) => p,
                            None => continue,
                        }
                    };
                    out.push(ScannedBody {
                        date: date.clone(),
                        dir_name,
                        path,
                    });
                }
            }
        }
    }
    out
}

/// 与前端 docToText 保持一致的纯文本：收集各 text 节点，用换行连接
fn doc_to_text(doc: &serde_json::Value) -> String {
    fn walk(node: &serde_json::Value, parts: &mut Vec<String>) {
        if let Some(t) = node.get("text").and_then(|v| v.as_str()) {
            parts.push(t.to_string());
            return;
        }
        if let Some(arr) = node.get("content").and_then(|v| v.as_array()) {
            for child in arr {
                walk(child, parts);
            }
        }
    }
    let mut parts = Vec::new();
    walk(doc, &mut parts);
    parts.join("\n")
}

/// 与前端 countWords 一致：去掉所有空白后的字符数
fn word_count(text: &str) -> usize {
    text.chars().filter(|c| !c.is_whitespace()).count()
}

/// 正文里第一个标题的文本（① 方案：外部日记的标题来源）
fn first_heading(doc: &serde_json::Value) -> Option<String> {
    fn find(node: &serde_json::Value) -> Option<String> {
        let arr = node.get("content")?.as_array()?;
        for child in arr {
            if child.get("type").and_then(|t| t.as_str()) == Some("heading") {
                let text = doc_to_text(child).replace('\n', " ");
                let t = text.trim();
                if !t.is_empty() {
                    return Some(t.to_string());
                }
            }
        }
        // 标题也可能被包在引用块 / 列表里
        for child in arr {
            if let Some(t) = find(child) {
                return Some(t);
            }
        }
        None
    }
    find(doc)
}

/// 与前端 buildExcerpt 一致：空白压成空格，截 80 字
fn excerpt(plain: &str) -> String {
    let s: String = plain
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .collect();
    let t = s.trim();
    t.chars().take(80).collect()
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
    let _io = state.io_lock.lock().map_err(|e| e.to_string())?;
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

    // 复制日记：把原日记目录里的图片文件真正复制到新目录
    if !diary.copy_images.is_empty() {
        fs::create_dir_all(&image_dir).map_err(|e| e.to_string())?;
        for src in &diary.copy_images {
            let src_path = PathBuf::from(src);
            if !src_path.is_file() {
                continue;
            }
            let Some(fname) = src_path.file_name().map(|n| n.to_string_lossy().to_string()) else {
                continue;
            };
            let new_name = format!("{}_{}", dir_name, fname);
            let dest = image_dir.join(&new_name);
            if fs::copy(&src_path, &dest).is_err() {
                continue;
            }
            replacements.insert(src.clone(), dest.to_string_lossy().to_string());
            kept.push(new_name);
        }
    }

    // 自动复制正文里引用的「外部图片」：粘贴自其他日记、或其他目录的图片，
    // 保存时复制进当前日记目录，避免删除原日记后图片失效。
    let mut external_srcs: Vec<String> = Vec::new();
    collect_image_srcs(&diary.content, &mut external_srcs);
    for src in external_srcs {
        if replacements.contains_key(&src) {
            continue;
        }
        let src_path = PathBuf::from(&src);
        if !src_path.is_file() {
            continue;
        }
        if src_path.starts_with(&diary_dir) {
            continue;
        }
        if let Some(old_dir) = &old_diary_dir {
            if src_path.starts_with(old_dir) {
                continue;
            }
        }
        fs::create_dir_all(&image_dir).map_err(|e| e.to_string())?;
        let Some(fname) = src_path.file_name().map(|n| n.to_string_lossy().to_string()) else {
            continue;
        };
        let mut new_name = format!("{}_{}", dir_name, fname);
        let mut serial = 1;
        while image_dir.join(&new_name).exists() {
            new_name = format!("{}_{}_{}", dir_name, serial, fname);
            serial += 1;
        }
        let dest = image_dir.join(&new_name);
        if fs::copy(&src_path, &dest).is_err() {
            continue;
        }
        replacements.insert(src, dest.to_string_lossy().to_string());
        kept.push(new_name);
    }
    if kept.is_empty() {
        let _ = remove_dir_safe(&image_dir);
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
    let body_path = diary_dir.join(format!("{}.json", dir_name));
    fs::write(&body_path, body_json).map_err(|e| e.to_string())?;
    // 记住这次写入，文件监听到这个文件变化时不算「外部改动」
    state.mark_self_write(&body_path);

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
    let _io = state.io_lock.lock().map_err(|e| e.to_string())?;
    let mut list = state.read_meta();
    let found = list
        .iter()
        .find(|m| m.id == id)
        .map(|m| (m.date.clone(), m.dir_name.clone()));
    list.retain(|m| m.id != id);
    state.write_meta(&list)?;

    if let Some((date, dir_name)) = found {
        let _ = remove_dir_safe(&state.diary_dir(&date, &dir_name));
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

/// 手动/开机后强制扫描一次数据目录（前端也能调，用来兜底）
#[tauri::command]
pub fn rescan_diaries(state: State<'_, Db>) -> Result<ScanReport, String> {
    state.scan_and_sync()
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
                remove_dir_safe(&new_dir)
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
    // 换了根目录，旧的 mtime 记录全部作废
    state.stamps.lock().unwrap().clear();

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
    remove_dir_safe(&p).map_err(|e| format!("清理原数据目录失败（文件可能被占用）：{}", e))
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
    use super::{now_ms, rebase_image_src, remove_dir_safe, Db, DiaryMeta};
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
            stamps: Mutex::new(std::collections::HashMap::new()),
            recent: Mutex::new(std::collections::HashMap::new()),
            manifest: Mutex::new(Default::default()),
            io_lock: Mutex::new(()),
        };

        assert!(db.read_meta_if_initialized().is_none());

        db.write_meta(&[]).unwrap();
        let meta = db
            .read_meta_if_initialized()
            .expect("an existing empty meta.json means initialized");
        assert!(meta.is_empty());

        let _ = remove_dir_safe(&root);
    }

    fn scan_test_root(tag: &str) -> PathBuf {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-data")
            .join(format!("kiko-scan-{}-{}-{}", tag, std::process::id(), now_ms()));
        fs::create_dir_all(root.join("diaries")).unwrap();
        fs::write(root.join("meta.json"), "[]").unwrap();
        root
    }

    fn write_external_diary(root: &PathBuf, date: &str, dir_name: &str, heading: &str) {
        let parts: Vec<&str> = date.split('-').collect();
        let body_dir = root
            .join("diaries")
            .join(parts[0])
            .join(parts[1])
            .join(date)
            .join(dir_name);
        fs::create_dir_all(&body_dir).unwrap();
        let doc = json!({
            "type": "doc",
            "content": [
                { "type": "heading", "attrs": { "level": 1 },
                  "content": [{ "type": "text", "text": heading }] },
                { "type": "paragraph",
                  "content": [{ "type": "text", "text": "第一段正文" }] }
            ]
        });
        fs::write(
            body_dir.join(format!("{}.json", dir_name)),
            serde_json::to_string(&doc).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn scan_picks_up_external_diary() {
        let root = scan_test_root("add");
        write_external_diary(&root, "2026-11-25", "1795000000000", "外部写入的标题");
        let db = Db {
            dir: Mutex::new(root.clone()),
            stamps: Mutex::new(std::collections::HashMap::new()),
            recent: Mutex::new(std::collections::HashMap::new()),
            manifest: Mutex::new(Default::default()),
            io_lock: Mutex::new(()),
        };

        let report = db.scan_and_sync().unwrap();
        assert_eq!(report.added.len(), 1, "外部日记应被识别为新增");
        let list = db.read_meta();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "外部写入的标题", "标题取正文第一个标题");
        assert_eq!(list[0].date, "2026-11-25");
        assert_eq!(list[0].dir_name, "1795000000000");
        assert!(list[0].tags.is_empty(), "外部日记标签留空");
        assert_eq!(
            list[0].word_count,
            "外部写入的标题第一段正文".chars().count(),
            "字数与前端 countWords 口径一致"
        );
        assert!(db.read_search().contains_key(&list[0].id.to_string()));

        // 再扫一次不该重复新增
        let again = db.scan_and_sync().unwrap();
        assert!(again.is_empty());
        assert_eq!(db.read_meta().len(), 1);

        let _ = remove_dir_safe(&root);
    }

    #[test]
    fn scan_drops_index_entry_whose_dir_is_gone() {
        let root = scan_test_root("remove");
        let db = Db {
            dir: Mutex::new(root.clone()),
            stamps: Mutex::new(std::collections::HashMap::new()),
            recent: Mutex::new(std::collections::HashMap::new()),
            manifest: Mutex::new(Default::default()),
            io_lock: Mutex::new(()),
        };
        // 索引里有一条，但磁盘上对应目录已经不存在（外部删除）
        db.write_meta(&[DiaryMeta {
            id: 7,
            title: "外面删掉的日记".into(),
            date: "2026-11-25".into(),
            tags: vec![],
            word_count: 6,
            excerpt: "外面删掉的日记".into(),
            dir_name: "1795000000000".into(),
        }])
        .unwrap();

        let report = db.scan_and_sync().unwrap();
        assert_eq!(report.removed, vec![7], "外部删除的日记应从索引移除");
        assert!(db.read_meta().is_empty());
        assert!(db.read_search().is_empty() || !db.read_search().contains_key("7"));

        let _ = remove_dir_safe(&root);
    }

    #[test]
    fn scan_ignores_own_write() {
        let root = scan_test_root("selfwrite");
        write_external_diary(&root, "2026-11-25", "1795000000000", "标题");
        let db = Db {
            dir: Mutex::new(root.clone()),
            stamps: Mutex::new(std::collections::HashMap::new()),
            recent: Mutex::new(std::collections::HashMap::new()),
            manifest: Mutex::new(Default::default()),
            io_lock: Mutex::new(()),
        };
        db.scan_and_sync().unwrap();

        // 模拟界面里保存：正文改动 + 标记为「自己写的」
        let body = root
            .join("diaries")
            .join("2026")
            .join("11")
            .join("2026-11-25")
            .join("1795000000000")
            .join("1795000000000.json");
        let doc = json!({
            "type": "doc",
            "content": [{ "type": "paragraph",
                          "content": [{ "type": "text", "text": "自己保存的新内容" }] }]
        });
        fs::write(&body, serde_json::to_string(&doc).unwrap()).unwrap();
        db.mark_self_write(&body);

        let report = db.scan_and_sync().unwrap();
        assert!(report.changed.is_empty(), "自己保存的改动不该当成外部修改上报");

        let _ = remove_dir_safe(&root);
    }

    #[test]
    fn manifest_change_is_reported_when_external_writer_updates_meta() {
        let root = scan_test_root("manifest");
        write_external_diary(&root, "2026-11-24", "1794900000000", "已有日记");
        let db = Db {
            dir: Mutex::new(root.clone()),
            stamps: Mutex::new(std::collections::HashMap::new()),
            recent: Mutex::new(std::collections::HashMap::new()),
            manifest: Mutex::new(Default::default()),
            io_lock: Mutex::new(()),
        };
        db.scan_and_sync().unwrap();
        assert!(!db.manifest_changed(), "自己扫完写下的索引不算外部改动");

        // 外部脚本（kiko_add_entry.py）的写法：正文和 meta.json 一起写
        write_external_diary(&root, "2026-11-26", "1795656600000", "外部新增");
        let mut list = db.read_meta();
        list.push(DiaryMeta {
            id: 99,
            title: "3476.88 0.01% / 65, 5 / 1766, 3642 / 13173亿(-4.75%,-657亿) / 5".into(),
            date: "2026-11-26".into(),
            tags: vec!["短线".into()],
            word_count: 4,
            excerpt: "外部新增".into(),
            dir_name: "1795656600000".into(),
        });
        fs::write(
            root.join("meta.json"),
            serde_json::to_string_pretty(&list).unwrap(),
        )
        .unwrap();

        // 索引里已经有这条 → 增量扫描看不到新增，只能靠索引指纹发现
        let report = db.scan_and_sync().unwrap();
        assert!(report.is_empty(), "外部脚本已同步维护索引，增量扫描为空");
        assert!(db.manifest_changed(), "索引文件被外部改写必须上报给界面");
        assert!(!db.manifest_changed(), "同一次改动只上报一次");

        let _ = remove_dir_safe(&root);
    }
}
