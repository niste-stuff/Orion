import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import type { ChatMessage } from '@orion/core'
import type { ActiveReview } from './useCoach'
import { HEURISTICS, type CoachFlag } from '@orion/core'

type Props = {
  messages: ChatMessage[]
  loading: boolean
  error: string | null
  onSend: (text: string) => void
  onDeleteMessage: (index: number) => void
  onDismissError: () => void
  review: ActiveReview | null
  reviewing: boolean
  reviewError: string | null
  onFixFlag: (flag: CoachFlag) => void
  onDismissReview: () => void
  onRegenerate?: () => void
}

/**
 * The central conversational surface. User messages sit right in a soft accent
 * tint; assistant replies sit left, airy and bubble-less. The input is a
 * rounded, gently elevated bar — Enter sends, Shift+Enter inserts a newline.
 */
export default function ChatPanel({
  messages,
  loading,
  error,
  onSend,
  onDeleteMessage,
  onDismissError,
  review,
  reviewing,
  reviewError,
  onFixFlag,
  onDismissReview,
  onRegenerate,
}: Props) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to the newest message / indicator / coach output.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, reviewing, review, reviewError])

  function submit() {
    const text = input.trim()
    if (!text || loading) return
    onSend(text)
    setInput('')
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    submit()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto flex max-w-2xl flex-col gap-6">
          {messages.length === 0 && !loading && (
            <div className="py-20 text-center">
              <p className="text-lg font-medium text-ink">Let's build a card.</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Describe a character, a setting, an opening line — Orion shapes the
                personality, scenario, first message, and lorebook as you talk.
              </p>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="group flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => onDeleteMessage(i)}
                  title="Delete this message and everything after it, reverting card changes"
                  aria-label="Delete this message and everything after it"
                  className="shrink-0 rounded-md px-1.5 py-1 text-sm text-faint opacity-0 transition hover:bg-clay-soft hover:text-clay-dark focus:opacity-100 group-hover:opacity-100"
                >
                  <span aria-hidden>🗑</span>
                </button>
                <div className="max-w-[82%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-clay-soft px-4 py-2.5 text-[15px] leading-relaxed text-ink">
                  {m.content}
                </div>
              </div>
            ) : (
              // Assistant replies stay airy — no heavy bubble.
              <div key={i} className="group flex items-start justify-start gap-2">
                <div className="max-w-[82%] whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
                  {m.content}
                </div>
                {i === messages.length - 1 && onRegenerate && !loading && (
                  <button
                    type="button"
                    onClick={onRegenerate}
                    title="Regenerate last response"
                    aria-label="Regenerate last response"
                    className="shrink-0 rounded-md px-1.5 py-1 text-sm text-faint opacity-0 transition hover:bg-clay-soft hover:text-clay-dark focus:opacity-100 group-hover:opacity-100"
                  >
                    <span aria-hidden>🔄</span>
                  </button>
                )}
              </div>
            ),
          )}

          {loading && (
            <div className="flex justify-start">
              <div className="w-full max-w-[85%]">
                <AgenticThoughts lastUserMessage={messages.filter((m) => m.role === 'user').slice(-1)[0]?.content || ''} />
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start justify-between gap-3 rounded-xl bg-red-50/70 px-4 py-3 text-sm leading-relaxed text-red-800 ring-1 ring-red-200/70 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900/50">
              <span>Error: {error}</span>
              <button
                type="button"
                onClick={onDismissError}
                className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-red-700 transition hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/40"
              >
                Dismiss
              </button>
            </div>
          )}

          {reviewing && (
            <div className="flex items-center gap-1.5 text-[15px] leading-relaxed text-faint">
              <span className="thinking-dot">●</span>
              <span className="thinking-dot" style={{ animationDelay: '0.18s' }}>●</span>
              <span className="thinking-dot" style={{ animationDelay: '0.36s' }}>●</span>
              <span className="ml-1">reviewing…</span>
            </div>
          )}

          {reviewError && !reviewing && (
            <div className="flex items-start justify-between gap-3 rounded-xl bg-surface px-4 py-3 text-sm leading-relaxed text-muted ring-1 ring-line">
              <span>{reviewError}</span>
              <button
                type="button"
                onClick={onDismissReview}
                className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-muted transition hover:bg-surface-sunk"
              >
                Dismiss
              </button>
            </div>
          )}

          {review && !reviewing && (
            <CoachCard review={review} onFixFlag={onFixFlag} onDismiss={onDismissReview} />
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input bar */}
      <div className="px-6 pb-6 pt-2">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl border border-line bg-surface px-3 py-2.5 shadow-raised transition focus-within:border-clay/40 focus-within:ring-2 focus-within:ring-clay/10"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Describe your character, or ask Orion anything…"
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-ink placeholder:text-faint focus:outline-none"
          />
          {onRegenerate && messages.some(m => m.role === 'user') && !loading && (
            <button
              type="button"
              onClick={onRegenerate}
              title="Regenerate last response"
              className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium text-ink transition hover:bg-surface-sunk active:scale-[0.98] shrink-0"
            >
              🔄
            </button>
          )}
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="rounded-xl bg-clay px-4 py-2 text-sm font-medium text-white shadow-soft transition hover:bg-clay-dark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-clay"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  )
}

type CoachCardProps = {
  review: ActiveReview
  onFixFlag: (flag: CoachFlag) => void
  onDismiss: () => void
}

/**
 * The coach's findings, rendered as a soft card in the chat column. Empty flags
 * means the block passed the checklist — show a brief confirmation, not an empty
 * list. Each flag offers an optional "Fix this" that routes back through the
 * authoring engine.
 */
function CoachCard({ review, onFixFlag, onDismiss }: CoachCardProps) {
  const label = HEURISTICS[review.section].label
  const solid = review.flags.length === 0

  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5 shadow-soft">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-clay-dark">
          <span aria-hidden>✦</span>
          Coach · {label}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md px-2 py-0.5 text-xs font-medium text-muted transition hover:bg-surface-sunk"
        >
          Dismiss
        </button>
      </div>

      {solid ? (
        <p className="mt-2 text-sm leading-relaxed text-ink">
          Looks solid — no issues against the {label.toLowerCase()} checklist.
        </p>
      ) : (
        <ul className="mt-2.5 flex flex-col gap-2.5">
          {review.flags.map((flag, i) => (
            <li key={i} className="rounded-lg bg-paper px-3.5 py-2.5 ring-1 ring-line">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{flag.issue}</p>
                  {flag.why && (
                    <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{flag.why}</p>
                  )}
                  {flag.suggestion && (
                    <p className="mt-1 text-[13px] leading-relaxed text-faint">
                      → {flag.suggestion}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onFixFlag(flag)}
                  className="shrink-0 rounded-md bg-clay px-2.5 py-1 text-xs font-medium text-white shadow-soft transition hover:bg-clay-dark active:scale-[0.98]"
                >
                  Fix this
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type Step = {
  type: 'info' | 'draft'
  text: string
}

function AgenticThoughts({ lastUserMessage }: { lastUserMessage: string }) {
  const [expanded, setExpanded] = useState(true)
  const [visibleSteps, setVisibleSteps] = useState<number>(0)

  const steps: Step[] = [
    { type: 'info', text: 'Reading your message and the conversation so far.' },
    { type: 'info', text: `Analyzing requirements for ${getPromptSummary(lastUserMessage)}.` },
    { type: 'info', text: 'Drafting the personality, scenario, dialogue examples, storefront, and opening messages.' },
    { type: 'info', text: 'Reviewing the draft against the whole card.' },
    { type: 'draft', text: 'Draft 1: Personality section token density checks — revising the layout.' },
    { type: 'info', text: 'Reviewing the draft against the whole card.' },
    { type: 'draft', text: 'Draft 2: Dialogue examples use {{user}}/{{char}} placeholders correctly — updating delimiters.' },
    { type: 'info', text: 'Reviewing the draft against the whole card.' },
    { type: 'draft', text: 'Refined 3 drafts; keeping the one with the fewest remaining issues.' },
    { type: 'info', text: 'Waiting for LLM generation to complete (high-token payload under assembly)...' }
  ]

  function getPromptSummary(msg: string): string {
    const clean = msg.replace(/\[[\s\S]*?\]/g, '').trim() // Strip tag blocks for summary
    if (!clean) return 'character updates'
    if (clean.length < 45) return `"${clean}"`
    return `"${clean.slice(0, 45)}..."`
  }

  useEffect(() => {
    setVisibleSteps(1)
    
    // Sequence the steps over time to simulate progress
    const timers: number[] = []
    
    const scheduleStep = (index: number, delay: number) => {
      const timer = window.setTimeout(() => {
        setVisibleSteps(index + 1)
      }, delay)
      timers.push(timer)
    }

    // Ticking delays
    scheduleStep(1, 1200)
    scheduleStep(2, 3200)
    scheduleStep(3, 5200)
    scheduleStep(4, 7500)
    scheduleStep(5, 9500)
    scheduleStep(6, 11800)
    scheduleStep(7, 13800)
    scheduleStep(8, 16000)
    scheduleStep(9, 18000)

    return () => {
      timers.forEach(clearTimeout)
    }
  }, [])

  return (
    <div className="rounded-xl border border-line bg-surface-sunk/60 dark:bg-surface-sunk/20 shadow-soft transition-all duration-300">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left focus:outline-none"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-clay-dark dark:text-clay-soft">
          <span className="inline-block animate-pulse">✦</span>
          Refining — Kept the Strongest Draft
        </span>
        <span className="text-muted text-xs select-none">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-line px-4 pb-4 pt-3">
          <ul className="flex flex-col gap-2.5">
            {steps.slice(0, visibleSteps).map((step, idx) => {
              const isLast = idx === visibleSteps - 1
              return (
                <li
                  key={idx}
                  className={`flex items-start gap-2.5 text-[13.5px] leading-relaxed transition-opacity duration-300 ${
                    isLast ? 'text-ink font-medium' : 'text-muted'
                  }`}
                >
                  <span className="shrink-0 mt-0.5 text-sm font-mono">
                    {step.type === 'draft' ? (
                      <span className={`${isLast ? 'text-clay animate-spin inline-block' : 'text-clay-soft'}`}>↺</span>
                    ) : (
                      <span className="text-faint">·</span>
                    )}
                  </span>
                  <div className="flex-1">
                    {step.text}
                    {isLast && (
                      <span className="inline-flex ml-1.5 items-center gap-0.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-clay animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="h-1.5 w-1.5 rounded-full bg-clay animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="h-1.5 w-1.5 rounded-full bg-clay animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

