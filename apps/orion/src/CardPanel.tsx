import type { Card, Lorebook, LorebookEntry, ReviewableSection, ScalarSection } from '@orion/core'
import { MAX_OPENING_MESSAGES } from '@orion/core'
import { useHoverExpand } from './useHoverExpand'

type Props = {
  card: Card
  setSection: (section: ScalarSection, value: string) => void
  setOpeningMessages: (list: string[]) => void
  setLorebook: (lorebook: Lorebook) => void
  saveStatus: 'idle' | 'saving' | 'saved'
  onReviewSection: (section: ReviewableSection) => void
  reviewingSection: ReviewableSection | null
  /** Report which section's editor has focus (drives section-aware retrieval). */
  onActiveSection: (section: string) => void
}

const textareaClass =
  'w-full resize-y rounded-xl border border-line bg-paper px-3.5 py-3 font-mono text-[13.5px] leading-relaxed text-ink shadow-soft transition placeholder:text-faint focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/15'

const SCALAR_FIELDS: {
  id: ScalarSection
  label: string
  placeholder: string
  note?: string
  rows: number
}[] = [
  { id: 'personality', label: 'Personality', placeholder: 'Who they are, how they speak, what drives them…', rows: 6 },
  { id: 'scenario', label: 'Scenario', placeholder: 'The setting and situation the chat opens in…', rows: 4 },
  { id: 'dialogue_examples', label: 'Dialogue examples', placeholder: 'Example lines that show the character\'s voice…', rows: 5 },
  {
    id: 'storefront',
    label: 'Storefront',
    placeholder: 'Marketing hook for the public listing — what makes someone want to click…',
    note: 'Public listing — not seen by the model.',
    rows: 4,
  },
]

/**
 * The right-hand card panel: the six card sections as the editing safety net.
 * Manual edits flow straight through the same debounced local-save path Orion
 * uses. Storefront is labeled as public (not model-facing); opening messages are
 * an equal, ordered list (no "first message" special-casing); the lorebook is a
 * default-off toggle.
 *
 * Like the left rail it rests MINIMIZED to a slim gutter and expands on
 * hover-intent / pin / inner focus.
 */
export default function CardPanel({
  card,
  setSection,
  setOpeningMessages,
  setLorebook,
  saveStatus,
  onReviewSection,
  reviewingSection,
  onActiveSection,
}: Props) {
  const { open, pinned, togglePin, containerProps } = useHoverExpand({
    openDelay: 0,
    closeDelay: 160,
  })

  return (
    <aside
      {...containerProps}
      aria-label="Card panel"
      className="relative z-20 flex h-full shrink-0 overflow-hidden border-l border-line bg-surface shadow-soft transition-[width] duration-200 ease-out motion-reduce:transition-none"
      style={{ width: open ? 420 : 56 }}
    >
      <div className="flex h-full w-[420px]">
        {/* Gutter rail — always visible, even when collapsed. */}
        <div className="flex w-14 shrink-0 flex-col items-center gap-4 border-r border-line py-4">
          <button
            type="button"
            onClick={togglePin}
            aria-pressed={pinned}
            title={pinned ? 'Unpin card panel' : 'Pin card panel open'}
            className={
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm transition hover:bg-surface-sunk ' +
              (pinned ? 'text-clay' : 'text-muted')
            }
          >
            <span aria-hidden>{pinned ? '◉' : '◎'}</span>
          </button>
          <span aria-hidden className="text-base text-muted">▤</span>
          <span
            className="text-[11px] font-semibold uppercase tracking-widest text-faint"
            style={{ writingMode: 'vertical-rl' }}
          >
            Card
          </span>
          {saveStatus === 'saving' && (
            <span className="mt-auto h-2 w-2 rounded-full bg-clay/60" title="Saving…" />
          )}
        </div>

        {/* Editing column — clipped when collapsed. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-sm font-semibold text-ink">Card</h2>
            <span className="text-xs text-faint transition-opacity">
              {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : ''}
            </span>
          </div>

          <div
            className="flex-1 space-y-6 overflow-y-auto px-5 py-5"
            onFocusCapture={(e) => {
              const section = (e.target as HTMLElement).dataset.section
              if (section) onActiveSection(section)
            }}
          >
            {/* Context Budget Dashboard */}
            <ContextBudgetDashboard card={card} />

            {/* Personality / Scenario / Dialogue examples / Storefront */}
            {SCALAR_FIELDS.map(({ id, label, placeholder, note, rows }) => (
              <label key={id} className="flex flex-col gap-2">
                <SectionHeader
                  label={label}
                  reviewing={reviewingSection === id}
                  reviewDisabled={reviewingSection !== null}
                  onReview={() => onReviewSection(id)}
                />
                {note && <span className="-mt-1 text-[11px] italic text-faint">{note}</span>}
                <textarea
                  value={card[id]}
                  onChange={(e) => setSection(id, e.target.value)}
                  placeholder={placeholder}
                  rows={rows}
                  data-section={id}
                  className={textareaClass}
                />
              </label>
            ))}

            {/* Opening messages — an equal, ordered list. */}
            <OpeningMessages
              openers={card.opening_messages}
              onChange={setOpeningMessages}
            />

            {/* Lorebook — optional, default off. */}
            <LorebookSection
              lorebook={card.lorebook}
              onChange={setLorebook}
              reviewing={reviewingSection === 'lorebook'}
              reviewDisabled={reviewingSection !== null}
              onReview={() => onReviewSection('lorebook')}
            />
          </div>
        </div>
      </div>
    </aside>
  )
}

type SectionHeaderProps = {
  label: string
  reviewing: boolean
  reviewDisabled: boolean
  onReview: () => void
}

function SectionHeader({ label, reviewing, reviewDisabled, onReview }: SectionHeaderProps) {
  return (
    <span className="flex items-center justify-between">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <button
        type="button"
        onClick={onReview}
        disabled={reviewDisabled}
        title={`Review the ${label.toLowerCase()} against quality heuristics`}
        className="rounded-md px-2 py-0.5 text-[11px] font-medium text-clay-dark transition hover:bg-clay-soft disabled:cursor-not-allowed disabled:opacity-40"
      >
        {reviewing ? 'Reviewing…' : 'Review'}
      </button>
    </span>
  )
}

type OpeningMessagesProps = {
  openers: string[]
  onChange: (list: string[]) => void
}

function OpeningMessages({ openers, onChange }: OpeningMessagesProps) {
  const atCap = openers.length >= MAX_OPENING_MESSAGES

  function update(index: number, value: string) {
    onChange(openers.map((o, i) => (i === index ? value : o)))
  }
  function add() {
    if (atCap) return
    onChange([...openers, ''])
  }
  function remove(index: number) {
    onChange(openers.filter((_, i) => i !== index))
  }
  function move(index: number, delta: number) {
    const next = index + delta
    if (next < 0 || next >= openers.length) return
    const copy = [...openers]
    const [item] = copy.splice(index, 1)
    copy.splice(next, 0, item)
    onChange(copy)
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          Opening messages
        </span>
        <span className="text-[11px] font-medium text-faint">
          {openers.length}/{MAX_OPENING_MESSAGES}
        </span>
      </span>
      <span className="-mt-1 text-[11px] italic text-faint">
        All equal — each is an alternative opener for the same bot.
      </span>

      {openers.length === 0 && (
        <p className="rounded-lg border border-dashed border-line bg-paper px-3.5 py-3 text-xs text-faint">
          No openers yet. Add at least one — the first slot becomes the card's primary greeting.
        </p>
      )}

      {openers.map((opener, i) => (
        <div key={i} className="rounded-xl border border-line bg-paper p-2.5 shadow-soft">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted">#{i + 1}</span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                title="Move up"
                aria-label={`Move opener ${i + 1} up`}
                className="rounded px-1.5 py-0.5 text-xs text-muted transition hover:bg-surface-sunk disabled:cursor-not-allowed disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === openers.length - 1}
                title="Move down"
                aria-label={`Move opener ${i + 1} down`}
                className="rounded px-1.5 py-0.5 text-xs text-muted transition hover:bg-surface-sunk disabled:cursor-not-allowed disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => remove(i)}
                title="Remove this opener"
                aria-label={`Remove opener ${i + 1}`}
                className="rounded px-1.5 py-0.5 text-xs text-clay-dark transition hover:bg-clay-soft"
              >
                ✕
              </button>
            </div>
          </div>
          <textarea
            value={opener}
            onChange={(e) => update(i, e.target.value)}
            placeholder="An opening message in the character's voice…"
            rows={3}
            data-section="opening_messages"
            className={textareaClass}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        disabled={atCap}
        className="rounded-lg border border-line bg-paper px-3.5 py-2 text-sm font-medium text-ink shadow-soft transition hover:bg-surface-sunk active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {atCap ? `Max ${MAX_OPENING_MESSAGES} openers` : '+ Add opening message'}
      </button>
    </div>
  )
}

type LorebookSectionProps = {
  lorebook: Lorebook
  onChange: (lorebook: Lorebook) => void
  reviewing: boolean
  reviewDisabled: boolean
  onReview: () => void
}

function LorebookSection({ lorebook, onChange, reviewing, reviewDisabled, onReview }: LorebookSectionProps) {
  const entries = lorebook.entries || []

  function addEntry() {
    const newEntry: LorebookEntry = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
      keys: [],
      content: '',
      enabled: true,
      insertionOrder: 50,
    }
    onChange({ ...lorebook, entries: [...entries, newEntry] })
  }

  function updateEntry(id: string, updates: Partial<LorebookEntry>) {
    onChange({
      ...lorebook,
      entries: entries.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    })
  }

  function deleteEntry(id: string) {
    onChange({
      ...lorebook,
      entries: entries.filter((e) => e.id !== id),
    })
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Lorebook</span>
        <div className="flex items-center gap-2">
          {lorebook.enabled && (
            <button
              type="button"
              onClick={onReview}
              disabled={reviewDisabled}
              title="Review the lorebook against quality heuristics"
              className="rounded-md px-2 py-0.5 text-[11px] font-medium text-clay-dark transition hover:bg-clay-soft disabled:cursor-not-allowed disabled:opacity-40"
            >
              {reviewing ? 'Reviewing…' : 'Review'}
            </button>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={lorebook.enabled}
            onClick={() => onChange({ ...lorebook, enabled: !lorebook.enabled })}
            title={lorebook.enabled ? 'Disable lorebook' : 'Enable lorebook'}
            className={
              'relative h-5 w-9 shrink-0 rounded-full transition ' +
              (lorebook.enabled ? 'bg-clay' : 'bg-surface-sunk ring-1 ring-line')
            }
          >
            <span
              aria-hidden
              className={
                'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-soft transition-all ' +
                (lorebook.enabled ? 'left-[18px]' : 'left-0.5')
              }
            />
          </button>
        </div>
      </div>

      {lorebook.enabled ? (
        <div className="space-y-4">
          {entries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line bg-paper px-3.5 py-4 text-center text-xs text-faint">
              No entries defined yet. Keys trigger world facts in model context.
            </p>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => {
                const tokenEstimate = Math.ceil(entry.content.length / 4)
                return (
                  <div 
                    key={entry.id} 
                    className={`rounded-xl border border-line bg-paper p-3 shadow-soft space-y-2.5 transition-all duration-200 ${
                      entry.enabled ? 'border-line' : 'opacity-60 border-dashed bg-paper-sunk'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {/* Toggle enabled state */}
                        <button
                          type="button"
                          onClick={() => updateEntry(entry.id, { enabled: !entry.enabled })}
                          className={`h-4 w-4 rounded border flex items-center justify-center transition-all ${
                            entry.enabled 
                              ? 'bg-clay border-clay text-white' 
                              : 'border-line hover:border-clay'
                          }`}
                          title={entry.enabled ? 'Disable entry' : 'Enable entry'}
                        >
                          {entry.enabled && <span className="text-[10px]">✓</span>}
                        </button>
                        <span className="text-[10px] font-semibold text-faint uppercase">
                          Insertion Order
                        </span>
                        <input
                          type="number"
                          value={entry.insertionOrder}
                          onChange={(e) => updateEntry(entry.id, { insertionOrder: parseInt(e.target.value) || 50 })}
                          className="w-12 px-1 py-0.5 text-xs text-ink rounded bg-surface border border-line focus:outline-none focus:border-clay text-center font-mono"
                          title="Priority order for injection (lower runs earlier)"
                        />
                      </div>
                      
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-faint font-semibold">
                          ~{tokenEstimate} tokens
                        </span>
                        <button
                          type="button"
                          onClick={() => deleteEntry(entry.id)}
                          className="rounded p-1 text-xs text-clay-dark hover:bg-clay-soft transition"
                          title="Delete entry"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* Trigger Keys */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-muted uppercase tracking-wider block">
                        Trigger Keys (comma-separated)
                      </label>
                      <input
                        type="text"
                        value={entry.keys.join(', ')}
                        onChange={(e) => {
                          const keys = e.target.value
                            .split(',')
                            .map((k) => k.trim())
                            .filter(Boolean)
                          updateEntry(entry.id, { keys })
                        }}
                        placeholder="e.g. magic, academy, tower"
                        className="w-full px-2.5 py-1 text-xs text-ink rounded-lg bg-surface border border-line focus:outline-none focus:border-clay font-mono placeholder:text-faint"
                      />
                    </div>

                    {/* Content */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-muted uppercase tracking-wider block">
                        Content
                      </label>
                      <textarea
                        value={entry.content}
                        onChange={(e) => updateEntry(entry.id, { content: e.target.value })}
                        placeholder="World facts or lore about this subject..."
                        rows={3}
                        className={textareaClass}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <button
            type="button"
            onClick={addEntry}
            className="w-full rounded-lg border border-line bg-paper px-3.5 py-2 text-sm font-medium text-ink shadow-soft transition hover:bg-surface-sunk active:scale-[0.98]"
          >
            + Add Lorebook Entry
          </button>
        </div>
      ) : (
        <p className="text-[11px] italic text-faint">
          Off — excluded from the model context and from export. Toggle on to add key-triggered lorebook entries.
        </p>
      )}
    </div>
  )
}

function ContextBudgetDashboard({ card }: { card: Card }) {
  const coreWeightTokens = Math.ceil((card.personality.length + card.scenario.length) / 4)
  const permanentPayloadTokens = Math.ceil(card.opening_messages.reduce((sum, o) => sum + o.length, 0) / 4)
  
  const activeEntries = card.lorebook.enabled ? card.lorebook.entries.filter(e => e.enabled) : []
  const memoryOverheadTokens = Math.ceil(activeEntries.reduce((sum, e) => sum + e.content.length, 0) / 4)
  
  const totalTokens = coreWeightTokens + permanentPayloadTokens + memoryOverheadTokens
  const maxSafeTokens = 4000 // typical context limit/threshold for safe bot logic on Janitor AI

  // Percentage calculations
  const corePct = Math.min(100, (coreWeightTokens / maxSafeTokens) * 100)
  const permanentPct = Math.min(100, (permanentPayloadTokens / maxSafeTokens) * 100)
  const memoryPct = Math.min(100, (memoryOverheadTokens / maxSafeTokens) * 100)

  return (
    <div className="rounded-xl border border-line bg-paper-sunk p-4 space-y-3 shadow-soft transition-all duration-300 hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-clay animate-pulse" />
          Context Budget
        </span>
        <span className="text-xs font-medium text-ink">
          {totalTokens.toLocaleString()} tokens
        </span>
      </div>

      {/* Stacked progress bar */}
      <div className="h-2.5 w-full rounded-full bg-surface-sunk overflow-hidden flex">
        <div 
          className="h-full bg-clay transition-all duration-500 ease-out" 
          style={{ width: `${corePct}%` }}
          title={`Core Weight: ${coreWeightTokens} tokens`}
        />
        <div 
          className="h-full bg-emerald-500 transition-all duration-500 ease-out" 
          style={{ width: `${permanentPct}%` }}
          title={`Permanent Payload: ${permanentPayloadTokens} tokens`}
        />
        <div 
          className="h-full bg-indigo-500 transition-all duration-500 ease-out" 
          style={{ width: `${memoryPct}%` }}
          title={`Memory Overhead: ${memoryOverheadTokens} tokens`}
        />
      </div>

      {/* Grid of details */}
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-clay" />
            <span className="text-faint font-medium">Core Weight</span>
          </div>
          <p className="font-semibold text-ink">{coreWeightTokens} t</p>
          <span className={`text-[9px] font-medium leading-none ${coreWeightTokens > 1000 ? 'text-amber-500' : 'text-faint'}`}>
            {coreWeightTokens > 1000 ? 'Heavy (>1k)' : 'Optimal (<1k)'}
          </span>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="text-faint font-medium">Permanent</span>
          </div>
          <p className="font-semibold text-ink">{permanentPayloadTokens} t</p>
          <span className="text-[9px] text-faint font-medium leading-none">
            Opener memory
          </span>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
            <span className="text-faint font-medium">Memory Overh.</span>
          </div>
          <p className="font-semibold text-ink">{memoryOverheadTokens} t</p>
          <span className={`text-[9px] font-medium leading-none ${memoryOverheadTokens > 2000 ? 'text-rose-500 animate-pulse' : 'text-faint'}`}>
            {memoryOverheadTokens > 2000 ? 'Context Risk (>2k)' : 'Safe'}
          </span>
        </div>
      </div>
    </div>
  )
}
