import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Card, CardUpdates, Lorebook, ScalarSection } from '@orion/core'
import { MAX_OPENING_MESSAGES } from '@orion/core'

const SAVE_DEBOUNCE_MS = 1500

/** Lightweight card list entry for the library sidebar. */
export type CardSummary = { id: string; title: string; updatedAt: string }

/** The on-disk card file shape (cards/<id>.json). `sections` is the Card itself. */
type StoredCard = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  sections: Card
}

export type SaveStatus = 'idle' | 'saving' | 'saved'

function emptyCard(): Card {
  return {
    personality: '',
    scenario: '',
    dialogue_examples: '',
    storefront: '',
    opening_messages: [],
    lorebook: { enabled: false, text: '' },
  }
}

function newStoredCard(): StoredCard {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    title: 'Untitled',
    createdAt: now,
    updatedAt: now,
    sections: emptyCard(),
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === 'string' ? err : String(err)
}

function toSummary(s: StoredCard): CardSummary {
  return { id: s.id, title: s.title, updatedAt: s.updatedAt }
}

function sortByUpdated(list: CardSummary[]): CardSummary[] {
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/**
 * Loads and persists the user's cards as local JSON files via the Rust storage
 * commands (no network — fully offline). The active card's six sections are kept
 * in state; any edit schedules a debounced whole-file save of the active card.
 * Also owns the card library: the list of cards, creating new ones, and
 * switching between them. On any parse/engine failure NO section is touched
 * (never-wipe), exactly as before.
 */
export function useCard() {
  const [cards, setCards] = useState<CardSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [card, setCard] = useState<Card>(emptyCard)
  const [title, setTitleState] = useState('Untitled')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  // The authoritative current card, so debounced saves serialize the whole file
  // with the latest content without waiting for a re-render.
  const liveRef = useRef<StoredCard | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initStarted = useRef(false)

  const setActiveStored = useCallback((stored: StoredCard) => {
    liveRef.current = stored
    setActiveId(stored.id)
    setCard(stored.sections)
    setTitleState(stored.title)
  }, [])

  // Write the whole active card file and reflect it in the list.
  const persist = useCallback(async (stored: StoredCard) => {
    setSaveStatus('saving')
    try {
      await invoke('save_card', { card: stored })
      setSaveStatus('saved')
      setCards((prev) =>
        sortByUpdated([toSummary(stored), ...prev.filter((c) => c.id !== stored.id)]),
      )
    } catch (err) {
      setError(errMessage(err))
      setSaveStatus('idle')
    }
  }, [])

  // Flush any pending debounced save immediately (before switching/creating).
  const flushPending = useCallback(async () => {
    if (!saveTimer.current) return
    clearTimeout(saveTimer.current)
    saveTimer.current = null
    const cur = liveRef.current
    if (!cur) return
    const stamped = { ...cur, updatedAt: new Date().toISOString() }
    liveRef.current = stamped
    await persist(stamped)
  }, [persist])

  const scheduleSave = useCallback(() => {
    if (!liveRef.current) return
    setSaveStatus('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      const cur = liveRef.current
      if (!cur) return
      const stamped = { ...cur, updatedAt: new Date().toISOString() }
      liveRef.current = stamped
      void persist(stamped)
    }, SAVE_DEBOUNCE_MS)
  }, [persist])

  // Load-or-create on first mount. Guarded so React StrictMode's double-invoke
  // can't create two cards on a fresh install.
  useEffect(() => {
    if (initStarted.current) return
    initStarted.current = true

    async function init() {
      try {
        const list = await invoke<CardSummary[]>('list_cards')
        if (list.length === 0) {
          const fresh = newStoredCard()
          await invoke('save_card', { card: fresh })
          setCards([toSummary(fresh)])
          setActiveStored(fresh)
          setSaveStatus('saved')
        } else {
          setCards(sortByUpdated(list))
          const stored = await invoke<StoredCard>('load_card', { id: list[0].id })
          setActiveStored(stored)
        }
      } catch (err) {
        setError(errMessage(err))
      }
    }

    void init()
  }, [setActiveStored])

  // Apply a sections change to the active card and schedule a save.
  const mutateSections = useCallback(
    (fn: (sections: Card) => Card) => {
      const cur = liveRef.current
      if (!cur) return
      const next = fn(cur.sections)
      liveRef.current = { ...cur, sections: next }
      setCard(next)
      scheduleSave()
    },
    [scheduleSave],
  )

  const setSection = useCallback(
    (section: ScalarSection, value: string) =>
      mutateSections((s) => ({ ...s, [section]: value })),
    [mutateSections],
  )

  const setOpeningMessages = useCallback(
    (list: string[]) =>
      mutateSections((s) => ({ ...s, opening_messages: list.slice(0, MAX_OPENING_MESSAGES) })),
    [mutateSections],
  )

  const setLorebook = useCallback(
    (lorebook: Lorebook) => mutateSections((s) => ({ ...s, lorebook })),
    [mutateSections],
  )

  // Apply a parsed engine turn. Only present keys change; lorebook text/enabled
  // merge into the current lorebook. The parser already guarded the array.
  const applyUpdates = useCallback(
    (u: CardUpdates) =>
      mutateSections((s) => {
        const next: Card = { ...s }
        if (typeof u.personality === 'string') next.personality = u.personality
        if (typeof u.scenario === 'string') next.scenario = u.scenario
        if (typeof u.dialogue_examples === 'string') next.dialogue_examples = u.dialogue_examples
        if (typeof u.storefront === 'string') next.storefront = u.storefront
        if (u.opening_messages) next.opening_messages = u.opening_messages.slice(0, MAX_OPENING_MESSAGES)
        if (u.lorebook !== undefined || u.lorebook_enabled !== undefined) {
          next.lorebook = {
            enabled: u.lorebook_enabled ?? s.lorebook.enabled,
            text: u.lorebook ?? s.lorebook.text,
          }
        }
        return next
      }),
    [mutateSections],
  )

  // Restore an entire card snapshot (used by chat delete-revert).
  const restoreCard = useCallback(
    (snapshot: Card) =>
      mutateSections(() => ({
        ...snapshot,
        opening_messages: [...snapshot.opening_messages],
        lorebook: { ...snapshot.lorebook },
      })),
    [mutateSections],
  )

  const setTitle = useCallback(
    (value: string) => {
      const cur = liveRef.current
      if (!cur) return
      liveRef.current = { ...cur, title: value }
      setTitleState(value)
      setCards((prev) => prev.map((c) => (c.id === cur.id ? { ...c, title: value } : c)))
      scheduleSave()
    },
    [scheduleSave],
  )

  const newCard = useCallback(async () => {
    await flushPending()
    const fresh = newStoredCard()
    try {
      await invoke('save_card', { card: fresh })
      setCards((prev) => sortByUpdated([toSummary(fresh), ...prev]))
      setActiveStored(fresh)
      setSaveStatus('saved')
    } catch (err) {
      setError(errMessage(err))
    }
  }, [flushPending, setActiveStored])

  const switchCard = useCallback(
    async (id: string) => {
      if (id === activeId) return
      await flushPending()
      try {
        const stored = await invoke<StoredCard>('load_card', { id })
        setActiveStored(stored)
        setSaveStatus('idle')
      } catch (err) {
        setError(errMessage(err))
      }
    },
    [activeId, flushPending, setActiveStored],
  )

  return {
    card,
    title,
    setTitle,
    setSection,
    setOpeningMessages,
    setLorebook,
    applyUpdates,
    restoreCard,
    saveStatus,
    error,
    dismissError: () => setError(null),
    cards,
    activeId,
    newCard,
    switchCard,
  }
}
