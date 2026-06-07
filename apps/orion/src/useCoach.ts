import { useCallback, useRef, useState } from 'react'
import type { ReviewableSection, Settings } from '@orion/core'
import { chatCompletion } from '@orion/core'
import {
  buildReviewRequest,
  HEURISTICS,
  parseCoachReview,
  type CoachFlag,
} from '@orion/core'

type Args = {
  settings: Settings
  /** Current text of each reviewable section (lorebook = its text). */
  sections: Record<ReviewableSection, string>
}

/** A completed review, scoped to one section. `flags` empty means "looks solid". */
export type ActiveReview = {
  section: ReviewableSection
  flags: CoachFlag[]
}

/**
 * The quality coach engine. On demand, makes ONE separate non-streaming call to
 * the active LLM connection asking it to evaluate a single section against that
 * section's heuristic checklist. It NEVER writes to a section — findings are
 * kept in ephemeral component state and surfaced in the chat. Parse/network
 * failures degrade gracefully: the review is abandoned and nothing changes.
 */
export function useCoach({ settings, sections }: Args) {
  const [review, setReview] = useState<ActiveReview | null>(null)
  const [reviewingSection, setReviewingSection] = useState<ReviewableSection | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)

  // Read the freshest settings/sections at review time without re-creating runReview.
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const sectionsRef = useRef(sections)
  sectionsRef.current = sections

  const runReview = useCallback(async (section: ReviewableSection) => {
    if (reviewingSection) return

    const content = sectionsRef.current[section] ?? ''
    setReviewError(null)
    setReview(null)

    // Nothing to review yet — skip the call and say so, rather than burning a
    // request on an empty section.
    if (!content.trim()) {
      setReviewError(`The ${HEURISTICS[section].label} section is empty — add something to review.`)
      return
    }

    setReviewingSection(section)
    try {
      const request = buildReviewRequest(section, content)
      const raw = await chatCompletion(settingsRef.current, request)
      const parsed = parseCoachReview(raw)
      if (!parsed) {
        setReviewError("Couldn't complete the review — the response wasn't understood. Nothing was changed.")
        return
      }
      setReview({ section, flags: parsed.flags })
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      setReviewError(`Couldn't complete the review: ${detail}. Nothing was changed.`)
    } finally {
      setReviewingSection(null)
    }
  }, [reviewingSection])

  const clearReview = useCallback(() => {
    setReview(null)
    setReviewError(null)
  }, [])

  return { review, reviewingSection, reviewError, runReview, clearReview }
}
