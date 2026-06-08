export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  // For user messages: a snapshot of the whole card taken just BEFORE this
  // message was sent. Deleting the message restores the card to this snapshot,
  // reverting every change the message (and the turns after it) produced.
  cardBefore?: Card
}

// A message sent to the model. Orion's system prompt uses the `system` role,
// which never appears in the visible chat history.
export type RequestMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type LorebookEntry = {
  id: string
  keys: string[]
  content: string
  enabled: boolean
  insertionOrder: number
}

/** A lorebook is OPTIONAL and OFF BY DEFAULT — model-facing only when enabled. */
export type Lorebook = {
  enabled: boolean
  entries: LorebookEntry[]
}

/**
 * The card's six sections.
 *
 * Personality, scenario, dialogue_examples and opening_messages are normal
 * model-facing content. `storefront` is public marketing copy a human browser
 * reads — NOT characterization the model roleplays from. `lorebook` is optional.
 */
export type Card = {
  personality: string
  scenario: string
  dialogue_examples: string
  storefront: string
  /** Ordered list of up to MAX_OPENING_MESSAGES openers, ALL canonical/equal. */
  opening_messages: string[]
  lorebook: Lorebook
}

/** The plain-text sections — one card_blocks row each, content stored verbatim. */
export type ScalarSection = 'personality' | 'scenario' | 'dialogue_examples' | 'storefront'

/** Sections the quality coach can review (scalar text; lorebook reviews its text). */
export type ReviewableSection = ScalarSection | 'lorebook'

/**
 * What the conversational engine may change in one turn — include ONLY what
 * changed. `opening_messages` is the COMPLETE intended array (not a diff).
 */
export type CardUpdates = {
  personality?: string
  scenario?: string
  dialogue_examples?: string
  storefront?: string
  opening_messages?: string[]
  lorebook_entries?: LorebookEntry[]
  lorebook_enabled?: boolean
}

/** Hard cap on opening messages. */
export const MAX_OPENING_MESSAGES = 10

export type Settings = {
  apiKey: string
  baseUrl: string
  model: string
}
