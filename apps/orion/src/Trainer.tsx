import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

/**
 * The Trainer: the only in-app door for teaching Orion a style. The author adds
 * section-tagged example text to a named "set"; saving writes it to local files
 * (Rust save_sample_set). This is WRITE-ONLY — there is no browsing, retrieval,
 * or display of stored sample text anywhere. For existing sets the Trainer shows
 * nothing but name / slug / tags / sample count.
 *
 * Framing is always "training a style", never a database/store/library.
 */

const MAX_SAMPLES = 20

type TagType = 'creator' | 'genre' | 'quality' | 'trope'
const TAG_TYPES: TagType[] = ['creator', 'genre', 'quality', 'trope']

type SampleSection =
  | 'personality'
  | 'scenario'
  | 'dialogue_examples'
  | 'storefront'
  | 'opening_messages'
  | 'lorebook'
  | 'general'

const SECTIONS: { id: SampleSection; label: string }[] = [
  { id: 'personality', label: 'Personality' },
  { id: 'scenario', label: 'Scenario' },
  { id: 'dialogue_examples', label: 'Dialogue examples' },
  { id: 'storefront', label: 'Storefront' },
  { id: 'opening_messages', label: 'Opening message' },
  { id: 'lorebook', label: 'Lorebook' },
  { id: 'general', label: 'General' },
]

type Tag = { tag: string; type: TagType }
type SampleEntry = { section: SampleSection; text: string }

/** Metadata only — never sample text. Mirrors the Rust SampleSetSummary. */
type SampleSetSummary = {
  id: string
  name: string
  slug: string
  tags: Tag[]
  sampleCount: number
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === 'string' ? err : String(err)
}

const fieldClass =
  'rounded-lg border border-line bg-paper px-3 py-1.5 text-sm text-ink placeholder:text-faint transition focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/15'

type Props = { onClose: () => void }

export default function Trainer({ onClose }: Props) {
  const [sets, setSets] = useState<SampleSetSummary[]>([])

  // Target: a brand-new set, or an existing set id to append to.
  const [target, setTarget] = useState<'new' | string>('new')
  const [name, setName] = useState('')

  // User-added tags (the slug is auto-included as a creator tag at save time).
  const [tags, setTags] = useState<Tag[]>([])
  const [draftTag, setDraftTag] = useState('')
  const [draftTagType, setDraftTagType] = useState<TagType>('genre')

  const [samples, setSamples] = useState<SampleEntry[]>([{ section: 'personality', text: '' }])

  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const refreshSets = useCallback(async () => {
    try {
      const list = await invoke<SampleSetSummary[]>('list_my_sample_sets')
      setSets(list)
    } catch (err) {
      setStatus({ kind: 'err', text: errMessage(err) })
    }
  }, [])

  useEffect(() => {
    void refreshSets()
  }, [refreshSets])

  const selected = useMemo(
    () => (target === 'new' ? null : sets.find((s) => s.id === target) ?? null),
    [target, sets],
  )

  // Slug + effective name come from the new-set name, or the existing set.
  const slug = selected ? selected.slug : slugify(name)
  const effectiveName = selected ? selected.name : name.trim()

  const existingCount = selected?.sampleCount ?? 0
  const remaining = Math.max(0, MAX_SAMPLES - existingCount)
  const total = existingCount + samples.length

  function resetForm() {
    setTarget('new')
    setName('')
    setTags([])
    setDraftTag('')
    setDraftTagType('genre')
    setSamples([{ section: 'personality', text: '' }])
  }

  function selectTarget(value: string) {
    setStatus(null)
    setTarget(value)
    setTags([])
    setDraftTag('')
    setSamples([{ section: 'personality', text: '' }])
  }

  function addTag() {
    const t = draftTag.trim().toLowerCase()
    if (!t) return
    if (tags.some((x) => x.tag === t && x.type === draftTagType)) {
      setDraftTag('')
      return
    }
    setTags((prev) => [...prev, { tag: t, type: draftTagType }])
    setDraftTag('')
  }

  function removeTag(index: number) {
    setTags((prev) => prev.filter((_, i) => i !== index))
  }

  function addSample() {
    if (samples.length >= remaining) return
    setSamples((prev) => [...prev, { section: 'general', text: '' }])
  }

  function updateSample(index: number, patch: Partial<SampleEntry>) {
    setSamples((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function removeSample(index: number) {
    setSamples((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)))
  }

  // Final tag list: the slug as a creator tag (auto), then existing + user tags,
  // de-duplicated by (tag,type).
  const finalTags = useMemo<Tag[]>(() => {
    const out: Tag[] = []
    const seen = new Set<string>()
    const push = (t: Tag) => {
      const key = `${t.tag}::${t.type}`
      if (t.tag && !seen.has(key)) {
        seen.add(key)
        out.push(t)
      }
    }
    if (slug) push({ tag: slug, type: 'creator' })
    if (selected) selected.tags.forEach(push)
    tags.forEach(push)
    return out
  }, [slug, selected, tags])

  const cleanedSamples = useMemo(
    () => samples.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text.length > 0),
    [samples],
  )

  const canSave =
    !saving &&
    !!effectiveName &&
    !!slug &&
    cleanedSamples.length > 0 &&
    existingCount + cleanedSamples.length <= MAX_SAMPLES

  async function save() {
    if (!canSave) return
    setSaving(true)
    setStatus(null)
    const now = new Date().toISOString()
    const set = {
      id: selected ? selected.id : crypto.randomUUID(),
      name: effectiveName,
      slug,
      createdAt: now,
      updatedAt: now,
      tags: finalTags,
      samples: cleanedSamples,
    }
    try {
      await invoke('save_sample_set', { set })
      await refreshSets()
      const verb = selected ? 'updated' : 'created'
      setStatus({
        kind: 'ok',
        text: `Style "${effectiveName}" ${verb} — ${cleanedSamples.length} example${
          cleanedSamples.length === 1 ? '' : 's'
        } added.`,
      })
      resetForm()
    } catch (err) {
      setStatus({ kind: 'err', text: errMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  async function openDataFolder() {
    try {
      await invoke('reveal_data_dir')
    } catch (err) {
      setStatus({ kind: 'err', text: errMessage(err) })
    }
  }

  async function rescan() {
    try {
      await invoke('rebuild_index')
      await refreshSets()
      setStatus({ kind: 'ok', text: 'Rescanned files.' })
    } catch (err) {
      setStatus({ kind: 'err', text: errMessage(err) })
    }
  }

  const full = !!selected && remaining === 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-6 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">Trainer</h2>
          <p className="truncate text-xs text-faint">
            Teach Orion a style by adding example sections. More examples make the style stronger.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm font-medium text-ink shadow-soft transition hover:bg-surface-sunk"
        >
          ← Back to chat
        </button>
      </div>

      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-6 py-5">
        <div className="flex flex-col gap-6">
          {/* Target: new vs existing */}
          <section className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-faint">Style</label>
            <select
              value={target}
              onChange={(e) => selectTarget(e.target.value)}
              className={fieldClass}
            >
              <option value="new">+ New style…</option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.sampleCount})
                </option>
              ))}
            </select>

            {target === 'new' ? (
              <label className="mt-1 flex flex-col gap-1.5 text-xs font-medium text-muted">
                Name
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Elias"
                  className={fieldClass}
                />
                {slug && (
                  <span className="text-[11px] font-normal text-faint">
                    Tagged as <span className="font-mono text-muted">{slug}</span>
                  </span>
                )}
              </label>
            ) : (
              selected && (
                <div className="mt-1 rounded-lg border border-line bg-surface-sunk/50 px-3.5 py-2.5 text-xs text-muted">
                  <div>
                    <span className="font-medium text-ink">{selected.name}</span>{' '}
                    <span className="font-mono text-faint">({selected.slug})</span>
                  </div>
                  <div className="mt-1">
                    {selected.sampleCount} example{selected.sampleCount === 1 ? '' : 's'} so far ·
                    adding appends to this style
                  </div>
                  {selected.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {selected.tags.map((t, i) => (
                        <span
                          key={`${t.tag}-${t.type}-${i}`}
                          className="rounded-full bg-paper px-2 py-0.5 text-[11px] text-muted ring-1 ring-line"
                        >
                          {t.tag}
                          <span className="text-faint"> · {t.type}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}
          </section>

          {/* Tags */}
          <section className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-faint">
              Tags <span className="font-normal normal-case text-faint">(optional)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={draftTag}
                onChange={(e) => setDraftTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTag()
                  }
                }}
                placeholder="add a tag…"
                className={fieldClass + ' flex-1'}
              />
              <select
                value={draftTagType}
                onChange={(e) => setDraftTagType(e.target.value as TagType)}
                className={fieldClass}
              >
                {TAG_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addTag}
                className="rounded-lg border border-line bg-paper px-3 py-1.5 text-sm font-medium text-ink shadow-soft transition hover:bg-surface-sunk"
              >
                Add
              </button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t, i) => (
                  <span
                    key={`${t.tag}-${t.type}-${i}`}
                    className="flex items-center gap-1 rounded-full bg-clay-soft/60 px-2.5 py-0.5 text-[11px] text-clay-dark ring-1 ring-clay/20"
                  >
                    {t.tag}
                    <span className="text-clay/70">· {t.type}</span>
                    <button
                      type="button"
                      onClick={() => removeTag(i)}
                      aria-label={`Remove tag ${t.tag}`}
                      className="ml-0.5 text-clay/60 transition hover:text-clay-dark"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Samples */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wide text-faint">
                Examples
              </label>
              <span className="text-xs text-faint">
                {total}/{MAX_SAMPLES}
                {selected ? ` · ${existingCount} saved` : ''}
              </span>
            </div>

            {full ? (
              <p className="rounded-lg bg-clay-soft/60 px-3.5 py-2.5 text-xs text-clay-dark ring-1 ring-clay/20">
                This style already has {MAX_SAMPLES} examples — the maximum. Create a new style to add more.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {samples.map((s, i) => (
                  <div key={i} className="rounded-xl border border-line bg-surface p-3 shadow-soft">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <select
                        value={s.section}
                        onChange={(e) => updateSample(i, { section: e.target.value as SampleSection })}
                        className={fieldClass}
                      >
                        {SECTIONS.map((sec) => (
                          <option key={sec.id} value={sec.id}>
                            {sec.label}
                          </option>
                        ))}
                      </select>
                      {samples.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeSample(i)}
                          aria-label="Remove example"
                          className="rounded-md px-2 py-1 text-xs text-muted transition hover:bg-surface-sunk hover:text-ink"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <textarea
                      value={s.text}
                      onChange={(e) => updateSample(i, { text: e.target.value })}
                      rows={4}
                      placeholder="Paste an example of this section in the style you're teaching…"
                      className="w-full resize-y rounded-lg border border-line bg-paper px-3 py-2 font-mono text-[13px] leading-relaxed text-ink placeholder:text-faint transition focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/15"
                    />
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addSample}
                  disabled={samples.length >= remaining}
                  className="self-start rounded-lg border border-dashed border-line px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-surface-sunk hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  + Add example
                </button>
              </div>
            )}
          </section>

          {status && (
            <p
              className={
                'rounded-lg px-3.5 py-2.5 text-sm ring-1 ' +
                (status.kind === 'ok'
                  ? 'bg-clay-soft/50 text-clay-dark ring-clay/20'
                  : 'bg-red-50/70 text-red-800 ring-red-200/70 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900/50')
              }
            >
              {status.text}
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openDataFolder}
                className="rounded-lg border border-line bg-paper px-3 py-1.5 text-xs font-medium text-muted shadow-soft transition hover:bg-surface-sunk hover:text-ink"
              >
                Open data folder
              </button>
              <button
                type="button"
                onClick={rescan}
                className="rounded-lg border border-line bg-paper px-3 py-1.5 text-xs font-medium text-muted shadow-soft transition hover:bg-surface-sunk hover:text-ink"
              >
                Rescan files
              </button>
            </div>
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              className="rounded-lg bg-clay px-4 py-2 text-sm font-medium text-white shadow-soft transition hover:bg-clay-dark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-clay"
            >
              {saving ? 'Saving…' : selected ? 'Add to style' : 'Create style'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
