import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { isTauri } from '@orion/core'
import type { Card, CardUpdates, Lorebook, ScalarSection, ChatMessage } from '@orion/core'
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
  chatHistory?: ChatMessage[]
}

async function invoke<T>(cmd: string, args?: any): Promise<T> {
  if (isTauri()) {
    return await tauriInvoke<T>(cmd, args);
  }

  switch (cmd) {
    case 'list_cards': {
      const summaries: CardSummary[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('orion_card_')) {
          try {
            const stored = JSON.parse(localStorage.getItem(key)!) as StoredCard;
            summaries.push({ id: stored.id, title: stored.title, updatedAt: stored.updatedAt });
          } catch (e) {
            console.error('Failed to parse card:', key, e);
          }
        }
      }
      return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) as unknown as T;
    }
    case 'load_card': {
      const id = args?.id;
      const item = localStorage.getItem('orion_card_' + id);
      if (!item) throw new Error('Card not found');
      return JSON.parse(item) as T;
    }
    case 'save_card': {
      const card = args?.card;
      if (!card || !card.id) throw new Error('Invalid card data');
      localStorage.setItem('orion_card_' + card.id, JSON.stringify(card));
      return undefined as unknown as T;
    }
    case 'delete_card': {
      const id = args?.id;
      localStorage.removeItem('orion_card_' + id);
      return undefined as unknown as T;
    }
    default:
      throw new Error(`Command "${cmd}" not supported in browser mode.`);
  }
}

export type SaveStatus = 'idle' | 'saving' | 'saved'

function emptyCard(): Card {
  return {
    personality: '',
    scenario: '',
    dialogue_examples: '',
    storefront: '',
    opening_messages: [],
    lorebook: { enabled: false, entries: [] },
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
    chatHistory: [],
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === 'string' ? err : String(err)
}

function normalizeCard(sections: any): Card {
  if (!sections || typeof sections !== 'object') {
    return emptyCard()
  }
  const normalized: Card = {
    personality: typeof sections.personality === 'string' ? sections.personality : '',
    scenario: typeof sections.scenario === 'string' ? sections.scenario : '',
    dialogue_examples: typeof sections.dialogue_examples === 'string' ? sections.dialogue_examples : '',
    storefront: typeof sections.storefront === 'string' ? sections.storefront : '',
    opening_messages: Array.isArray(sections.opening_messages) ? sections.opening_messages.map(String) : [],
    lorebook: { enabled: false, entries: [] },
  }

  if (sections.lorebook && typeof sections.lorebook === 'object') {
    const lb = sections.lorebook
    normalized.lorebook.enabled = typeof lb.enabled === 'boolean' ? lb.enabled : false
    if (Array.isArray(lb.entries)) {
      normalized.lorebook.entries = lb.entries.map((e: any) => ({
        id: typeof e.id === 'string' ? e.id : crypto.randomUUID(),
        keys: Array.isArray(e.keys) ? e.keys.map(String) : [],
        content: typeof e.content === 'string' ? e.content : '',
        enabled: typeof e.enabled === 'boolean' ? e.enabled : true,
        insertionOrder: typeof e.insertionOrder === 'number' ? e.insertionOrder : 100,
      }))
    } else if (typeof lb.text === 'string' && lb.text.trim()) {
      normalized.lorebook.entries = [
        {
          id: crypto.randomUUID(),
          keys: ['general'],
          content: lb.text,
          enabled: true,
          insertionOrder: 100,
        },
      ]
    }
  }

  return normalized
}

function normalizeStoredCard(stored: StoredCard): StoredCard {
  return {
    ...stored,
    sections: normalizeCard(stored.sections),
    chatHistory: Array.isArray(stored.chatHistory) ? stored.chatHistory : [],
  }
}

function toSummary(s: StoredCard): CardSummary {
  return { id: s.id, title: s.title, updatedAt: s.updatedAt }
}

function sortByUpdated(list: CardSummary[]): CardSummary[] {
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

let globalInitPromise: Promise<{ list: CardSummary[]; active: StoredCard }> | null = null

/**
 * Loads and persists the user's cards as local JSON files via the Rust storage
 * commands (no network — fully offline). The active card's six sections are kept
 * in state; any edit schedules a debounced whole-file save of the active card.
 * Also owns the card library: the list of cards, creating new ones, and
 * switching between them. On any parse/engine failure NO section is touched
 * (never-wipe), exactly as before.
 */
export function useCard() {
  const isMounted = useRef(true)
  const [cards, setCards] = useState<CardSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [card, setCard] = useState<Card>(emptyCard)
  const [title, setTitleState] = useState('Untitled')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [chatHistory, setChatHistoryState] = useState<ChatMessage[]>([])

  // The authoritative current card, so debounced saves serialize the whole file
  // with the latest content without waiting for a re-render.
  const liveRef = useRef<StoredCard | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  const setActiveStored = useCallback((stored: StoredCard) => {
    const normalized = normalizeStoredCard(stored)
    liveRef.current = normalized
    setActiveId(normalized.id)
    setCard(normalized.sections)
    setTitleState(normalized.title)
    setChatHistoryState(normalized.chatHistory || [])
  }, [])
  // Write the whole active card file and reflect it in the list.
  const persist = useCallback(async (stored: StoredCard) => {
    setSaveStatus('saving')
    try {
      await invoke('save_card', { card: stored })
      if (isMounted.current) {
        setSaveStatus('saved')
        setCards((prev) =>
          sortByUpdated([toSummary(stored), ...prev.filter((c) => c.id !== stored.id)]),
        )
      }
    } catch (err) {
      if (isMounted.current) {
        setError(errMessage(err))
        setSaveStatus('idle')
      }
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

  const saveImmediately = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
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

  const setChatHistory = useCallback((newHistory: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    const cur = liveRef.current
    if (!cur) return
    const resolvedHistory = typeof newHistory === 'function' ? newHistory(cur.chatHistory || []) : newHistory
    liveRef.current = { ...cur, chatHistory: resolvedHistory }
    setChatHistoryState(resolvedHistory)
    void saveImmediately()
  }, [saveImmediately])

  // Load-or-create on first mount. Guarded so React StrictMode's double-invoke
  // can't create two cards on a fresh install.
  useEffect(() => {
    let active = true

    async function init() {
      if (!globalInitPromise) {
        globalInitPromise = (async () => {
          const list = await invoke<CardSummary[]>('list_cards')
          if (list.length === 0) {
            const fresh = newStoredCard()
            await invoke('save_card', { card: fresh })
            return {
              list: [toSummary(fresh)],
              active: fresh,
            }
          } else {
            const stored = await invoke<StoredCard>('load_card', { id: list[0].id })
            return {
              list: sortByUpdated(list),
              active: stored,
            }
          }
        })()
      }

      try {
        const result = await globalInitPromise
        if (active && isMounted.current) {
          setCards(result.list)
          setActiveStored(result.active)
          setSaveStatus('saved')
        }
      } catch (err) {
        if (active && isMounted.current) {
          setError(errMessage(err))
          globalInitPromise = null
        }
      }
    }

    void init()

    return () => {
      active = false
    }
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

  // Apply a parsed engine turn. Only present keys change; lorebook entries/enabled
  // merge into the current lorebook. The parser already guarded the array.
  const applyUpdates = useCallback(
    (u: CardUpdates) => {
      mutateSections((s) => {
        const next: Card = { ...s }
        if (typeof u.personality === 'string') next.personality = u.personality
        if (typeof u.scenario === 'string') next.scenario = u.scenario
        if (typeof u.dialogue_examples === 'string') next.dialogue_examples = u.dialogue_examples
        if (typeof u.storefront === 'string') next.storefront = u.storefront
        if (u.opening_messages) next.opening_messages = u.opening_messages.slice(0, MAX_OPENING_MESSAGES)
        if (u.lorebook_entries !== undefined || u.lorebook_enabled !== undefined) {
          next.lorebook = {
            enabled: u.lorebook_enabled ?? s.lorebook.enabled,
            entries: u.lorebook_entries ?? s.lorebook.entries,
          }
        }
        return next
      })
      void saveImmediately()
    },
    [mutateSections, saveImmediately],
  )

  // Restore an entire card snapshot (used by chat delete-revert).
  const restoreCard = useCallback(
    (snapshot: Card) => {
      mutateSections(() => ({
        ...snapshot,
        opening_messages: [...snapshot.opening_messages],
        lorebook: {
          enabled: snapshot.lorebook.enabled,
          entries: snapshot.lorebook.entries.map((e) => ({ ...e, keys: [...e.keys] })),
        },
      }))
      void saveImmediately()
    },
    [mutateSections, saveImmediately],
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

  const renameCard = useCallback(async (id: string, newTitle: string) => {
    const trimmed = newTitle.trim() || 'Untitled'
    if (id === activeId) {
      setTitle(trimmed)
      return
    }
    try {
      const stored = await invoke<StoredCard>('load_card', { id })
      stored.title = trimmed
      stored.updatedAt = new Date().toISOString()
      await invoke('save_card', { card: stored })
      if (isMounted.current) {
        setCards((prev) =>
          prev.map((c) => (c.id === id ? { ...c, title: trimmed, updatedAt: stored.updatedAt } : c))
        )
      }
    } catch (err) {
      if (isMounted.current) {
        setError(errMessage(err))
      }
    }
  }, [activeId, setTitle])

  const newCard = useCallback(async () => {
    await flushPending()
    const fresh = newStoredCard()
    try {
      await invoke('save_card', { card: fresh })
      if (isMounted.current) {
        setCards((prev) => sortByUpdated([toSummary(fresh), ...prev]))
        setActiveStored(fresh)
        setSaveStatus('saved')
      }
    } catch (err) {
      if (isMounted.current) {
        setError(errMessage(err))
      }
    }
  }, [flushPending, setActiveStored])

  const switchCard = useCallback(
    async (id: string) => {
      if (id === activeId) return
      await flushPending()
      try {
        const stored = await invoke<StoredCard>('load_card', { id })
        if (isMounted.current) {
          setActiveStored(stored)
          setSaveStatus('idle')
        }
      } catch (err) {
        if (isMounted.current) {
          setError(errMessage(err))
        }
      }
    },
    [activeId, flushPending, setActiveStored],
  )

  const deleteCard = useCallback(
    async (id: string) => {
      await flushPending()
      try {
        await invoke('delete_card', { id })
        if (isMounted.current) {
          setCards((prev) => {
            const next = prev.filter((c) => c.id !== id)
            if (id === activeId) {
              if (next.length > 0) {
                void switchCard(next[0].id)
              } else {
                void newCard()
              }
            }
            return next
          })
        }
      } catch (err) {
        if (isMounted.current) {
          setError(errMessage(err))
        }
      }
    },
    [activeId, flushPending, switchCard, newCard],
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
    chatHistory,
    setChatHistory,
    deleteCard,
    renameCard,
  }
}
