use std::collections::HashSet;
use std::sync::OnceLock;
use std::time::Duration;

use futures_util::future::join_all;
use futures_util::StreamExt;
use regex::Regex;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, CONTENT_TYPE, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::error::{AppError, AppResult};

const EXA_URL: &str = "https://mcp.exa.ai/mcp";
const PURILI_URL: &str = "https://puri.li/api/";
const MAX_RESPONSE: usize = 512 * 1024;
const MAX_SOURCES: usize = 5;
const EXA_TIMEOUT_MS: u64 = 18_000;
const PURILI_TIMEOUT_MS: u64 = 12_000;
const USER_AGENT_VALUE: &str = "minilearn/0.1.0";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchSourceDetail {
    pub url: String,
    pub title: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchOutcome {
    pub query: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    pub status: String,
    pub sources: Vec<SearchSourceDetail>,
}

enum SearchFailure {
    Cancelled,
    Other,
}

fn clean(value: Option<&str>, limit: usize) -> String {
    match value {
        Some(v) => v.trim().chars().take(limit).collect(),
        None => String::new(),
    }
}

fn check_cancelled(cancel: &CancellationToken) -> AppResult<()> {
    if cancel.is_cancelled() {
        Err(AppError::cancelled())
    } else {
        Ok(())
    }
}

/// Keep result URLs as data; minilearn never fetches arbitrary URLs supplied by
/// the model or a page. Links must be ordinary HTTP(S) URLs without credentials.
pub(crate) fn safe_url(value: Option<&str>) -> Option<String> {
    let raw = value?;
    if raw.chars().count() > 2000 {
        return None;
    }
    let parsed = Url::parse(raw).ok()?;
    if !matches!(parsed.scheme(), "https" | "http")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.host_str().is_none()
    {
        return None;
    }
    let href = parsed.as_str();
    if href.chars().count() <= 2000 {
        Some(href.to_string())
    } else {
        None
    }
}

fn sources_from(results: &[Value]) -> Vec<SearchSourceDetail> {
    let mut seen = HashSet::new();
    let mut sources = Vec::new();
    for item in results {
        let Some(obj) = item.as_object() else {
            continue;
        };
        let Some(url) = safe_url(obj.get("url").and_then(|v| v.as_str())) else {
            continue;
        };
        if !seen.insert(url.clone()) {
            continue;
        }
        let highlights = obj
            .get("highlights")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|h| h.as_str())
                    .take(5)
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();
        let fallback_host = Url::parse(&url)
            .ok()
            .and_then(|u| u.host_str().map(str::to_string))
            .unwrap_or_default();
        let title_clean = clean(obj.get("title").and_then(|v| v.as_str()), 300);
        let title = if title_clean.is_empty() {
            fallback_host
        } else {
            title_clean
        };
        let raw_text = if !highlights.is_empty() {
            highlights
        } else if let Some(t) = obj
            .get("text")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            t.to_string()
        } else {
            obj.get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };
        sources.push(SearchSourceDetail {
            url,
            title,
            text: clean(Some(&raw_text), 2200),
        });
        if sources.len() == MAX_SOURCES {
            break;
        }
    }
    sources
}

fn find_sse_boundary(buf: &[u8]) -> Option<(usize, usize)> {
    for i in 0..buf.len() {
        let tail = &buf[i..];
        if tail.starts_with(b"\r\n\r\n") {
            return Some((i, 4));
        }
        if tail.starts_with(b"\r\n\n") || tail.starts_with(b"\n\r\n") {
            return Some((i, 3));
        }
        if tail.starts_with(b"\n\n") {
            return Some((i, 2));
        }
    }
    None
}

/// MCP may respond with either JSON or a stream of server-sent events. Stop
/// reading once the requested reply arrives, even if the stream stays open.
async fn read_json(
    response: reqwest::Response,
    expected_id: Option<u64>,
    cancel: &CancellationToken,
) -> Result<Value, SearchFailure> {
    let is_sse = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_ascii_lowercase().contains("text/event-stream"))
        .unwrap_or(false);

    let mut stream = response.bytes_stream();
    let mut raw_buf: Vec<u8> = Vec::new();
    let mut size: usize = 0;

    loop {
        let next_chunk = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(SearchFailure::Cancelled),
            item = stream.next() => item,
        };
        let Some(chunk_res) = next_chunk else {
            break;
        };
        let chunk = chunk_res.map_err(|_| SearchFailure::Other)?;
        size += chunk.len();
        if size > MAX_RESPONSE {
            return Err(SearchFailure::Other);
        }
        raw_buf.extend_from_slice(&chunk);

        if is_sse {
            while let Some((idx, sep_len)) = find_sse_boundary(&raw_buf) {
                let event = String::from_utf8_lossy(&raw_buf[..idx]).into_owned();
                raw_buf.drain(..idx + sep_len);
                let data = event
                    .split('\n')
                    .map(|line| line.strip_suffix('\r').unwrap_or(line))
                    .filter_map(|line| line.strip_prefix("data:"))
                    .map(str::trim_start)
                    .collect::<Vec<_>>()
                    .join("\n");
                if data.is_empty() {
                    continue;
                }
                let message: Value = serde_json::from_str(&data)
                    .map_err(|_| SearchFailure::Other)?;
                if let Some(id) = expected_id {
                    if message.get("id").and_then(|v| v.as_u64()) == Some(id) {
                        return Ok(message);
                    }
                }
            }
        }
    }

    if is_sse {
        return Err(SearchFailure::Other);
    }
    serde_json::from_slice(&raw_buf).map_err(|_| SearchFailure::Other)
}

fn block_split_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\n\s*---\s*\n").unwrap())
}

fn title_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?m)^Title:\s*([^\r\n]+)$").unwrap())
}

fn url_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?m)^URL:\s*(\S+)$").unwrap())
}

fn text_split_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\n(?:Highlights|Text):\s*").unwrap())
}

fn ws_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\s+").unwrap())
}

async fn exa_rpc(
    client: &reqwest::Client,
    exa_url: &str,
    headers: &mut HeaderMap,
    method: &str,
    params: Value,
    id: Option<u64>,
    cancel: &CancellationToken,
) -> Result<Value, SearchFailure> {
    let mut body = json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    });
    if let Some(id_val) = id {
        body.as_object_mut()
            .unwrap()
            .insert("id".to_string(), json!(id_val));
    }

    let req = client
        .post(exa_url)
        .headers(headers.clone())
        .json(&body);

    let res = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(SearchFailure::Cancelled),
        r = req.send() => r.map_err(|_| SearchFailure::Other)?,
    };

    if !res.status().is_success() {
        drop(res);
        return Err(SearchFailure::Other);
    }
    let Some(expected_id) = id else {
        drop(res);
        return Ok(Value::Null);
    };

    if method == "initialize" {
        if let Some(session) = res.headers().get("mcp-session-id") {
            headers.insert("mcp-session-id", session.clone());
        }
    }

    let reply = read_json(res, Some(expected_id), cancel).await?;
    let reply_id = reply.get("id").and_then(|v| v.as_u64());
    let has_error = reply.get("error").is_some_and(|e| !e.is_null());
    let result = reply.get("result").filter(|r| !r.is_null()).cloned();
    if reply_id != Some(expected_id) || has_error || result.is_none() {
        return Err(SearchFailure::Other);
    }
    Ok(result.unwrap())
}

async fn exa_search(
    client: &reqwest::Client,
    exa_url: &str,
    query: &str,
    cancel: &CancellationToken,
) -> Result<Vec<SearchSourceDetail>, SearchFailure> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/json, text/event-stream"),
    );
    headers.insert(USER_AGENT, HeaderValue::from_static(USER_AGENT_VALUE));

    let init = exa_rpc(
        client,
        exa_url,
        &mut headers,
        "initialize",
        json!({
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": { "name": "minilearn", "version": "0.1.0" },
        }),
        Some(1),
        cancel,
    )
    .await?;

    let protocol_version = init
        .get("protocolVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if !matches!(
        protocol_version,
        "2025-03-26" | "2025-06-18" | "2025-11-25"
    ) {
        return Err(SearchFailure::Other);
    }
    let version_header =
        HeaderValue::from_str(protocol_version).map_err(|_| SearchFailure::Other)?;
    headers.insert("mcp-protocol-version", version_header);

    exa_rpc(
        client,
        exa_url,
        &mut headers,
        "notifications/initialized",
        json!({}),
        None,
        cancel,
    )
    .await?;

    let result = exa_rpc(
        client,
        exa_url,
        &mut headers,
        "tools/call",
        json!({
            "name": "web_search_exa",
            "arguments": { "query": query, "numResults": MAX_SOURCES },
        }),
        Some(2),
        cancel,
    )
    .await?;

    if result.get("isError").and_then(|v| v.as_bool()) == Some(true) {
        return Err(SearchFailure::Other);
    }
    if let Some(arr) = result
        .get("structuredContent")
        .and_then(|sc| sc.get("results"))
        .and_then(|r| r.as_array())
    {
        return Ok(sources_from(arr));
    }

    // Earlier MCP deployments expose the same results as plain text blocks.
    let blocks: Vec<Value> = result
        .get("content")
        .and_then(|c| c.as_array())
        .into_iter()
        .flatten()
        .filter(|part| part.get("type").and_then(|v| v.as_str()) == Some("text"))
        .filter_map(|part| part.get("text").and_then(|v| v.as_str()))
        .flat_map(|text| block_split_re().split(text))
        .map(|block| {
            let title = title_re()
                .captures(block)
                .and_then(|c| c.get(1))
                .map(|m| Value::String(m.as_str().to_string()))
                .unwrap_or(Value::Null);
            let url = url_re()
                .captures(block)
                .and_then(|c| c.get(1))
                .map(|m| Value::String(m.as_str().to_string()))
                .unwrap_or(Value::Null);
            let mut split_iter = text_split_re().splitn(block, 2);
            let _head = split_iter.next();
            let text = split_iter
                .next()
                .map(|s| Value::String(s.to_string()))
                .unwrap_or(Value::Null);
            json!({
                "title": title,
                "url": url,
                "text": text,
            })
        })
        .collect();
    Ok(sources_from(&blocks))
}

async fn purili_get(
    client: &reqwest::Client,
    purili_url: &str,
    endpoint: &str,
    params: &[(&str, &str)],
    cancel: &CancellationToken,
) -> Result<Value, SearchFailure> {
    let base = if purili_url.ends_with('/') {
        purili_url.to_string()
    } else {
        format!("{purili_url}/")
    };
    let mut url = Url::parse(&format!("{base}{endpoint}"))
        .map_err(|_| SearchFailure::Other)?;
    {
        let mut qp = url.query_pairs_mut();
        for (k, v) in params {
            qp.append_pair(k, v);
        }
    }

    let req = client
        .get(url)
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, USER_AGENT_VALUE);

    let res = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(SearchFailure::Cancelled),
        r = req.send() => r.map_err(|_| SearchFailure::Other)?,
    };
    if !res.status().is_success() {
        drop(res);
        return Err(SearchFailure::Other);
    }
    read_json(res, None, cancel).await
}

async fn purili_search(
    client: &reqwest::Client,
    purili_url: &str,
    query: &str,
    cancel: &CancellationToken,
) -> Result<Vec<SearchSourceDetail>, SearchFailure> {
    let result = purili_get(
        client,
        purili_url,
        "search",
        &[("q", query), ("page", "1")],
        cancel,
    )
    .await?;
    let Some(arr) = result.get("results").and_then(|v| v.as_array()) else {
        return Err(SearchFailure::Other);
    };
    let mut sources = sources_from(arr);

    // Obtain additional indexed text from the top two results when available.
    let context_fetches = sources.iter().take(2).map(|source| {
        let url = source.url.clone();
        async move {
            match purili_get(client, purili_url, "context", &[("url", &url)], cancel).await {
                Ok(data) => {
                    let text = clean(data.get("content").and_then(|v| v.as_str()), 2200);
                    if text.is_empty() {
                        None
                    } else {
                        Some(text)
                    }
                }
                Err(_) => None,
            }
        }
    });
    let contexts = join_all(context_fetches).await;
    for (source, extra) in sources.iter_mut().take(2).zip(contexts) {
        if let Some(text) = extra {
            source.text = text;
        }
    }

    Ok(sources)
}

async fn run_with_deadline<F>(
    cancel: &CancellationToken,
    ms: u64,
    fut: F,
) -> Result<Vec<SearchSourceDetail>, SearchFailure>
where
    F: std::future::Future<Output = Result<Vec<SearchSourceDetail>, SearchFailure>>,
{
    if cancel.is_cancelled() {
        return Err(SearchFailure::Cancelled);
    }
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(SearchFailure::Cancelled),
        _ = tokio::time::sleep(Duration::from_millis(ms)) => Err(SearchFailure::Other),
        res = fut => res,
    }
}

pub async fn search_web(
    client: &reqwest::Client,
    query: &str,
    cancel: &CancellationToken,
) -> AppResult<SearchOutcome> {
    search_web_with_urls(client, query, EXA_URL, PURILI_URL, cancel).await
}

pub(crate) async fn search_web_with_urls(
    client: &reqwest::Client,
    query: &str,
    exa_url: &str,
    purili_url: &str,
    cancel: &CancellationToken,
) -> AppResult<SearchOutcome> {
    check_cancelled(cancel)?;
    let cleaned = clean(Some(query), 500);
    let normalized = ws_re().replace_all(&cleaned, " ").into_owned();
    if normalized.is_empty() {
        return Ok(SearchOutcome {
            query: String::new(),
            provider: None,
            status: "unavailable".to_string(),
            sources: Vec::new(),
        });
    }

    let mut had_response = false;

    for (provider, is_exa, ms) in [
        ("Exa", true, EXA_TIMEOUT_MS),
        ("Purili", false, PURILI_TIMEOUT_MS),
    ] {
        let attempt = if is_exa {
            run_with_deadline(cancel, ms, exa_search(client, exa_url, &normalized, cancel)).await
        } else {
            run_with_deadline(
                cancel,
                ms,
                purili_search(client, purili_url, &normalized, cancel),
            )
            .await
        };

        match attempt {
            Ok(sources) => {
                check_cancelled(cancel)?;
                had_response = true;
                if !sources.is_empty() {
                    return Ok(SearchOutcome {
                        query: normalized,
                        provider: Some(provider.to_string()),
                        status: "ok".to_string(),
                        sources,
                    });
                }
            }
            Err(SearchFailure::Cancelled) => return Err(AppError::cancelled()),
            Err(SearchFailure::Other) => {
                check_cancelled(cancel)?;
            }
        }
    }

    Ok(SearchOutcome {
        query: normalized,
        provider: None,
        status: if had_response {
            "no-results".to_string()
        } else {
            "unavailable".to_string()
        },
        sources: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap()
    }

    #[derive(Clone)]
    struct RecordedRequest {
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

    enum MockReply {
        Json(u16, Vec<(String, String)>, Value),
        Raw(u16, Vec<(String, String)>, Vec<u8>),
        SseOpen(Vec<Vec<u8>>),
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
        let _method = parts.next()?.to_string();
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
            path,
            headers,
            body: String::from_utf8_lossy(body_bytes).into_owned(),
        })
    }

    async fn spawn_mock_server<F>(handler: F) -> String
    where
        F: Fn(RecordedRequest) -> MockReply + Send + Sync + 'static,
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
                        match handler(req) {
                            MockReply::Json(status, extra_headers, val) => {
                                let body = serde_json::to_vec(&val).unwrap();
                                let mut resp = format!(
                                    "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
                                    body.len()
                                );
                                for (k, v) in extra_headers {
                                    resp.push_str(&format!("{k}: {v}\r\n"));
                                }
                                resp.push_str("\r\n");
                                let _ = socket.write_all(resp.as_bytes()).await;
                                let _ = socket.write_all(&body).await;
                                break;
                            }
                            MockReply::Raw(status, extra_headers, body) => {
                                let mut resp = format!(
                                    "HTTP/1.1 {status} Status\r\nContent-Length: {}\r\nConnection: close\r\n",
                                    body.len()
                                );
                                for (k, v) in extra_headers {
                                    resp.push_str(&format!("{k}: {v}\r\n"));
                                }
                                resp.push_str("\r\n");
                                let _ = socket.write_all(resp.as_bytes()).await;
                                let _ = socket.write_all(&body).await;
                                break;
                            }
                            MockReply::SseOpen(chunks) => {
                                let resp = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n";
                                if socket.write_all(resp.as_bytes()).await.is_err() {
                                    break;
                                }
                                for chunk in chunks {
                                    let head = format!("{:X}\r\n", chunk.len());
                                    if socket.write_all(head.as_bytes()).await.is_err() {
                                        break;
                                    }
                                    if socket.write_all(&chunk).await.is_err() {
                                        break;
                                    }
                                    if socket.write_all(b"\r\n").await.is_err() {
                                        break;
                                    }
                                    let _ = socket.flush().await;
                                }
                                // Keep stream open until client drops connection.
                                let mut discard = [0u8; 64];
                                while let Ok(n) = socket.read(&mut discard).await {
                                    if n == 0 {
                                        break;
                                    }
                                }
                                break;
                            }
                        }
                    }
                });
            }
        });
        format!("http://127.0.0.1:{}", addr.port())
    }

    fn exa_reply(req: &RecordedRequest, results: Value, streamed: bool) -> MockReply {
        let payload: Value = serde_json::from_str(&req.body).unwrap();
        let method = payload["method"].as_str().unwrap();
        if method == "initialize" {
            return MockReply::Json(
                200,
                vec![("mcp-session-id".into(), "test-session".into())],
                json!({
                    "jsonrpc": "2.0",
                    "id": payload["id"],
                    "result": { "protocolVersion": "2025-11-25" },
                }),
            );
        }
        assert_eq!(req.header("mcp-session-id"), Some("test-session"));
        assert_eq!(req.header("mcp-protocol-version"), Some("2025-11-25"));
        if method == "notifications/initialized" {
            return MockReply::Raw(202, vec![], vec![]);
        }
        assert_eq!(method, "tools/call");
        assert_eq!(payload["params"]["name"], "web_search_exa");
        assert_eq!(payload["params"]["arguments"]["numResults"], 5);
        let reply = json!({
            "jsonrpc": "2.0",
            "id": payload["id"],
            "result": results,
        });
        if !streamed {
            return MockReply::Json(200, vec![], reply);
        }
        let event = format!("event: message\r\ndata: {}\r\n\r\n", reply);
        let bytes = event.into_bytes();
        let (first, second) = bytes.split_at(24);
        MockReply::SseOpen(vec![
            b": keepalive\r\n\r\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\r\n\r\n".to_vec(),
            first.to_vec(),
            second.to_vec(),
        ])
    }

    #[tokio::test]
    async fn keyless_exa_mcp_supports_streamed_replies_bounded_excerpts_and_safe_links() {
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_ref = calls.clone();
        let exa_base = spawn_mock_server(move |req| {
            assert_eq!(req.path, "/mcp");
            assert!(req.header("authorization").is_none());
            calls_ref.fetch_add(1, Ordering::SeqCst);
            let long_highlight = "x".repeat(5000);
            exa_reply(
                &req,
                json!({
                    "structuredContent": {
                        "results": [
                            {
                                "url": "https://example.org/lecture",
                                "title": "Lecture",
                                "highlights": [long_highlight],
                            },
                            { "url": "https://example.org/lecture", "title": "Duplicate" },
                            { "url": "javascript:alert(1)", "title": "Invalid" },
                            { "url": "https://user:secret@example.org/", "title": "Credentials" },
                        ]
                    }
                }),
                true,
            )
        })
        .await;

        let client = test_client();
        let cancel = CancellationToken::new();
        let result = search_web_with_urls(
            &client,
            " linear   algebra ",
            &format!("{exa_base}/mcp"),
            "http://127.0.0.1:1/api/",
            &cancel,
        )
        .await
        .unwrap();

        assert_eq!(calls.load(Ordering::SeqCst), 3);
        assert_eq!(result.query, "linear algebra");
        assert_eq!(result.provider.as_deref(), Some("Exa"));
        assert_eq!(result.status, "ok");
        assert_eq!(result.sources.len(), 1);
        assert_eq!(result.sources[0].text.len(), 2200);
        assert_eq!(result.sources[0].url, "https://example.org/lecture");
    }

    #[tokio::test]
    async fn exa_text_responses_and_purili_fallback() {
        let mode = Arc::new(Mutex::new("text".to_string()));
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));

        let mode_exa = mode.clone();
        let seen_exa = seen.clone();
        let exa_base = spawn_mock_server(move |req| {
            let m = mode_exa.lock().unwrap().clone();
            seen_exa.lock().unwrap().push(format!("exa:{}", req.path));
            if m == "limited" {
                return MockReply::Raw(429, vec![], vec![]);
            }
            if m == "empty" {
                return exa_reply(&req, json!({ "structuredContent": { "results": [] } }), false);
            }
            exa_reply(
                &req,
                json!({
                    "content": [{
                        "type": "text",
                        "text": "Title: Lecture\nURL: https://example.org/lecture\nText: Some source text.",
                    }]
                }),
                false,
            )
        })
        .await;

        let seen_purili = seen.clone();
        let purili_base = spawn_mock_server(move |req| {
            seen_purili
                .lock()
                .unwrap()
                .push(format!("purili:{}", req.path));
            assert!(req.header("authorization").is_none());
            let parsed = Url::parse(&format!("http://localhost{}", req.path)).unwrap();
            if parsed.path() == "/api/search" {
                let q = parsed
                    .query_pairs()
                    .find(|(k, _)| k == "q")
                    .map(|(_, v)| v.into_owned());
                assert_eq!(q.as_deref(), Some("vector spaces"));
                return MockReply::Json(
                    200,
                    vec![],
                    json!({
                        "results": [{
                            "title": "Textbook",
                            "url": "https://example.edu/book",
                            "description": "Snippet",
                        }]
                    }),
                );
            }
            assert_eq!(parsed.path(), "/api/context");
            let u = parsed
                .query_pairs()
                .find(|(k, _)| k == "url")
                .map(|(_, v)| v.into_owned());
            assert_eq!(u.as_deref(), Some("https://example.edu/book"));
            MockReply::Json(200, vec![], json!({ "content": "Indexed textbook passage" }))
        })
        .await;

        let client = test_client();
        let cancel = CancellationToken::new();
        let first = search_web_with_urls(
            &client,
            "vector spaces",
            &format!("{exa_base}/mcp"),
            &format!("{purili_base}/api/"),
            &cancel,
        )
        .await
        .unwrap();
        assert_eq!(first.sources[0].text, "Some source text.");
        assert!(!seen
            .lock()
            .unwrap()
            .iter()
            .any(|p| p.starts_with("purili:")));

        for m in ["limited", "empty"] {
            *mode.lock().unwrap() = m.to_string();
            let result = search_web_with_urls(
                &client,
                "vector spaces",
                &format!("{exa_base}/mcp"),
                &format!("{purili_base}/api/"),
                &cancel,
            )
            .await
            .unwrap();
            assert_eq!(result.provider.as_deref(), Some("Purili"));
            assert_eq!(result.sources[0].text, "Indexed textbook passage");
        }
    }

    #[tokio::test]
    async fn search_failure_empty_results_and_cancellation_are_distinct() {
        let mode = Arc::new(Mutex::new("failure".to_string()));
        let calls = Arc::new(AtomicUsize::new(0));
        let cancel = CancellationToken::new();

        let mode_exa = mode.clone();
        let calls_exa = calls.clone();
        let cancel_exa = cancel.clone();
        let exa_base = spawn_mock_server(move |_req| {
            calls_exa.fetch_add(1, Ordering::SeqCst);
            let m = mode_exa.lock().unwrap().clone();
            if m == "cancel" {
                cancel_exa.cancel();
            }
            MockReply::Raw(503, vec![], vec![])
        })
        .await;

        let mode_purili = mode.clone();
        let calls_purili = calls.clone();
        let purili_base = spawn_mock_server(move |_req| {
            calls_purili.fetch_add(1, Ordering::SeqCst);
            let m = mode_purili.lock().unwrap().clone();
            if m == "empty" {
                return MockReply::Json(200, vec![], json!({ "results": [] }));
            }
            MockReply::Raw(503, vec![], vec![])
        })
        .await;

        let client = test_client();
        let unavailable = search_web_with_urls(
            &client,
            "test",
            &format!("{exa_base}/mcp"),
            &format!("{purili_base}/api/"),
            &cancel,
        )
        .await
        .unwrap();
        assert_eq!(unavailable.status, "unavailable");
        assert!(unavailable.provider.is_none());

        *mode.lock().unwrap() = "empty".to_string();
        let empty = search_web_with_urls(
            &client,
            "test",
            &format!("{exa_base}/mcp"),
            &format!("{purili_base}/api/"),
            &cancel,
        )
        .await
        .unwrap();
        assert_eq!(empty.status, "no-results");
        assert!(empty.provider.is_none());

        calls.store(0, Ordering::SeqCst);
        *mode.lock().unwrap() = "cancel".to_string();
        let err = search_web_with_urls(
            &client,
            "test",
            &format!("{exa_base}/mcp"),
            &format!("{purili_base}/api/"),
            &cancel,
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, 499);
        assert_eq!(calls.load(Ordering::SeqCst), 1, "no fallback after cancellation");
    }

    #[tokio::test]
    async fn blank_query_returns_unavailable() {
        let client = test_client();
        let cancel = CancellationToken::new();
        let res = search_web_with_urls(
            &client,
            "   \n\t ",
            "http://127.0.0.1:1/mcp",
            "http://127.0.0.1:1/api/",
            &cancel,
        )
        .await
        .unwrap();
        assert_eq!(res.query, "");
        assert_eq!(res.status, "unavailable");
        assert!(res.provider.is_none());
        assert!(res.sources.is_empty());
    }
}
