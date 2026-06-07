//! Dumb transport for outbound LLM HTTP calls.
//!
//! The browser webview cannot POST directly to an LLM endpoint (CORS), so these
//! commands forward the request from Rust instead. They are TRANSPORT ONLY:
//!
//! - no API key is embedded, stored, or hardcoded — it arrives per-call from the
//!   frontend (where it lives on-device) and is only ever placed in an auth header,
//! - no provider-specific logic, model defaults, or response parsing/validation —
//!   the OpenAI-compatible body is forwarded untouched and the response body is
//!   returned untouched for the frontend to parse,
//! - nothing is cached, and request bodies and API keys are never logged.

use serde::Serialize;

/// What the frontend gets back. The body is the raw response text, passed through
/// verbatim so the frontend keeps its own tolerant JSON parsing. `ok`/`status`/
/// `status_text` let the frontend reproduce its existing error handling.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyResponse {
    ok: bool,
    status: u16,
    status_text: String,
    body: String,
}

/// Trim a single trailing slash so a path can be appended cleanly.
fn trim_base(base_url: &str) -> &str {
    base_url.trim_end_matches('/')
}

/// Attach `Authorization: Bearer <key>` ONLY when a non-empty key is present.
/// Local servers (Ollama, LM Studio) accept no key, and an empty `Bearer` can be
/// rejected, so an empty/whitespace key sends no auth header at all.
fn apply_auth(req: reqwest::RequestBuilder, api_key: Option<String>) -> reqwest::RequestBuilder {
    match api_key {
        Some(key) if !key.trim().is_empty() => req.bearer_auth(key.trim()),
        _ => req,
    }
}

/// Send the prepared request and pass the response (status + raw body) through.
/// A transport failure (DNS, refused connection, TLS) becomes an `Err` so the
/// frontend's `catch` runs and its change-nothing-on-error behavior triggers.
async fn send(req: reqwest::RequestBuilder) -> Result<ProxyResponse, String> {
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let ok = status.is_success();
    // Read the body regardless of status — error responses carry useful detail
    // the frontend already surfaces.
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(ProxyResponse {
        ok,
        status: status.as_u16(),
        status_text,
        body,
    })
}

/// POST `${base_url}/chat/completions` with the OpenAI-compatible JSON `body`
/// exactly as the frontend built it. Non-streaming, like the rest of the app.
#[tauri::command]
pub async fn llm_chat_completion(
    base_url: String,
    api_key: Option<String>,
    body: serde_json::Value,
) -> Result<ProxyResponse, String> {
    let url = format!("{}/chat/completions", trim_base(&base_url));
    let req = reqwest::Client::new().post(url).json(&body);
    send(apply_auth(req, api_key)).await
}

/// Append a STYLE REFERENCE block to the first system message of an OpenAI body
/// (or prepend a new system message if none exists). Used only by the authoring
/// command so retrieved samples stay in Rust and never reach the frontend.
fn inject_into_system(body: &mut serde_json::Value, reference: &str) {
    let Some(messages) = body.get_mut("messages").and_then(|m| m.as_array_mut()) else {
        return;
    };
    for msg in messages.iter_mut() {
        if msg.get("role").and_then(|r| r.as_str()) == Some("system") {
            let existing = msg.get("content").and_then(|c| c.as_str()).unwrap_or("");
            msg["content"] = serde_json::Value::String(format!("{existing}\n\n{reference}"));
            return;
        }
    }
    messages.insert(0, serde_json::json!({ "role": "system", "content": reference }));
}

/// Like `llm_chat_completion`, but FIRST does invisible style retrieval: it
/// resolves the parsed `tags` against the local sample store, selects weighted
/// section-aware samples, and splices them into the system message as a STYLE
/// REFERENCE before POSTing. Retrieval is best-effort — any failure or a miss
/// posts the body unchanged (silent no-reference call). The response is handled
/// by the frontend exactly as for the dumb proxy.
#[tauri::command]
pub async fn llm_authoring_completion(
    app: tauri::AppHandle,
    base_url: String,
    api_key: Option<String>,
    mut body: serde_json::Value,
    tags: Vec<crate::storage::WeightedTag>,
    active_section: String,
) -> Result<ProxyResponse, String> {
    if !tags.is_empty() {
        if let Some(reference) =
            crate::storage::build_style_reference_for(&app, &tags, &active_section)
        {
            inject_into_system(&mut body, &reference);
        }
    }
    let url = format!("{}/chat/completions", trim_base(&base_url));
    let req = reqwest::Client::new().post(url).json(&body);
    send(apply_auth(req, api_key)).await
}

/// GET `${base_url}/models` — backs the Connections manager's optional
/// "Fetch models" button, which would otherwise hit CORS inside the webview.
#[tauri::command]
pub async fn llm_list_models(
    base_url: String,
    api_key: Option<String>,
) -> Result<ProxyResponse, String> {
    let url = format!("{}/models", trim_base(&base_url));
    let req = reqwest::Client::new().get(url);
    send(apply_auth(req, api_key)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    /// What the mock server saw on the wire.
    struct Captured {
        request_line: String,
        /// All request headers, lowercased, for case-insensitive assertions.
        headers_lower: String,
        body: String,
    }

    fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack.windows(needle.len()).position(|w| w == needle)
    }

    /// Start a one-shot server on an ephemeral port: it accepts a single request,
    /// replies 200 with `response_body`, and reports what it received. Returns the
    /// base URL to point a command at and a handle yielding the captured request.
    fn mock_once(response_body: &'static str) -> (String, thread::JoinHandle<Captured>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf: Vec<u8> = Vec::new();
            let mut tmp = [0u8; 4096];
            loop {
                if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&buf[..pos]).to_ascii_lowercase();
                    let content_length = head
                        .lines()
                        .find_map(|l| {
                            l.strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                        })
                        .unwrap_or(0);
                    if buf.len() >= pos + 4 + content_length {
                        break;
                    }
                }
                let n = stream.read(&mut tmp).unwrap();
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&tmp[..n]);
            }
            let text = String::from_utf8_lossy(&buf).to_string();
            let split = text.find("\r\n\r\n").map(|p| p + 4).unwrap_or(text.len());
            let head = &text[..split];
            let captured = Captured {
                request_line: head.lines().next().unwrap_or("").to_string(),
                headers_lower: head.to_ascii_lowercase(),
                body: text[split..].to_string(),
            };
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream.write_all(resp.as_bytes()).unwrap();
            stream.flush().unwrap();
            captured
        });
        (base_url, handle)
    }

    #[tokio::test]
    async fn sends_bearer_only_when_key_present() {
        let (base, handle) = mock_once("{\"choices\":[{\"message\":{\"content\":\"hi\"}}]}");
        let res = llm_chat_completion(
            base,
            Some("secret-key".into()),
            serde_json::json!({ "model": "m", "messages": [], "stream": false }),
        )
        .await
        .unwrap();
        let cap = handle.join().unwrap();

        assert!(cap.request_line.starts_with("POST /chat/completions "), "{}", cap.request_line);
        assert!(cap.headers_lower.contains("authorization: bearer secret-key"), "{}", cap.headers_lower);
        // Body forwarded untouched.
        assert!(cap.body.contains("\"model\":\"m\""), "{}", cap.body);
        // Response passed through untouched.
        assert!(res.ok);
        assert_eq!(res.status, 200);
        assert!(res.body.contains("\"content\":\"hi\""), "{}", res.body);
    }

    #[tokio::test]
    async fn omits_auth_when_key_whitespace() {
        let (base, handle) = mock_once("{}");
        llm_chat_completion(base, Some("   ".into()), serde_json::json!({})).await.unwrap();
        let cap = handle.join().unwrap();
        assert!(!cap.headers_lower.contains("authorization:"), "{}", cap.headers_lower);
    }

    #[tokio::test]
    async fn omits_auth_when_key_none() {
        let (base, handle) = mock_once("{}");
        llm_chat_completion(base, None, serde_json::json!({})).await.unwrap();
        let cap = handle.join().unwrap();
        assert!(!cap.headers_lower.contains("authorization:"), "{}", cap.headers_lower);
    }

    #[tokio::test]
    async fn trims_trailing_slash() {
        let (base, handle) = mock_once("{}");
        llm_chat_completion(format!("{base}/"), None, serde_json::json!({})).await.unwrap();
        let cap = handle.join().unwrap();
        assert!(cap.request_line.starts_with("POST /chat/completions "), "{}", cap.request_line);
    }

    #[tokio::test]
    async fn list_models_uses_models_path() {
        let (base, handle) = mock_once("{\"data\":[]}");
        let res = llm_list_models(base, None).await.unwrap();
        let cap = handle.join().unwrap();
        assert!(cap.request_line.starts_with("GET /models "), "{}", cap.request_line);
        assert!(res.ok);
    }

    #[tokio::test]
    async fn transport_error_is_surfaced() {
        // Nothing listening here → reqwest errs → the command returns Err, which
        // rejects the invoke so the frontend's change-nothing-on-error path runs.
        let res = llm_chat_completion("http://127.0.0.1:1".into(), None, serde_json::json!({})).await;
        assert!(res.is_err());
    }

    #[test]
    fn inject_appends_to_existing_system_message() {
        let mut body = serde_json::json!({
            "model": "m",
            "messages": [
                { "role": "system", "content": "base prompt" },
                { "role": "user", "content": "hi" }
            ]
        });
        inject_into_system(&mut body, "REFERENCE");
        let sys = body["messages"][0]["content"].as_str().unwrap();
        assert!(sys.starts_with("base prompt"));
        assert!(sys.contains("REFERENCE"));
        // User message untouched; no extra messages added.
        assert_eq!(body["messages"].as_array().unwrap().len(), 2);
        assert_eq!(body["messages"][1]["content"], "hi");
    }

    #[test]
    fn inject_prepends_system_when_none_present() {
        let mut body = serde_json::json!({
            "model": "m",
            "messages": [ { "role": "user", "content": "hi" } ]
        });
        inject_into_system(&mut body, "REFERENCE");
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][0]["content"], "REFERENCE");
        assert_eq!(body["messages"][1]["role"], "user");
    }
}
