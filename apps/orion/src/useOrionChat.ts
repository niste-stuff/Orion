import { useCallback, useEffect, useRef, useState } from 'react'
import type { Card, CardUpdates, ChatMessage, RequestMessage, Settings } from '@orion/core'
import { chatCompletion, chatCompletionWithStyle } from '@orion/core'
import { buildRequest, parseOrionResponse } from '@orion/core'
import { parseTagBlock } from '@orion/core'

// How many recent turns to send back as context with each request.
const HISTORY_TURNS = 12

type Args = {
  settings: Settings
  card: Card
  activeId: string | null
  /** The card section the user is currently editing (drives style retrieval). */
  activeSection: string
  applyUpdates: (updates: CardUpdates) => void
  restoreCard: (snapshot: Card) => void
  messages: ChatMessage[]
  setMessages: (newMessages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void
}

function cloneCard(card: Card): Card {
  return {
    ...card,
    opening_messages: [...card.opening_messages],
    lorebook: {
      enabled: card.lorebook.enabled,
      entries: (card.lorebook.entries || []).map((e) => ({
        ...e,
        keys: [...e.keys],
      })),
    },
  }
}

/**
 * The conversational engine. On send, makes ONE non-streaming request carrying
 * the system prompt, the current card, and recent chat history. The reply is
 * shown as an assistant message; any sections in "updates" are applied through
 * applyUpdates (which persists the card to disk). On any parse or network
 * failure, NO section is ever touched.
 */
export function useOrionChat({
  settings,
  card,
  activeId,
  activeSection,
  applyUpdates,
  restoreCard,
  messages,
  setMessages,
}: Args) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Always read the freshest card/active-section at send time, even though
  // sendMessage is memoised — avoids stale content/section in the request.
  const cardRef = useRef(card)
  cardRef.current = card
  const activeSectionRef = useRef(activeSection)
  activeSectionRef.current = activeSection
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

  // Reset loading and error states when switching cards
  useEffect(() => {
    setLoading(false)
    setError(null)
  }, [activeId])

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

      const sentCardId = activeIdRef.current

      try {
        const request = buildRequest(cardRef.current, history, cleaned)
        // With tags, route through the style-aware path (invisible retrieval);
        // otherwise the call is byte-identical to before. A retrieval miss/error
        // degrades silently inside the command to a normal no-reference call.
        const raw =
          tags.length > 0
            ? await chatCompletionWithStyle(settings, request, tags, activeSectionRef.current)
            : await chatCompletion(settings, request)

        if (activeIdRef.current !== sentCardId) {
          console.warn("Discarding response: card was switched during generation.")
          return
        }

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
        if (activeIdRef.current !== sentCardId) return
        // Network / request error: leave the whole card untouched.
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (activeIdRef.current === sentCardId) {
          setLoading(false)
        }
      }
    },
    [loading, messages, settings, applyUpdates, setMessages],
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
    [messages, restoreCard, setMessages],
  )

  const regenerate = useCallback(async () => {
    if (loading) return
    let lastUserIdx = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserIdx = i
        break
      }
    }
    if (lastUserIdx === -1) return

    const lastUserMsg = messages[lastUserIdx]
    
    if (lastUserMsg.cardBefore) {
      restoreCard(lastUserMsg.cardBefore)
    }

    const nextMessages = messages.slice(0, lastUserIdx + 1)
    setMessages(nextMessages)
    setError(null)
    setLoading(true)

    const sentCardId = activeIdRef.current
    const trimmed = lastUserMsg.content.trim()
    const { tags, cleaned } = parseTagBlock(trimmed)

    const history: RequestMessage[] = messages
      .slice(0, lastUserIdx)
      .slice(-HISTORY_TURNS)
      .map((m) => ({
        role: m.role,
        content: m.role === 'user' ? parseTagBlock(m.content).cleaned : m.content,
      }))

    try {
      const request = buildRequest(cardRef.current, history, cleaned)
      const raw =
        tags.length > 0
          ? await chatCompletionWithStyle(settings, request, tags, activeSectionRef.current)
          : await chatCompletion(settings, request)

      if (activeIdRef.current !== sentCardId) {
        console.warn("Discarding response: card was switched during generation.")
        return
      }

      const parsed = parseOrionResponse(raw)

      if (!parsed) {
        setMessages([...nextMessages, { role: 'assistant', content: raw }])
        return
      }

      applyUpdates(parsed.updates)
      setMessages([...nextMessages, { role: 'assistant', content: parsed.reply || 'Done.' }])
    } catch (err) {
      if (activeIdRef.current !== sentCardId) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (activeIdRef.current === sentCardId) {
        setLoading(false)
      }
    }
  }, [loading, messages, settings, restoreCard, setMessages, applyUpdates])

  return {
    messages,
    loading,
    error,
    sendMessage,
    deleteFrom,
    regenerate,
    dismissError: () => setError(null),
  }
}
