use std::sync::OnceLock;
use std::time::Duration;

use regex::Regex;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;
use url::Url;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::storage::{required_text, Connection, Settings, Storage};

const PROVIDERS: [(&str, &str, &str); 6] = [
    ("openai", "OpenAI", "https://api.openai.com/v1"),
    ("anthropic", "Anthropic", "https://api.anthropic.com/v1"),
    (
        "google",
        "Google Gemini",
        "https://generativelanguage.googleapis.com/v1beta",
    ),
    (
        "opencode",
        "OpenCode (pay-as-you-go)",
        "https://opencode.ai/inference",
    ),
    (
        "opencode-go",
        "OpenCode Go",
        "https://opencode.ai/inference/go",
    ),
    ("custom", "OpenAI-compatible", "http://localhost:11434/v1"),
];

const USER_AGENT_VALUE: &str = "minilearn/0.1.0";
const DISCOVER_TIMEOUT_MS: u64 = 20_000;
const GENERATE_TIMEOUT_MS: u64 = 120_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicConnection {
    pub id: String,
    pub provider: String,
    pub label: String,
    pub base_url: String,
    pub model: String,
    pub has_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attachment {
    pub mime: String,
    pub name: String,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    pub attachments: Vec<Attachment>,
}

fn provider_entry(id: &str) -> Option<(&'static str, &'static str)> {
    PROVIDERS
        .iter()
        .find(|(key, _, _)| *key == id)
        .map(|(_, name, url)| (*name, *url))
}

fn provider_names() -> Value {
    let mut map = serde_json::Map::new();
    for (key, name, _) in PROVIDERS {
        map.insert(key.to_string(), Value::String(name.to_string()));
    }
    Value::Object(map)
}

pub fn normalize_connection(
    input: &Value,
    previous: Option<&Connection>,
    need_model: bool,
) -> AppResult<Connection> {
    let Some(obj) = input.as_object() else {
        return Err(AppError::bad_request("Choose a supported provider."));
    };
    let Some(provider) = obj.get("provider").and_then(|v| v.as_str()) else {
        return Err(AppError::bad_request("Choose a supported provider."));
    };
    let Some((default_label, default_url)) = provider_entry(provider) else {
        return Err(AppError::bad_request("Choose a supported provider."));
    };

    let api_key = match obj.get("apiKey") {
        None => previous
            .map(|p| p.api_key.trim().to_string())
            .unwrap_or_default(),
        Some(v) => v
            .as_str()
            .map(|s| s.trim().to_string())
            .unwrap_or_default(),
    };
    if api_key.chars().count() > 12_000 || api_key.contains('\r') || api_key.contains('\n') {
        return Err(AppError::bad_request("Invalid API key."));
    }
    if provider != "custom" && api_key.is_empty() {
        return Err(AppError::bad_request("Enter your API key."));
    }

    let mut base_url = default_url.to_string();
    if provider == "custom" {
        let raw_url = obj
            .get("baseUrl")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(default_url);
        let invalid_url = || {
            AppError::bad_request(
                "Enter a valid HTTP or HTTPS API base URL, such as http://localhost:11434/v1.",
            )
        };
        let mut parsed = Url::parse(raw_url).map_err(|_| invalid_url())?;
        if !matches!(parsed.scheme(), "http" | "https")
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some_and(|q| !q.is_empty())
            || parsed.fragment().is_some_and(|f| !f.is_empty())
            || parsed.host_str().is_none()
        {
            return Err(invalid_url());
        }
        if parsed.path() == "/" {
            parsed.set_path("/v1");
        }
        base_url = parsed.as_str().trim_end_matches('/').to_string();
    }

    let model = if need_model {
        required_text(obj.get("model").and_then(|v| v.as_str()), "Model", 300)?
    } else {
        String::new()
    };

    let id = previous
        .map(|p| p.id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let label = obj
        .get("label")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(100).collect::<String>())
        .unwrap_or_else(|| default_label.to_string());

    Ok(Connection {
        id,
        provider: provider.to_string(),
        label,
        api_key,
        base_url,
        model,
    })
}

pub fn public_connection(c: &Connection) -> PublicConnection {
    PublicConnection {
        id: c.id.clone(),
        provider: c.provider.clone(),
        label: c.label.clone(),
        base_url: c.base_url.clone(),
        model: c.model.clone(),
        has_key: !c.api_key.is_empty(),
    }
}

pub fn get_connections(storage: &Storage) -> AppResult<Value> {
    let s = storage.settings()?;
    let connections: Vec<PublicConnection> = s.connections.iter().map(public_connection).collect();
    Ok(json!({
        "activeConnection": s.active_connection,
        "connections": connections,
        "providers": provider_names(),
    }))
}

pub fn selected_connection(storage: &Storage) -> AppResult<Connection> {
    let s = storage.settings()?;
    let Some(active) = s.active_connection.as_deref() else {
        return Err(AppError::conflict(
            "Connect an AI model in Settings before continuing.",
        ));
    };
    s.connections
        .into_iter()
        .find(|c| c.id == active)
        .ok_or_else(|| AppError::conflict("Connect an AI model in Settings before continuing."))
}

fn native_opencode(c: &Connection) -> bool {
    c.provider == "opencode" || c.provider == "opencode-go"
}

fn opencode_custom_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^https://opencode\.ai/(?:zen(?:/go)?/v1|inference(?:/go)?/openai/v1)$")
            .unwrap()
    })
}

fn excluded_model_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?i)embedding|moderation|whisper|^tts|dall-e|^gpt-image|audio|realtime|rerank",
        )
        .unwrap()
    })
}

fn is_opencode(c: &Connection) -> bool {
    // Also support existing custom connections to documented OpenCode URLs.
    // Never attach OpenCode-specific routing data to unrelated custom hosts.
    native_opencode(c) || (c.provider == "custom" && opencode_custom_re().is_match(&c.base_url))
}

fn request_headers(c: &Connection, conversation_id: Option<&str>) -> AppResult<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    if c.provider == "anthropic" {
        headers.insert(
            "x-api-key",
            HeaderValue::from_str(&c.api_key)
                .map_err(|_| AppError::bad_request("Invalid API key."))?,
        );
        headers.insert(
            "anthropic-version",
            HeaderValue::from_static("2023-06-01"),
        );
    } else if c.provider == "google" {
        headers.insert(
            "x-goog-api-key",
            HeaderValue::from_str(&c.api_key)
                .map_err(|_| AppError::bad_request("Invalid API key."))?,
        );
    } else if !c.api_key.is_empty() {
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", c.api_key))
                .map_err(|_| AppError::bad_request("Invalid API key."))?,
        );
    }

    if is_opencode(c) {
        headers.insert(USER_AGENT, HeaderValue::from_static(USER_AGENT_VALUE));
        // Opaque, stable within this connection and conversation; no learner data
        // or raw project identifiers need to be sent as routing metadata.
        let conv = match conversation_id {
            Some(id) => id.to_string(),
            None => Uuid::new_v4().to_string(),
        };
        let input = serde_json::to_string(&(&c.id, &conv))
            .map_err(|e| AppError::internal(e.to_string()))?;
        let digest = hex::encode(Sha256::digest(input.as_bytes()));
        headers.insert(
            "x-opencode-session",
            HeaderValue::from_str(&format!("ses_{digest}"))
                .map_err(|e| AppError::internal(e.to_string()))?,
        );
    }

    Ok(headers)
}

async fn request(
    client: &reqwest::Client,
    c: &Connection,
    endpoint: &str,
    body: Option<&Value>,
    conversation_id: Option<&str>,
    timeout_ms: u64,
    cancel: &CancellationToken,
) -> AppResult<Value> {
    if cancel.is_cancelled() {
        return Err(AppError::cancelled());
    }

    let url = format!("{}{}", c.base_url, endpoint);
    let headers = request_headers(c, conversation_id)?;
    let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);
    let mut req = match body {
        Some(payload) => client.post(&url).headers(headers).json(payload),
        None => client.get(&url).headers(headers),
    };
    req = req.timeout(Duration::from_millis(timeout_ms));

    let response = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(AppError::cancelled()),
        _ = tokio::time::sleep_until(deadline) => {
            return Err(AppError::bad_gateway("The model did not respond in time."));
        }
        res = req.send() => match res {
            Ok(r) => r,
            Err(err) => {
                if cancel.is_cancelled() {
                    return Err(AppError::cancelled());
                }
                if err.is_timeout() {
                    return Err(AppError::bad_gateway("The model did not respond in time."));
                }
                return Err(AppError::bad_gateway(
                    "Could not reach the provider. Check the API URL, key, and network connection.",
                ));
            }
        }
    };

    let status = response.status();
    let bytes = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(AppError::cancelled()),
        _ = tokio::time::sleep_until(deadline) => {
            return Err(AppError::bad_gateway("The model did not respond in time."));
        }
        res = response.bytes() => match res {
            Ok(b) => b,
            Err(err) => {
                if cancel.is_cancelled() {
                    return Err(AppError::cancelled());
                }
                if err.is_timeout() {
                    return Err(AppError::bad_gateway("The model did not respond in time."));
                }
                return Err(AppError::bad_gateway(format!(
                    "The provider returned an unexpected response ({}).",
                    status.as_u16()
                )));
            }
        }
    };

    let result: Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => {
            if cancel.is_cancelled() {
                return Err(AppError::cancelled());
            }
            return Err(AppError::bad_gateway(format!(
                "The provider returned an unexpected response ({}).",
                status.as_u16()
            )));
        }
    };

    if !status.is_success() {
        let mut message = result
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                result
                    .get("message")
                    .and_then(|m| m.as_str())
                    .filter(|s| !s.is_empty())
            })
            .map(str::to_string)
            .unwrap_or_else(|| format!("Provider returned HTTP {}.", status.as_u16()));
        if !c.api_key.is_empty() {
            message = message.replace(&c.api_key, "[redacted]");
        }
        let truncated: String = message.chars().take(600).collect();
        return Err(AppError::bad_gateway(truncated));
    }

    Ok(result)
}

pub async fn discover_models(
    client: &reqwest::Client,
    connection: &Connection,
    cancel: &CancellationToken,
) -> AppResult<Vec<ModelInfo>> {
    if connection.provider == "google" {
        let data = request(
            client,
            connection,
            "/models?pageSize=100",
            None,
            None,
            DISCOVER_TIMEOUT_MS,
            cancel,
        )
        .await?;
        let mut models: Vec<ModelInfo> = data
            .get("models")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
            .filter(|m| {
                m.get("supportedGenerationMethods")
                    .and_then(|v| v.as_array())
                    .is_some_and(|arr| arr.iter().any(|item| item.as_str() == Some("generateContent")))
            })
            .filter_map(|m| {
                let raw_name = m.get("name").and_then(|v| v.as_str())?;
                let id = raw_name.strip_prefix("models/").unwrap_or(raw_name).to_string();
                let name = m
                    .get("displayName")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(raw_name)
                    .to_string();
                Some(ModelInfo { id, name })
            })
            .collect();
        models.sort_by(|a, b| a.id.cmp(&b.id));
        return Ok(models);
    }

    let endpoint = if native_opencode(connection) {
        "/v1/models"
    } else if connection.provider == "anthropic" {
        "/models?limit=100"
    } else {
        "/models"
    };

    let data = request(
        client,
        connection,
        endpoint,
        None,
        None,
        DISCOVER_TIMEOUT_MS,
        cancel,
    )
    .await?;

    let is_native_oc = native_opencode(connection);
    let mut models: Vec<ModelInfo> = data
        .get("data")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let id = m.get("id").and_then(|v| v.as_str())?;
            let type_ok = !is_native_oc
                || match m.get("type").and_then(|v| v.as_str()) {
                    None | Some("") | Some("chat") => true,
                    _ => false,
                };
            if !type_ok || excluded_model_re().is_match(id) {
                return None;
            }
            let name = m
                .get("display_name")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    if is_native_oc {
                        m.get("name")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty())
                    } else {
                        None
                    }
                })
                .unwrap_or(id)
                .to_string();
            Some(ModelInfo {
                id: id.to_string(),
                name,
            })
        })
        .collect();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}

fn openai_content(message: &ChatMessage) -> Value {
    if message.attachments.is_empty() {
        return Value::String(message.content.clone());
    }
    let mut parts = vec![json!({ "type": "text", "text": message.content })];
    for f in &message.attachments {
        let data = format!("data:{};base64,{}", f.mime, f.data);
        if f.mime == "application/pdf" {
            parts.push(json!({
                "type": "file",
                "file": { "filename": f.name, "file_data": data },
            }));
        } else {
            parts.push(json!({
                "type": "image_url",
                "image_url": { "url": data },
            }));
        }
    }
    Value::Array(parts)
}

fn anthropic_content(message: &ChatMessage) -> Value {
    if message.attachments.is_empty() {
        return Value::String(message.content.clone());
    }
    let mut parts = vec![json!({ "type": "text", "text": message.content })];
    for f in &message.attachments {
        let block_type = if f.mime == "application/pdf" {
            "document"
        } else {
            "image"
        };
        parts.push(json!({
            "type": block_type,
            "source": {
                "type": "base64",
                "media_type": f.mime,
                "data": f.data,
            },
        }));
    }
    Value::Array(parts)
}

fn gemini_content(message: &ChatMessage) -> Value {
    let role = if message.role == "assistant" {
        "model"
    } else {
        "user"
    };
    let mut parts = vec![json!({ "text": message.content })];
    for f in &message.attachments {
        parts.push(json!({
            "inlineData": {
                "mimeType": f.mime,
                "data": f.data,
            },
        }));
    }
    json!({ "role": role, "parts": parts })
}

fn encode_uri_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.as_bytes() {
        let unescaped = matches!(
            *byte,
            b'A'..=b'Z'
                | b'a'..=b'z'
                | b'0'..=b'9'
                | b'-'
                | b'_'
                | b'.'
                | b'!'
                | b'~'
                | b'*'
                | b'\''
                | b'('
                | b')'
        );
        if unescaped {
            out.push(*byte as char);
        } else {
            out.push_str(&format!("%{:02X}", byte));
        }
    }
    out
}

fn is_truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0) != 0.0,
        Some(Value::String(s)) => !s.is_empty(),
        _ => true,
    }
}

pub async fn generate(
    client: &reqwest::Client,
    connection: &Connection,
    system: &str,
    messages: &[ChatMessage],
    test: bool,
    conversation_id: Option<&str>,
    cancel: &CancellationToken,
) -> AppResult<String> {
    let model = &connection.model;
    let answer: Option<String> = if connection.provider == "anthropic" {
        let msgs: Vec<Value> = messages
            .iter()
            .map(|m| json!({ "role": m.role, "content": anthropic_content(m) }))
            .collect();
        let body = json!({
            "model": model,
            "system": system,
            "max_tokens": if test { 128 } else { 8192 },
            "messages": msgs,
        });
        let result = request(
            client,
            connection,
            "/messages",
            Some(&body),
            None,
            GENERATE_TIMEOUT_MS,
            cancel,
        )
        .await?;
        result.get("content").and_then(|v| v.as_array()).map(|arr| {
            arr.iter()
                .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("\n")
        })
    } else if connection.provider == "google" {
        let stripped = model.strip_prefix("models/").unwrap_or(model);
        let endpoint = format!("/models/{}:generateContent", encode_uri_component(stripped));
        let contents: Vec<Value> = messages.iter().map(gemini_content).collect();
        let body = json!({
            "systemInstruction": { "parts": [{ "text": system }] },
            "contents": contents,
            "generationConfig": { "maxOutputTokens": if test { 512 } else { 8192 } },
        });
        let result = request(
            client,
            connection,
            &endpoint,
            Some(&body),
            None,
            GENERATE_TIMEOUT_MS,
            cancel,
        )
        .await?;
        result
            .get("candidates")
            .and_then(|c| c.as_array())
            .and_then(|c| c.first())
            .and_then(|c| c.get("content"))
            .and_then(|c| c.get("parts"))
            .and_then(|p| p.as_array())
            .map(|parts| {
                parts
                    .iter()
                    .filter(|p| !is_truthy(p.get("thought")))
                    .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
    } else {
        let endpoint = if native_opencode(connection) {
            "/openai/v1/chat/completions"
        } else {
            "/chat/completions"
        };
        let mut msgs = vec![json!({ "role": "system", "content": system })];
        for m in messages {
            msgs.push(json!({ "role": m.role, "content": openai_content(m) }));
        }
        let mut body = json!({
            "model": model,
            "messages": msgs,
        });
        if test {
            let map = body.as_object_mut().unwrap();
            if connection.provider == "openai" {
                map.insert("max_completion_tokens".to_string(), json!(512));
            } else {
                let limit = if is_opencode(connection) { 1024 } else { 128 };
                map.insert("max_tokens".to_string(), json!(limit));
            }
        }
        let result = request(
            client,
            connection,
            endpoint,
            Some(&body),
            conversation_id,
            GENERATE_TIMEOUT_MS,
            cancel,
        )
        .await?;
        let content = result
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|c| c.first())
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"));
        match content {
            Some(Value::String(s)) => Some(s.clone()),
            Some(Value::Array(arr)) => Some(
                arr.iter()
                    .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("\n"),
            ),
            _ => None,
        }
    };

    let trimmed = answer
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    match trimmed {
        Some(text) => Ok(text.to_string()),
        None => Err(AppError::bad_gateway(
            "The model returned an empty response. Check that the selected model supports text generation.",
        )),
    }
}

pub async fn connect(
    client: &reqwest::Client,
    storage: &Storage,
    input: &Value,
    cancel: &CancellationToken,
) -> AppResult<PublicConnection> {
    let settings = storage.settings()?;
    let requested_id = input
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    let previous = match requested_id {
        Some(id) => {
            let found = settings.connections.iter().find(|c| c.id == id);
            if found.is_none() {
                return Err(AppError::not_found("Connection not found."));
            }
            found
        }
        None => None,
    };

    let c = normalize_connection(input, previous, true)?;
    let should_test = input.get("test").and_then(|v| v.as_bool()) != Some(false);
    if should_test {
        let test_msg = [ChatMessage {
            role: "user".to_string(),
            content: "Say OK.".to_string(),
            attachments: Vec::new(),
        }];
        generate(
            client,
            &c,
            "You are testing a connection. Reply with OK.",
            &test_msg,
            true,
            None,
            cancel,
        )
        .await?;
    }

    // Reread after the network request in case another connection was changed.
    let fresh = storage.settings()?;
    let mut connections: Vec<Connection> = fresh
        .connections
        .into_iter()
        .filter(|v| v.id != c.id)
        .collect();
    connections.push(c.clone());
    storage.save_settings(&Settings {
        connections,
        active_connection: Some(c.id.clone()),
    })?;
    Ok(public_connection(&c))
}

pub fn activate_connection(storage: &Storage, connection_id: &str) -> AppResult<Value> {
    let mut settings = storage.settings()?;
    if !settings.connections.iter().any(|c| c.id == connection_id) {
        return Err(AppError::not_found("Connection not found."));
    }
    settings.active_connection = Some(connection_id.to_string());
    storage.save_settings(&settings)?;
    get_connections(storage)
}

pub fn delete_connection(storage: &Storage, connection_id: &str) -> AppResult<Value> {
    let settings = storage.settings()?;
    let connections: Vec<Connection> = settings
        .connections
        .into_iter()
        .filter(|c| c.id != connection_id)
        .collect();
    let active_connection = if settings.active_connection.as_deref() == Some(connection_id) {
        connections.first().map(|c| c.id.clone())
    } else {
        settings.active_connection
    };
    storage.save_settings(&Settings {
        connections,
        active_connection,
    })?;
    get_connections(storage)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tutor::{run_planner, run_tutor};
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap()
    }

    fn temp_dir(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("minilearn-{label}-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[derive(Clone)]
    struct RecordedRequest {
        method: String,
        path: String,
        headers: Vec<(String, String)>,
        body: String,
    }

    impl RecordedRequest {
        fn header(&self, name: &str) -> Option<&str> {
            let lower = name.to_ascii_lowercase();
            self.headers
                .iter()
                .find(|(k, _)| k.to_ascii_lowercase() == lower)
                .map(|(_, v)| v.as_str())
        }
    }

    async fn read_http_request(socket: &mut tokio::net::TcpStream) -> Option<RecordedRequest> {
        let mut buf = Vec::new();
        let mut tmp = [0u8; 4096];
        let header_end;
        loop {
            let n = socket.read(&mut tmp).await.ok()?;
            if n == 0 {
                return None;
            }
            buf.extend_from_slice(&tmp[..n]);
            if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                header_end = pos + 4;
                break;
            }
        }
        let head = String::from_utf8_lossy(&buf[..header_end - 4]);
        let mut lines = head.split("\r\n");
        let first = lines.next()?;
        let mut parts = first.split_whitespace();
        let method = parts.next()?.to_string();
        let path = parts.next()?.to_string();
        let mut headers = Vec::new();
        let mut content_length = 0usize;
        for line in lines {
            if let Some((k, v)) = line.split_once(':') {
                let key = k.trim().to_string();
                let val = v.trim().to_string();
                if key.eq_ignore_ascii_case("content-length") {
                    content_length = val.parse().unwrap_or(0);
                }
                headers.push((key, val));
            }
        }
        while buf.len() - header_end < content_length {
            let n = socket.read(&mut tmp).await.ok()?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&tmp[..n]);
        }
        let body_bytes = &buf[header_end..header_end + content_length];
        Some(RecordedRequest {
            method,
            path,
            headers,
            body: String::from_utf8_lossy(body_bytes).into_owned(),
        })
    }

    async fn spawn_mock_server<F>(handler: F) -> String
    where
        F: Fn(RecordedRequest) -> (u16, Value) + Send + Sync + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handler = Arc::new(handler);
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let handler = handler.clone();
                tokio::spawn(async move {
                    while let Some(req) = read_http_request(&mut socket).await {
                        let (status, val) = handler(req);
                        let body = serde_json::to_vec(&val).unwrap();
                        let resp = format!(
                            "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        );
                        let _ = socket.write_all(resp.as_bytes()).await;
                        let _ = socket.write_all(&body).await;
                        break;
                    }
                });
            }
        });
        format!("http://127.0.0.1:{}", addr.port())
    }

    #[tokio::test]
    async fn provider_adapters_discover_and_generate_with_correct_formats() {
        let calls = Arc::new(Mutex::new(Vec::<RecordedRequest>::new()));
        let calls_ref = calls.clone();
        let base = spawn_mock_server(move |req| {
            calls_ref.lock().unwrap().push(req.clone());
            if req.path.starts_with("/anthropic") {
                if req.method == "GET" {
                    return (
                        200,
                        json!({ "data": [{ "id": "claude-test", "display_name": "Claude" }] }),
                    );
                }
                return (
                    200,
                    json!({ "content": [{ "type": "text", "text": "Anthropic reply" }] }),
                );
            }
            if req.path.starts_with("/google") {
                if req.method == "GET" {
                    return (
                        200,
                        json!({
                            "models": [{
                                "name": "models/gemini-test",
                                "supportedGenerationMethods": ["generateContent"],
                            }]
                        }),
                    );
                }
                return (
                    200,
                    json!({
                        "candidates": [{
                            "content": {
                                "parts": [
                                    { "thought": true, "text": "Hidden reasoning" },
                                    { "text": "Gemini reply" },
                                ]
                            }
                        }]
                    }),
                );
            }
            if req.method == "GET" {
                return (
                    200,
                    json!({ "data": [{ "id": "gpt-test" }, { "id": "text-embedding-test" }] }),
                );
            }
            (
                200,
                json!({ "choices": [{ "message": { "content": "OpenAI reply" } }] }),
            )
        })
        .await;

        let client = test_client();
        let cancel = CancellationToken::new();
        let user_msg = [ChatMessage {
            role: "user".to_string(),
            content: "hello".to_string(),
            attachments: Vec::new(),
        }];

        let mut openai = normalize_connection(
            &json!({ "provider": "openai", "apiKey": "fake", "model": "gpt-test" }),
            None,
            true,
        )
        .unwrap();
        openai.base_url = format!("{base}/openai");
        let openai_models = discover_models(&client, &openai, &cancel).await.unwrap();
        assert_eq!(
            openai_models.into_iter().map(|m| m.id).collect::<Vec<_>>(),
            vec!["gpt-test"]
        );
        assert_eq!(
            generate(&client, &openai, "system", &user_msg, false, None, &cancel)
                .await
                .unwrap(),
            "OpenAI reply"
        );
        assert_eq!(
            calls.lock().unwrap().last().unwrap().header("authorization"),
            Some("Bearer fake")
        );

        let mut anthropic = normalize_connection(
            &json!({ "provider": "anthropic", "apiKey": "fake", "model": "claude-test" }),
            None,
            true,
        )
        .unwrap();
        anthropic.base_url = format!("{base}/anthropic");
        assert_eq!(
            discover_models(&client, &anthropic, &cancel).await.unwrap()[0].id,
            "claude-test"
        );
        assert_eq!(
            generate(
                &client,
                &anthropic,
                "system",
                &user_msg,
                false,
                None,
                &cancel
            )
            .await
            .unwrap(),
            "Anthropic reply"
        );
        {
            let guard = calls.lock().unwrap();
            let last = guard.last().unwrap();
            let payload: Value = serde_json::from_str(&last.body).unwrap();
            assert_eq!(payload["system"], "system");
            assert_eq!(last.header("x-api-key"), Some("fake"));
        }

        let mut google = normalize_connection(
            &json!({ "provider": "google", "apiKey": "fake", "model": "gemini-test" }),
            None,
            true,
        )
        .unwrap();
        google.base_url = format!("{base}/google");
        assert_eq!(
            discover_models(&client, &google, &cancel).await.unwrap()[0].id,
            "gemini-test"
        );
        assert_eq!(
            generate(&client, &google, "system", &user_msg, false, None, &cancel)
                .await
                .unwrap(),
            "Gemini reply"
        );
        {
            let guard = calls.lock().unwrap();
            let last = guard.last().unwrap();
            let payload: Value = serde_json::from_str(&last.body).unwrap();
            assert_eq!(payload["contents"][0]["parts"][0]["text"], "hello");
            assert_eq!(last.header("x-goog-api-key"), Some("fake"));
        }

        let local = normalize_connection(
            &json!({ "provider": "custom", "baseUrl": "http://127.0.0.1:1234", "model": "local" }),
            None,
            true,
        )
        .unwrap();
        assert_eq!(local.base_url, "http://127.0.0.1:1234/v1");
        assert_eq!(local.api_key, "");
    }

    #[tokio::test]
    async fn opencode_endpoints_and_conversation_scoped_session_headers() {
        let dir = temp_dir("opencode");
        let storage = Storage::new(&dir).unwrap();
        let requests = Arc::new(Mutex::new(Vec::<RecordedRequest>::new()));
        let req_ref = requests.clone();

        let base = spawn_mock_server(move |req| {
            req_ref.lock().unwrap().push(req.clone());
            if req.path.starts_with("/oc") {
                assert_eq!(req.header("authorization"), Some("Bearer fake-key"));
                assert!(req
                    .header("user-agent")
                    .is_some_and(|ua| ua.starts_with("minilearn/")));
                match req.header("x-opencode-session") {
                    None => {
                        return (
                            400,
                            json!({ "error": { "message": "Request is missing x-opencode-session" } }),
                        )
                    }
                    Some(ses) => {
                        assert!(ses.starts_with("ses_") && ses.len() == 68);
                        assert!(ses[4..].chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
                    }
                }
            }
            if req.method == "GET" {
                return (
                    200,
                    json!({
                        "data": [
                            { "id": "model-test", "name": "Test Model", "type": "chat" },
                            { "id": "decision-test", "type": "decision" },
                        ]
                    }),
                );
            }
            (
                200,
                json!({
                    "choices": [{
                        "message": {
                            "content": serde_json::to_string(&json!({
                                "reply": "Hello",
                                "curriculum": null,
                                "knowledge": [],
                            })).unwrap()
                        }
                    }]
                }),
            )
        })
        .await;

        let client = test_client();
        let cancel = CancellationToken::new();
        for (provider, expected_base) in [
            ("opencode-go", "https://opencode.ai/inference/go"),
            ("opencode", "https://opencode.ai/inference"),
        ] {
            let mut c = normalize_connection(
                &json!({ "provider": provider, "apiKey": "fake-key", "model": "model-test" }),
                None,
                true,
            )
            .unwrap();
            assert_eq!(c.base_url, expected_base);
            c.base_url = format!("{base}/oc");
            let models = discover_models(&client, &c, &cancel).await.unwrap();
            assert_eq!(
                models,
                vec![ModelInfo {
                    id: "model-test".into(),
                    name: "Test Model".into()
                }]
            );
            assert_eq!(requests.lock().unwrap().last().unwrap().path, "/oc/v1/models");
            generate(
                &client,
                &c,
                "sys",
                &[ChatMessage {
                    role: "user".into(),
                    content: "Say OK.".into(),
                    attachments: Vec::new(),
                }],
                true,
                None,
                &cancel,
            )
            .await
            .unwrap();
            assert_eq!(
                requests.lock().unwrap().last().unwrap().path,
                "/oc/openai/v1/chat/completions"
            );
        }

        // Persist a custom connection routed to mock server to test connect() + conversation routing.
        let mut c = normalize_connection(
            &json!({ "provider": "opencode-go", "apiKey": "fake-key", "model": "model-test" }),
            None,
            true,
        )
        .unwrap();
        c.base_url = format!("{base}/oc");
        storage
            .save_settings(&Settings {
                connections: vec![c.clone()],
                active_connection: Some(c.id.clone()),
            })
            .unwrap();
        let c = selected_connection(&storage).unwrap();

        let route = || {
            requests
                .lock()
                .unwrap()
                .last()
                .unwrap()
                .header("x-opencode-session")
                .map(str::to_string)
        };

        generate(
            &client,
            &c,
            "sys",
            &[ChatMessage {
                role: "user".into(),
                content: "Hi".into(),
                attachments: Vec::new(),
            }],
            true,
            None,
            &cancel,
        )
        .await
        .unwrap();
        let test_route = route().unwrap();

        let project = storage.create(Some("Linear Algebra")).unwrap();
        let lesson = project
            .save_curriculum(json!([{ "title": "Vectors", "lessons": [{ "title": "Span" }] }]))
            .unwrap()[0]
            .lessons[0]
            .clone();
        let session = project.new_session(Some(&lesson.id), Some("learn")).unwrap();
        run_tutor(
            &client,
            &project,
            &c,
            &session.id,
            &json!({ "message": "Teach me" }),
            &cancel,
        )
        .await
        .unwrap();
        let tutor_route = route().unwrap();
        assert_ne!(tutor_route, test_route);

        let reopened = storage.project(project.id()).unwrap();
        run_tutor(
            &client,
            &reopened,
            &c,
            &session.id,
            &json!({ "message": "Continue" }),
            &cancel,
        )
        .await
        .unwrap();
        assert_eq!(route().unwrap(), tutor_route);

        let another = project
            .new_session(Some(&lesson.id), Some("practice"))
            .unwrap();
        run_tutor(
            &client,
            &project,
            &c,
            &another.id,
            &json!({ "message": "Practice" }),
            &cancel,
        )
        .await
        .unwrap();
        assert_ne!(route().unwrap(), tutor_route);

        run_planner(&client, &project, &c, Some("Plan vectors"), false, &cancel)
            .await
            .unwrap();
        let planner_route = route().unwrap();
        assert_ne!(planner_route, tutor_route);

        let reopened2 = storage.project(project.id()).unwrap();
        run_planner(
            &client,
            &reopened2,
            &c,
            Some("Continue planning"),
            false,
            &cancel,
        )
        .await
        .unwrap();
        assert_eq!(route().unwrap(), planner_route);

        project.clear_planner().unwrap();
        run_planner(&client, &project, &c, Some("New plan"), false, &cancel)
            .await
            .unwrap();
        assert_ne!(route().unwrap(), planner_route);

        let other = storage.create(Some("Another subject")).unwrap();
        run_planner(&client, &other, &c, Some("New plan"), false, &cancel)
            .await
            .unwrap();
        assert_ne!(route().unwrap(), planner_route);

        // Legacy custom OpenCode URL matches is_opencode; unrelated custom hosts do not.
        let legacy = normalize_connection(
            &json!({
                "provider": "custom",
                "baseUrl": "https://opencode.ai/zen/go/v1",
                "apiKey": "fake-key",
                "model": "model-test",
            }),
            None,
            true,
        )
        .unwrap();
        assert!(is_opencode(&legacy));
        let h1 = request_headers(&legacy, Some("conversation")).unwrap();
        let h2 = request_headers(&legacy, Some("conversation")).unwrap();
        assert_eq!(h1.get("x-opencode-session"), h2.get("x-opencode-session"));

        let local = normalize_connection(
            &json!({
                "provider": "custom",
                "baseUrl": format!("{base}/local/v1"),
                "model": "local",
            }),
            None,
            true,
        )
        .unwrap();
        assert!(!is_opencode(&local));
        generate(
            &client,
            &local,
            "system",
            &[ChatMessage {
                role: "user".into(),
                content: "Hi".into(),
                attachments: Vec::new(),
            }],
            false,
            Some("conversation"),
            &cancel,
        )
        .await
        .unwrap();
        assert!(route().is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn error_redacts_api_key_and_connect_persists_without_exposing_key() {
        let dir = temp_dir("connect");
        let storage = Storage::new(&dir).unwrap();
        let base = spawn_mock_server(|req| {
            if req.path == "/fail/chat/completions" {
                return (
                    401,
                    json!({ "error": { "message": "Invalid token super-secret-key provided" } }),
                );
            }
            (
                200,
                json!({ "choices": [{ "message": { "content": "OK" } }] }),
            )
        })
        .await;

        let client = test_client();
        let cancel = CancellationToken::new();

        let err = connect(
            &client,
            &storage,
            &json!({
                "provider": "custom",
                "baseUrl": format!("{base}/fail"),
                "apiKey": "super-secret-key",
                "model": "m",
            }),
            &cancel,
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, 502);
        assert!(!err.message.contains("super-secret-key"));
        assert!(err.message.contains("[redacted]"));

        let pub_conn = connect(
            &client,
            &storage,
            &json!({
                "provider": "custom",
                "baseUrl": format!("{base}/ok"),
                "apiKey": "super-secret-key",
                "model": "m",
            }),
            &cancel,
        )
        .await
        .unwrap();
        assert!(pub_conn.has_key);
        let json_pub = serde_json::to_string(&get_connections(&storage).unwrap()).unwrap();
        assert!(!json_pub.contains("super-secret-key"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn normalize_connection_validation_and_connection_lifecycle() {
        let dir = temp_dir("lifecycle");
        let storage = Storage::new(&dir).unwrap();

        assert_eq!(
            selected_connection(&storage).unwrap_err().status,
            409
        );
        assert!(normalize_connection(&json!({ "provider": "unknown" }), None, true).is_err());
        assert!(normalize_connection(&json!({ "provider": "openai", "model": "gpt-4o" }), None, true).is_err());
        assert!(normalize_connection(
            &json!({ "provider": "openai", "apiKey": "bad\nkey", "model": "gpt-4o" }),
            None,
            true
        )
        .is_err());
        assert!(normalize_connection(
            &json!({ "provider": "custom", "baseUrl": "https://user:pass@example.com/v1", "model": "x" }),
            None,
            true
        )
        .is_err());
        assert!(normalize_connection(
            &json!({ "provider": "custom", "baseUrl": "ftp://example.com/v1", "model": "x" }),
            None,
            true
        )
        .is_err());

        let c1 = normalize_connection(
            &json!({ "provider": "custom", "baseUrl": "http://127.0.0.1:11434/", "model": "m1" }),
            None,
            true,
        )
        .unwrap();
        assert_eq!(c1.base_url, "http://127.0.0.1:11434/v1");
        let c2 = normalize_connection(
            &json!({ "provider": "custom", "baseUrl": "http://127.0.0.1:1234/v1/", "model": "m2" }),
            None,
            true,
        )
        .unwrap();
        storage
            .save_settings(&Settings {
                connections: vec![c1.clone(), c2.clone()],
                active_connection: Some(c1.id.clone()),
            })
            .unwrap();

        assert_eq!(activate_connection(&storage, "missing").unwrap_err().status, 404);
        activate_connection(&storage, &c2.id).unwrap();
        assert_eq!(selected_connection(&storage).unwrap().id, c2.id);

        delete_connection(&storage, &c2.id).unwrap();
        assert_eq!(selected_connection(&storage).unwrap().id, c1.id);
        delete_connection(&storage, &c1.id).unwrap();
        assert_eq!(selected_connection(&storage).unwrap_err().status, 409);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn multimodal_payload_builders_format_pdf_and_images_correctly() {
        let msg = ChatMessage {
            role: "user".into(),
            content: "Check these".into(),
            attachments: vec![
                Attachment {
                    mime: "application/pdf".into(),
                    name: "notes.pdf".into(),
                    data: "JVBERi0=".into(),
                },
                Attachment {
                    mime: "image/png".into(),
                    name: "diag.png".into(),
                    data: "iVBORw==".into(),
                },
            ],
        };
        let oa = openai_content(&msg);
        assert_eq!(oa[0]["type"], "text");
        assert_eq!(oa[1]["type"], "file");
        assert_eq!(oa[1]["file"]["filename"], "notes.pdf");
        assert_eq!(oa[2]["type"], "image_url");

        let ant = anthropic_content(&msg);
        assert_eq!(ant[1]["type"], "document");
        assert_eq!(ant[2]["type"], "image");
        assert_eq!(ant[1]["source"]["media_type"], "application/pdf");

        let gem = gemini_content(&msg);
        assert_eq!(gem["role"], "user");
        assert_eq!(gem["parts"][1]["inlineData"]["mimeType"], "application/pdf");
        assert_eq!(gem["parts"][2]["inlineData"]["mimeType"], "image/png");
    }

    #[tokio::test]
    async fn generate_respects_pre_cancelled_token() {
        let client = test_client();
        let cancel = CancellationToken::new();
        cancel.cancel();
        let c = normalize_connection(
            &json!({ "provider": "custom", "baseUrl": "http://127.0.0.1:1/v1", "model": "m" }),
            None,
            true,
        )
        .unwrap();
        let err = generate(
            &client,
            &c,
            "sys",
            &[ChatMessage {
                role: "user".into(),
                content: "hi".into(),
                attachments: Vec::new(),
            }],
            false,
            None,
            &cancel,
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, 499);
    }
}
