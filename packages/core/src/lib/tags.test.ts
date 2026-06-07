import { describe, expect, it } from 'vitest'
import { parseTagBlock } from './tags'

describe('parseTagBlock', () => {
  it('parses the example into 3 weighted tags and strips the block', () => {
    const r = parseTagBlock('[(elias:0.8), netori, (masterpiece:1.2)] make her colder and guarded')
    expect(r.hadBlock).toBe(true)
    expect(r.cleaned).toBe('make her colder and guarded')
    expect(r.tags).toEqual([
      { tag: 'elias', weight: 0.8 },
      { tag: 'netori', weight: 1.0 },
      { tag: 'masterpiece', weight: 1.2 },
    ])
  })

  it('defaults barewords to weight 1.0 and lowercases tags', () => {
    const r = parseTagBlock('[Elias, NETORI] hi')
    expect(r.tags).toEqual([
      { tag: 'elias', weight: 1.0 },
      { tag: 'netori', weight: 1.0 },
    ])
  })

  it('clamps out-of-range weights to 0.1..2.0', () => {
    const r = parseTagBlock('[(a:5), (b:0), (c:-3)]')
    expect(r.tags).toEqual([
      { tag: 'a', weight: 2.0 },
      { tag: 'b', weight: 0.1 },
      { tag: 'c', weight: 0.1 },
    ])
  })

  it('falls back to 1.0 for missing/garbage weights inside (tag:weight)', () => {
    const r = parseTagBlock('[(a:), (b:abc)] x')
    expect(r.tags).toEqual([
      { tag: 'a', weight: 1.0 },
      { tag: 'b', weight: 1.0 },
    ])
  })

  it('returns no block when there is no bracket', () => {
    const r = parseTagBlock('make her colder')
    expect(r).toEqual({ tags: [], cleaned: 'make her colder', hadBlock: false })
  })

  it('does not crash or eat the message on an unmatched bracket', () => {
    const r = parseTagBlock('make her [colder and guarded')
    expect(r.hadBlock).toBe(false)
    expect(r.cleaned).toBe('make her [colder and guarded')
    expect(r.tags).toEqual([])
  })

  it('treats prose-in-brackets as NOT a tag block', () => {
    const r = parseTagBlock('[note to self] do the thing')
    expect(r.hadBlock).toBe(false)
    expect(r.cleaned).toBe('[note to self] do the thing')
  })

  it('rejects the whole block if any entry is invalid', () => {
    const r = parseTagBlock('[elias, not valid, netori] x')
    expect(r.hadBlock).toBe(false)
  })

  it('treats an empty block as no block', () => {
    const r = parseTagBlock('[] hello')
    expect(r.hadBlock).toBe(false)
    expect(r.cleaned).toBe('[] hello')
  })

  it('strips an embedded block and tidies whitespace', () => {
    const r = parseTagBlock('make her [(elias:0.8)] colder')
    expect(r.hadBlock).toBe(true)
    expect(r.cleaned).toBe('make her colder')
  })

  it('does not touch {{char}} / {{user}} macros', () => {
    const r = parseTagBlock('{{char}} greets {{user}} warmly')
    expect(r.hadBlock).toBe(false)
    expect(r.cleaned).toBe('{{char}} greets {{user}} warmly')
  })

  it('dedupes a repeated tag keeping the max weight', () => {
    const r = parseTagBlock('[(elias:0.5), (elias:1.5)] x')
    expect(r.tags).toEqual([{ tag: 'elias', weight: 1.5 }])
  })

  it('only strips the first valid block', () => {
    const r = parseTagBlock('[elias] keep [this] literal')
    expect(r.hadBlock).toBe(true)
    expect(r.tags).toEqual([{ tag: 'elias', weight: 1.0 }])
    expect(r.cleaned).toBe('keep [this] literal')
  })

  it('handles a block with only whitespace as no block', () => {
    const r = parseTagBlock('[   ] hi')
    expect(r.hadBlock).toBe(false)
  })
})
