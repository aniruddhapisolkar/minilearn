use std::collections::{BTreeMap, HashSet};
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::{SecondsFormat, Utc};
use regex::Regex;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

pub const VERSION: u32 = 1;
pub const CATEGORIES: [&str; 4] = ["content", "generated", "history", "cache"];
pub const MAX_ARCHIVE: usize = 100 * 1024 * 1024;
pub const MAX_MATERIAL: usize = 20 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub provider: String,
    pub label: String,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub connections: Vec<Connection>,
    #[serde(default)]
    pub active_connection: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Lesson {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Module {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub lessons: Vec<Lesson>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LessonWithModule {
    pub id: String,
    pub title: String,
    pub description: String,
    pub module_title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MaterialRecord {
    pub id: String,
    pub name: String,
    pub file_name: String,
    pub mime: String,
    pub size: usize,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MaterialData {
    pub record: MaterialRecord,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedNote {
    pub id: String,
    pub title: String,
    pub body: String,
    pub lesson_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchSource {
    pub title: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchRecord {
    pub query: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    pub status: String,
    pub sources: Vec<WebSearchSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub kind: String,
    pub prompt: String,
    pub options: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question: Option<Question>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_search: Option<WebSearchRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub lesson_id: String,
    pub lesson_title: String,
    pub mode: String,
    pub created_at: String,
    pub updated_at: String,
    pub messages: Vec<SessionMessage>,
    pub material_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub session_id: String,
    pub message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    pub title: String,
    pub statement: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lesson_id: Option<String>,
    pub sources: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<Vec<Evidence>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sources: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<Vec<Evidence>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlannerMessage {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_search: Option<WebSearchRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlannerState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub messages: Vec<PlannerMessage>,
    pub proposal: Option<Vec<Module>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
}

impl Default for PlannerState {
    fn default() -> Self {
        Self {
            id: None,
            messages: Vec::new(),
            proposal: None,
            base: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub version: u32,
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    #[serde(flatten)]
    pub meta: ProjectMeta,
    pub lesson_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub lesson_id: String,
    pub lesson_title: String,
    pub mode: String,
    pub created_at: String,
    pub updated_at: String,
    pub material_ids: Vec<String>,
    pub message_count: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CategoryUsage {
    pub files: usize,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    #[serde(flatten)]
    pub meta: ProjectMeta,
    pub folder: String,
    pub curriculum: Vec<Module>,
    pub materials: Vec<MaterialRecord>,
    pub generated: Vec<GeneratedNote>,
    pub sessions: Vec<SessionSummary>,
    pub graph: Graph,
    pub progress: BTreeMap<String, String>,
    pub planner: PlannerState,
    pub storage: BTreeMap<String, CategoryUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveFile {
    pub path: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LearnArchive {
    pub format: String,
    pub version: u32,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exported_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub categories: Option<Vec<String>>,
    pub files: Vec<ArchiveFile>,
}

/// Resolves the storage root: `MINILEARN_DATA_DIR` if non-empty, else
/// `app_support_dir` if provided, else `~/Library/Application Support/minilearn`
/// (or platform data dir) falling back to `./data`.
pub fn resolve_data_root(app_support_dir: Option<&Path>) -> PathBuf {
    if let Ok(env_dir) = std::env::var("MINILEARN_DATA_DIR") {
        if !env_dir.trim().is_empty() {
            return resolve_path(Path::new(&env_dir));
        }
    }
    if let Some(dir) = app_support_dir {
        return resolve_path(dir);
    }
    if let Some(data_dir) = dirs::data_dir() {
        return resolve_path(&data_dir.join("minilearn"));
    }
    if let Some(home) = dirs::home_dir() {
        return resolve_path(
            &home
                .join("Library")
                .join("Application Support")
                .join("minilearn"),
        );
    }
    resolve_path(Path::new("./data"))
}

pub fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        && !matches!(value, "__proto__" | "constructor" | "prototype")
}

pub fn required_text(value: Option<&str>, label: &str, max: usize) -> AppResult<String> {
    let Some(raw) = value else {
        return Err(AppError::bad_request(format!(
            "{label} must be between 1 and {max} characters."
        )));
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() || raw.encode_utf16().count() > max {
        return Err(AppError::bad_request(format!(
            "{label} must be between 1 and {max} characters."
        )));
    }
    Ok(trimmed.to_string())
}

fn check_id(value: &str) -> AppResult<&str> {
    if !valid_id(value) {
        return Err(AppError::bad_request("Invalid identifier."));
    }
    Ok(value)
}

fn clamp_text(value: Option<&str>, max: usize) -> String {
    let Some(raw) = value else {
        return String::new();
    };
    let mut count = 0usize;
    for (idx, ch) in raw.char_indices() {
        let next = count + ch.len_utf16();
        if next > max {
            return raw[..idx].to_string();
        }
        count = next;
    }
    raw.to_string()
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn uid() -> String {
    Uuid::new_v4().to_string()
}

fn resolve_path(path: &Path) -> PathBuf {
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    };
    let mut out = PathBuf::new();
    for comp in joined.components() {
        match comp {
            Component::Prefix(p) => out.push(p.as_os_str()),
            Component::RootDir => out.push(comp.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if matches!(out.components().next_back(), Some(Component::Normal(_))) {
                    out.pop();
                }
            }
            Component::Normal(s) => out.push(s),
        }
    }
    if out.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        out
    }
}

fn create_dir_private(dir: &Path, recursive: bool) -> std::io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(recursive);
    #[cfg(unix)]
    builder.mode(0o700);
    builder.create(dir)
}

fn write_bytes_private(file: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AppError::internal(format!("Could not create directory: {e}")))?;
    }
    let mut temp_os = OsString::from(file.as_os_str());
    temp_os.push(format!(".{}.tmp", uid()));
    let temp = PathBuf::from(temp_os);

    let write_res = (|| -> std::io::Result<()> {
        let mut opts = OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        opts.mode(0o600);
        let mut handle = opts.open(&temp)?;
        handle.write_all(bytes)?;
        handle.sync_all()?;
        drop(handle);
        fs::rename(&temp, file)?;
        Ok(())
    })();

    if fs::symlink_metadata(&temp).is_ok() {
        let _ = fs::remove_file(&temp);
    }

    write_res.map_err(|e| {
        let name = file
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("file");
        AppError::internal(format!("Could not write {name}: {e}"))
    })
}

fn write_json<T: Serialize>(file: &Path, value: &T) -> AppResult<()> {
    let mut serialized = serde_json::to_string_pretty(value)
        .map_err(|e| AppError::internal(format!("Could not serialize JSON: {e}")))?;
    serialized.push('\n');
    write_bytes_private(file, serialized.as_bytes())
}

fn read_json_opt<T: DeserializeOwned>(file: &Path) -> AppResult<Option<T>> {
    match fs::read_to_string(file) {
        Ok(content) => serde_json::from_str(&content).map(Some).map_err(|_| {
            let name = file
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("file");
            AppError::internal(format!("Could not read {name}."))
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => {
            let name = file
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("file");
            Err(AppError::internal(format!("Could not read {name}.")))
        }
    }
}

fn read_json_or<T: DeserializeOwned>(file: &Path, fallback: impl FnOnce() -> T) -> AppResult<T> {
    Ok(read_json_opt(file)?.unwrap_or_else(fallback))
}

fn files_in_dir(dir: &Path) -> AppResult<Vec<String>> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => {
            return Err(AppError::internal(format!(
                "Could not list directory: {e}"
            )))
        }
    };
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| AppError::internal(format!("Directory error: {e}")))?;
        let ft = entry
            .file_type()
            .map_err(|e| AppError::internal(format!("File type error: {e}")))?;
        if ft.is_file() {
            if let Some(name) = entry.file_name().to_str() {
                names.push(name.to_string());
            }
        }
    }
    Ok(names)
}

fn clear_dir(dir: &Path) -> AppResult<()> {
    match fs::symlink_metadata(dir) {
        Ok(_) => fs::remove_dir_all(dir)
            .map_err(|e| AppError::internal(format!("Could not clear directory: {e}")))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            return Err(AppError::internal(format!(
                "Could not access directory: {e}"
            )))
        }
    }
    fs::create_dir_all(dir)
        .map_err(|e| AppError::internal(format!("Could not recreate directory: {e}")))
}

fn slug(name: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in name.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.len() > 58 {
        out.truncate(58);
        while out.ends_with('-') {
            out.pop();
        }
    }
    if out.is_empty() {
        "project".to_string()
    } else {
        out
    }
}

fn windows_device_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)").unwrap()
    })
}

fn source_filename(name: &str) -> String {
    let replaced: String = name
        .chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
                || (c as u32) <= 0x1f
            {
                '_'
            } else {
                c
            }
        })
        .collect();
    let stripped = replaced.trim_end_matches(&['.', ' '][..]).trim();
    let mut safe = if stripped.is_empty()
        || stripped == "."
        || stripped == ".."
        || windows_device_regex().is_match(stripped)
    {
        format!(
            "file_{}",
            if stripped.is_empty() { "source" } else { stripped }
        )
    } else {
        stripped.to_string()
    };
    while safe.len() > 220 {
        safe.pop();
    }
    safe
}

fn base64_pattern() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[A-Za-z0-9+/]*={0,2}$").unwrap())
}

fn safe_base64(value: Option<&str>, max: usize) -> AppResult<Vec<u8>> {
    let max_encoded = max.div_ceil(3) * 4 + 4;
    let Some(s) = value else {
        return Err(AppError::bad_request("Invalid or oversized file."));
    };
    if s.len() > max_encoded || s.len() % 4 != 0 || !base64_pattern().is_match(s) {
        return Err(AppError::bad_request("Invalid or oversized file."));
    }
    let data = BASE64_STANDARD
        .decode(s)
        .map_err(|_| AppError::bad_request("Invalid or oversized file."))?;
    if data.len() > max {
        return Err(AppError::bad_request("File is too large."));
    }
    Ok(data)
}

/// Normalizes and validates a curriculum JSON array, keeping valid non-duplicate
/// IDs when `preserve_ids` is true and minting fresh UUIDs otherwise.
pub fn normalize_curriculum(value: Value, preserve_ids: bool) -> AppResult<Vec<Module>> {
    let Some(raw_modules) = value.as_array() else {
        return Err(AppError::bad_request(
            "Curriculum must contain an array of up to 200 modules.",
        ));
    };
    if raw_modules.len() > 200 {
        return Err(AppError::bad_request(
            "Curriculum must contain an array of up to 200 modules.",
        ));
    }

    let mut seen = HashSet::new();
    let mut allocate = |candidate: Option<&str>| -> String {
        let next = match candidate {
            Some(c) if preserve_ids && valid_id(c) && !seen.contains(c) => c.to_string(),
            _ => uid(),
        };
        seen.insert(next.clone());
        next
    };

    let mut total_lessons = 0usize;
    let mut modules = Vec::with_capacity(raw_modules.len());

    for raw_mod in raw_modules {
        let Some(mod_obj) = raw_mod.as_object() else {
            return Err(AppError::bad_request(
                "Each module needs a title and lessons array.",
            ));
        };
        let Some(raw_lessons) = mod_obj.get("lessons").and_then(Value::as_array) else {
            return Err(AppError::bad_request(
                "Each module needs a title and lessons array.",
            ));
        };
        total_lessons += raw_lessons.len();
        if total_lessons > 3000 {
            return Err(AppError::bad_request(
                "Curriculum contains too many lessons.",
            ));
        }

        let mod_id = allocate(mod_obj.get("id").and_then(Value::as_str));
        let mod_title = required_text(
            mod_obj.get("title").and_then(Value::as_str),
            "Module title",
            300,
        )?;
        let mod_desc = clamp_text(mod_obj.get("description").and_then(Value::as_str), 5000);

        let mut lessons = Vec::with_capacity(raw_lessons.len());
        for raw_lesson in raw_lessons {
            let Some(lesson_obj) = raw_lesson.as_object() else {
                return Err(AppError::bad_request("Invalid lesson."));
            };
            let lesson_id = allocate(lesson_obj.get("id").and_then(Value::as_str));
            let lesson_title = required_text(
                lesson_obj.get("title").and_then(Value::as_str),
                "Lesson title",
                300,
            )?;
            let lesson_desc =
                clamp_text(lesson_obj.get("description").and_then(Value::as_str), 10000);
            lessons.push(Lesson {
                id: lesson_id,
                title: lesson_title,
                description: lesson_desc,
            });
        }

        modules.push(Module {
            id: mod_id,
            title: mod_title,
            description: mod_desc,
            lessons,
        });
    }

    Ok(modules)
}

/// Parses a plain-text or Markdown course outline into normalized curriculum modules.
pub fn parse_outline(raw: Option<&str>) -> AppResult<Vec<Module>> {
    static H2_RE: OnceLock<Regex> = OnceLock::new();
    static HEADING_RE: OnceLock<Regex> = OnceLock::new();
    static MODULE_LABEL_RE: OnceLock<Regex> = OnceLock::new();
    static BULLET_RE: OnceLock<Regex> = OnceLock::new();

    let h2_re = H2_RE.get_or_init(|| Regex::new(r"^##\s+").unwrap());
    let heading_re = HEADING_RE.get_or_init(|| Regex::new(r"^(#{1,3})\s+(.+)$").unwrap());
    let module_label_re = MODULE_LABEL_RE.get_or_init(|| {
        Regex::new(r"(?i)^(?:module|unit|chapter|part|section)\s+[\w.-]+\s*[:.\-–—]?\s*(.*)$")
            .unwrap()
    });
    let bullet_re = BULLET_RE
        .get_or_init(|| Regex::new(r"^(?:[-*+•]\s+|\d+(?:\.\d+)*[.)]\s+)(.+)$").unwrap());

    let source = required_text(raw, "Outline", 100000)?;
    let rows: Vec<&str> = source
        .split('\n')
        .map(|s| s.strip_suffix('\r').unwrap_or(s))
        .filter(|x| !x.trim().is_empty())
        .collect();

    let has_h2 = rows.iter().any(|r| h2_re.is_match(r.trim()));
    let mut modules: Vec<Value> = Vec::new();

    let start = |modules: &mut Vec<Value>, title: &str| {
        modules.push(serde_json::json!({
            "title": title.trim(),
            "lessons": []
        }));
    };
    let add = |modules: &mut Vec<Value>, title: &str| {
        if modules.is_empty() {
            modules.push(serde_json::json!({
                "title": "Topics",
                "lessons": []
            }));
        }
        if let Some(last) = modules.last_mut().and_then(Value::as_object_mut) {
            if let Some(lessons) = last.get_mut("lessons").and_then(Value::as_array_mut) {
                lessons.push(serde_json::json!({ "title": title.trim() }));
            }
        }
    };

    for raw_line in &rows {
        let line = raw_line.trim();
        let starts_with_ws = raw_line.chars().next().is_some_and(char::is_whitespace);
        let heading = heading_re.captures(line);
        let module_label = module_label_re.is_match(line);
        let bullet = bullet_re.captures(line);

        if let Some(ref cap) = heading {
            if cap[1].len() == 1 && has_h2 {
                continue;
            }
            if cap[1].len() <= 2 {
                start(&mut modules, &cap[2]);
                continue;
            }
        }
        if module_label && !starts_with_ws {
            start(&mut modules, line);
        } else if let Some(cap) = heading {
            add(&mut modules, cap[2].trim());
        } else if let Some(cap) = bullet {
            add(&mut modules, cap[1].trim());
        } else if line.ends_with(':') && !starts_with_ws {
            start(&mut modules, &line[..line.len() - 1]);
        } else {
            add(&mut modules, line);
        }
    }

    normalize_curriculum(Value::Array(modules), true)
}

fn archive_category(relative: &str) -> Option<&'static str> {
    static MAT_RE: OnceLock<Regex> = OnceLock::new();
    static GEN_RE: OnceLock<Regex> = OnceLock::new();
    static SESS_RE: OnceLock<Regex> = OnceLock::new();
    static CACHE_RE: OnceLock<Regex> = OnceLock::new();

    if relative.encode_utf16().count() > 512
        || relative.contains('\\')
        || relative
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
    {
        return None;
    }
    if relative == "curriculum.json" || relative == "materials/index.json" {
        return Some("content");
    }
    let mat_re = MAT_RE
        .get_or_init(|| Regex::new(r"^materials/([a-zA-Z0-9_-]{1,100})/([^/]+)$").unwrap());
    if let Some(cap) = mat_re.captures(relative) {
        if valid_id(&cap[1]) && source_filename(&cap[2]).as_str() == &cap[2] {
            return Some("content");
        }
    }
    let gen_re = GEN_RE.get_or_init(|| Regex::new(r"^generated/([a-zA-Z0-9_-]{1,100})\.json$").unwrap());
    if let Some(cap) = gen_re.captures(relative) {
        if valid_id(&cap[1]) {
            return Some("generated");
        }
    }
    if matches!(
        relative,
        "learning-history/graph.json"
            | "learning-history/progress.json"
            | "learning-history/planner.json"
    ) {
        return Some("history");
    }
    let sess_re = SESS_RE.get_or_init(|| {
        Regex::new(r"^learning-history/sessions/([a-zA-Z0-9_-]{1,100})\.json$").unwrap()
    });
    if let Some(cap) = sess_re.captures(relative) {
        if valid_id(&cap[1]) {
            return Some("history");
        }
    }
    let cache_re =
        CACHE_RE.get_or_init(|| Regex::new(r"^cache/(?:[a-zA-Z0-9_.-]+/)*[a-zA-Z0-9_.-]+$").unwrap());
    if cache_re.is_match(relative) {
        return Some("cache");
    }
    None
}

fn parse_json(bytes: &[u8], name: &str) -> AppResult<Value> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| AppError::bad_request(format!("Invalid JSON in {name}.")))?;
    serde_json::from_str(text)
        .map_err(|_| AppError::bad_request(format!("Invalid JSON in {name}.")))
}

fn validate_curriculum(value: &Value) -> AppResult<()> {
    let normalized = normalize_curriculum(value.clone(), true)?;
    let arr = value
        .as_array()
        .ok_or_else(|| AppError::bad_request("Invalid or duplicate curriculum IDs."))?;

    let mut original_ids: Vec<Option<&str>> = Vec::new();
    for m in arr {
        let obj = m
            .as_object()
            .ok_or_else(|| AppError::bad_request("Invalid or duplicate curriculum IDs."))?;
        original_ids.push(obj.get("id").and_then(Value::as_str));
        let lessons = obj
            .get("lessons")
            .and_then(Value::as_array)
            .ok_or_else(|| AppError::bad_request("Invalid or duplicate curriculum IDs."))?;
        for l in lessons {
            original_ids.push(
                l.as_object()
                    .and_then(|lo| lo.get("id"))
                    .and_then(Value::as_str),
            );
        }
    }

    let mut normalized_ids: Vec<&str> = Vec::with_capacity(original_ids.len());
    for m in &normalized {
        normalized_ids.push(m.id.as_str());
        for l in &m.lessons {
            normalized_ids.push(l.id.as_str());
        }
    }

    if original_ids.len() != normalized_ids.len()
        || original_ids
            .iter()
            .zip(normalized_ids.iter())
            .any(|(orig, norm)| *orig != Some(*norm))
    {
        return Err(AppError::bad_request(
            "Invalid or duplicate curriculum IDs.",
        ));
    }

    for m in arr {
        let obj = m.as_object().unwrap();
        if obj.get("description").and_then(Value::as_str).is_none() {
            return Err(AppError::bad_request("Invalid curriculum description."));
        }
        for l in obj.get("lessons").and_then(Value::as_array).unwrap() {
            if l.as_object()
                .and_then(|lo| lo.get("description"))
                .and_then(Value::as_str)
                .is_none()
            {
                return Err(AppError::bad_request("Invalid curriculum description."));
            }
        }
    }

    Ok(())
}

fn validate_materials(value: &Value, entries: &BTreeMap<String, Vec<u8>>) -> AppResult<()> {
    let Some(arr) = value.as_array() else {
        return Err(AppError::bad_request("Invalid material index."));
    };
    if arr.len() > 5000 {
        return Err(AppError::bad_request("Invalid material index."));
    }
    let mut seen = HashSet::new();
    for item in arr {
        let Some(m) = item.as_object() else {
            return Err(AppError::bad_request("Invalid material record."));
        };
        let raw_id = m.get("id").and_then(Value::as_str).unwrap_or("");
        let mid = check_id(raw_id)?;
        if seen.contains(mid) {
            return Err(AppError::bad_request("Invalid material record."));
        }
        let Some(name) = m.get("name").and_then(Value::as_str) else {
            return Err(AppError::bad_request("Invalid material record."));
        };
        if name.chars().any(|c| matches!(c, '\r' | '\n' | '\0')) {
            return Err(AppError::bad_request("Invalid material record."));
        }
        let Some(file_name) = m.get("fileName").and_then(Value::as_str) else {
            return Err(AppError::bad_request("Invalid material record."));
        };
        if file_name.is_empty() || source_filename(file_name) != file_name {
            return Err(AppError::bad_request("Invalid material record."));
        }
        if m.get("mime").and_then(Value::as_str).is_none()
            || m.get("createdAt").and_then(Value::as_str).is_none()
        {
            return Err(AppError::bad_request("Invalid material record."));
        }
        let Some(size) = m.get("size").and_then(Value::as_u64) else {
            return Err(AppError::bad_request("Invalid material record."));
        };
        let path = format!("materials/{mid}/{file_name}");
        let Some(bytes) = entries.get(&path) else {
            return Err(AppError::bad_request("Invalid material record."));
        };
        if bytes.len() as u64 != size {
            return Err(AppError::bad_request("Invalid material record."));
        }
        seen.insert(mid.to_string());
    }
    Ok(())
}

fn validate_generated(value: &Value, relative: &str) -> AppResult<()> {
    let Some(obj) = value.as_object() else {
        return Err(AppError::bad_request("Invalid study material."));
    };
    let raw_id = obj.get("id").and_then(Value::as_str).unwrap_or("");
    let gid = check_id(raw_id)?;
    if obj.get("title").and_then(Value::as_str).is_none()
        || obj.get("body").and_then(Value::as_str).is_none()
        || obj.get("createdAt").and_then(Value::as_str).is_none()
        || relative != format!("generated/{gid}.json")
    {
        return Err(AppError::bad_request("Invalid study material."));
    }
    Ok(())
}

fn valid_message_search(message: &serde_json::Map<String, Value>) -> bool {
    let Some(ws_val) = message.get("webSearch") else {
        return true;
    };
    if message.get("role").and_then(Value::as_str) != Some("assistant") {
        return false;
    }
    let Some(search) = ws_val.as_object() else {
        return false;
    };
    let Some(query) = search.get("query").and_then(Value::as_str) else {
        return false;
    };
    if query.encode_utf16().count() > 500 {
        return false;
    }
    let Some(status) = search.get("status").and_then(Value::as_str) else {
        return false;
    };
    if !matches!(status, "ok" | "no-results" | "unavailable") {
        return false;
    }
    let Some(sources) = search.get("sources").and_then(Value::as_array) else {
        return false;
    };
    if sources.len() > 5 {
        return false;
    }
    if status == "ok" {
        let provider_ok = search
            .get("provider")
            .and_then(Value::as_str)
            .is_some_and(|p| matches!(p, "Exa" | "Purili"));
        if !provider_ok || sources.is_empty() {
            return false;
        }
    } else if search.contains_key("provider") || !sources.is_empty() {
        return false;
    }

    sources.iter().all(|source| {
        let Some(so) = source.as_object() else {
            return false;
        };
        let Some(title) = so.get("title").and_then(Value::as_str) else {
            return false;
        };
        let Some(url_str) = so.get("url").and_then(Value::as_str) else {
            return false;
        };
        if title.encode_utf16().count() > 300 || url_str.encode_utf16().count() > 2000 {
            return false;
        }
        match Url::parse(url_str) {
            Ok(parsed) => {
                matches!(parsed.scheme(), "http" | "https")
                    && parsed.username().is_empty()
                    && parsed.password().is_none()
            }
            Err(_) => false,
        }
    })
}

fn validate_session(value: &Value, relative: &str) -> AppResult<()> {
    let Some(obj) = value.as_object() else {
        return Err(AppError::bad_request("Invalid learning session."));
    };
    let raw_id = obj.get("id").and_then(Value::as_str).unwrap_or("");
    let sid = check_id(raw_id)?;
    if relative != format!("learning-history/sessions/{sid}.json") {
        return Err(AppError::bad_request("Invalid learning session."));
    }
    if !obj
        .get("lessonId")
        .and_then(Value::as_str)
        .is_some_and(valid_id)
        || !obj
            .get("mode")
            .and_then(Value::as_str)
            .is_some_and(|m| matches!(m, "learn" | "practice"))
        || obj.get("lessonTitle").and_then(Value::as_str).is_none()
        || obj.get("createdAt").and_then(Value::as_str).is_none()
        || obj.get("updatedAt").and_then(Value::as_str).is_none()
    {
        return Err(AppError::bad_request("Invalid learning session."));
    }
    let Some(messages) = obj.get("messages").and_then(Value::as_array) else {
        return Err(AppError::bad_request("Invalid learning session."));
    };
    for msg in messages {
        let Some(m) = msg.as_object() else {
            return Err(AppError::bad_request("Invalid learning session."));
        };
        let Some(role) = m.get("role").and_then(Value::as_str) else {
            return Err(AppError::bad_request("Invalid learning session."));
        };
        if !m.get("id").and_then(Value::as_str).is_some_and(valid_id)
            || !matches!(role, "user" | "assistant")
            || m.get("content").and_then(Value::as_str).is_none()
            || !valid_message_search(m)
        {
            return Err(AppError::bad_request("Invalid learning session."));
        }
        if let Some(q_val) = m.get("question") {
            let Some(q) = q_val.as_object() else {
                return Err(AppError::bad_request("Invalid learning session."));
            };
            let Some(opts) = q.get("options").and_then(Value::as_array) else {
                return Err(AppError::bad_request("Invalid learning session."));
            };
            if role != "assistant"
                || !q
                    .get("kind")
                    .and_then(Value::as_str)
                    .is_some_and(|k| matches!(k, "prediction" | "check" | "practice"))
                || q.get("prompt").and_then(Value::as_str).is_none()
                || opts.len() > 5
                || opts.iter().any(|v| v.as_str().is_none())
            {
                return Err(AppError::bad_request("Invalid learning session."));
            }
        }
    }
    let Some(material_ids) = obj.get("materialIds").and_then(Value::as_array) else {
        return Err(AppError::bad_request("Invalid learning session."));
    };
    if material_ids
        .iter()
        .any(|id_val| !id_val.as_str().is_some_and(valid_id))
    {
        return Err(AppError::bad_request("Invalid learning session."));
    }
    Ok(())
}

fn valid_evidence(value: Option<&Value>) -> bool {
    let Some(val) = value else {
        return true;
    };
    let Some(arr) = val.as_array() else {
        return false;
    };
    arr.iter().all(|item| {
        item.as_object().is_some_and(|o| {
            o.get("sessionId").and_then(Value::as_str).is_some_and(valid_id)
                && o.get("messageId").and_then(Value::as_str).is_some_and(valid_id)
        })
    })
}

fn validate_graph(value: &Value) -> AppResult<()> {
    let Some(obj) = value.as_object() else {
        return Err(AppError::bad_request("Invalid knowledge map."));
    };
    let Some(nodes) = obj.get("nodes").and_then(Value::as_array) else {
        return Err(AppError::bad_request("Invalid knowledge map."));
    };
    let Some(edges) = obj.get("edges").and_then(Value::as_array) else {
        return Err(AppError::bad_request("Invalid knowledge map."));
    };
    if nodes.len() > 50000 || edges.len() > 100000 {
        return Err(AppError::bad_request("Invalid knowledge map."));
    }

    let mut ids = HashSet::new();
    for node in nodes {
        let Some(n) = node.as_object() else {
            return Err(AppError::bad_request("Invalid knowledge node."));
        };
        let raw_id = n.get("id").and_then(Value::as_str).unwrap_or("");
        let nid = check_id(raw_id)?;
        let Some(sources) = n.get("sources").and_then(Value::as_array) else {
            return Err(AppError::bad_request("Invalid knowledge node."));
        };
        if ids.contains(nid)
            || n.get("title").and_then(Value::as_str).is_none()
            || n.get("statement").and_then(Value::as_str).is_none()
            || sources.iter().any(|s| !s.as_str().is_some_and(valid_id))
            || !valid_evidence(n.get("evidence"))
        {
            return Err(AppError::bad_request("Invalid knowledge node."));
        }
        ids.insert(nid.to_string());
    }

    for edge in edges {
        let Some(e) = edge.as_object() else {
            return Err(AppError::bad_request("Invalid knowledge connection."));
        };
        let from_ok = e
            .get("from")
            .and_then(Value::as_str)
            .is_some_and(|f| ids.contains(f));
        let to_ok = e
            .get("to")
            .and_then(Value::as_str)
            .is_some_and(|t| ids.contains(t));
        let sources_ok = match e.get("sources") {
            None => true,
            Some(s_val) => s_val
                .as_array()
                .is_some_and(|arr| arr.iter().all(|s| s.as_str().is_some_and(valid_id))),
        };
        if !from_ok || !to_ok || !sources_ok || !valid_evidence(e.get("evidence")) {
            return Err(AppError::bad_request("Invalid knowledge connection."));
        }
    }

    Ok(())
}

fn validate_progress(value: &Value) -> AppResult<()> {
    let Some(obj) = value.as_object() else {
        return Err(AppError::bad_request("Invalid lesson progress."));
    };
    if obj.iter().any(|(k, v)| {
        !valid_id(k) || !matches!(v.as_str(), Some("started") | Some("complete"))
    }) {
        return Err(AppError::bad_request("Invalid lesson progress."));
    }
    Ok(())
}

fn validate_planner(value: &Value) -> AppResult<()> {
    let Some(obj) = value.as_object() else {
        return Err(AppError::bad_request("Invalid curriculum conversation."));
    };
    if let Some(pid) = obj.get("id") {
        if !pid.as_str().is_some_and(valid_id) {
            return Err(AppError::bad_request("Invalid curriculum conversation."));
        }
    }
    let Some(messages) = obj.get("messages").and_then(Value::as_array) else {
        return Err(AppError::bad_request("Invalid curriculum conversation."));
    };
    for msg in messages {
        let Some(m) = msg.as_object() else {
            return Err(AppError::bad_request("Invalid curriculum conversation."));
        };
        if !m
            .get("role")
            .and_then(Value::as_str)
            .is_some_and(|r| matches!(r, "assistant" | "user"))
            || m.get("content").and_then(Value::as_str).is_none()
            || !valid_message_search(m)
        {
            return Err(AppError::bad_request("Invalid curriculum conversation."));
        }
    }
    match obj.get("proposal") {
        Some(proposal) if proposal.is_null() => Ok(()),
        Some(proposal) => validate_curriculum(proposal),
        None => validate_curriculum(&Value::Null),
    }
}

fn prune_exchange_evidence(
    sources: Option<&[String]>,
    evidence: Option<&[Evidence]>,
    session_id: &str,
    message_ids: &HashSet<String>,
) -> Option<(Vec<String>, Vec<Evidence>)> {
    let ev = evidence?;
    if ev.is_empty() {
        return None;
    }
    let remaining: Vec<Evidence> = ev
        .iter()
        .filter(|v| v.session_id != session_id || !message_ids.contains(&v.message_id))
        .cloned()
        .collect();
    if remaining.len() == ev.len() {
        return None;
    }
    let tracked_before: HashSet<&str> = ev.iter().map(|v| v.session_id.as_str()).collect();
    let mut new_sources = Vec::new();
    let mut seen = HashSet::new();
    if let Some(orig) = sources {
        for s in orig {
            if !tracked_before.contains(s.as_str()) && seen.insert(s.clone()) {
                new_sources.push(s.clone());
            }
        }
    }
    for v in &remaining {
        if seen.insert(v.session_id.clone()) {
            new_sources.push(v.session_id.clone());
        }
    }
    Some((new_sources, remaining))
}

#[derive(Debug, Clone)]
pub struct Storage {
    root: PathBuf,
    projects: PathBuf,
}

impl Storage {
    pub fn new(root: impl AsRef<Path>) -> AppResult<Self> {
        let root = resolve_path(root.as_ref());
        let projects = root.join("projects");
        create_dir_private(&projects, true)
            .map_err(|e| AppError::internal(format!("Could not initialize storage: {e}")))?;
        Ok(Self { root, projects })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn settings(&self) -> AppResult<Settings> {
        read_json_or(&self.root.join("settings.json"), Settings::default)
    }

    pub fn save_settings(&self, value: &Settings) -> AppResult<()> {
        write_json(&self.root.join("settings.json"), value)
    }

    pub fn list(&self) -> AppResult<Vec<ProjectSummary>> {
        let entries = fs::read_dir(&self.projects)
            .map_err(|e| AppError::internal(format!("Could not list projects: {e}")))?;
        let mut summaries = Vec::new();
        for entry in entries {
            let Ok(entry) = entry else { continue };
            let Ok(ft) = entry.file_type() else { continue };
            if !ft.is_dir() {
                continue;
            }
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if !valid_id(&name) {
                continue;
            }
            let Ok(project) = self.project(&name) else {
                continue;
            };
            let Ok(meta) = project.meta() else {
                continue;
            };
            let Ok(curriculum) = project.curriculum() else {
                continue;
            };
            let lesson_count = curriculum.iter().map(|m| m.lessons.len()).sum();
            summaries.push(ProjectSummary { meta, lesson_count });
        }
        summaries.sort_by(|a, b| b.meta.updated_at.cmp(&a.meta.updated_at));
        Ok(summaries)
    }

    pub fn create(&self, name: Option<&str>) -> AppResult<Project> {
        let name = required_text(name, "Project name", 120)?;
        let project_id = format!("{}-{}", slug(&name), &uid()[..8]);
        let dir = self.projects.join(&project_id);
        create_dir_private(&dir, false)
            .map_err(|e| AppError::internal(format!("Could not create project directory: {e}")))?;
        let project = Project {
            dir,
            id: project_id.clone(),
        };
        let created_at = now();
        write_json(
            &project.file("project.json")?,
            &ProjectMeta {
                version: VERSION,
                id: project_id,
                name,
                created_at: created_at.clone(),
                updated_at: created_at,
            },
        )?;
        write_json(&project.file("curriculum.json")?, &Vec::<Module>::new())?;
        for subdir in ["materials", "generated", "learning-history/sessions", "cache"] {
            fs::create_dir_all(project.file(subdir)?)
                .map_err(|e| AppError::internal(format!("Could not create {subdir}: {e}")))?;
        }
        Ok(project)
    }

    pub fn project(&self, project_id: &str) -> AppResult<Project> {
        check_id(project_id)?;
        let directory = self.projects.join(project_id);
        let stat = fs::symlink_metadata(&directory)
            .map_err(|_| AppError::not_found("Project not found."))?;
        if !stat.is_dir() || stat.file_type().is_symlink() {
            return Err(AppError::not_found("Project not found."));
        }
        let project = Project {
            dir: directory,
            id: project_id.to_string(),
        };
        project.meta()?;
        Ok(project)
    }

    pub fn delete(&self, project_id: &str) -> AppResult<()> {
        let project = self.project(project_id)?;
        fs::remove_dir_all(project.dir())
            .map_err(|e| AppError::internal(format!("Could not delete project: {e}")))?;
        Ok(())
    }

    pub fn import(&self, archive: Value) -> AppResult<Project> {
        let Some(obj) = archive.as_object() else {
            return Err(AppError::bad_request("This is not a supported .learn file."));
        };
        if obj.get("format").and_then(Value::as_str) != Some("minilearn")
            || obj.get("version").and_then(Value::as_u64) != Some(VERSION as u64)
        {
            return Err(AppError::bad_request("This is not a supported .learn file."));
        }
        let Some(files) = obj.get("files").and_then(Value::as_array) else {
            return Err(AppError::bad_request("This is not a supported .learn file."));
        };
        if files.len() > 20000 {
            return Err(AppError::bad_request("Archive contains too many files."));
        }
        let name = required_text(
            obj.get("name").and_then(Value::as_str),
            "Project name",
            120,
        )?;

        let mut entries: BTreeMap<String, Vec<u8>> = BTreeMap::new();
        let mut total: usize = 0;
        for entry_val in files {
            let Some(entry) = entry_val.as_object() else {
                return Err(AppError::bad_request(
                    "Archive includes an invalid or duplicate path.",
                ));
            };
            let Some(rel) = entry.get("path").and_then(Value::as_str) else {
                return Err(AppError::bad_request(
                    "Archive includes an invalid or duplicate path.",
                ));
            };
            if archive_category(rel).is_none() || entries.contains_key(rel) {
                return Err(AppError::bad_request(
                    "Archive includes an invalid or duplicate path.",
                ));
            }
            let bytes = safe_base64(entry.get("data").and_then(Value::as_str), MAX_ARCHIVE)?;
            total = total.checked_add(bytes.len()).ok_or_else(|| {
                AppError::bad_request("Project exceeds the 100 MB import limit.")
            })?;
            if total > MAX_ARCHIVE {
                return Err(AppError::bad_request(
                    "Project exceeds the 100 MB import limit.",
                ));
            }
            entries.insert(rel.to_string(), bytes);
        }

        // Parse and validate all JSON metadata before writing a project directory.
        for (relative, bytes) in &entries {
            if relative == "curriculum.json" {
                validate_curriculum(&parse_json(bytes, relative)?)?;
            } else if relative == "materials/index.json" {
                validate_materials(&parse_json(bytes, relative)?, &entries)?;
            } else if relative.starts_with("generated/") {
                validate_generated(&parse_json(bytes, relative)?, relative)?;
            } else if relative.starts_with("learning-history/sessions/") {
                validate_session(&parse_json(bytes, relative)?, relative)?;
            } else if relative == "learning-history/graph.json" {
                validate_graph(&parse_json(bytes, relative)?)?;
            } else if relative == "learning-history/progress.json" {
                validate_progress(&parse_json(bytes, relative)?)?;
            } else if relative == "learning-history/planner.json" {
                validate_planner(&parse_json(bytes, relative)?)?;
            }
        }

        let material_paths: HashSet<String> = match entries.get("materials/index.json") {
            Some(bytes) => {
                let parsed = parse_json(bytes, "materials/index.json")?;
                parsed
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|m| {
                        let o = m.as_object()?;
                        let mid = o.get("id")?.as_str()?;
                        let fname = o.get("fileName")?.as_str()?;
                        Some(format!("materials/{mid}/{fname}"))
                    })
                    .collect()
            }
            None => HashSet::new(),
        };
        for relative in entries.keys() {
            if relative.starts_with("materials/")
                && relative != "materials/index.json"
                && !material_paths.contains(relative)
            {
                return Err(AppError::bad_request(
                    "Archive contains an unindexed source file.",
                ));
            }
        }

        let project = self.create(Some(&name))?;
        let import_result = (|| -> AppResult<()> {
            for (relative, bytes) in &entries {
                let dest = project.file(relative)?;
                write_bytes_private(&dest, bytes)?;
            }
            project.snapshot()?;
            Ok(())
        })();
        if let Err(err) = import_result {
            let _ = self.delete(project.id());
            return Err(err);
        }
        Ok(project)
    }
}

#[derive(Debug, Clone)]
pub struct Project {
    dir: PathBuf,
    id: String,
}

#[derive(Debug)]
struct WalkedFile {
    relative: String,
    file: PathBuf,
    category: &'static str,
    bytes: u64,
}

impl Project {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Resolves `relative` inside the project directory, rejecting path traversal
    /// and any symbolic link along the traversed path.
    pub fn file(&self, relative: &str) -> AppResult<PathBuf> {
        if relative.contains('\0') {
            return Err(AppError::bad_request("Invalid path."));
        }
        let rel_path = Path::new(relative);
        if rel_path.is_absolute() {
            return Err(AppError::bad_request("Invalid path."));
        }
        let base = resolve_path(&self.dir);
        let resolved = resolve_path(&base.join(rel_path));
        let rel = resolved
            .strip_prefix(&base)
            .map_err(|_| AppError::bad_request("Invalid path."))?;
        if rel.as_os_str().is_empty() {
            return Err(AppError::bad_request("Invalid path."));
        }

        let mut current = base;
        for part in rel.components() {
            current.push(part.as_os_str());
            match fs::symlink_metadata(&current) {
                Ok(meta) => {
                    if meta.file_type().is_symlink() {
                        return Err(AppError::bad_request(
                            "Project data cannot use symbolic links.",
                        ));
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
                Err(e) => {
                    return Err(AppError::internal(format!(
                        "Could not access project path: {e}"
                    )))
                }
            }
        }
        Ok(resolved)
    }

    pub fn meta(&self) -> AppResult<ProjectMeta> {
        let meta: Option<ProjectMeta> = read_json_opt(&self.file("project.json")?)?;
        match meta {
            Some(m) if m.id == self.id && m.version == VERSION => Ok(m),
            _ => Err(AppError::not_found("Invalid project.")),
        }
    }

    pub fn touch(&self) -> AppResult<()> {
        let mut meta = self.meta()?;
        meta.updated_at = now();
        write_json(&self.file("project.json")?, &meta)
    }

    pub fn rename(&self, name: Option<&str>) -> AppResult<()> {
        let mut meta = self.meta()?;
        meta.name = required_text(name, "Project name", 120)?;
        meta.updated_at = now();
        write_json(&self.file("project.json")?, &meta)
    }

    pub fn curriculum(&self) -> AppResult<Vec<Module>> {
        read_json_or(&self.file("curriculum.json")?, Vec::new)
    }

    pub fn save_curriculum(&self, value: Value) -> AppResult<Vec<Module>> {
        let curriculum = normalize_curriculum(value, true)?;
        write_json(&self.file("curriculum.json")?, &curriculum)?;
        self.touch()?;
        Ok(curriculum)
    }

    pub fn lesson(&self, lesson_id: &str) -> AppResult<LessonWithModule> {
        check_id(lesson_id)?;
        for module in self.curriculum()? {
            if let Some(lesson) = module.lessons.into_iter().find(|l| l.id == lesson_id) {
                return Ok(LessonWithModule {
                    id: lesson.id,
                    title: lesson.title,
                    description: lesson.description,
                    module_title: module.title,
                });
            }
        }
        Err(AppError::not_found("Lesson not found."))
    }

    pub fn materials(&self) -> AppResult<Vec<MaterialRecord>> {
        read_json_or(&self.file("materials/index.json")?, Vec::new)
    }

    pub fn material(&self, material_id: &str) -> AppResult<MaterialData> {
        check_id(material_id)?;
        let record = self
            .materials()?
            .into_iter()
            .find(|m| m.id == material_id)
            .ok_or_else(|| AppError::not_found("Material not found."))?;
        if record.file_name.is_empty() || source_filename(&record.file_name) != record.file_name {
            return Err(AppError::bad_request("Invalid material filename."));
        }
        let path = self.file(&format!("materials/{material_id}/{}", record.file_name))?;
        let bytes = fs::read(&path)
            .map_err(|e| AppError::internal(format!("Could not read material: {e}")))?;
        Ok(MaterialData { record, bytes })
    }

    pub fn add_material(
        &self,
        name: Option<&str>,
        mime: Option<&str>,
        data: Option<&str>,
    ) -> AppResult<MaterialRecord> {
        let raw_name = required_text(name, "File name", 255)?;
        let clean_name: String = raw_name
            .chars()
            .map(|c| {
                if c == '\\' || c == '/' || (c as u32) <= 0x1f {
                    '_'
                } else {
                    c
                }
            })
            .collect();
        let bytes = safe_base64(data, MAX_MATERIAL)?;
        let mime_clean = clamp_text(mime, 120);
        let record = MaterialRecord {
            id: uid(),
            file_name: source_filename(&clean_name),
            name: clean_name,
            mime: if mime_clean.is_empty() {
                "application/octet-stream".to_string()
            } else {
                mime_clean
            },
            size: bytes.len(),
            created_at: now(),
        };

        let mat_dir = self.file(&format!("materials/{}", record.id))?;
        fs::create_dir_all(&mat_dir)
            .map_err(|e| AppError::internal(format!("Could not create material directory: {e}")))?;
        let dest = self.file(&format!("materials/{}/{}", record.id, record.file_name))?;
        write_bytes_private(&dest, &bytes)?;

        let mut list = self.materials()?;
        list.push(record.clone());
        write_json(&self.file("materials/index.json")?, &list)?;
        self.touch()?;
        Ok(record)
    }

    pub fn delete_material(&self, material_id: &str) -> AppResult<()> {
        let material = self.material(material_id)?;
        let file_path = self.file(&format!(
            "materials/{material_id}/{}",
            material.record.file_name
        ))?;
        fs::remove_file(&file_path)
            .map_err(|e| AppError::internal(format!("Could not delete material: {e}")))?;
        let mat_dir = self.file(&format!("materials/{material_id}"))?;
        if let Err(e) = fs::remove_dir(&mat_dir) {
            let has_entries = fs::read_dir(&mat_dir)
                .ok()
                .and_then(|mut it| it.next())
                .is_some();
            if !has_entries {
                return Err(AppError::internal(format!(
                    "Could not delete material directory: {e}"
                )));
            }
        }
        let filtered: Vec<MaterialRecord> = self
            .materials()?
            .into_iter()
            .filter(|m| m.id != material_id)
            .collect();
        write_json(&self.file("materials/index.json")?, &filtered)?;
        self.touch()?;
        Ok(())
    }

    pub fn generated(&self) -> AppResult<Vec<GeneratedNote>> {
        let mut notes = Vec::new();
        for name in files_in_dir(&self.file("generated")?)? {
            if let Some(stem) = name.strip_suffix(".json") {
                if !stem.is_empty()
                    && stem
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                {
                    if let Some(note) =
                        read_json_opt::<GeneratedNote>(&self.file(&format!("generated/{name}"))?)?
                    {
                        notes.push(note);
                    }
                }
            }
        }
        notes.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(notes)
    }

    pub fn write_generated(
        &self,
        title: Option<&str>,
        body: Option<&str>,
        lesson_id: Option<&str>,
        existing_id: Option<&str>,
    ) -> AppResult<GeneratedNote> {
        let existing = existing_id.filter(|s| !s.is_empty());
        let note_id = match existing {
            Some(eid) => check_id(eid)?.to_string(),
            None => uid(),
        };
        let clean_title = required_text(title, "Note title", 300)?;
        let clean_body = required_text(body, "Note", 200000)?;
        let clean_lesson_id = match lesson_id.filter(|s| !s.is_empty()) {
            Some(lid) => Some(check_id(lid)?.to_string()),
            None => None,
        };
        let mut created_at = now();
        if let Some(eid) = existing {
            let previous: Option<GeneratedNote> =
                read_json_opt(&self.file(&format!("generated/{eid}.json"))?)?;
            let Some(prev) = previous else {
                return Err(AppError::not_found("Note not found."));
            };
            created_at = prev.created_at;
        }
        let record = GeneratedNote {
            id: note_id.clone(),
            title: clean_title,
            body: clean_body,
            lesson_id: clean_lesson_id,
            created_at,
        };
        write_json(&self.file(&format!("generated/{note_id}.json"))?, &record)?;
        self.touch()?;
        Ok(record)
    }

    pub fn delete_generated(&self, note_id: &str) -> AppResult<()> {
        let nid = check_id(note_id)?;
        let file = self.file(&format!("generated/{nid}.json"))?;
        match fs::symlink_metadata(&file) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(AppError::not_found("Note not found."))
            }
            Err(e) => return Err(AppError::internal(format!("Could not delete note: {e}"))),
        }
        fs::remove_file(&file)
            .map_err(|e| AppError::internal(format!("Could not delete note: {e}")))?;
        self.touch()?;
        Ok(())
    }

    pub fn sessions(&self) -> AppResult<Vec<Session>> {
        let mut list = Vec::new();
        for name in files_in_dir(&self.file("learning-history/sessions")?)? {
            if let Some(stem) = name.strip_suffix(".json") {
                if !stem.is_empty()
                    && stem
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                {
                    if let Some(session) = read_json_opt::<Session>(
                        &self.file(&format!("learning-history/sessions/{name}"))?,
                    )? {
                        list.push(session);
                    }
                }
            }
        }
        list.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(list)
    }

    pub fn session(&self, session_id: &str) -> AppResult<Session> {
        let sid = check_id(session_id)?;
        let session: Option<Session> =
            read_json_opt(&self.file(&format!("learning-history/sessions/{sid}.json"))?)?;
        session.ok_or_else(|| AppError::not_found("Session not found."))
    }

    pub fn new_session(&self, lesson_id: Option<&str>, mode: Option<&str>) -> AppResult<Session> {
        let Some(mode_str) = mode.filter(|m| matches!(*m, "learn" | "practice")) else {
            return Err(AppError::bad_request("Invalid session mode."));
        };
        let lid = lesson_id.unwrap_or("");
        let lesson = self.lesson(lid)?;
        let created_at = now();
        let mut session = Session {
            id: uid(),
            lesson_id: lid.to_string(),
            lesson_title: lesson.title,
            mode: mode_str.to_string(),
            created_at: created_at.clone(),
            updated_at: created_at,
            messages: Vec::new(),
            material_ids: Vec::new(),
        };
        self.save_session(&mut session)?;
        Ok(session)
    }

    pub fn save_session(&self, session: &mut Session) -> AppResult<()> {
        check_id(&session.id)?;
        session.updated_at = now();
        write_json(
            &self.file(&format!("learning-history/sessions/{}.json", session.id))?,
            session,
        )?;
        self.touch()?;
        Ok(())
    }

    pub fn delete_session(&self, session_id: &str) -> AppResult<()> {
        self.session(session_id)?;
        fs::remove_file(self.file(&format!("learning-history/sessions/{session_id}.json"))?)
            .map_err(|e| AppError::internal(format!("Could not delete session: {e}")))?;

        let graph = self.graph()?;
        let nodes: Vec<GraphNode> = graph
            .nodes
            .into_iter()
            .filter_map(|mut n| {
                n.sources.retain(|s| s != session_id);
                if let Some(ev) = &mut n.evidence {
                    ev.retain(|v| v.session_id != session_id);
                }
                if n.sources.is_empty() {
                    None
                } else {
                    Some(n)
                }
            })
            .collect();
        let remaining: HashSet<String> = nodes.iter().map(|n| n.id.clone()).collect();
        let edges: Vec<GraphEdge> = graph
            .edges
            .into_iter()
            .filter_map(|mut e| {
                if let Some(sources) = &mut e.sources {
                    sources.retain(|s| s != session_id);
                }
                if let Some(ev) = &mut e.evidence {
                    ev.retain(|v| v.session_id != session_id);
                }
                if remaining.contains(&e.from)
                    && remaining.contains(&e.to)
                    && e.sources.as_ref().map_or(true, |s| !s.is_empty())
                {
                    Some(e)
                } else {
                    None
                }
            })
            .collect();
        self.write_graph(&Graph { nodes, edges })?;
        self.touch()?;
        Ok(())
    }

    pub fn delete_exchange(&self, session_id: &str, message_id: &str) -> AppResult<Session> {
        let mut session = self.session(session_id)?;
        let mid = check_id(message_id)?;
        let idx = session
            .messages
            .iter()
            .position(|m| m.id == mid)
            .ok_or_else(|| AppError::not_found("Message not found."))?;
        let paired = if session.messages[idx].role == "assistant" {
            if idx > 0 && session.messages[idx - 1].role == "user" {
                Some(idx - 1)
            } else {
                None
            }
        } else if idx + 1 < session.messages.len() && session.messages[idx + 1].role == "assistant"
        {
            Some(idx + 1)
        } else {
            None
        };

        let mut removed = HashSet::new();
        removed.insert(session.messages[idx].id.clone());
        if let Some(p) = paired {
            removed.insert(session.messages[p].id.clone());
        }
        session.messages.retain(|m| !removed.contains(&m.id));
        self.save_session(&mut session)?;

        let graph = self.graph()?;
        let nodes: Vec<GraphNode> = graph
            .nodes
            .into_iter()
            .filter_map(|mut n| {
                match prune_exchange_evidence(
                    Some(&n.sources),
                    n.evidence.as_deref(),
                    session_id,
                    &removed,
                ) {
                    Some((new_sources, remaining)) => {
                        if new_sources.is_empty() {
                            None
                        } else {
                            n.sources = new_sources;
                            n.evidence = Some(remaining);
                            Some(n)
                        }
                    }
                    None => Some(n),
                }
            })
            .collect();
        let ids: HashSet<String> = nodes.iter().map(|n| n.id.clone()).collect();
        let edges: Vec<GraphEdge> = graph
            .edges
            .into_iter()
            .filter_map(|mut e| {
                let updated = match prune_exchange_evidence(
                    e.sources.as_deref(),
                    e.evidence.as_deref(),
                    session_id,
                    &removed,
                ) {
                    Some((new_sources, remaining)) => {
                        if new_sources.is_empty() {
                            return None;
                        }
                        e.sources = Some(new_sources);
                        e.evidence = Some(remaining);
                        e
                    }
                    None => e,
                };
                if ids.contains(&updated.from) && ids.contains(&updated.to) {
                    Some(updated)
                } else {
                    None
                }
            })
            .collect();
        self.write_graph(&Graph { nodes, edges })?;
        Ok(session)
    }

    pub fn progress(&self) -> AppResult<BTreeMap<String, String>> {
        read_json_or(&self.file("learning-history/progress.json")?, BTreeMap::new)
    }

    pub fn set_progress(&self, lesson_id: &str, status: Option<&str>) -> AppResult<()> {
        self.lesson(lesson_id)?;
        let mut value = self.progress()?;
        match status {
            None => {
                value.remove(lesson_id);
            }
            Some("started") | Some("complete") => {
                value.insert(lesson_id.to_string(), status.unwrap().to_string());
            }
            Some(_) => return Err(AppError::bad_request("Invalid progress status.")),
        }
        write_json(&self.file("learning-history/progress.json")?, &value)?;
        self.touch()?;
        Ok(())
    }

    pub fn graph(&self) -> AppResult<Graph> {
        read_json_or(&self.file("learning-history/graph.json")?, Graph::default)
    }

    pub fn write_graph(&self, graph: &Graph) -> AppResult<()> {
        write_json(&self.file("learning-history/graph.json")?, graph)
    }

    pub fn delete_node(&self, node_id: &str) -> AppResult<()> {
        let nid = check_id(node_id)?;
        let g = self.graph()?;
        let updated = Graph {
            nodes: g.nodes.into_iter().filter(|n| n.id != nid).collect(),
            edges: g
                .edges
                .into_iter()
                .filter(|e| e.from != nid && e.to != nid)
                .collect(),
        };
        self.write_graph(&updated)?;
        self.touch()?;
        Ok(())
    }

    pub fn clear_graph(&self) -> AppResult<()> {
        self.write_graph(&Graph::default())?;
        self.touch()?;
        Ok(())
    }

    pub fn planner(&self) -> AppResult<PlannerState> {
        read_json_or(
            &self.file("learning-history/planner.json")?,
            PlannerState::default,
        )
    }

    pub fn save_planner(&self, value: &PlannerState) -> AppResult<()> {
        write_json(&self.file("learning-history/planner.json")?, value)?;
        self.touch()?;
        Ok(())
    }

    pub fn clear_planner(&self) -> AppResult<()> {
        self.save_planner(&PlannerState::default())
    }

    pub fn snapshot(&self) -> AppResult<ProjectSnapshot> {
        let sessions: Vec<SessionSummary> = self
            .sessions()?
            .into_iter()
            .map(|s| SessionSummary {
                id: s.id,
                lesson_id: s.lesson_id,
                lesson_title: s.lesson_title,
                mode: s.mode,
                created_at: s.created_at,
                updated_at: s.updated_at,
                material_ids: s.material_ids,
                message_count: s.messages.len(),
            })
            .collect();
        Ok(ProjectSnapshot {
            meta: self.meta()?,
            folder: self.dir.to_string_lossy().into_owned(),
            curriculum: self.curriculum()?,
            materials: self.materials()?,
            generated: self.generated()?,
            sessions,
            graph: self.graph()?,
            progress: self.progress()?,
            planner: self.planner()?,
            storage: self.usage()?,
        })
    }

    fn walk(&self) -> AppResult<Vec<WalkedFile>> {
        let mut result = Vec::new();
        self.walk_dir(&self.dir, &mut result)?;
        result.sort_by(|a, b| a.relative.cmp(&b.relative));
        Ok(result)
    }

    fn walk_dir(&self, dir: &Path, result: &mut Vec<WalkedFile>) -> AppResult<()> {
        let entries = fs::read_dir(dir)
            .map_err(|e| AppError::internal(format!("Could not scan project directory: {e}")))?;
        for entry in entries {
            let entry =
                entry.map_err(|e| AppError::internal(format!("Could not read entry: {e}")))?;
            let ft = entry
                .file_type()
                .map_err(|e| AppError::internal(format!("Could not inspect entry: {e}")))?;
            let path = entry.path();
            if ft.is_dir() {
                self.walk_dir(&path, result)?;
            } else if ft.is_file() {
                let Ok(rel) = path.strip_prefix(&self.dir) else {
                    continue;
                };
                let relative = rel
                    .components()
                    .filter_map(|c| c.as_os_str().to_str())
                    .collect::<Vec<_>>()
                    .join("/");
                if let Some(category) = archive_category(&relative) {
                    let bytes = fs::metadata(&path)
                        .map_err(|e| {
                            AppError::internal(format!("Could not stat project file: {e}"))
                        })?
                        .len();
                    result.push(WalkedFile {
                        relative,
                        file: path,
                        category,
                        bytes,
                    });
                }
            }
        }
        Ok(())
    }

    pub fn usage(&self) -> AppResult<BTreeMap<String, CategoryUsage>> {
        let mut totals = BTreeMap::new();
        for cat in CATEGORIES {
            totals.insert(cat.to_string(), CategoryUsage::default());
        }
        for f in self.walk()? {
            if let Some(entry) = totals.get_mut(f.category) {
                entry.files += 1;
                entry.bytes += f.bytes;
            }
        }
        Ok(totals)
    }

    pub fn clear(&self, categories: &[String]) -> AppResult<()> {
        if categories
            .iter()
            .any(|c| !CATEGORIES.contains(&c.as_str()))
        {
            return Err(AppError::bad_request("Invalid data category."));
        }
        let unique: HashSet<&str> = categories.iter().map(String::as_str).collect();
        for category in unique {
            match category {
                "content" => {
                    write_json(&self.file("curriculum.json")?, &Vec::<Module>::new())?;
                    clear_dir(&self.file("materials")?)?;
                }
                "generated" => clear_dir(&self.file("generated")?)?,
                "history" => {
                    clear_dir(&self.file("learning-history")?)?;
                    fs::create_dir_all(self.file("learning-history/sessions")?).map_err(|e| {
                        AppError::internal(format!("Could not create sessions dir: {e}"))
                    })?;
                }
                "cache" => clear_dir(&self.file("cache")?)?,
                _ => {}
            }
        }
        self.touch()?;
        Ok(())
    }

    pub fn export(&self, categories: &[String]) -> AppResult<LearnArchive> {
        if categories
            .iter()
            .any(|c| !CATEGORIES.contains(&c.as_str()))
        {
            return Err(AppError::bad_request("Invalid export category."));
        }
        let selected_set: HashSet<&str> = categories.iter().map(String::as_str).collect();
        let selected: Vec<WalkedFile> = self
            .walk()?
            .into_iter()
            .filter(|f| selected_set.contains(f.category))
            .collect();
        let total_bytes: u64 = selected.iter().map(|f| f.bytes).sum();
        if total_bytes > MAX_ARCHIVE as u64 {
            return Err(AppError::bad_request("Export exceeds the 100 MB limit."));
        }

        let mut files = Vec::with_capacity(selected.len());
        for f in selected {
            let bytes = fs::read(&f.file)
                .map_err(|e| AppError::internal(format!("Could not read export file: {e}")))?;
            files.push(ArchiveFile {
                path: f.relative,
                data: BASE64_STANDARD.encode(&bytes),
            });
        }

        Ok(LearnArchive {
            format: "minilearn".to_string(),
            version: VERSION,
            name: self.meta()?.name,
            exported_at: Some(now()),
            categories: Some(categories.to_vec()),
            files,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(prefix: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("{prefix}-{}", Uuid::new_v4()));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn fixture(prefix: &str) -> (TempDir, Storage) {
        let dir = TempDir::new(prefix);
        let storage = Storage::new(dir.path()).unwrap();
        (dir, storage)
    }

    #[test]
    fn resolve_data_root_respects_env_override_and_fallback() {
        let _guard = ENV_LOCK.lock().unwrap();
        let prev = std::env::var_os("MINILEARN_DATA_DIR");
        let custom = TempDir::new("minilearn-custom-root");
        let support = TempDir::new("minilearn-support-root");

        std::env::remove_var("MINILEARN_DATA_DIR");
        assert_eq!(
            resolve_data_root(Some(support.path())),
            resolve_path(support.path())
        );

        let fallback = resolve_data_root(None);
        assert!(fallback.ends_with("minilearn"));

        std::env::set_var("MINILEARN_DATA_DIR", "");
        assert_eq!(
            resolve_data_root(Some(support.path())),
            resolve_path(support.path())
        );

        std::env::set_var("MINILEARN_DATA_DIR", custom.path());
        assert_eq!(
            resolve_data_root(Some(support.path())),
            resolve_path(custom.path())
        );

        match prev {
            Some(v) => std::env::set_var("MINILEARN_DATA_DIR", v),
            None => std::env::remove_var("MINILEARN_DATA_DIR"),
        }
    }

    #[test]
    fn outline_parsing_and_stable_curriculum_identities() {
        let (_dir, s) = fixture("minilearn-outline");
        let p = s.create(Some("Linear Algebra")).unwrap();
        let outline = parse_outline(Some(
            "# Linear Algebra\n## Module 1: Vectors\n- Span\n- Basis\n## Module 2: Transformations\n- Eigenvectors",
        ))
        .unwrap();
        assert_eq!(outline.len(), 2);
        assert_eq!(outline[0].lessons[1].title, "Basis");

        let mut curriculum = p.save_curriculum(serde_json::to_value(&outline).unwrap()).unwrap();
        let basis_id = curriculum[0].lessons[1].id.clone();
        let moved = curriculum[0].lessons.pop().unwrap();
        curriculum[1].lessons.insert(0, moved);
        p.save_curriculum(serde_json::to_value(&curriculum).unwrap())
            .unwrap();

        let fetched = p.lesson(&basis_id).unwrap();
        assert_eq!(fetched.module_title, "Module 2: Transformations");
        assert_eq!(fetched.title, "Basis");

        let invalid = normalize_curriculum(
            serde_json::json!([{
                "id": "duplicate",
                "title": "One",
                "lessons": [{ "id": "duplicate", "title": "Two" }]
            }]),
            true,
        )
        .unwrap();
        assert_ne!(invalid[0].id, invalid[0].lessons[0].id);

        let labeled = parse_outline(Some(
            "Module 1: Intro\n1. Limits\n2.1) Derivatives\nColon Group:\n• Integrals",
        ))
        .unwrap();
        assert_eq!(labeled.len(), 2);
        assert_eq!(labeled[0].title, "Module 1: Intro");
        assert_eq!(labeled[0].lessons[0].title, "Limits");
        assert_eq!(labeled[0].lessons[1].title, "Derivatives");
        assert_eq!(labeled[1].title, "Colon Group");
        assert_eq!(labeled[1].lessons[0].title, "Integrals");
    }

    #[test]
    fn projects_independent_and_exports_round_trip_without_credentials() {
        let (_dir, s) = fixture("minilearn-roundtrip");
        let a = s.create(Some("Algebra")).unwrap();
        let b = s.create(Some("Mechanics")).unwrap();

        s.save_settings(&Settings {
            connections: vec![Connection {
                id: "conn-1".into(),
                provider: "openai".into(),
                label: "OpenAI".into(),
                api_key: "private-test-key".into(),
                base_url: "https://api.openai.com/v1".into(),
                model: "gpt-4o".into(),
            }],
            active_connection: None,
        })
        .unwrap();

        let saved_curr = a
            .save_curriculum(serde_json::json!([
                { "title": "Vectors", "lessons": [{ "title": "Span" }] }
            ]))
            .unwrap();
        let lesson = &saved_curr[0].lessons[0];

        let file = a
            .add_material(
                Some("reference.txt"),
                Some("text/plain"),
                Some(&BASE64_STANDARD.encode(b"project-specific reference")),
            )
            .unwrap();

        let mut session = a.new_session(Some(&lesson.id), Some("learn")).unwrap();
        session.messages.push(SessionMessage {
            id: "message-one".into(),
            role: "user".into(),
            content: "What is a span?".into(),
            question: None,
            web_search: None,
            created_at: None,
        });
        a.save_session(&mut session).unwrap();
        a.set_progress(&lesson.id, Some("complete")).unwrap();
        a.write_generated(
            Some("A note"),
            Some("A study explanation"),
            Some(&lesson.id),
            None,
        )
        .unwrap();
        a.write_graph(&Graph {
            nodes: vec![GraphNode {
                id: "node-one".into(),
                title: "Span".into(),
                statement: "Span is a set of linear combinations.".into(),
                lesson_id: Some(lesson.id.clone()),
                sources: vec![session.id.clone()],
                evidence: None,
                created_at: None,
            }],
            edges: vec![],
        })
        .unwrap();
        fs::write(a.file("cache/local.txt").unwrap(), "temporary data").unwrap();

        assert!(b.curriculum().unwrap().is_empty());
        assert_eq!(b.graph().unwrap(), Graph::default());
        assert!(b.materials().unwrap().is_empty());

        let cat_vec: Vec<String> = CATEGORIES.iter().map(|c| (*c).to_string()).collect();
        let archive = a.export(&cat_vec).unwrap();
        let archive_json = serde_json::to_string(&archive).unwrap();
        assert!(!archive_json.contains("private-test-key"));
        assert!(archive.files.iter().all(|f| !f.path.contains("settings")));

        let copy = s.import(serde_json::to_value(&archive).unwrap()).unwrap();
        assert_ne!(copy.id(), a.id());
        assert_eq!(copy.lesson(&lesson.id).unwrap().title, "Span");
        assert_eq!(
            copy.material(&file.id).unwrap().bytes,
            a.material(&file.id).unwrap().bytes
        );
        assert_eq!(copy.sessions().unwrap().len(), 1);
        assert_eq!(copy.graph().unwrap().nodes.len(), 1);
        assert_eq!(
            copy.progress().unwrap().get(&lesson.id).map(String::as_str),
            Some("complete")
        );
        assert_eq!(copy.generated().unwrap().len(), 1);
        assert_eq!(
            fs::read_to_string(copy.file("cache/local.txt").unwrap()).unwrap(),
            "temporary data"
        );

        let clean_archive = a.export(&["content".to_string()]).unwrap();
        let clean = s
            .import(serde_json::to_value(&clean_archive).unwrap())
            .unwrap();
        assert_eq!(clean.curriculum().unwrap().len(), 1);
        assert_eq!(clean.materials().unwrap().len(), 1);
        assert_eq!(clean.sessions().unwrap().len(), 0);
        assert_eq!(clean.graph().unwrap().nodes.len(), 0);
        assert_eq!(clean.generated().unwrap().len(), 0);

        a.clear(&[
            "history".to_string(),
            "cache".to_string(),
            "generated".to_string(),
        ])
        .unwrap();
        assert_eq!(a.curriculum().unwrap().len(), 1);
        assert_eq!(a.materials().unwrap().len(), 1);
        assert_eq!(a.generated().unwrap().len(), 0);
        assert_eq!(a.sessions().unwrap().len(), 0);
        assert!(a.progress().unwrap().is_empty());
        assert_eq!(a.graph().unwrap().nodes.len(), 0);
        assert_eq!(a.usage().unwrap()["cache"].files, 0);
        assert_eq!(copy.sessions().unwrap().len(), 1);

        s.delete(a.id()).unwrap();
        assert!(s.project(a.id()).is_err());
        assert_eq!(s.project(b.id()).unwrap().meta().unwrap().name, "Mechanics");
    }

    #[test]
    fn archive_validation_rejects_unsupported_paths_and_malformed_metadata() {
        let (_dir, s) = fixture("minilearn-invalid-archive");

        let err1 = s
            .import(serde_json::json!({
                "format": "minilearn",
                "version": 1,
                "name": "Invalid",
                "files": [{ "path": "settings.json", "data": BASE64_STANDARD.encode(b"{}") }]
            }))
            .unwrap_err();
        assert!(err1.message.contains("invalid or duplicate path"));
        assert_eq!(s.list().unwrap().len(), 0);

        let err2 = s
            .import(serde_json::json!({
                "format": "minilearn",
                "version": 1,
                "name": "Invalid",
                "files": [{
                    "path": "curriculum.json",
                    "data": BASE64_STANDARD.encode(
                        br#"[{"id":"same","title":"Module","description":"","lessons":[{"id":"same","title":"Lesson","description":""}]}]"#
                    )
                }]
            }))
            .unwrap_err();
        assert!(err2.message.contains("duplicate curriculum IDs"));
        assert_eq!(s.list().unwrap().len(), 0);

        let err3 = s
            .import(serde_json::json!({
                "format": "minilearn",
                "version": 1,
                "name": "Unindexed",
                "files": [{
                    "path": "materials/mat1/secret.txt",
                    "data": BASE64_STANDARD.encode(b"data")
                }]
            }))
            .unwrap_err();
        assert!(err3.message.contains("unindexed source file"));
        assert_eq!(s.list().unwrap().len(), 0);

        let err4 = s
            .import(serde_json::json!({
                "format": "minilearn",
                "version": 1,
                "name": "BadURL",
                "files": [{
                    "path": "learning-history/sessions/s1.json",
                    "data": BASE64_STANDARD.encode(br#"{
                        "id":"s1","lessonId":"l1","lessonTitle":"T","mode":"learn",
                        "createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z",
                        "materialIds":[],
                        "messages":[{
                            "id":"m1","role":"assistant","content":"hi",
                            "webSearch":{"query":"q","provider":"Exa","status":"ok","sources":[{"title":"t","url":"javascript:alert(1)"}]}
                        }]
                    }"#)
                }]
            }))
            .unwrap_err();
        assert!(err4.message.contains("Invalid learning session"));
        assert_eq!(s.list().unwrap().len(), 0);
    }

    #[test]
    fn deleting_session_removes_only_exclusively_associated_graph_evidence() {
        let (_dir, s) = fixture("minilearn-del-sess");
        let p = s.create(Some("Calculus")).unwrap();
        let lesson_id = p
            .save_curriculum(serde_json::json!([
                { "title": "Limits", "lessons": [{ "title": "Continuity" }] }
            ]))
            .unwrap()[0]
            .lessons[0]
            .id
            .clone();
        let a = p.new_session(Some(&lesson_id), Some("learn")).unwrap();
        let b = p.new_session(Some(&lesson_id), Some("practice")).unwrap();

        p.write_graph(&Graph {
            nodes: vec![
                GraphNode {
                    id: "one".into(),
                    title: "One".into(),
                    statement: "One".into(),
                    lesson_id: None,
                    sources: vec![a.id.clone(), b.id.clone()],
                    evidence: None,
                    created_at: None,
                },
                GraphNode {
                    id: "two".into(),
                    title: "Two".into(),
                    statement: "Two".into(),
                    lesson_id: None,
                    sources: vec![a.id.clone()],
                    evidence: None,
                    created_at: None,
                },
                GraphNode {
                    id: "three".into(),
                    title: "Three".into(),
                    statement: "Three".into(),
                    lesson_id: None,
                    sources: vec![b.id.clone()],
                    evidence: None,
                    created_at: None,
                },
            ],
            edges: vec![
                GraphEdge {
                    from: "one".into(),
                    to: "two".into(),
                    sources: Some(vec![a.id.clone()]),
                    evidence: None,
                },
                GraphEdge {
                    from: "one".into(),
                    to: "three".into(),
                    sources: Some(vec![a.id.clone()]),
                    evidence: None,
                },
            ],
        })
        .unwrap();

        p.delete_session(&a.id).unwrap();
        let g = p.graph().unwrap();
        let node_ids: Vec<&str> = g.nodes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(node_ids, vec!["one", "three"]);
        assert_eq!(g.nodes[0].sources, vec![b.id]);
        assert!(g.edges.is_empty());
    }

    #[test]
    fn delete_exchange_cleans_paired_messages_and_evidence() {
        let (_dir, s) = fixture("minilearn-del-exchange");
        let p = s.create(Some("Topology")).unwrap();
        let lesson_id = p
            .save_curriculum(serde_json::json!([
                { "title": "Spaces", "lessons": [{ "title": "Open sets" }] }
            ]))
            .unwrap()[0]
            .lessons[0]
            .id
            .clone();

        let mut sess = p.new_session(Some(&lesson_id), Some("learn")).unwrap();
        sess.messages = vec![
            SessionMessage {
                id: "u1".into(),
                role: "user".into(),
                content: "Q1".into(),
                question: None,
                web_search: None,
                created_at: None,
            },
            SessionMessage {
                id: "a1".into(),
                role: "assistant".into(),
                content: "A1".into(),
                question: None,
                web_search: None,
                created_at: None,
            },
            SessionMessage {
                id: "u2".into(),
                role: "user".into(),
                content: "Q2".into(),
                question: None,
                web_search: None,
                created_at: None,
            },
            SessionMessage {
                id: "a2".into(),
                role: "assistant".into(),
                content: "A2".into(),
                question: None,
                web_search: None,
                created_at: None,
            },
        ];
        p.save_session(&mut sess).unwrap();

        p.write_graph(&Graph {
            nodes: vec![
                GraphNode {
                    id: "n1".into(),
                    title: "Open".into(),
                    statement: "Open sets".into(),
                    lesson_id: None,
                    sources: vec![sess.id.clone()],
                    evidence: Some(vec![
                        Evidence {
                            session_id: sess.id.clone(),
                            message_id: "a1".into(),
                        },
                        Evidence {
                            session_id: sess.id.clone(),
                            message_id: "a2".into(),
                        },
                    ]),
                    created_at: None,
                },
                GraphNode {
                    id: "n2".into(),
                    title: "Closed".into(),
                    statement: "Closed sets".into(),
                    lesson_id: None,
                    sources: vec![sess.id.clone()],
                    evidence: Some(vec![Evidence {
                        session_id: sess.id.clone(),
                        message_id: "a2".into(),
                    }]),
                    created_at: None,
                },
            ],
            edges: vec![GraphEdge {
                from: "n1".into(),
                to: "n2".into(),
                sources: Some(vec![sess.id.clone()]),
                evidence: Some(vec![Evidence {
                    session_id: sess.id.clone(),
                    message_id: "a2".into(),
                }]),
            }],
        })
        .unwrap();

        let after = p.delete_exchange(&sess.id, "a2").unwrap();
        let remaining_msg_ids: Vec<&str> = after.messages.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(remaining_msg_ids, vec!["u1", "a1"]);

        let g = p.graph().unwrap();
        assert_eq!(g.nodes.len(), 1);
        assert_eq!(g.nodes[0].id, "n1");
        assert_eq!(g.nodes[0].evidence.as_ref().unwrap().len(), 1);
        assert_eq!(g.nodes[0].evidence.as_ref().unwrap()[0].message_id, "a1");
        assert!(g.edges.is_empty());
    }

    #[test]
    fn windows_device_filename_and_character_sanitization() {
        assert_eq!(source_filename("CON"), "file_CON");
        assert_eq!(source_filename("con.txt"), "file_con.txt");
        assert_eq!(source_filename("LPT1.md"), "file_LPT1.md");
        assert_eq!(source_filename("nul"), "file_nul");
        assert_eq!(source_filename("console.txt"), "console.txt");
        assert_eq!(source_filename("  ...  "), "file_source");
        assert_eq!(source_filename("a<b>c:d/e\\f|g?h*i.txt "), "a_b_c_d_e_f_g_h_i.txt");

        let long_name = "é".repeat(150);
        let truncated = source_filename(&long_name);
        assert!(truncated.len() <= 220);
        assert!(truncated.is_char_boundary(truncated.len()));
    }

    #[test]
    fn path_traversal_and_symlink_checks() {
        let (_dir, s) = fixture("minilearn-security");
        let p = s.create(Some("Security")).unwrap();

        assert!(p.file("").is_err());
        assert!(p.file(".").is_err());
        assert!(p.file("../escape").is_err());
        assert!(p.file("/etc/passwd").is_err());
        assert!(p.file("cache/../../escape").is_err());
        assert!(p.file("bad\0path").is_err());

        #[cfg(unix)]
        {
            use std::os::unix::fs::{symlink, PermissionsExt};
            let target = TempDir::new("minilearn-symlink-target");
            fs::write(target.path().join("secret.txt"), "secret").unwrap();
            let link_path = p.dir().join("cache").join("leak.txt");
            symlink(target.path().join("secret.txt"), &link_path).unwrap();

            let err = p.file("cache/leak.txt").unwrap_err();
            assert!(err.message.contains("symbolic links"));
            assert_eq!(p.usage().unwrap()["cache"].files, 0);

            let dir_link = p.dir().join("cache").join("dir_link");
            symlink(target.path(), &dir_link).unwrap();
            assert!(p.file("cache/dir_link/secret.txt").is_err());

            let settings_mode = fs::metadata(p.dir().join("project.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(settings_mode, 0o600);
        }
    }

    #[test]
    fn validation_helpers_match_js_contract() {
        assert!(valid_id("abc_123-XYZ"));
        assert!(!valid_id(""));
        assert!(!valid_id(&"a".repeat(101)));
        assert!(valid_id(&"a".repeat(100)));
        assert!(!valid_id("__proto__"));
        assert!(!valid_id("constructor"));
        assert!(!valid_id("prototype"));
        assert!(!valid_id("bad/id"));

        assert_eq!(required_text(Some("  hello  "), "Title", 10).unwrap(), "hello");
        assert!(required_text(None, "Title", 10).is_err());
        assert!(required_text(Some("   "), "Title", 10).is_err());
        // Astral emoji takes 2 UTF-16 code units in JS.
        assert!(required_text(Some("😀"), "Title", 1).is_err());
        assert_eq!(required_text(Some("😀"), "Title", 2).unwrap(), "😀");
    }
}
