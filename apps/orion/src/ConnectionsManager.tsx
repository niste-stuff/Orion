import { useState } from 'react'
import type { Connection } from './connections'
import { providerHint } from './connections'
import { fetchModels } from '@orion/core'

type Props = {
  connections: Connection[]
  activeId: string | null
  onAdd: (draft: Omit<Connection, 'id'>) => Connection
  onUpdate: (id: string, patch: Partial<Omit<Connection, 'id'>>) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  onSetActive: (id: string | null) => void
  onClose: () => void
}

// A blank draft for the Add form.
const EMPTY_DRAFT: Omit<Connection, 'id'> = {
  label: '',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: '',
  modelId: '',
}

const fieldClass =
  'rounded-lg border border-line bg-paper px-3 py-1.5 text-sm text-ink placeholder:text-faint transition focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/15'

/**
 * The Connections manager: a modal roster of saved LLM connection profiles, each
 * an OpenAI-compatible endpoint (OpenRouter, OpenAI, local Ollama / LM Studio…).
 * One profile may be marked active; the engine uses it, falling back to the
 * default Settings when none is active. All state is owned by useConnections and
 * persisted to localStorage — this component is pure presentation + form state.
 */
export default function ConnectionsManager({
  connections,
  activeId,
  onAdd,
  onUpdate,
  onDelete,
  onDuplicate,
  onSetActive,
  onClose,
}: Props) {
  // null = list view; 'new' = adding; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Omit<Connection, 'id'>>(EMPTY_DRAFT)

  // "Fetch models" state, scoped to the open form.
  const [models, setModels] = useState<string[] | null>(null)
  const [fetchState, setFetchState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [fetchMsg, setFetchMsg] = useState<string | null>(null)

  function startAdd() {
    setDraft(EMPTY_DRAFT)
    setModels(null)
    setFetchState('idle')
    setFetchMsg(null)
    setEditing('new')
  }

  function startEdit(conn: Connection) {
    const { id: _id, ...rest } = conn
    void _id
    setDraft(rest)
    setModels(null)
    setFetchState('idle')
    setFetchMsg(null)
    setEditing(conn.id)
  }

  function cancelForm() {
    setEditing(null)
  }

  function saveForm() {
    const label = draft.label.trim() || providerHint(draft.baseUrl)
    const cleaned: Omit<Connection, 'id'> = {
      label,
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey,
      modelId: draft.modelId.trim(),
    }
    if (editing === 'new') {
      const created = onAdd(cleaned)
      // A freshly added profile becomes active when none is set yet, so the
      // user's first connection just works without an extra click.
      if (!activeId) onSetActive(created.id)
    } else if (editing) {
      onUpdate(editing, cleaned)
    }
    setEditing(null)
  }

  async function handleFetchModels() {
    setFetchState('loading')
    setFetchMsg(null)
    try {
      const ids = await fetchModels(draft.baseUrl.trim(), draft.apiKey)
      setModels(ids)
      setFetchState('idle')
      if (ids.length === 0) setFetchMsg('No models returned by this endpoint.')
      else if (!draft.modelId) setDraft((d) => ({ ...d, modelId: ids[0] }))
    } catch {
      // 404 / CORS / network — degrade gracefully, just enter the id by hand.
      setFetchState('error')
      setFetchMsg(
        'Could not fetch models (the endpoint may not support /models, or CORS blocked it). Enter the Model ID manually.',
      )
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 dark:bg-black/60"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-surface p-6 shadow-raised"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Connections</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-muted transition hover:bg-surface-sunk"
          >
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-faint">
          Saved LLM endpoints — any OpenAI-compatible API. The active one is used for
          chat; with none active, Orion falls back to the default in Settings.
        </p>

        {editing === null ? (
          <ListView
            connections={connections}
            activeId={activeId}
            onAdd={startAdd}
            onEdit={startEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onSetActive={onSetActive}
          />
        ) : (
          <FormView
            isNew={editing === 'new'}
            draft={draft}
            setDraft={setDraft}
            models={models}
            fetchState={fetchState}
            fetchMsg={fetchMsg}
            onFetchModels={handleFetchModels}
            onCancel={cancelForm}
            onSave={saveForm}
          />
        )}
      </div>
    </div>
  )
}

type ListProps = {
  connections: Connection[]
  activeId: string | null
  onAdd: () => void
  onEdit: (conn: Connection) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  onSetActive: (id: string | null) => void
}

function ListView({
  connections,
  activeId,
  onAdd,
  onEdit,
  onDelete,
  onDuplicate,
  onSetActive,
}: ListProps) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="-mr-2 flex-1 overflow-y-auto pr-2">
        {connections.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-paper px-4 py-6 text-center text-sm text-faint">
            No connections yet. Add one to switch between providers.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {connections.map((conn) => {
              const isActive = conn.id === activeId
              return (
                <li
                  key={conn.id}
                  className={
                    'rounded-xl border bg-paper px-4 py-3 shadow-soft transition ' +
                    (isActive ? 'border-clay ring-1 ring-clay/20' : 'border-line')
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink">
                          {conn.label}
                        </span>
                        {isActive && (
                          <span className="shrink-0 rounded-full bg-clay-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-clay-dark">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {conn.modelId || 'no model set'}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-faint">
                        {providerHint(conn.baseUrl)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {isActive ? (
                        <button
                          type="button"
                          onClick={() => onSetActive(null)}
                          className="rounded-md px-2 py-1 text-xs font-medium text-muted transition hover:bg-surface-sunk"
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSetActive(conn.id)}
                          className="rounded-md bg-clay px-2.5 py-1 text-xs font-medium text-white shadow-soft transition hover:bg-clay-dark active:scale-[0.98]"
                        >
                          Set Active
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center gap-1 border-t border-line pt-2 text-xs">
                    <button
                      type="button"
                      onClick={() => onEdit(conn)}
                      className="rounded-md px-2 py-1 font-medium text-muted transition hover:bg-surface-sunk"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDuplicate(conn.id)}
                      className="rounded-md px-2 py-1 font-medium text-muted transition hover:bg-surface-sunk"
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(conn.id)}
                      className="ml-auto rounded-md px-2 py-1 font-medium text-clay-dark transition hover:bg-clay-soft"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={onAdd}
        className="mt-4 shrink-0 rounded-lg border border-line bg-paper px-3.5 py-2 text-sm font-medium text-ink shadow-soft transition hover:bg-surface-sunk active:scale-[0.98]"
      >
        + Add connection
      </button>
    </div>
  )
}

type FormProps = {
  isNew: boolean
  draft: Omit<Connection, 'id'>
  setDraft: React.Dispatch<React.SetStateAction<Omit<Connection, 'id'>>>
  models: string[] | null
  fetchState: 'idle' | 'loading' | 'error'
  fetchMsg: string | null
  onFetchModels: () => void
  onCancel: () => void
  onSave: () => void
}

function FormView({
  isNew,
  draft,
  setDraft,
  models,
  fetchState,
  fetchMsg,
  onFetchModels,
  onCancel,
  onSave,
}: FormProps) {
  const canSave = draft.baseUrl.trim().length > 0 && draft.modelId.trim().length > 0

  return (
    <div className="flex min-h-0 flex-col">
      <div className="-mr-2 flex flex-1 flex-col gap-4 overflow-y-auto pr-2">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
          Label
          <input
            type="text"
            value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            placeholder="e.g. OpenRouter — Claude"
            className={fieldClass}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
          Base URL
          <input
            type="text"
            value={draft.baseUrl}
            onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
            placeholder="https://…/v1"
            className={fieldClass}
          />
          <span className="text-[11px] font-normal text-faint">
            Path up to <code className="font-mono">/v1</code> — Orion appends{' '}
            <code className="font-mono">/chat/completions</code>. Local servers work too
            (e.g. <code className="font-mono">http://localhost:1234/v1</code>).
          </span>
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
          API Key <span className="font-normal text-faint">(optional)</span>
          <input
            type="password"
            value={draft.apiKey}
            onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value }))}
            placeholder="leave blank for local servers"
            className={fieldClass}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
          Model ID
          <input
            type="text"
            value={draft.modelId}
            onChange={(e) => setDraft((d) => ({ ...d, modelId: e.target.value }))}
            placeholder="e.g. anthropic/claude-3.5-sonnet"
            className={fieldClass}
            list="orion-fetched-models"
          />
          {models && models.length > 0 && (
            <datalist id="orion-fetched-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onFetchModels}
              disabled={fetchState === 'loading' || draft.baseUrl.trim().length === 0}
              className="rounded-md border border-line bg-paper px-2.5 py-1 text-[11px] font-medium text-muted shadow-soft transition hover:bg-surface-sunk disabled:cursor-not-allowed disabled:opacity-40"
            >
              {fetchState === 'loading' ? 'Fetching…' : 'Fetch models'}
            </button>
            {models && models.length > 0 && (
              <span className="text-[11px] text-faint">{models.length} models found</span>
            )}
          </div>
          {fetchMsg && (
            <span
              className={
                'text-[11px] ' + (fetchState === 'error' ? 'text-clay-dark' : 'text-faint')
              }
            >
              {fetchMsg}
            </span>
          )}
        </label>
      </div>

      <div className="mt-4 flex shrink-0 items-center justify-end gap-2 border-t border-line pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3.5 py-2 text-sm font-medium text-muted transition hover:bg-surface-sunk"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className="rounded-lg bg-clay px-3.5 py-2 text-sm font-medium text-white shadow-soft transition hover:bg-clay-dark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-clay"
        >
          {isNew ? 'Add connection' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
