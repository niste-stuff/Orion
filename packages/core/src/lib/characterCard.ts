/// <reference path="../png-libs.d.ts" />
import type { Card } from '../types'
import extract from 'png-chunks-extract'
import encode from 'png-chunks-encode'
import text from 'png-chunk-text'

/**
 * Which chara_card_v2 field the storefront (public marketing copy) bakes into.
 * Set to null to omit the storefront from the exported V2 entirely.
 */
export const STOREFRONT_EXPORT_TARGET: 'creator_notes' | null = 'creator_notes'

type CharacterBookEntry = {
  keys: string[]
  content: string
  enabled: boolean
  insertion_order: number
  constant: boolean
}

type CharacterBook = {
  entries: CharacterBookEntry[]
  name: string
}

type CardData = {
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
  creator_notes: string
  system_prompt: string
  post_history_instructions: string
  alternate_greetings: string[]
  tags: string[]
  creator: string
  character_version: string
  extensions: Record<string, unknown>
  character_book?: CharacterBook
}

export type CharacterCardV2 = {
  spec: 'chara_card_v2'
  spec_version: '2.0'
  data: CardData
}

/**
 * Build a Character Card V2 object from the title and the six card sections.
 *
 * Mapping:
 *  - personality        → personality (and description)
 *  - scenario           → scenario
 *  - dialogue_examples  → mes_example
 *  - opening_messages[0]→ first_mes (a slot, no special weight); [1..] → alternate_greetings
 *  - storefront         → STOREFRONT_EXPORT_TARGET (creator_notes, or omitted if null)
 *  - lorebook           → a single always-active character_book entry, ONLY when
 *                         enabled and non-empty
 *
 * With zero openers, first_mes is "" and alternate_greetings is [] — callers
 * should warn the author before exporting (see ExportPanel).
 */
export function buildCard(title: string, card: Card): CharacterCardV2 {
  const name = title.trim() || 'Untitled'

  const openers = card.opening_messages
  const firstMes = openers[0] ?? ''
  const alternateGreetings = openers.slice(1)

  const data: CardData = {
    name,
    description: card.personality,
    personality: card.personality,
    scenario: card.scenario,
    first_mes: firstMes,
    mes_example: card.dialogue_examples,
    creator_notes: STOREFRONT_EXPORT_TARGET === 'creator_notes' ? card.storefront : '',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: alternateGreetings,
    tags: [],
    creator: '',
    character_version: '1.0',
    extensions: {},
  }

  // Lorebook bakes in only when it's enabled AND has content.
  if (card.lorebook.enabled && card.lorebook.text.trim() !== '') {
    data.character_book = {
      entries: [
        {
          keys: [],
          content: card.lorebook.text,
          enabled: true,
          insertion_order: 0,
          constant: true,
        },
      ],
      name,
    }
  }

  return { spec: 'chara_card_v2', spec_version: '2.0', data }
}

/** Make a filesystem-friendly file name from the card title. */
export function safeFileName(title: string): string {
  const cleaned = title.trim().replace(/[^a-z0-9_\- ]/gi, '').trim()
  return cleaned || 'card'
}

/** Trigger a browser download for a Blob. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** UTF-8 safe base64 encoding (btoa alone breaks on non-Latin1 characters). */
function toBase64Utf8(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/** Export the card as a downloadable .json file. */
export function exportJson(card: CharacterCardV2): void {
  const json = JSON.stringify(card, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  downloadBlob(blob, `${safeFileName(card.data.name)}.json`)
}

/**
 * Bake the card JSON into the uploaded PNG as a tEXt chunk with keyword
 * "chara" and a base64-encoded value, then download the result. This is the
 * format Janitor AI / SillyTavern / Chub import.
 */
export async function exportPng(card: CharacterCardV2, avatar: File): Promise<void> {
  const buffer = new Uint8Array(await avatar.arrayBuffer())
  const chunks = extract(buffer)

  // Drop any pre-existing "chara" tEXt chunk so we don't end up with duplicates.
  const cleaned = chunks.filter((chunk) => {
    if (chunk.name !== 'tEXt') return true
    return text.decode(chunk.data).keyword !== 'chara'
  })

  const base64 = toBase64Utf8(JSON.stringify(card))
  const charaChunk = text.encode('chara', base64)

  // Insert the chunk just before IEND (the trailing end-of-file chunk).
  const iendIndex = cleaned.findIndex((chunk) => chunk.name === 'IEND')
  if (iendIndex === -1) {
    throw new Error('Invalid PNG: no IEND chunk found.')
  }
  cleaned.splice(iendIndex, 0, charaChunk)

  const encoded = encode(cleaned)
  // Copy into a fresh ArrayBuffer-backed array so it's a valid BlobPart.
  const bytes = new Uint8Array(encoded.length)
  bytes.set(encoded)
  const blob = new Blob([bytes], { type: 'image/png' })
  downloadBlob(blob, `${safeFileName(card.data.name)}.png`)
}
