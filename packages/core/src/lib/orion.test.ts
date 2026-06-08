import { describe, expect, it } from 'vitest'
import { parseOrionResponse } from './orion'

describe('parseOrionResponse', () => {
  it('parses correct JSON block', () => {
    const raw = `{
      "reply": "Successfully updated personality.",
      "updates": {
        "personality": "Exhaustive description."
      }
    }`
    const res = parseOrionResponse(raw)
    expect(res).not.toBeNull()
    expect(res?.reply).toBe('Successfully updated personality.')
    expect(res?.updates.personality).toBe('Exhaustive description.')
  })

  it('tolerates markdown json block wrapper', () => {
    const raw = `\`\`\`json
{
  "reply": "Wrapper test",
  "updates": {
    "scenario": "Under the rain."
  }
}
\`\`\``
    const res = parseOrionResponse(raw)
    expect(res).not.toBeNull()
    expect(res?.reply).toBe('Wrapper test')
    expect(res?.updates.scenario).toBe('Under the rain.')
  })

  it('escapes literal control characters (newlines) inside values, preserving structure', () => {
    const raw = `{\n  "reply": "Done.",\n  "updates": {\n    "personality": "Tsukishiro Hana\\n\\n[Mind/Psychology]\\n- Reserved\\n- Quiet"\n  }\n}`
    // Let's also test raw string containing actual literal newlines inside the value
    const rawWithLiteralNewlines = `{\n  "reply": "Done.",\n  "updates": {\n    "personality": "[Mind/Psychology]\nTsukishiro Hana is a student.\nShe is cold."\n  }\n}`
    const res = parseOrionResponse(rawWithLiteralNewlines)
    expect(res).not.toBeNull()
    expect(res?.reply).toBe('Done.')
    expect(res?.updates.personality).toBe('[Mind/Psychology]\nTsukishiro Hana is a student.\nShe is cold.')
  })

  it('strips trailing commas', () => {
    const raw = `{
      "reply": "Trailing comma test",
      "updates": {
        "personality": "Exhaustive description",
        "opening_messages": [
          "Msg 1",
          "Msg 2",
        ],
      },
    }`
    const res = parseOrionResponse(raw)
    expect(res).not.toBeNull()
    expect(res?.reply).toBe('Trailing comma test')
    expect(res?.updates.personality).toBe('Exhaustive description')
    expect(res?.updates.opening_messages).toEqual(['Msg 1', 'Msg 2'])
  })
})
