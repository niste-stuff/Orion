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
    ? `\n[LOREBOOK] (model-facing key-triggered world facts):\n${JSON.stringify(card.lorebook.entries, null, 2)}`
    : '\n[LOREBOOK]: (disabled — not part of the card right now; only touch it if the user asks to enable or write a lorebook)'

  return `You are Orion, an advanced prompt architect and context engineer specialized in creating hyper-detailed, industry-standard character cards for Janitor AI.

The target card uses a wide-open context scale. You must generate exhaustive, uncompressed text blocks to maximize structural quality:
- personality: Needs a massive layout (~2000 tokens). Break it down into strict architectural keys: [Mind/Psychology], [Physical Appearance/Outfit/Scars], [Speech Patterns/Verbal Quirks], [Behavioral Systems/Core Drives/Flaws], and [Lore Loops/Historical Bonds].
- scenario: Needs an immersive setting layout (~1000 tokens) with active behavioral limiters, environmental weights, current tension, and baseline operational bounds.
- dialogue_examples: Example dialogue exchanges using exact <START> delimiters to isolate scenes.
- opening_messages: Comprehensive starting scenes (~700-800 tokens each). An ORDERED LIST of up to ${MAX_OPENING_MESSAGES} alternative opening messages. They are ALL CANONICAL: each is an equally-valid opener for the SAME character; none is privileged.
- storefront: PUBLIC MARKETING COPY a human reads on a listing to decide whether to click. This is NOT characterization. NEVER roleplay from it. When you write it, write in a marketing voice: a hook, intrigue, what makes someone want to start the chat — not a description of traits.
- lorebook: OPTIONAL, model-facing key-triggered world facts. Off by default.

When updating a section, write its COMPLETE new content. Never return fragments, shorthand summaries, or descriptive placeholders. Keep every underlying asset detailed. Only include a section in "updates" if the user's message actually calls for changing it. If the user is just chatting or asking a question, make "updates" empty and answer in "reply".

When editing opening_messages, return the FULL list as an array of strings, preserving every opener you are not changing (do not return a diff or a single string). Keep at most ${MAX_OPENING_MESSAGES}.

Strict Orchestration Constraints:
1. Location Headers: Every single entry inside 'opening_messages' MUST start with a bold structural markdown banner defining spatial context on its own line: \`**[Location: ... | Activity: ...]**\`.
2. Visceral Prose: Narrative text must be heavily atmospheric, physical, and immediate. Enclose small, sensory actions and expressions in *asterisks* to anchor the writing.
3. Multi-Character Autonomy: In group dynamics, do not use script labels (\`Satoru:\`). Differentiate character actions, speech patterns, and reactions organically from the context.
4. Introspective Thoughts: Enclose internal reflections strictly within short \`backticks\` (\`like this\`). Limit internal thoughts to exactly 6-8 words, restricted to one active character per turn to prevent stacking.
5. Absolute Safety Guards: Ensure the bot never speaks for, acts for, or makes assumptions on behalf of \`{{user}}\`. Append rigid character limits to block narrative loops.
6. JSON String Safety: When outputting long text values inside JSON properties, you must escape all internal double quotes as \\\\" and treat newlines safely.

Current card:
[PERSONALITY]: ${card.personality}
[SCENARIO]: ${card.scenario}
[DIALOGUE_EXAMPLES]: ${card.dialogue_examples}
[OPENING_MESSAGES] (${card.opening_messages.length}/${MAX_OPENING_MESSAGES}, all canonical):
${renderOpeners(card.opening_messages)}

[STOREFRONT] (public marketing copy — NOT characterization; do not roleplay from this):
${card.storefront}
${lorebookBlock}

Respond with ONLY a JSON object — no markdown fences, no conversational prose outside the JSON:
{
  "reply": "A short, friendly message stating what you engineered or adjusted",
  "updates": {
    "personality": "Exhaustive ~2000 token structural definition block...",
    "scenario": "Detailed ~1000 token operational setting block with limiters...",
    "dialogue_examples": "Complete example scenes separated by <START>...",
    "opening_messages": [
      "**[Location: ... | Activity: ...]**\\\\n\\\\nFirst detailed scene text here...",
      "**[Location: ... | Activity: ...]**\\\\n\\\\nSecond detailed scene text here..."
    ],
    "storefront": "Hook copy optimized for human visibility",
    "lorebook_entries": [
      { "id": "uuid-string", "keys": ["keyword"], "content": "targeted fact details", "enabled": true, "insertionOrder": 50 }
    ],
    "lorebook_enabled": true
  }
}
Include in "updates" ONLY the keys you explicitly modified.`
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
 * fences, then extracts the first {...} object (first '{' through matching '}').
 * Cleans unescaped control characters (like literal newlines) and escapes
 * unescaped quotes inside string values using a state-machine parser to guarantee
 * stable parsing on high-token generations.
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
  if (start === -1) return null

  let result = '{'
  let i = start + 1
  let inString = false
  let escaped = false
  
  const stack: ('object' | 'array')[] = ['object']
  let isKey = true

  function peekNextNonWhitespaceChar(index: number): string {
    let p = index
    while (p < text.length && /\s/.test(text[p])) {
      p++
    }
    return text[p] || ''
  }

  while (i < text.length && stack.length > 0) {
    const char = text[i]

    if (inString) {
      if (escaped) {
        result += char
        escaped = false
        i++
        continue
      }

      if (char === '\\') {
        result += char
        escaped = true
        i++
        continue
      }

      if (char === '"') {
        const nextChar = peekNextNonWhitespaceChar(i + 1)
        const currentContext = stack[stack.length - 1]
        
        let isRealClosing = false
        if (currentContext === 'array') {
          if (nextChar === ',' || nextChar === ']' || nextChar === '') {
            isRealClosing = true
          }
        } else {
          if (isKey) {
            if (nextChar === ':') {
              isRealClosing = true
            }
          } else {
            if (nextChar === ',' || nextChar === '}' || nextChar === '') {
              isRealClosing = true
            }
          }
        }

        if (isRealClosing) {
          result += '"'
          inString = false
        } else {
          result += '\\"'
        }
        i++
        continue
      }

      const code = char.charCodeAt(0)
      if (code < 32) {
        if (char === '\n') result += '\\n'
        else if (char === '\r') result += '\\r'
        else if (char === '\t') result += '\\t'
      } else {
        result += char
      }
      i++
    } else {
      // Outside string
      if (char === '"') {
        inString = true
        escaped = false
        result += '"'
        i++
        continue
      }

      if (char === '{') {
        stack.push('object')
        isKey = true
      } else if (char === '[') {
        stack.push('array')
      } else if (char === '}') {
        stack.pop()
        isKey = true
      } else if (char === ']') {
        stack.pop()
        isKey = true
      } else if (char === ':') {
        isKey = false
      } else if (char === ',') {
        isKey = true
      }

      result += char
      i++
    }
  }

  // Apply trailing comma fix on the sanitized string
  const cleanJson = result.replace(/,\s*([}\]])/g, '$1')

  let obj: unknown
  try {
    obj = JSON.parse(cleanJson)
  } catch (err) {
    console.error('Failed to parse sanitized JSON block from Orion response. Raw text was:', raw, 'Sanitized was:', cleanJson, err)
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

    const oms = u.opening_messages
    if (Array.isArray(oms)) {
      const cleaned = oms
        .filter((x): x is string => typeof x === 'string')
        .slice(0, MAX_OPENING_MESSAGES)
      if (cleaned.length > 0) updates.opening_messages = cleaned
    }

    const entries = u.lorebook_entries
    if (Array.isArray(entries)) {
      const parsedEntries = []
      for (const e of entries) {
        if (typeof e === 'object' && e !== null) {
          const re = e as Record<string, unknown>
          const id = typeof re.id === 'string' ? re.id : (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15))
          const content = typeof re.content === 'string' ? re.content : ''
          const enabled = typeof re.enabled === 'boolean' ? re.enabled : true
          const insertionOrder = typeof re.insertionOrder === 'number' ? re.insertionOrder : 50
          let keys: string[] = []
          if (Array.isArray(re.keys)) {
            keys = re.keys.filter((k): k is string => typeof k === 'string')
          }
          parsedEntries.push({ id, keys, content, enabled, insertionOrder })
        }
      }
      updates.lorebook_entries = parsedEntries
    }
    if (typeof u.lorebook_enabled === 'boolean') updates.lorebook_enabled = u.lorebook_enabled
  }

  return { reply: record.reply, updates }
}
