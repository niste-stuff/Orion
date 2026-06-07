// Minimal type declarations for the PNG chunk libraries (they ship no types).

type PngChunk = { name: string; data: Uint8Array }

declare module 'png-chunks-extract' {
  export default function extract(data: Uint8Array): PngChunk[]
}

declare module 'png-chunks-encode' {
  export default function encode(chunks: PngChunk[]): Uint8Array
}

declare module 'png-chunk-text' {
  export function encode(keyword: string, content: string): PngChunk
  export function decode(data: Uint8Array): { keyword: string; text: string }
}
