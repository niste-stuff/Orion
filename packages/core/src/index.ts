// @orion/core — the product-agnostic Orion engine.
//
// Pure, UI-free logic shared across Orion (and future forks): domain types,
// the weighted tag-block parser, the authoring + coach prompt/parse logic,
// character-card bake/export, and the LLM transport contract. This package
// imports NOTHING from apps/ and no React/Tauri-UI; the only platform binding
// is the Tauri IPC client (@tauri-apps/api/core) used by the transport.

export * from './types'
export * from './lib/tags'
export * from './lib/orion'
export * from './lib/coach'
export * from './lib/characterCard'
export * from './api'
