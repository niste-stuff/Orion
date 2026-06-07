import type { ReviewableSection, RequestMessage } from '../types'

/**
 * Behavior knobs — centralized so the coach's posture is trivial to change.
 *
 * MODE "flag": the coach comments and offers a fix, never blocks or auto-writes.
 * TRIGGER "on-demand": review runs only when the author asks, never every turn.
 *
 * Only the "flag" + "on-demand" paths are built. Flipping either constant to its
 * other value is the FIRST step toward gate/auto behavior, but those code paths
 * deliberately do not exist yet.
 */
export const COACH_MODE: 'flag' | 'gate' = 'flag'
export const COACH_TRIGGER: 'on-demand' | 'auto' = 'on-demand'

/** One finding about a section: what's off, why it matters, and how to fix it. */
export type CoachFlag = {
  issue: string
  why: string
  suggestion: string
}

/** The parsed result of a review call. */
export type CoachReview = {
  flags: CoachFlag[]
}

/**
 * The heuristic checklist — what "good" means per section. This is the one place
 * to tune the coach: edit the strings here and the review prompt changes, with
 * no logic changes anywhere else.
 */
export const HEURISTICS: Record<ReviewableSection, { label: string; checklist: string[] }> = {
  personality: {
    label: 'Personality',
    checklist: [
      'Concrete and specific; flag generic adjective lists ("kind, smart, brave").',
      'Conveys traits through behavior and specifics, not bare labels.',
      'Not bloated or repetitive.',
    ],
  },
  scenario: {
    label: 'Scenario',
    checklist: [
      'Sets a clear situation with stakes or tension.',
      'Uses present-tense framing.',
      'Not redundant with the opening messages.',
    ],
  },
  dialogue_examples: {
    label: 'Dialogue examples',
    checklist: [
      'Actually demonstrates the character\'s voice and speech patterns.',
      'Shows range across more than one beat or mood, not a single line.',
      'Reads like example dialogue, not narration or a personality restatement.',
      'Uses {{user}} / {{char}} placeholders sanely where speakers are named.',
    ],
  },
  storefront: {
    label: 'Storefront',
    checklist: [
      'Reads as MARKETING copy aimed at a human browser — a hook, not a trait list.',
      'Creates intrigue and a clear reason to click/start the chat.',
      'Does NOT leak instructions or read like characterization the bot roleplays from.',
      'Concise and skimmable; front-loads what is most compelling.',
    ],
  },
  lorebook: {
    label: 'Lorebook',
    checklist: [
      'Token-efficient; flag bloat — this is injected every single turn.',
      'Facts are self-contained and discrete.',
      'No redundancy with the personality or scenario sections.',
    ],
  },
}

/**
 * Build the review system prompt for a section: it embeds that section's
 * checklist and asks for findings as JSON. The model must NOT rewrite the
 * section — it only evaluates and reports.
 */
export function buildReviewPrompt(section: ReviewableSection): string {
  const { label, checklist } = HEURISTICS[section]
  const items = checklist.map((c) => `- ${c}`).join('\n')

  return `You are a quality coach for AI character cards. Evaluate ONLY the ${label} section below against this checklist. Do NOT rewrite or rephrase the section — only report findings.

Checklist for a good ${label}:
${items}

Report each genuine problem as a flag. Be specific and concrete; do not invent problems. If the section satisfies the checklist, return an empty "flags" array.

Respond with ONLY a JSON object — no markdown fences, no other text:
{
  "flags": [
    { "issue": "short label of the problem", "why": "one sentence on why it hurts the card", "suggestion": "one concrete, actionable fix" }
  ]
}`
}

/** Assemble the review request: the checklist system prompt + the section's text. */
export function buildReviewRequest(
  section: ReviewableSection,
  content: string,
): RequestMessage[] {
  const { label } = HEURISTICS[section]
  return [
    { role: 'system', content: buildReviewPrompt(section) },
    { role: 'user', content: `Current ${label} section:\n\n${content}` },
  ]
}

/**
 * Tolerantly parse the model's review into a CoachReview, using the same
 * fence-strip / first-{...} extraction the authoring engine uses. Returns null
 * on any failure so the caller can degrade gracefully and change nothing.
 */
export function parseCoachReview(raw: string): CoachReview | null {
  let text = raw.trim()

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
  const rawFlags = (obj as Record<string, unknown>).flags
  if (!Array.isArray(rawFlags)) return null

  const flags: CoachFlag[] = []
  for (const entry of rawFlags) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (typeof e.issue !== 'string') continue
    flags.push({
      issue: e.issue,
      why: typeof e.why === 'string' ? e.why : '',
      suggestion: typeof e.suggestion === 'string' ? e.suggestion : '',
    })
  }

  return { flags }
}

/**
 * Build the authoring instruction a "Fix this" click sends back through the
 * normal conversational engine. The engine — not the coach — applies the change
 * via its usual { reply, updates } save path, so only the targeted section moves.
 */
export function buildFixInstruction(section: ReviewableSection, flag: CoachFlag): string {
  const { label } = HEURISTICS[section]
  const tail = flag.suggestion ? ` Specifically: ${flag.suggestion}` : ''
  return `Revise the ${label.toLowerCase()} section to fix this issue — "${flag.issue}".${tail} Update only the ${label.toLowerCase()} section.`
}
