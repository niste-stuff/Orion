import { invoke } from '@tauri-apps/api/core'
import type { RequestMessage, Settings } from './types'
import type { ParsedTag } from './lib/tags'

type CompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>
}

export type ModelsResponse = {
  data?: Array<{ id?: unknown }>
}

/**
 * The response shape returned by the Rust LLM proxy commands. The `body` is the
 * raw response text, passed through untouched so the tolerant JSON parsing stays
 * here on the frontend exactly as before.
 */
type ProxyResponse = {
  ok: boolean
  status: number
  statusText: string
  body: string
}

/**
 * Normalise an empty/whitespace key to null. The Rust side sends an auth header
 * ONLY when a non-empty key is present — local servers (Ollama, LM Studio) need
 * none, and an empty `Bearer` can be rejected.
 */
function normalizeKey(apiKey: string): string | null {
  const key = apiKey.trim()
  return key ? key : null
}

/** Build the OpenAI-compatible request body Orion sends (non-streaming). */
function buildBody(model: string, messages: RequestMessage[]) {
  return {
    model,
    messages: messages.map(({ role, content }) => ({ role, content })),
    stream: false,
  }
}

/** Parse a proxy response into the assistant's message text (tolerant parsing
 * of the LLM's own JSON stays with the caller). Throws on transport / malformed. */
function contentFromProxy(res: ProxyResponse): string {
  if (!res.ok) {
    throw new Error(
      `Request failed (${res.status} ${res.statusText})${res.body ? `: ${res.body}` : ''}`,
    )
  }
  let data: CompletionResponse
  try {
    data = JSON.parse(res.body) as CompletionResponse
  } catch (err) {
    const bodySnippet = res.body ? (res.body.length > 300 ? res.body.slice(0, 300) + '...' : res.body) : '(empty body)'
    throw new Error(`Failed to parse API response as JSON: ${bodySnippet}`)
  }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('Malformed response: missing message content')
  }
  return content
}

/**
 * Make a single non-streaming chat completion against an OpenAI-compatible
 * /chat/completions endpoint and return the assistant's message text.
 *
 * The HTTP request is performed by the Rust `llm_chat_completion` command (the
 * browser webview cannot reach LLM endpoints directly because of CORS). Rust is a
 * dumb pass-through: it forwards the OpenAI-format body untouched and returns the
 * raw response, which we parse here. A transport failure rejects, so the caller's
 * change-nothing-on-error behavior still triggers.
 */
export async function chatCompletion(
  { apiKey, baseUrl, model }: Settings,
  messages: RequestMessage[],
): Promise<string> {
  const res = await invoke<ProxyResponse>('llm_chat_completion', {
    baseUrl,
    apiKey: normalizeKey(apiKey),
    body: buildBody(model, messages),
  })
  return contentFromProxy(res)
}

/**
 * Like {@link chatCompletion}, but routes through the Rust `llm_authoring_completion`
 * command, which performs INVISIBLE style retrieval: it resolves `tags` against the
 * local sample store, selects weighted section-aware samples for `activeSection`,
 * and splices them into the system prompt before POSTing. Retrieved samples never
 * return to the frontend. A retrieval miss/error simply posts without a reference —
 * identical to {@link chatCompletion}. Response handling is the same.
 */
export async function chatCompletionWithStyle(
  { apiKey, baseUrl, model }: Settings,
  messages: RequestMessage[],
  tags: ParsedTag[],
  activeSection: string,
): Promise<string> {
  const res = await invoke<ProxyResponse>('llm_authoring_completion', {
    baseUrl,
    apiKey: normalizeKey(apiKey),
    body: buildBody(model, messages),
    tags,
    activeSection,
  })
  return contentFromProxy(res)
}

function extractModelIds(json: unknown): string[] {
  const ids: string[] = []

  const processValue = (val: unknown) => {
    if (typeof val === 'string' && val.trim()) {
      ids.push(val.trim())
    } else if (typeof val === 'object' && val !== null) {
      const obj = val as Record<string, unknown>
      for (const key of ['id', 'name', 'model']) {
        if (typeof obj[key] === 'string' && (obj[key] as string).trim()) {
          ids.push((obj[key] as string).trim())
          return
        }
      }
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'string' && (obj[key] as string).trim()) {
          ids.push((obj[key] as string).trim())
          return
        }
      }
    }
  }

  if (Array.isArray(json)) {
    json.forEach(processValue)
  } else if (typeof json === 'object' && json !== null) {
    const obj = json as Record<string, unknown>
    const arrays: unknown[][] = []
    if (Array.isArray(obj.data)) {
      arrays.push(obj.data)
    }
    if (Array.isArray(obj.models)) {
      arrays.push(obj.models)
    }
    for (const key of Object.keys(obj)) {
      if (key !== 'data' && key !== 'models' && Array.isArray(obj[key])) {
        arrays.push(obj[key] as unknown[])
      }
    }
    for (const arr of arrays) {
      arr.forEach(processValue)
    }
  }

  return Array.from(new Set(ids)).sort()
}

/**
 * GET `${baseUrl}/models` (via the Rust `llm_list_models` command) and return the
 * list of model ids. Used by the Connections manager's optional "Fetch models"
 * button. Throws on failure (404, network) so the caller can degrade gracefully.
 */
export async function fetchModels(
  baseUrl: string,
  apiKey: string,
): Promise<string[]> {
  const res = await invoke<ProxyResponse>('llm_list_models', {
    baseUrl,
    apiKey: normalizeKey(apiKey),
  })

  if (!res.ok) {
    throw new Error(`Request failed (${res.status} ${res.statusText})${res.body ? `: ${res.body}` : ''}`)
  }

  let data: unknown
  try {
    data = JSON.parse(res.body)
  } catch (err) {
    const bodySnippet = res.body ? (res.body.length > 300 ? res.body.slice(0, 300) + '...' : res.body) : '(empty body)'
    throw new Error(`Failed to parse models response as JSON: ${bodySnippet}`)
  }

  return extractModelIds(data)
}
