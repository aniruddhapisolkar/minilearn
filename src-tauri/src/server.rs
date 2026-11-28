use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Path, Query, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode, Uri};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::Router;
use futures_util::StreamExt;
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::models::{
    activate_connection, connect, delete_connection, discover_models, get_connections,
    normalize_connection, selected_connection,
};
use crate::storage::{parse_outline, Project, Storage, CATEGORIES};
use crate::tutor::{apply_proposal, run_planner, run_tutor};

include!(concat!(env!("OUT_DIR"), "/vendor_assets.rs"));

const MAX_BODY: usize = 32 * 1024 * 1024;
const MAX_IMPORT: usize = 140 * 1024 * 1024;
const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'";

const INDEX_HTML: &[u8] = include_bytes!("../../web/index.html");
const APP_JS: &[u8] = include_bytes!("../../web/app.js");
const GRAPH_JS: &[u8] = include_bytes!("../../web/graph.js");
const STYLES_CSS: &[u8] = include_bytes!("../../web/styles.css");
const WORKSPACE_CSS: &[u8] = include_bytes!("../../web/workspace.css");
const FONT_NORMAL: &[u8] =
    include_bytes!("../../web/fonts/jetbrains-mono-latin-wght-normal.woff2");
const FONT_ITALIC: &[u8] =
    include_bytes!("../../web/fonts/jetbrains-mono-latin-wght-italic.woff2");

#[derive(Clone)]
pub struct AppState {
    pub storage: Storage,
    pub client: reqwest::Client,
    pub running: Arc<Mutex<HashMap<String, (u64, CancellationToken)>>>,
    pub next_op: Arc<AtomicU64>,
}

impl AppState {
    pub fn new(storage: Storage) -> Self {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("failed to build reqwest client");
        Self {
            storage,
            client,
            running: Arc::new(Mutex::new(HashMap::new())),
            next_op: Arc::new(AtomicU64::new(1)),
        }
    }
}

struct OperationGuard {
    running: Arc<Mutex<HashMap<String, (u64, CancellationToken)>>>,
    project_id: String,
    op_id: u64,
    token: CancellationToken,
}

impl Drop for OperationGuard {
    fn drop(&mut self) {
        self.token.cancel();
        let mut map = self.running.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((current_id, _)) = map.get(&self.project_id) {
            if *current_id == self.op_id {
                map.remove(&self.project_id);
            }
        }
    }
}

#[derive(Deserialize)]
struct ExportQuery {
    include: Option<String>,
}

fn host_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$").unwrap()
    })
}

fn apply_security_headers(headers: &mut HeaderMap) {
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(CSP),
    );
}

fn error_response(err: AppError) -> Response {
    let status = StatusCode::from_u16(err.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let message = if status == StatusCode::INTERNAL_SERVER_ERROR {
        eprintln!("minilearn: {}", err.message);
        "Something went wrong. See the local server log.".to_string()
    } else {
        err.message
    };
    let body = serde_json::to_vec(&json!({ "error": message })).unwrap_or_else(|_| {
        br#"{"error":"Internal error."}"#.to_vec()
    });
    let mut res = (
        status,
        [
            (header::CONTENT_TYPE, "application/json; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        body,
    )
        .into_response();
    apply_security_headers(res.headers_mut());
    res
}

fn json_response<T: serde::Serialize>(value: &T, status: StatusCode) -> AppResult<Response> {
    let bytes = serde_json::to_vec(value)
        .map_err(|e| AppError::internal(format!("JSON serialization failed: {e}")))?;
    Ok((
        status,
        [
            (header::CONTENT_TYPE, "application/json; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        bytes,
    )
        .into_response())
}

fn ok_json<T: serde::Serialize>(value: &T) -> AppResult<Response> {
    json_response(value, StatusCode::OK)
}

fn created_json<T: serde::Serialize>(value: &T) -> AppResult<Response> {
    json_response(value, StatusCode::CREATED)
}

fn encode_rfc5987(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.as_bytes() {
        let ch = *b as char;
        if b.is_ascii_alphanumeric()
            || matches!(ch, '-' | '_' | '.' | '!' | '~' | '*' | '\'' | '(' | ')')
        {
            out.push(ch);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

fn download_response(bytes: Vec<u8>, filename: &str) -> AppResult<Response> {
    let ascii_name: String = filename
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let ascii_name = if ascii_name.is_empty() {
        "download".to_string()
    } else {
        ascii_name
    };
    let utf8_name = encode_rfc5987(filename);
    let disposition = format!("attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{utf8_name}");
    let mut res = (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/octet-stream"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        bytes,
    )
        .into_response();
    let header_val = HeaderValue::from_str(&disposition)
        .map_err(|_| AppError::internal("Invalid download filename."))?;
    res.headers_mut().insert(header::CONTENT_DISPOSITION, header_val);
    Ok(res)
}

async fn security_middleware(req: Request, next: Next) -> Response {
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !host_regex().is_match(host) {
        return error_response(AppError::forbidden(
            "This app only accepts localhost requests.",
        ));
    }

    if let Some(origin) = req.headers().get(header::ORIGIN) {
        let ok = origin
            .to_str()
            .map(|o| o == format!("http://{host}"))
            .unwrap_or(false);
        if !ok {
            return error_response(AppError::forbidden(
                "Cross-origin requests are not allowed.",
            ));
        }
    }

    if let Some(sfs) = req.headers().get("sec-fetch-site") {
        if sfs.to_str().ok() == Some("cross-site") {
            return error_response(AppError::forbidden(
                "Cross-site requests are not allowed.",
            ));
        }
    }

    let mut res = next.run(req).await;
    apply_security_headers(res.headers_mut());
    res
}

async fn read_json_body(headers: &HeaderMap, body: Body, limit: usize) -> AppResult<Value> {
    let ct = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !ct.to_ascii_lowercase().starts_with("application/json") {
        return Err(AppError::unsupported_media_type("Expected JSON request."));
    }

    if let Some(cl) = headers.get(header::CONTENT_LENGTH) {
        if let Ok(len_str) = cl.to_str() {
            if let Ok(len) = len_str.trim().parse::<usize>() {
                if len > limit {
                    return Err(AppError::payload_too_large("Request exceeds the size limit."));
                }
            }
        }
    }

    let mut stream = body.into_data_stream();
    let mut buf = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| AppError::bad_request("Invalid JSON request."))?;
        if buf.len().saturating_add(chunk.len()) > limit {
            return Err(AppError::payload_too_large("Request exceeds the size limit."));
        }
        buf.extend_from_slice(&chunk);
    }

    let value: Value =
        serde_json::from_slice(&buf).map_err(|_| AppError::bad_request("Invalid JSON request."))?;
    if !value.is_object() && !value.is_array() {
        return Err(AppError::bad_request("Invalid JSON request."));
    }
    Ok(value)
}

async fn optional_json_body(headers: &HeaderMap, body: Body) -> AppResult<Value> {
    if headers.contains_key(header::CONTENT_TYPE) {
        read_json_body(headers, body, MAX_BODY).await
    } else {
        Ok(Value::Object(Default::default()))
    }
}

fn ensure_idle(state: &AppState, project_id: &str) -> AppResult<()> {
    let map = state.running.lock().unwrap_or_else(|e| e.into_inner());
    if map.contains_key(project_id) {
        return Err(AppError::conflict(
            "A model is working in this project. Stop it or wait before changing project data.",
        ));
    }
    Ok(())
}

async fn run_operation<F, Fut, T>(state: &AppState, project_id: &str, action: F) -> AppResult<T>
where
    F: FnOnce(CancellationToken) -> Fut,
    Fut: std::future::Future<Output = AppResult<T>>,
{
    let op_id = state.next_op.fetch_add(1, Ordering::Relaxed);
    let token = CancellationToken::new();
    {
        let mut map = state.running.lock().unwrap_or_else(|e| e.into_inner());
        if map.contains_key(project_id) {
            return Err(AppError::conflict(
                "A model is working in this project. Stop it or wait before changing project data.",
            ));
        }
        map.insert(project_id.to_string(), (op_id, token.clone()));
    }

    let _guard = OperationGuard {
        running: state.running.clone(),
        project_id: project_id.to_string(),
        op_id,
        token: token.clone(),
    };

    tokio::select! {
        biased;
        _ = token.cancelled() => Err(AppError::cancelled()),
        res = action(token.clone()) => res,
    }
}

fn into_axum_result(res: AppResult<Response>) -> Response {
    match res {
        Ok(r) => r,
        Err(e) => error_response(e),
    }
}

fn static_asset(path: &str) -> Option<(&'static [u8], &'static str)> {
    match path {
        "/" => Some((INDEX_HTML, "text/html; charset=utf-8")),
        "/app.js" => Some((APP_JS, "text/javascript; charset=utf-8")),
        "/graph.js" => Some((GRAPH_JS, "text/javascript; charset=utf-8")),
        "/styles.css" => Some((STYLES_CSS, "text/css; charset=utf-8")),
        "/workspace.css" => Some((WORKSPACE_CSS, "text/css; charset=utf-8")),
        "/fonts/jetbrains-mono-latin-wght-normal.woff2" => Some((FONT_NORMAL, "font/woff2")),
        "/fonts/jetbrains-mono-latin-wght-italic.woff2" => Some((FONT_ITALIC, "font/woff2")),
        _ => vendor_asset(path),
    }
}

async fn serve_root() -> Response {
    let (bytes, mime) = static_asset("/").unwrap();
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, "no-store"),
        ],
        bytes,
    )
        .into_response()
}

async fn handle_fallback(method: Method, uri: Uri) -> Response {
    let path = uri.path();
    if path.starts_with("/api/") {
        return error_response(AppError::not_found("Not found."));
    }
    if method != Method::GET {
        return error_response(AppError::not_found("Not found."));
    }
    match static_asset(path) {
        Some((bytes, mime)) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, mime),
                (header::CACHE_CONTROL, "no-store"),
            ],
            bytes,
        )
            .into_response(),
        None => error_response(AppError::not_found("Not found.")),
    }
}

async fn api_not_found() -> Response {
    error_response(AppError::not_found("Not found."))
}

// --- Connection endpoints ---

async fn list_connections(State(state): State<AppState>) -> Response {
    into_axum_result((|| ok_json(&get_connections(&state.storage)?))())
}

async fn discover_connection_models(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let value = read_json_body(&headers, body, MAX_BODY).await?;
            let settings = state.storage.settings()?;
            let prev = value
                .get("id")
                .and_then(|v| v.as_str())
                .and_then(|id| settings.connections.iter().find(|c| c.id == id));
            let conn = normalize_connection(&value, prev, false)?;
            let cancel = CancellationToken::new();
            let models = discover_models(&state.client, &conn, &cancel).await?;
            ok_json(&json!({ "models": models }))
        }
        .await,
    )
}

async fn create_connection(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let value = read_json_body(&headers, body, MAX_BODY).await?;
            let cancel = CancellationToken::new();
            let conn = connect(&state.client, &state.storage, &value, &cancel).await?;
            created_json(&conn)
        }
        .await,
    )
}

async fn activate_conn(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    into_axum_result((|| ok_json(&activate_connection(&state.storage, &id)?))())
}

async fn delete_conn(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    into_axum_result((|| ok_json(&delete_connection(&state.storage, &id)?))())
}

// --- Project collection endpoints ---

async fn list_projects(State(state): State<AppState>) -> Response {
    into_axum_result((|| ok_json(&json!({ "projects": state.storage.list()? })))())
}

async fn create_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let value = read_json_body(&headers, body, MAX_BODY).await?;
            let name = value.get("name").and_then(|v| v.as_str());
            let project = state.storage.create(name)?;
            created_json(&project.snapshot()?)
        }
        .await,
    )
}

async fn import_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let value = read_json_body(&headers, body, MAX_IMPORT).await?;
            let project = state.storage.import(value)?;
            created_json(&project.snapshot()?)
        }
        .await,
    )
}

// --- Project-scoped endpoints ---

fn project_or_404(state: &AppState, id: &str) -> AppResult<Project> {
    state.storage.project(id)
}

async fn get_project(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    into_axum_result((|| {
        let p = project_or_404(&state, &id)?;
        ok_json(&p.snapshot()?)
    })())
}

async fn cancel_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let _payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            let map = state.running.lock().unwrap_or_else(|e| e.into_inner());
            if let Some((_, token)) = map.get(p.id()) {
                token.cancel();
            }
            ok_json(&json!({ "cancelled": true }))
        }
        .await,
    )
}

async fn rename_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            p.rename(payload.get("name").and_then(|v| v.as_str()))?;
            ok_json(&p.snapshot()?)
        }
        .await,
    )
}

async fn delete_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let _payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            state.storage.delete(p.id())?;
            ok_json(&json!({ "deleted": true }))
        }
        .await,
    )
}

async fn save_project_curriculum(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            let curriculum = payload.get("curriculum").cloned().unwrap_or(Value::Null);
            p.save_curriculum(curriculum)?;
            ok_json(&p.snapshot()?)
        }
        .await,
    )
}

async fn parse_project_curriculum(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            let parsed = parse_outline(payload.get("text").and_then(|v| v.as_str()))?;
            ok_json(&json!({ "curriculum": parsed }))
        }
        .await,
    )
}

async fn post_planner(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            let conn = selected_connection(&state.storage)?;
            let message = payload.get("message").and_then(|v| v.as_str());
            let web_search = payload
                .get("webSearch")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let client = state.client.clone();
            let p_id = p.id().to_string();
            let result = run_operation(&state, &p_id, |cancel| async move {
                run_planner(&client, &p, &conn, message, web_search, &cancel).await
            })
            .await?;
            ok_json(&result)
        }
        .await,
    )
}

async fn clear_project_planner(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let _payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            p.clear_planner()?;
            ok_json(&p.snapshot()?)
        }
        .await,
    )
}

async fn apply_project_planner(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let _payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            ok_json(&apply_proposal(&p)?)
        }
        .await,
    )
}

async fn discard_project_proposal(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let _payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            let mut planner = p.planner()?;
            planner.proposal = None;
            planner.base = None;
            p.save_planner(&planner)?;
            ok_json(&p.snapshot()?)
        }
        .await,
    )
}

async fn add_project_material(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            p.add_material(
                payload.get("name").and_then(|v| v.as_str()),
                payload.get("mime").and_then(|v| v.as_str()),
                payload.get("data").and_then(|v| v.as_str()),
            )?;
            created_json(&p.snapshot()?)
        }
        .await,
    )
}

async fn get_project_material(
    State(state): State<AppState>,
    Path((id, item)): Path<(String, String)>,
) -> Response {
    into_axum_result((|| {
        let p = project_or_404(&state, &id)?;
        let mat = p.material(&item)?;
        download_response(mat.bytes, &mat.record.name)
    })())
}

async fn delete_project_material(
    State(state): State<AppState>,
    Path((id, item)): Path<(String, String)>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let _payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            p.delete_material(&item)?;
            ok_json(&p.snapshot()?)
        }
        .await,
    )
}

async fn create_project_generated(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            p.write_generated(
                payload.get("title").and_then(|v| v.as_str()),
                payload.get("body").and_then(|v| v.as_str()),
                payload.get("lessonId").and_then(|v| v.as_str()),
                None,
            )?;
            created_json(&p.snapshot()?)
        }
        .await,
    )
}

async fn update_project_generated(
    State(state): State<AppState>,
    Path((id, item)): Path<(String, String)>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            p.write_generated(
                payload.get("title").and_then(|v| v.as_str()),
                payload.get("body").and_then(|v| v.as_str()),
                payload.get("lessonId").and_then(|v| v.as_str()),
                Some(item.as_str()),
            )?;
            ok_json(&p.snapshot()?)
        }
        .await,
    )
}

async fn delete_project_generated(
    State(state): State<AppState>,
    Path((id, item)): Path<(String, String)>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let _payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            p.delete_generated(&item)?;
            ok_json(&p.snapshot()?)
        }
        .await,
    )
}

async fn create_project_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            let session = p.new_session(
                payload.get("lessonId").and_then(|v| v.as_str()),
                payload.get("mode").and_then(|v| v.as_str()),
            )?;
            created_json(&session)
        }
        .await,
    )
}

async fn get_project_session(
    State(state): State<AppState>,
    Path((id, item)): Path<(String, String)>,
) -> Response {
    into_axum_result((|| {
        let p = project_or_404(&state, &id)?;
        ok_json(&p.session(&item)?)
    })())
}

async fn delete_project_session(
    State(state): State<AppState>,
    Path((id, item)): Path<(String, String)>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let _payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            p.delete_session(&item)?;
            ok_json(&p.snapshot()?)
        }
        .await,
    )
}

async fn delete_session_exchange(
    State(state): State<AppState>,
    Path((id, item, detail)): Path<(String, String, String)>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let _payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            ok_json(&p.delete_exchange(&item, &detail)?)
        }
        .await,
    )
}

async fn run_session_turn(
    State(state): State<AppState>,
    Path((id, item)): Path<(String, String)>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            let conn = selected_connection(&state.storage)?;
            let client = state.client.clone();
            let p_id = p.id().to_string();
            let session = run_operation(&state, &p_id, |cancel| async move {
                run_tutor(&client, &p, &conn, &item, &payload, &cancel).await
            })
            .await?;
            ok_json(&session)
        }
        .await,
    )
}

async fn set_lesson_progress(
    State(state): State<AppState>,
    Path((id, item)): Path<(String, String)>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            match payload.get("status") {
                Some(Value::Null) => p.set_progress(&item, None)?,
                Some(Value::String(s)) => p.set_progress(&item, Some(s.as_str()))?,
                _ => return Err(AppError::bad_request("Invalid progress status.")),
            }
            ok_json(&p.snapshot()?)
        }
        .await,
    )
}

async fn delete_project_graph_node(
    State(state): State<AppState>,
    Path((id, item)): Path<(String, String)>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let _payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            p.delete_node(&item)?;
            ok_json(&p.snapshot()?)
        }
        .await,
    )
}

async fn clear_project_graph(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let _payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            p.clear_graph()?;
            ok_json(&p.snapshot()?)
        }
        .await,
    )
}

async fn clear_project_data(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    into_axum_result(
        async {
            let payload = optional_json_body(&headers, body).await?;
            let p = project_or_404(&state, &id)?;
            ensure_idle(&state, p.id())?;
            let arr = payload
                .get("categories")
                .and_then(|v| v.as_array())
                .ok_or_else(|| AppError::bad_request("Invalid data category."))?;
            let mut categories = Vec::with_capacity(arr.len());
            for item in arr {
                let s = item
                    .as_str()
                    .ok_or_else(|| AppError::bad_request("Invalid data category."))?;
                categories.push(s.to_string());
            }
            p.clear(&categories)?;
            ok_json(&p.snapshot()?)
        }
        .await,
    )
}

async fn export_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<ExportQuery>,
) -> Response {
    into_axum_result((|| {
        let p = project_or_404(&state, &id)?;
        let categories: Vec<String> = match query.include {
            Some(raw) => raw
                .split(',')
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect(),
            None => CATEGORIES.iter().map(|s| s.to_string()).collect(),
        };
        let archive = p.export(&categories)?;
        let bytes = serde_json::to_vec(&archive)
            .map_err(|e| AppError::internal(format!("Export serialization failed: {e}")))?;
        let filename = format!("{}.learn", p.meta()?.name);
        download_response(bytes, &filename)
    })())
}

pub fn router(storage: Storage) -> Router {
    let state = AppState::new(storage);
    Router::new()
        .route("/", get(serve_root))
        .route(
            "/api/connections",
            get(list_connections).post(create_connection),
        )
        .route(
            "/api/connections/discover",
            post(discover_connection_models),
        )
        .route("/api/connections/{id}/activate", post(activate_conn))
        .route("/api/connections/{id}", delete(delete_conn))
        .route("/api/projects", get(list_projects).post(create_project))
        .route("/api/projects/import", post(import_project))
        .route(
            "/api/projects/{id}",
            get(get_project)
                .patch(rename_project)
                .delete(delete_project),
        )
        .route("/api/projects/{id}/cancel", post(cancel_project))
        .route(
            "/api/projects/{id}/curriculum",
            put(save_project_curriculum),
        )
        .route(
            "/api/projects/{id}/curriculum/parse",
            post(parse_project_curriculum),
        )
        .route(
            "/api/projects/{id}/planner",
            post(post_planner).delete(clear_project_planner),
        )
        .route(
            "/api/projects/{id}/planner/apply",
            post(apply_project_planner),
        )
        .route(
            "/api/projects/{id}/planner/proposal",
            delete(discard_project_proposal),
        )
        .route("/api/projects/{id}/materials", post(add_project_material))
        .route(
            "/api/projects/{id}/materials/{item}",
            get(get_project_material).delete(delete_project_material),
        )
        .route(
            "/api/projects/{id}/generated",
            post(create_project_generated),
        )
        .route(
            "/api/projects/{id}/generated/{item}",
            put(update_project_generated).delete(delete_project_generated),
        )
        .route("/api/projects/{id}/sessions", post(create_project_session))
        .route(
            "/api/projects/{id}/sessions/{item}",
            get(get_project_session).delete(delete_project_session),
        )
        .route(
            "/api/projects/{id}/sessions/{item}/exchanges/{detail}",
            delete(delete_session_exchange),
        )
        .route(
            "/api/projects/{id}/sessions/{item}/turn",
            post(run_session_turn),
        )
        .route(
            "/api/projects/{id}/progress/{item}",
            put(set_lesson_progress),
        )
        .route("/api/projects/{id}/graph", delete(clear_project_graph))
        .route(
            "/api/projects/{id}/graph/{item}",
            delete(delete_project_graph_node),
        )
        .route("/api/projects/{id}/data", post(clear_project_data))
        .route("/api/projects/{id}/export", get(export_project))
        .fallback(handle_fallback)
        .method_not_allowed_fallback(api_not_found)
        .layer(DefaultBodyLimit::disable())
        .layer(middleware::from_fn(security_middleware))
        .with_state(state)
}

pub async fn start_server(
    storage: Storage,
) -> Result<(SocketAddr, oneshot::Sender<()>), Box<dyn std::error::Error + Send + Sync>> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let app = router(storage);
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    tokio::spawn(async move {
        let server = axum::serve(listener, app).with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        });
        if let Err(err) = server.await {
            eprintln!("minilearn server error: {err}");
        }
    });

    Ok((addr, shutdown_tx))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::State as AxumState;
    use axum::routing::get as axum_get;
    use axum::Json;
    use std::sync::atomic::AtomicBool;
    use tokio::sync::Notify;

    struct TempDir(std::path::PathBuf);
    impl TempDir {
        fn new(prefix: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("{prefix}-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[derive(Clone)]
    struct MockState {
        seen: Arc<Mutex<Vec<Value>>>,
        hold_notify: Arc<Notify>,
        hold_reached: Arc<AtomicBool>,
    }

    async fn mock_models() -> Json<Value> {
        Json(json!({ "data": [{ "id": "test-model" }] }))
    }

    async fn mock_chat(
        AxumState(mock): AxumState<MockState>,
        Json(payload): Json<Value>,
    ) -> Json<Value> {
        {
            let mut seen = mock.seen.lock().unwrap();
            seen.push(payload.clone());
        }
        let messages = payload["messages"].as_array().unwrap();
        let prompt = messages[0]["content"].as_str().unwrap_or("");
        let last = messages.last().unwrap()["content"].as_str().unwrap_or("");

        let answer = if prompt.contains("testing a connection") {
            "OK".to_string()
        } else if prompt.contains("author a curriculum") {
            let lessons = if last == "Insert independence after span" {
                json!([
                    { "title": "Span" },
                    { "title": "Independence" },
                    { "title": "Basis" }
                ])
            } else {
                json!([{ "title": "Span" }, { "title": "Basis" }])
            };
            json!({
                "reply": "Here is your proposed curriculum.",
                "curriculum": [{ "title": "Vectors", "lessons": lessons }]
            })
            .to_string()
        } else if last == "hold generation" {
            mock.hold_reached.store(true, Ordering::SeqCst);
            mock.hold_notify.notified().await;
            json!({
                "reply": "Late reply",
                "knowledge": [],
                "complete": false
            })
            .to_string()
        } else if last == "A span contains every linear combination." {
            json!({
                "reply": "Correct. A span includes all linear combinations.",
                "knowledge": [{
                    "title": "Span",
                    "statement": "The span of a set consists of all linear combinations.",
                    "premises": []
                }],
                "complete": true
            })
            .to_string()
        } else {
            json!({
                "reply": "Start with $a\\mathbf{v}$.",
                "question": {
                    "kind": "prediction",
                    "prompt": "What do you know about linear combinations?",
                    "options": ["A weighted sum.", "Only one vector."]
                },
                "knowledge": [],
                "complete": false
            })
            .to_string()
        };

        Json(json!({ "choices": [{ "message": { "content": answer } }] }))
    }

    async fn start_mock_provider() -> (String, MockState, oneshot::Sender<()>) {
        let mock = MockState {
            seen: Arc::new(Mutex::new(Vec::new())),
            hold_notify: Arc::new(Notify::new()),
            hold_reached: Arc::new(AtomicBool::new(false)),
        };
        let app = Router::new()
            .route("/v1/models", axum_get(mock_models))
            .route("/v1/chat/completions", post(mock_chat))
            .with_state(mock.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = oneshot::channel::<()>();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = rx.await;
                })
                .await;
        });
        (format!("http://127.0.0.1:{}/v1", addr.port()), mock, tx)
    }

    #[tokio::test]
    async fn complete_api_workflow_and_security() {
        let tmp = TempDir::new("minilearn-server-test");
        let storage = Storage::new(&tmp.0).unwrap();
        let (provider_url, mock, mock_shutdown) = start_mock_provider().await;
        let (addr, server_shutdown) = start_server(storage).await.unwrap();
        let base = format!("http://127.0.0.1:{}", addr.port());
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();

        // Static assets + security headers
        for asset in [
            "/",
            "/app.js",
            "/graph.js",
            "/styles.css",
            "/workspace.css",
            "/fonts/jetbrains-mono-latin-wght-normal.woff2",
            "/fonts/jetbrains-mono-latin-wght-italic.woff2",
        ] {
            let res = http.get(format!("{base}{asset}")).send().await.unwrap();
            assert_eq!(res.status(), 200, "asset {asset}");
            assert_eq!(res.headers().get("cache-control").unwrap(), "no-store");
            assert_eq!(
                res.headers().get("x-content-type-options").unwrap(),
                "nosniff"
            );
            assert_eq!(res.headers().get("x-frame-options").unwrap(), "DENY");
            if asset.starts_with("/fonts/") {
                let ct = res.headers().get("content-type").unwrap().to_str().unwrap();
                assert!(ct.starts_with("font/"), "unexpected font ct: {ct}");
            }
            assert!(!res.bytes().await.unwrap().is_empty());
        }

        if vendor_asset("/vendor/katex.css").is_some() {
            for v in [
                "/vendor/marked.js",
                "/vendor/purify.js",
                "/vendor/katex.js",
                "/vendor/katex.css",
            ] {
                let res = http.get(format!("{base}{v}")).send().await.unwrap();
                assert_eq!(res.status(), 200, "vendor {v}");
            }
        }

        for retired in [
            "/fonts/source-sans-3-latin-wght-normal.woff2",
            "/fonts/source-sans-3-latin-wght-italic.woff2",
            "/fonts/cmu-serif-bold.ttf",
        ] {
            let res = http.get(format!("{base}{retired}")).send().await.unwrap();
            assert_eq!(res.status(), 404, "retired font {retired}");
        }

        // Security checks: cross-origin / cross-site / non-localhost host
        let bad_origin = http
            .get(format!("{base}/api/projects"))
            .header("origin", "https://not-local.example")
            .send()
            .await
            .unwrap();
        assert_eq!(bad_origin.status(), 403);

        let bad_sfs = http
            .get(format!("{base}/api/projects"))
            .header("sec-fetch-site", "cross-site")
            .send()
            .await
            .unwrap();
        assert_eq!(bad_sfs.status(), 403);

        let bad_host = http
            .get(format!("{base}/api/projects"))
            .header("host", "evil.example")
            .send()
            .await
            .unwrap();
        assert_eq!(bad_host.status(), 403);

        // Helper closure for JSON API calls
        let call = |method: reqwest::Method, path: String, body: Option<Value>, expected: u16| {
            let http = http.clone();
            let base = base.clone();
            async move {
                let mut req = http.request(method, format!("{base}{path}"));
                if let Some(b) = body {
                    req = req.json(&b);
                }
                let res = req.send().await.unwrap();
                let status = res.status().as_u16();
                let text = res.text().await.unwrap();
                let json: Value = serde_json::from_str(&text)
                    .unwrap_or_else(|_| panic!("non-json response ({status}): {text}"));
                assert_eq!(status, expected, "{path} -> {json}");
                json
            }
        };

        // 1. Discover & connect provider
        let discovered = call(
            reqwest::Method::POST,
            "/api/connections/discover".into(),
            Some(json!({ "provider": "custom", "baseUrl": provider_url })),
            200,
        )
        .await;
        assert_eq!(discovered["models"][0]["id"], "test-model");

        let conn = call(
            reqwest::Method::POST,
            "/api/connections".into(),
            Some(json!({
                "provider": "custom",
                "baseUrl": provider_url,
                "model": "test-model",
                "apiKey": "test-secret"
            })),
            201,
        )
        .await;
        assert_eq!(conn["hasKey"], true);
        assert!(conn.get("apiKey").is_none());

        let public_settings = call(reqwest::Method::GET, "/api/connections".into(), None, 200).await;
        assert!(!public_settings.to_string().contains("test-secret"));

        // 2. Projects & isolation
        let p = call(
            reqwest::Method::POST,
            "/api/projects".into(),
            Some(json!({ "name": "Linear algebra" })),
            201,
        )
        .await;
        let other = call(
            reqwest::Method::POST,
            "/api/projects".into(),
            Some(json!({ "name": "Separate subject" })),
            201,
        )
        .await;
        let p_id = p["id"].as_str().unwrap().to_string();
        let other_id = other["id"].as_str().unwrap().to_string();
        let p_url = format!("/api/projects/{p_id}");

        call(
            reqwest::Method::PUT,
            format!("/api/projects/{other_id}/curriculum"),
            Some(json!({
                "curriculum": [{ "title": "OTHER PROJECT PRIVATE", "lessons": [{ "title": "Secret" }] }]
            })),
            200,
        )
        .await;

        // 3. Planner + reconcile + apply
        let planner = call(
            reqwest::Method::POST,
            format!("{p_url}/planner"),
            Some(json!({ "message": "Help me plan a unit about vectors." })),
            200,
        )
        .await;
        assert_eq!(planner["proposal"][0]["lessons"].as_array().unwrap().len(), 2);
        assert_eq!(
            call(reqwest::Method::GET, p_url.clone(), None, 200).await["curriculum"]
                .as_array()
                .unwrap()
                .len(),
            0
        );

        let planned = call(
            reqwest::Method::POST,
            format!("{p_url}/planner/apply"),
            None,
            200,
        )
        .await;
        assert_eq!(planned["curriculum"].as_array().unwrap().len(), 1);
        let lesson_id = planned["curriculum"][0]["lessons"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let basis_id = planned["curriculum"][0]["lessons"][1]["id"]
            .as_str()
            .unwrap()
            .to_string();

        let insertion = call(
            reqwest::Method::POST,
            format!("{p_url}/planner"),
            Some(json!({ "message": "Insert independence after span" })),
            200,
        )
        .await;
        assert_eq!(insertion["proposal"][0]["lessons"][0]["id"], lesson_id);
        assert_eq!(insertion["proposal"][0]["lessons"][2]["id"], basis_id);
        call(
            reqwest::Method::POST,
            format!("{p_url}/planner/apply"),
            None,
            200,
        )
        .await;

        // 4. Session + Tutor turns + Graph + Progress
        let s = call(
            reqwest::Method::POST,
            format!("{p_url}/sessions"),
            Some(json!({ "lessonId": lesson_id, "mode": "learn" })),
            201,
        )
        .await;
        let s_id = s["id"].as_str().unwrap().to_string();

        let first = call(
            reqwest::Method::POST,
            format!("{p_url}/sessions/{s_id}/turn"),
            Some(json!({ "message": "Teach me.", "materialIds": [] })),
            200,
        )
        .await;
        assert_eq!(first["messages"].as_array().unwrap().len(), 2);
        assert_eq!(first["messages"][1]["question"]["kind"], "prediction");

        let second = call(
            reqwest::Method::POST,
            format!("{p_url}/sessions/{s_id}/turn"),
            Some(json!({ "message": "A span contains every linear combination.", "materialIds": [] })),
            200,
        )
        .await;
        assert_eq!(second["messages"].as_array().unwrap().len(), 4);

        let updated = call(reqwest::Method::GET, p_url.clone(), None, 200).await;
        assert_eq!(updated["graph"]["nodes"].as_array().unwrap().len(), 1);
        assert_eq!(updated["progress"][&lesson_id], "complete");
        assert_eq!(
            call(
                reqwest::Method::GET,
                format!("/api/projects/{other_id}"),
                None,
                200
            )
            .await["graph"]["nodes"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
        {
            let seen = mock.seen.lock().unwrap();
            assert!(seen
                .iter()
                .all(|r| !r.to_string().contains("OTHER PROJECT PRIVATE")));
        }

        // 5. Generated note + HEAD/GET Export + Import roundtrip
        call(
            reqwest::Method::POST,
            format!("{p_url}/generated"),
            Some(json!({
                "title": "Saved explanation",
                "body": second["messages"][3]["content"],
                "lessonId": lesson_id
            })),
            201,
        )
        .await;

        let head_export = http
            .head(format!("{base}{p_url}/export"))
            .send()
            .await
            .unwrap();
        assert_eq!(head_export.status(), 200);
        assert!(head_export.headers().contains_key("content-disposition"));

        let archive = call(reqwest::Method::GET, format!("{p_url}/export"), None, 200).await;
        let copy = call(
            reqwest::Method::POST,
            "/api/projects/import".into(),
            Some(archive),
            201,
        )
        .await;
        let copy_id = copy["id"].as_str().unwrap().to_string();
        assert_ne!(copy_id, p_id);
        assert_eq!(copy["curriculum"][0]["lessons"][0]["id"], lesson_id);
        assert_eq!(copy["graph"]["nodes"].as_array().unwrap().len(), 1);
        assert_eq!(copy["generated"].as_array().unwrap().len(), 1);

        // 6. Delete exchange cleans up graph evidence
        let msg_id = second["messages"][3]["id"].as_str().unwrap();
        let trimmed = call(
            reqwest::Method::DELETE,
            format!("{p_url}/sessions/{s_id}/exchanges/{msg_id}"),
            None,
            200,
        )
        .await;
        assert_eq!(trimmed["messages"].as_array().unwrap().len(), 2);
        let after_del = call(reqwest::Method::GET, p_url.clone(), None, 200).await;
        assert_eq!(after_del["graph"]["nodes"].as_array().unwrap().len(), 0);
        assert_eq!(after_del["generated"].as_array().unwrap().len(), 1);

        // 7. Cancellation & 409 lock during active generation
        let http_bg = http.clone();
        let turn_url = format!("{base}{p_url}/sessions/{s_id}/turn");
        let pending = tokio::spawn(async move {
            http_bg
                .post(turn_url)
                .json(&json!({ "message": "hold generation", "materialIds": [] }))
                .send()
                .await
                .unwrap()
        });

        for _ in 0..200 {
            if mock.hold_reached.load(Ordering::SeqCst) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert!(mock.hold_reached.load(Ordering::SeqCst));

        call(
            reqwest::Method::POST,
            format!("{p_url}/data"),
            Some(json!({ "categories": ["history"] })),
            409,
        )
        .await;

        call(
            reqwest::Method::POST,
            format!("{p_url}/cancel"),
            None,
            200,
        )
        .await;

        let cancelled_res = pending.await.unwrap();
        assert_eq!(cancelled_res.status().as_u16(), 499);
        mock.hold_notify.notify_one();

        // 8. Clear data keeps generated & curriculum
        let cleared = call(
            reqwest::Method::POST,
            format!("{p_url}/data"),
            Some(json!({ "categories": ["history", "cache"] })),
            200,
        )
        .await;
        assert_eq!(cleared["sessions"].as_array().unwrap().len(), 0);
        assert_eq!(cleared["graph"]["nodes"].as_array().unwrap().len(), 0);
        assert_eq!(cleared["generated"].as_array().unwrap().len(), 1);
        assert_eq!(cleared["curriculum"].as_array().unwrap().len(), 1);

        let _ = server_shutdown.send(());
        let _ = mock_shutdown.send(());
    }
}
