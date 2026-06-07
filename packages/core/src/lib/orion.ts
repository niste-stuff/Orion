import type { Card, CardUpdates, RequestMessage } from '../types'
import { MAX_OPENING_MESSAGES } from '../types'

/** The parsed shape of an Orion turn: a chat reply plus any section rewrites. */
export type OrionResponse = {
  reply: string
  updates: CardUpdates
}

const SCALAR_KEYS = ['personality', 'scenario', 'dialogue_examples', 'storefront'] as const

/** Render the ordered opener list for the prompt (or a placeholder if empty). */
function renderOpeners(openers: string[]): string {
  if (openers.length === 0) return '(none yet)'
  return openers.map((o, i) => `  ${i + 1}. ${o}`).join('\n')
}

/**
 * Build the Orion system prompt, embedding the current content of every
 * model-facing section so the model can decide which (if any) to rewrite.
 *
 * Two sections are special:
 *  - STOREFRONT is shown under a header that marks it as public marketing copy,
 *    NOT characterization — the model may read/edit it but must never roleplay
 *    from it, and when it writes it, it writes in a marketing voice.
 *  - LOREBOOK is included ONLY when enabled; otherwise it's omitted entirely.
 */
export function buildSystemPrompt(card: Card): string {
  const lorebookBlock = card.lorebook.enabled
    ? `\n[LOREBOOK] (model-facing world facts; injected every turn — keep it lean):\n${card.lorebook.text}`
    : '\n[LOREBOOK]: (disabled — not part of the card right now; only touch it if the user asks to enable or write a lorebook)'

  return `You are Orion, an assistant that builds character cards through conversation.

The card has these sections:
- personality — model-facing characterization.
- scenario — model-facing setup/situation.
- dialogue_examples — model-facing example lines that demonstrate the character's voice.
- opening_messages — an ORDERED LIST of up to ${MAX_OPENING_MESSAGES} alternative opening messages. They are ALL CANONICAL: each is an equally-valid opener for the SAME character; none is privileged.
- storefront — PUBLIC MARKETING COPY a human reads on a listing to decide whether to click. This is NOT characterization. NEVER roleplay from it. When you write it, write in a marketing voice: a hook, intrigue, what makes someone want to start the chat — not a description of traits.
- lorebook — OPTIONAL, model-facing world facts. Off by default.

Based on the user's message, decide which section(s) to create or update and write their COMPLETE new content. Only include a section in "updates" if the user's message actually calls for changing it. Preserve everything a section already contains that the instruction does not target — when editing, return the full updated section, never a fragment. If the user is just chatting or asking a question, make "updates" empty and answer in "reply".

When editing opening_messages, return the FULL list as an array of strings, preserving every opener you are not changing (do not return a diff or a single string). Keep at most ${MAX_OPENING_MESSAGES}.

To enable or disable the lorebook, set "lorebook_enabled" (boolean). Set "lorebook" to its text.

Current card:
[PERSONALITY]: ${card.personality}
[SCENARIO]: ${card.scenario}
[DIALOGUE_EXAMPLES]: ${card.dialogue_examples}
[OPENING_MESSAGES] (${card.opening_messages.length}/${MAX_OPENING_MESSAGES}, all canonical):
${renderOpeners(card.opening_messages)}

[STOREFRONT] (public marketing copy — NOT characterization; do not roleplay from this):
${card.storefront}
${lorebookBlock}

Respond with ONLY a JSON object — no markdown fences, no other text:
{
  "reply": "a short, friendly message saying what you did or answering the user",
  "updates": {
    "personality"?: string,
    "scenario"?: string,
    "dialogue_examples"?: string,
    "storefront"?: string,
    "opening_messages"?: string[],
    "lorebook"?: string,
    "lorebook_enabled"?: boolean
  }
}
Include in "updates" ONLY the sections you changed.`
}

/** Assemble the request: system prompt, recent history, then the new message. */
export function buildRequest(
  card: Card,
  history: RequestMessage[],
  userMessage: string,
): RequestMessage[] {
  return [
    { role: 'system', content: buildSystemPrompt(card) },
    ...history,
    { role: 'user', content: userMessage },
  ]
}

/**
 * Tolerantly parse the model's reply into an OrionResponse. Strips any ```json
 * fences, then extracts the first {...} object (first '{' through last '}').
 * Returns null on any failure so callers can fall back to showing the raw text
 * WITHOUT touching any section.
 *
 * Array safety guard: opening_messages is applied only when it is a non-empty
 * array of strings (capped at MAX_OPENING_MESSAGES). A missing, malformed, or
 * empty value is omitted from the updates, leaving existing openers untouched.
 */
export function parseOrionResponse(raw: string): OrionResponse | null {
  let text = raw.trim()

  // Strip a fenced code block if the model wrapped its JSON in one.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null

  let obj: unknown
  try {
    obj = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }

  if (typeof obj !== 'object' || obj === null) return null
  const record = obj as Record<string, unknown>

  if (typeof record.reply !== 'string') return null

  const updates: CardUpdates = {}
  const rawUpdates = record.updates
  if (typeof rawUpdates === 'object' && rawUpdates !== null) {
    const u = rawUpdates as Record<string, unknown>

    for (const key of SCALAR_KEYS) {
      if (typeof u[key] === 'string') updates[key] = u[key] as string
    }

    // Opening messages: only apply a non-empty array of strings, capped. A
    // malformed or empty value is dropped so existing openers are preserved.
    const oms = u.opening_messages
    if (Array.isArray(oms)) {
      const cleaned = oms
        .filter((x): x is string => typeof x === 'string')
        .slice(0, MAX_OPENING_MESSAGES)
      if (cleaned.length > 0) updates.opening_messages = cleaned
    }

    if (typeof u.lorebook === 'string') updates.lorebook = u.lorebook
    if (typeof u.lorebook_enabled === 'boolean') updates.lorebook_enabled = u.lorebook_enabled
  }

  return { reply: record.reply, updates }
}
