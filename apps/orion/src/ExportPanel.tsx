import { useState } from 'react'
import type { Card } from '@orion/core'
import { buildCard, exportJson, exportPng } from '@orion/core'

type Props = {
  title: string
  setTitle: (value: string) => void
  card: Card
  onClose: () => void
}

/**
 * Export dialog: name the card, then bake the six sections into a Character Card
 * V2 — as raw JSON, or embedded into an uploaded avatar PNG (tEXt "chara").
 */
export default function ExportPanel({ title, setTitle, card, onClose }: Props) {
  const [avatar, setAvatar] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // No openers → first_mes will be empty; warn but don't block.
  const noOpeners = card.opening_messages.length === 0

  function handleExportJson() {
    setError(null)
    try {
      exportJson(buildCard(title, card))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleExportPng() {
    if (!avatar) return
    setError(null)
    setBusy(true)
    try {
      await exportPng(buildCard(title, card), avatar)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 dark:bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-raised"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Export card</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-muted transition hover:bg-surface-sunk"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Card Title
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled"
              className="rounded-lg border border-line bg-paper px-3 py-1.5 text-sm text-ink placeholder:text-faint transition focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/15"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Avatar PNG
            <input
              type="file"
              accept="image/png"
              onChange={(e) => setAvatar(e.target.files?.[0] ?? null)}
              className="text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface-sunk file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink file:transition hover:file:bg-clay-soft"
            />
          </label>

          {noOpeners && (
            <p className="rounded-lg bg-clay-soft/60 px-3.5 py-2.5 text-xs leading-relaxed text-clay-dark ring-1 ring-clay/20">
              No opening messages yet — the exported card's first message will be empty. Add at
              least one opener in the card panel for a usable greeting.
            </p>
          )}

          <div className="mt-1 flex items-center gap-3">
            <button
              type="button"
              onClick={handleExportJson}
              className="rounded-lg border border-line bg-paper px-3.5 py-2 text-sm font-medium text-ink shadow-soft transition hover:bg-surface-sunk active:scale-[0.98]"
            >
              Export JSON
            </button>

            <button
              type="button"
              onClick={handleExportPng}
              disabled={!avatar || busy}
              title={avatar ? '' : 'Upload an avatar PNG to enable'}
              className="rounded-lg bg-clay px-3.5 py-2 text-sm font-medium text-white shadow-soft transition hover:bg-clay-dark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-clay"
            >
              {busy ? 'Baking…' : 'Export Card PNG'}
            </button>
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50/70 px-3.5 py-2.5 text-sm text-red-800 ring-1 ring-red-200/70 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900/50">
            Export error: {error}
          </p>
        )}
      </div>
    </div>
  )
}
