import type { Settings } from '@orion/core'

/**
 * A saved LLM connection profile. Any OpenAI-compatible endpoint: OpenRouter,
 * OpenAI, a local server (Ollama / LM Studio), etc. `apiKey` may be empty — local
 * servers often need no auth, in which case the adapter sends no auth header.
 */
export type Connection = {
  id: string
  label: string
  baseUrl: string
  apiKey: string
  modelId: string
}

// localStorage keys. Profiles and keys live on-device only — never sent to any
// server, so stored keys can't leak.
const CONNECTIONS_KEY = 'orion.llm.connections'
const ACTIVE_KEY = 'orion.llm.activeConnectionId'

/** A connection resolved into the adapter's Settings shape. */
export function connectionToSettings(conn: Connection): Settings {
  return { apiKey: conn.apiKey, baseUrl: conn.baseUrl, model: conn.modelId }
}

/**
 * A short provider hint derived from the base URL host — e.g. "openrouter.ai",
 * "api.openai.com", "localhost". Falls back to the raw string if it won't parse.
 */
export function providerHint(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl
  } catch {
    return baseUrl.trim() || 'unknown'
  }
}

/** Generate a unique id for a new connection. */
export function newConnectionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Load saved connections from localStorage; returns [] on any failure. */
export function loadConnections(): Connection[] {
  try {
    const raw = localStorage.getItem(CONNECTIONS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isConnection)
  } catch {
    return []
  }
}

/** Load the active connection id from localStorage; null if none/invalid. */
export function loadActiveId(): string | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY)
    return raw && raw.length > 0 ? raw : null
  } catch {
    return null
  }
}

/** Persist the connection list. */
export function saveConnections(connections: Connection[]): void {
  try {
    localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(connections))
  } catch {
    // Storage unavailable (private mode / quota) — fail silently; in-memory
    // state still works for the session.
  }
}

/** Persist the active connection id (or clear it when null). */
export function saveActiveId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id)
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // See saveConnections.
  }
}

function isConnection(value: unknown): value is Connection {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.label === 'string' &&
    typeof v.baseUrl === 'string' &&
    typeof v.apiKey === 'string' &&
    typeof v.modelId === 'string'
  )
}
