import { useState } from 'react'
import type { Settings } from '@orion/core'
import type { Theme } from './useTheme'
import type { CardSummary } from './useCard'
import { useHoverExpand } from './useHoverExpand'

type Props = {
  settings: Settings
  setApiKey: (v: string) => void
  setBaseUrl: (v: string) => void
  setModel: (v: string) => void
  activeLabel: string | null
  onOpenConnections: () => void
  showCard: boolean
  onToggleCard: () => void
  onExport: () => void
  theme: Theme
  onToggleTheme: () => void
  // Card library
  cards: CardSummary[]
  activeId: string | null
  title: string
  onSetTitle: (v: string) => void
  onNewCard: () => void
  onSwitchCard: (id: string) => void
  trainerActive: boolean
  onToggleTrainer: () => void
}

const fieldClass =
  'rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-faint transition focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/15'

const pinClass =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm transition hover:bg-surface-sunk'

/**
 * The left rail. At rest it sits MINIMIZED to a slim icon strip so the chat gets
 * maximum width; it expands on hover-intent (or when pinned, or when keyboard
 * focus lands inside). The aside animates its width; the collapsed and expanded
 * states render distinct content (a clean icon rail vs. the full panel) over a
 * uniform surface, so neither bleeds into the other. Holds the title, Export /
 * card toggle / Connections, a collapsible Settings section (the default
 * connection), and room for a card list.
 */
export default function Sidebar({
  settings,
  setApiKey,
  setBaseUrl,
  setModel,
  activeLabel,
  onOpenConnections,
  showCard,
  onToggleCard,
  onExport,
  theme,
  onToggleTheme,
  cards,
  activeId,
  title,
  onSetTitle,
  onNewCard,
  onSwitchCard,
  trainerActive,
  onToggleTrainer,
}: Props) {
  const isDark = theme === 'dark'
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Expand the instant the cursor arrives; keep a short close delay so brushing
  // past the edge doesn't snap it shut.
  const { open, pinned, togglePin, containerProps } = useHoverExpand({
    openDelay: 0,
    closeDelay: 160,
  })

  return (
    <aside
      {...containerProps}
      aria-label="Sidebar"
      className="relative z-20 flex h-full shrink-0 flex-col overflow-hidden border-r border-line bg-surface shadow-soft transition-[width] duration-200 ease-out motion-reduce:transition-none"
      style={{ width: open ? 240 : 56 }}
    >
      {open ? (
        <div className="flex h-full w-60 flex-col">
          {/* Header: pin toggle + title. */}
          <div className="flex items-center gap-2 px-3 py-4">
            <button
              type="button"
              onClick={togglePin}
              aria-pressed={pinned}
              title={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
              className={pinClass + (pinned ? ' text-clay' : ' text-muted')}
            >
              <span aria-hidden>{pinned ? '◉' : '◎'}</span>
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight text-ink">Orion</h1>
              <p className="truncate text-xs text-faint">Character card studio</p>
            </div>
          </div>

          <nav className="flex flex-col gap-1 px-3">
            <button
              type="button"
              onClick={onExport}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink transition hover:bg-surface-sunk"
            >
              <span aria-hidden className="w-4 shrink-0 text-center text-muted">↧</span>
              <span className="truncate">Export</span>
            </button>

            <button
              type="button"
              onClick={onToggleCard}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink transition hover:bg-surface-sunk"
            >
              <span aria-hidden className="w-4 shrink-0 text-center text-muted">▤</span>
              <span className="truncate">{showCard ? 'Hide Card' : 'Show Card'}</span>
            </button>

            <button
              type="button"
              onClick={onOpenConnections}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink transition hover:bg-surface-sunk"
            >
              <span aria-hidden className="w-4 shrink-0 text-center text-muted">⇄</span>
              <span className="flex min-w-0 flex-col items-start">
                <span className="truncate">Connections</span>
                <span className="truncate text-[11px] font-normal text-faint">
                  {activeLabel ?? 'Default (Settings)'}
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={onToggleTrainer}
              aria-pressed={trainerActive}
              className={
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ' +
                (trainerActive
                  ? 'bg-clay-soft/60 text-clay-dark'
                  : 'text-ink hover:bg-surface-sunk')
              }
            >
              <span aria-hidden className="w-4 shrink-0 text-center text-muted">✦</span>
              <span className="truncate">{trainerActive ? 'Back to chat' : 'Trainer'}</span>
            </button>

            <button
              type="button"
              onClick={onToggleTheme}
              aria-pressed={isDark}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink transition hover:bg-surface-sunk"
            >
              <span aria-hidden className="w-4 shrink-0 text-center text-muted">
                {isDark ? '☀' : '☾'}
              </span>
              <span className="truncate">{isDark ? 'Light mode' : 'Dark mode'}</span>
            </button>
          </nav>

          {/* Collapsible settings */}
          <div className="mt-2 px-3">
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-expanded={settingsOpen}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-ink transition hover:bg-surface-sunk"
            >
              <span className="flex items-center gap-2.5">
                <span aria-hidden className="w-4 shrink-0 text-center text-muted">⚙</span>
                <span className="truncate">Settings</span>
              </span>
              <span
                aria-hidden
                className={'text-xs text-faint transition-transform ' + (settingsOpen ? 'rotate-90' : '')}
              >
                ›
              </span>
            </button>

            {settingsOpen && (
              <div className="mt-1 flex flex-col gap-3 px-3 pb-2 pt-1">
                <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
                  API Key
                  <input
                    type="password"
                    value={settings.apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-…"
                    className={fieldClass}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
                  Base URL
                  <input
                    type="text"
                    value={settings.baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
                  Model ID
                  <input
                    type="text"
                    value={settings.model}
                    onChange={(e) => setModel(e.target.value)}
                    className={fieldClass}
                  />
                </label>
              </div>
            )}
          </div>

          {/* Card library: list, switch, rename the active one, add new. */}
          <div className="mt-3 flex min-h-0 flex-1 flex-col px-3">
            <div className="flex items-center justify-between px-2 pb-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">
                Cards
              </p>
              <button
                type="button"
                onClick={onNewCard}
                title="New card"
                aria-label="New card"
                className="flex h-6 w-6 items-center justify-center rounded-md text-base leading-none text-muted transition hover:bg-surface-sunk hover:text-ink"
              >
                <span aria-hidden>+</span>
              </button>
            </div>

            <div className="-mx-1 flex-1 overflow-y-auto px-1 pb-2">
              {cards.length === 0 ? (
                <p className="px-2 py-1 text-xs text-faint">No cards yet.</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {cards.map((c) =>
                    c.id === activeId ? (
                      <li key={c.id}>
                        <input
                          type="text"
                          value={title}
                          onChange={(e) => onSetTitle(e.target.value)}
                          placeholder="Untitled"
                          aria-label="Card title"
                          className="w-full rounded-lg border border-clay/40 bg-paper px-2.5 py-1.5 text-sm font-medium text-ink shadow-soft transition focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/15"
                        />
                      </li>
                    ) : (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => onSwitchCard(c.id)}
                          title={c.title || 'Untitled'}
                          className="block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm text-muted transition hover:bg-surface-sunk hover:text-ink"
                        >
                          {c.title || 'Untitled'}
                        </button>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Collapsed icon rail. Buttons fire their actions directly so touch
           users (no hover) can act without expanding; the pin locks it open. */
        <div className="flex h-full w-14 flex-col items-center gap-1 py-4">
          <button
            type="button"
            onClick={togglePin}
            aria-pressed={pinned}
            title={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
            className={pinClass + (pinned ? ' text-clay' : ' text-muted')}
          >
            <span aria-hidden>{pinned ? '◉' : '◎'}</span>
          </button>

          <div className="my-2 h-px w-6 bg-line" />

          <button
            type="button"
            onClick={onNewCard}
            title="New card"
            aria-label="New card"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-base text-muted transition hover:bg-surface-sunk"
          >
            <span aria-hidden>+</span>
          </button>
          <button
            type="button"
            onClick={onExport}
            title="Export"
            aria-label="Export"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface-sunk"
          >
            <span aria-hidden>↧</span>
          </button>
          <button
            type="button"
            onClick={onToggleCard}
            title={showCard ? 'Hide Card' : 'Show Card'}
            aria-label={showCard ? 'Hide Card' : 'Show Card'}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface-sunk"
          >
            <span aria-hidden>▤</span>
          </button>
          <button
            type="button"
            onClick={onOpenConnections}
            title="Connections"
            aria-label="Connections"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface-sunk"
          >
            <span aria-hidden>⇄</span>
          </button>
          <button
            type="button"
            onClick={onToggleTrainer}
            aria-pressed={trainerActive}
            title={trainerActive ? 'Back to chat' : 'Trainer'}
            aria-label={trainerActive ? 'Back to chat' : 'Trainer'}
            className={
              'flex h-9 w-9 items-center justify-center rounded-lg transition hover:bg-surface-sunk ' +
              (trainerActive ? 'text-clay' : 'text-muted')
            }
          >
            <span aria-hidden>✦</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!pinned) togglePin()
              setSettingsOpen(true)
            }}
            title="Settings"
            aria-label="Settings"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface-sunk"
          >
            <span aria-hidden>⚙</span>
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="mt-auto flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface-sunk"
          >
            <span aria-hidden>{isDark ? '☀' : '☾'}</span>
          </button>
        </div>
      )}
    </aside>
  )
}
