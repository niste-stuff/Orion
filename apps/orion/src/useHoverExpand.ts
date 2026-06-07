import { useCallback, useEffect, useRef, useState } from 'react'
import type { FocusEvent } from 'react'

type Options = {
  /** Delay before expanding on hover, so a passing cursor doesn't flicker. */
  openDelay?: number
  /** Delay before collapsing after the cursor leaves. */
  closeDelay?: number
}

/**
 * Hover-intent expansion for a minimized rail. A panel is expanded when any of:
 * pinned (click-locked open — the touch + keyboard fallback), hover-intent
 * (cursor has dwelt past openDelay), or KEYBOARD focus inside it (so keyboard
 * users keep it open). Focus left behind by a mouse click does NOT hold it open.
 * Enter/leave are debounced so a cursor merely crossing the screen never snaps
 * panels open and shut.
 *
 * Spread `containerProps` onto the panel's root element.
 */
export function useHoverExpand({ openDelay = 180, closeDelay = 220 }: Options = {}) {
  const [pinned, setPinned] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [focused, setFocused] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  // Drop any pending open/close timer if the component unmounts.
  useEffect(() => clearTimer, [clearTimer])

  const onMouseEnter = useCallback(() => {
    clearTimer()
    timer.current = setTimeout(() => setHovering(true), openDelay)
  }, [clearTimer, openDelay])

  const onMouseLeave = useCallback(() => {
    clearTimer()
    timer.current = setTimeout(() => setHovering(false), closeDelay)
  }, [clearTimer, closeDelay])

  // Decide whether focus should hold the panel open. A mouse click leaves focus
  // on the button it hit; if that counted, the panel would stay open after the
  // cursor left (the reported bug). So:
  //  - text-entry fields (input/textarea/contenteditable) always hold it open —
  //    you're actively editing, e.g. the card textareas;
  //  - other elements (buttons) hold it open only under KEYBOARD focus
  //    (:focus-visible), so a mouse click never latches it open.
  const onFocus = useCallback((e: FocusEvent) => {
    const target = e.target as HTMLElement
    const tag = target.tagName
    const isTextEntry = tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
    let keyboard = false
    try {
      keyboard = target.matches(':focus-visible')
    } catch {
      keyboard = true
    }
    if (isTextEntry || keyboard) setFocused(true)
  }, [])

  // Only collapse when focus actually leaves the panel, not when it moves
  // between children.
  const onBlur = useCallback((e: FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
  }, [])

  const togglePin = useCallback(() => setPinned((p) => !p), [])

  const open = pinned || hovering || focused

  return {
    open,
    pinned,
    togglePin,
    containerProps: { onMouseEnter, onMouseLeave, onFocus, onBlur },
  }
}
