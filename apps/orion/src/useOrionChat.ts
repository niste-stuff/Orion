import { useCallback, useRef, useState } from 'react'
import type { Card, CardUpdates, ChatMessage, RequestMessage, Settings } from '@orion/core'
import { chatCompletion, chatCompletionWithStyle } from '@orion/core'
import { buildRequest, parseOrionResponse } from '@orion/core'
import { parseTagBlock } from '@orion/core'

// How many recent turns to send back as context with each request.
const HISTORY_TURNS = 12

type Args = {
  settings: Settings
  card: Card
  /** The card section the user is currently editing (drives style retrieval). */
  activeSection: string
  applyUpdates: (updates: CardUpdates) => void
  restoreCard: (snapshot: Card) => void
}

/** Deep-clone a card so a snapshot is immune to later in-place mutations. */
function cloneCard(card: Card): Card {
  return {
    ...card,
    opening_messages: [...card.opening_messages],
    lorebook: { ...card.lorebook },
  }
}

/**
 * The conversational engine. On send, makes ONE non-streaming request carrying
 * the system prompt, the current card, and recent chat history. The reply is
 * shown as an assistant message; any sections in "updates" are applied through
 * applyUpdates (which persists the card to disk). On any parse or network
 * failure, NO section is ever touched.
 */
export function useOrionChat({ settings, card, activeSection, applyUpdates, restoreCard }: Args) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Always read the freshest card/active-section at send time, even though
  // sendMessage is memoised — avoids stale content/section in the request.
  const cardRef = useRef(card)
  cardRef.current = card
  const activeSectionRef = useRef(activeSection)
  activeSectionRef.current = activeSection

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || loading) return

      // Parse any weighted tag block. The user SEES their typed message (tags and
      // all); the MODEL sees it with the block stripped. Tag blocks are likewise
      // stripped from prior user turns in the history we send.
      const { tags, cleaned } = parseTagBlock(trimmed)

      const history: RequestMessage[] = messages
        .slice(-HISTORY_TURNS)
        .map((m) => ({
          role: m.role,
          content: m.role === 'user' ? parseTagBlock(m.content).cleaned : m.content,
        }))

      // Snapshot the card as it stands BEFORE this turn, so the message can be
      // deleted later and its (and subsequent turns') changes reverted.
      const cardBefore = cloneCard(cardRef.current)
      setMessages((prev) => [...prev, { role: 'user', content: trimmed, cardBefore }])
      setError(null)
      setLoading(true)

      try {
        const request = buildRequest(cardRef.current, history, cleaned)
        // With tags, route through the style-aware path (invisible retrieval);
        // otherwise the call is byte-identical to before. A retrieval miss/error
        // degrades silently inside the command to a normal no-reference call.
        const raw =
          tags.length > 0
            ? await chatCompletionWithStyle(settings, request, tags, activeSectionRef.current)
            : await chatCompletion(settings, request)
        const parsed = parseOrionResponse(raw)

        if (!parsed) {
          // Parse failure: surface the raw text, change NO section.
          setMessages((prev) => [...prev, { role: 'assistant', content: raw }])
          return
        }

        // Apply only the sections the model returned — never the others.
        applyUpdates(parsed.updates)

        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: parsed.reply || 'Done.' },
        ])
      } catch (err) {
        // Network / request error: leave the whole card untouched.
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [loading, messages, settings, applyUpdates],
  )

  // Delete a user message and everything after it, reverting all card changes
  // back to the snapshot taken before that message was sent.
  const deleteFrom = useCallback(
    (index: number) => {
      const target = messages[index]
      if (!target || target.role !== 'user') return

      if (target.cardBefore) restoreCard(target.cardBefore)

      setMessages((prev) => prev.slice(0, index))
      setError(null)
    },
    [messages, restoreCard],
  )

  return {
    messages,
    loading,
    error,
    sendMessage,
    deleteFrom,
    dismissError: () => setError(null),
  }
}
