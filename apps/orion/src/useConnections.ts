import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Connection } from './connections'
import {
  loadActiveId,
  loadConnections,
  newConnectionId,
  saveActiveId,
  saveConnections,
} from './connections'

/**
 * Manages the roster of saved LLM connection profiles and which one is active.
 * State is mirrored to localStorage so profiles and the active selection survive
 * a refresh. The active connection (if any) is what the engine should use;
 * otherwise callers fall back to the default settings.
 */
export function useConnections() {
  const [connections, setConnections] = useState<Connection[]>(() => loadConnections())
  const [activeId, setActiveId] = useState<string | null>(() => loadActiveId())

  useEffect(() => {
    saveConnections(connections)
  }, [connections])

  useEffect(() => {
    saveActiveId(activeId)
  }, [activeId])

  const addConnection = useCallback((draft: Omit<Connection, 'id'>): Connection => {
    const conn: Connection = { ...draft, id: newConnectionId() }
    setConnections((prev) => [...prev, conn])
    return conn
  }, [])

  const updateConnection = useCallback(
    (id: string, patch: Partial<Omit<Connection, 'id'>>) => {
      setConnections((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      )
    },
    [],
  )

  const deleteConnection = useCallback((id: string) => {
    setConnections((prev) => prev.filter((c) => c.id !== id))
    // Deleting the active profile falls back to the default connection.
    setActiveId((prev) => (prev === id ? null : prev))
  }, [])

  const duplicateConnection = useCallback((id: string) => {
    setConnections((prev) => {
      const source = prev.find((c) => c.id === id)
      if (!source) return prev
      const copy: Connection = {
        ...source,
        id: newConnectionId(),
        label: `${source.label} copy`,
      }
      return [...prev, copy]
    })
  }, [])

  const setActive = useCallback((id: string | null) => {
    setActiveId(id)
  }, [])

  const activeConnection = useMemo(
    () => connections.find((c) => c.id === activeId) ?? null,
    [connections, activeId],
  )

  return {
    connections,
    activeId,
    activeConnection,
    addConnection,
    updateConnection,
    deleteConnection,
    duplicateConnection,
    setActive,
  }
}
