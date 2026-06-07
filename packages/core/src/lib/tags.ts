/**
 * Tag-block parser for the conversational engine.
 *
 * A message may carry a leading/embedded weighted tag block in square brackets,
 * e.g.  [(elias:0.8), netori, (masterpiece:1.2)] make her colder
 *
 * We parse ONLY a well-formed [...] block (every comma-separated entry must be a
 * valid tag entry). Anything else — a stray "[", an unmatched bracket, prose in
 * brackets, an empty block — is left untouched and reported as "no block", so the
 * message sends exactly as today. {{char}}/{{user}} macros use different
 * delimiters and are never touched.
 *
 * The parser assigns NO tag type; the index decides type during resolution.
 */

export type ParsedTag = { tag: string; weight: number }

export type ParsedMessage = {
  /** Parsed tags (deduped, lowercased, weights clamped). Empty when no block. */
  tags: ParsedTag[]
  /** The message with the tag block stripped and whitespace tidied. */
  cleaned: string
  /** Whether a well-formed tag block was found and removed. */
  hadBlock: boolean
}

const MIN_WEIGHT = 0.1
const MAX_WEIGHT = 2.0

// A bareword tag: slug characters only (letters/digits/-/_), no spaces.
const BAREWORD = /^[a-z0-9_-]+$/i
// (tag:weight) — weight is captured loosely so garbage weights fall back to 1.0.
const WEIGHTED = /^\(\s*([a-z0-9_-]+)\s*:\s*([^)]*?)\s*\)$/i

/** Clamp to the sane range; non-finite (missing/garbage) becomes 1.0. */
function clampWeight(w: number): number {
  if (!Number.isFinite(w)) return 1.0
  return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, w))
}

/** Parse one comma-separated entry, or null if it is not a valid tag entry. */
function parseEntry(raw: string): ParsedTag | null {
  const entry = raw.trim()
  if (!entry) return null

  if (BAREWORD.test(entry)) {
    return { tag: entry.toLowerCase(), weight: 1.0 }
  }

  const m = WEIGHTED.exec(entry)
  if (m) {
    return { tag: m[1].toLowerCase(), weight: clampWeight(parseFloat(m[2])) }
  }

  return null
}

/**
 * Extract and strip the first well-formed [...] tag block from a message.
 * Returns the parsed tags, the cleaned message, and whether a block was found.
 * Robust: never throws; on anything malformed it returns the message as-is.
 */
export function parseTagBlock(message: string): ParsedMessage {
  const asIs = (): ParsedMessage => ({ tags: [], cleaned: message.trim(), hadBlock: false })

  const open = message.indexOf('[')
  if (open === -1) return asIs()

  const close = message.indexOf(']', open + 1)
  if (close === -1) return asIs() // unmatched "[" — leave the message alone

  const entries = message
    .slice(open + 1, close)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  if (entries.length === 0) return asIs() // "[]" is not a tag block

  const parsed: ParsedTag[] = []
  for (const e of entries) {
    const tag = parseEntry(e)
    if (!tag) return asIs() // any invalid entry → not a tag block; send as-is
    parsed.push(tag)
  }

  // Dedupe by tag, keeping the max weight (a tag typed twice leans harder).
  const byTag = new Map<string, number>()
  for (const { tag, weight } of parsed) {
    const prev = byTag.get(tag)
    byTag.set(tag, prev === undefined ? weight : Math.max(prev, weight))
  }
  const tags: ParsedTag[] = Array.from(byTag, ([tag, weight]) => ({ tag, weight }))

  const cleaned = (message.slice(0, open) + message.slice(close + 1))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+(\n|$)/g, '$1')
    .trim()

  return { tags, cleaned, hadBlock: true }
}
