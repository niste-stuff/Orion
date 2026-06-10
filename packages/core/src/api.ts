import { invoke } from '@tauri-apps/api/core'
import type { RequestMessage, Settings } from './types'
import type { ParsedTag } from './lib/tags'

type CompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>
}

export type ModelsResponse = {
  data?: Array<{ id?: unknown }>
}

type ProxyResponse = {
  ok: boolean
  status: number
  statusText: string
  body: string
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
}

function normalizeKey(apiKey: string): string | null {
  const key = apiKey.trim()
  return key ? key : null
}

function buildBody(model: string, messages: RequestMessage[]) {
  return {
    model,
    messages: messages.map(({ role, content }) => ({ role, content })),
    stream: false,
  }
}

function contentFromProxy(res: ProxyResponse): string {
  if (!res.ok) {
    throw new Error(
      `Request failed (${res.status} ${res.statusText})${res.body ? `: ${res.body}` : ''}`,
    )
  }
  let data: CompletionResponse
  try {
    data = JSON.parse(res.body) as CompletionResponse
  } catch (err) {
    const bodySnippet = res.body ? (res.body.length > 300 ? res.body.slice(0, 300) + '...' : res.body) : '(empty body)'
    throw new Error(`Failed to parse API response as JSON: ${bodySnippet}`)
  }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('Malformed response: missing message content')
  }
  return content
}

// --- Browser Fallback Styles Retrieval Implementation ---

function getSampleSetsInBrowser(): any[] {
  if (typeof localStorage === 'undefined') return [];
  const sets: any[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('orion_set_')) {
      try {
        const set = JSON.parse(localStorage.getItem(key)!);
        sets.push(set);
      } catch (e) {
        console.error('Failed to parse set:', key, e);
      }
    }
  }
  return sets;
}

function sectionPriority(section: string, active: string): number {
  if (section === active) return 0;
  if (section === 'general') return 1;
  return 2;
}

function clampRatio(weights: number[], maxRatio: number): number[] {
  const max = Math.max(0, ...weights);
  if (max <= 0 || maxRatio <= 0) {
    return [...weights];
  }
  const floor = max / maxRatio;
  return weights.map(w => Math.max(w, floor));
}

function distributeSlots(weights: number[], cap: number, prefer: number[]): number[] {
  const slots = Array(weights.length).fill(0);
  if (weights.length === 0 || cap === 0) {
    return slots;
  }

  const rank = Array(weights.length).fill(Infinity);
  for (let pos = 0; pos < prefer.length; pos++) {
    const idx = prefer[pos];
    if (idx < weights.length) {
      rank[idx] = pos;
    }
  }

  const eff = clampRatio(weights, 5.0); // MAX_DISTRIBUTION_RATIO = 5.0
  const sum = eff.reduce((a, b) => a + b, 0);

  if (sum <= 0) {
    let given = 0;
    for (const idx of prefer) {
      if (given >= cap) break;
      if (idx < weights.length) {
        slots[idx]++;
        given++;
      }
    }
    return slots;
  }

  const shares = eff.map(w => (w / sum) * cap);
  for (let i = 0; i < weights.length; i++) {
    slots[i] = Math.floor(shares[i]);
  }
  let remainder = cap - slots.reduce((a, b) => a + b, 0);

  const idxs = Array.from({ length: weights.length }, (_, i) => i);
  idxs.sort((a, b) => {
    const fa = shares[a] - Math.floor(shares[a]);
    const fb = shares[b] - Math.floor(shares[b]);
    if (Math.abs(fb - fa) > 1e-9) {
      return fb - fa;
    }
    if (rank[a] !== rank[b]) {
      return rank[a] - rank[b];
    }
    return a - b;
  });

  for (let i = 0; i < remainder; i++) {
    slots[idxs[i]]++;
  }

  const guaranteeAll = weights.length <= cap;
  while (true) {
    const needy = idxs.find(i => slots[i] === 0 && (guaranteeAll || weights[i] >= 1.0));
    if (needy === undefined) break;

    let donor: number | undefined = undefined;
    for (let i = 0; i < weights.length; i++) {
      if (slots[i] > 1) {
        if (donor === undefined || weights[i] < weights[donor]) {
          donor = i;
        } else if (weights[i] === weights[donor] && i > donor) {
          donor = i;
        }
      }
    }

    if (donor === undefined) break;
    slots[donor]--;
    slots[needy]++;
  }

  return slots;
}

function selectSamples(
  resolved: Array<{ weight: number; isQuality: boolean; samples: any[] }>,
  hasQualityTag: boolean,
  cap: number
): Array<[number, number]> {
  const n = resolved.length;
  if (n === 0) return [];

  const prefer = Array.from({ length: n }, (_, i) => i);
  prefer.sort((a, b) => {
    if (!hasQualityTag) {
      const qa = resolved[a].isQuality;
      const qb = resolved[b].isQuality;
      if (qa !== qb) {
        return qb ? 1 : -1;
      }
    }
    if (Math.abs(resolved[b].weight - resolved[a].weight) > 1e-9) {
      return resolved[b].weight - resolved[a].weight;
    }
    return a - b;
  });

  const weights = resolved.map(r => r.weight);
  const slots = distributeSlots(weights, cap, prefer);

  for (let i = 0; i < n; i++) {
    slots[i] = Math.min(slots[i], resolved[i].samples.length);
  }

  let leftover = cap - slots.reduce((a, b) => a + b, 0);
  while (leftover > 0) {
    let progressed = false;
    for (const i of prefer) {
      if (leftover === 0) break;
      if (slots[i] < resolved[i].samples.length) {
        slots[i]++;
        leftover--;
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  const out: Array<[number, number]> = [];
  for (const i of prefer) {
    for (let j = 0; j < slots[i]; j++) {
      out.push([i, j]);
    }
  }
  return out;
}

function formatReference(
  resolved: Array<{ name: string; weight: number; samples: any[] }>,
  selection: Array<[number, number]>,
  activeSection: string
): string {
  const order: number[] = [];
  for (const [si, _] of selection) {
    if (!order.includes(si)) {
      order.push(si);
    }
  }

  const ranked = [...order];
  ranked.sort((a, b) => {
    if (Math.abs(resolved[b].weight - resolved[a].weight) > 1e-9) {
      return resolved[b].weight - resolved[a].weight;
    }
    const pa = order.indexOf(a);
    const pb = order.indexOf(b);
    return pa - pb;
  });

  const maxW = Math.max(1e-9, ...ranked.map(i => resolved[i].weight));
  const hierarchy = ranked.map((idx, pos) => {
    const r = resolved[idx];
    const ratio = r.weight / maxW;
    let lead = '';
    if (pos === 0) {
      lead = 'lean hardest on';
    } else if (ratio >= 0.66) {
      lead = 'draw strongly on';
    } else if (ratio >= 0.33) {
      lead = 'draw moderately on';
    } else {
      lead = 'lightly reference';
    }
    return `${lead} '${r.name}'`;
  });

  let out = '=== STYLE REFERENCE (emulate; do not copy) ===\n';
  out += `You are authoring the "${activeSection}" section of a character card. The passages below are STYLE REFERENCES to learn from for this section.\n`;
  out += `Style hierarchy (most to least important): ${hierarchy.join('; ')}.\n`;
  out += 'Treat the above as a HIERARCHY OF IMPORTANCE, normalized relative to one another — not exact percentages.\n';
  out += 'Above all, produce a single coherent character in one unified voice. When the referenced styles conflict or pull in different directions, BLEND them into one consistent voice — do NOT alternate between styles, switch tone mid-passage, or average them into something incoherent. Coherence of the result outranks faithfully hitting every emphasis.\n';
  out += 'Emulate the STRUCTURE, VOICE, and STYLE of these references, but do NOT reuse their specific characters, names, or premises — produce something new in that style. These are references to emulate, NOT content to copy verbatim, NOT conversation, and NOT the card\'s own data.\n\n';

  for (let n = 0; n < selection.length; n++) {
    const [si, sj] = selection[n];
    const s = resolved[si].samples[sj];
    out += `[reference ${n + 1} · ${s.section}]\n${s.text.trim()}\n\n`;
  }
  out += '=== END STYLE REFERENCE ===';
  return out;
}

function buildStyleReferenceInBrowser(
  tags: ParsedTag[],
  activeSection: string
): string | null {
  if (tags.length === 0) return null;
  const allSets = getSampleSetsInBrowser();
  if (allSets.length === 0) return null;

  const setWeight = new Map<string, number>();
  const orderedSetIds: string[] = [];
  let hasQualityTag = false;

  for (const wt of tags) {
    const targetTag = wt.tag.toLowerCase();
    for (const set of allSets) {
      const hasTag = (set.tags || []).some((t: any) => t.tag.toLowerCase() === targetTag);
      if (hasTag) {
        const isQuality = (set.tags || []).some((t: any) => t.type === 'quality');
        if (isQuality) {
          hasQualityTag = true;
        }
        const currentWeight = setWeight.get(set.id) || 0;
        if (wt.weight > currentWeight) {
          setWeight.set(set.id, wt.weight);
        }
        if (!orderedSetIds.includes(set.id)) {
          orderedSetIds.push(set.id);
        }
      }
    }
  }

  if (orderedSetIds.length === 0) {
    return null;
  }

  const resolved: Array<{ name: string; weight: number; isQuality: boolean; samples: any[] }> = [];
  for (const sid of orderedSetIds) {
    const set = allSets.find(s => s.id === sid);
    if (!set) continue;
    const weight = setWeight.get(sid) ?? 1.0;
    const isQuality = (set.tags || []).some((t: any) => t.type === 'quality');
    const samples = [...(set.samples || [])];
    samples.sort((a, b) => sectionPriority(a.section, activeSection) - sectionPriority(b.section, activeSection));
    resolved.push({ name: set.name, weight, isQuality, samples });
  }

  if (resolved.length === 0) return null;

  const selection = selectSamples(resolved, hasQualityTag, 7);
  if (selection.length === 0) return null;

  return formatReference(resolved, selection, activeSection);
}

function injectIntoSystem(body: any, reference: string) {
  if (!body || !Array.isArray(body.messages)) return;
  for (const msg of body.messages) {
    if (msg.role === 'system') {
      msg.content = `${msg.content}\n\n${reference}`;
      return;
    }
  }
  body.messages.unshift({ role: 'system', content: reference });
}

// --- API Calls (Tauri & Browser Fetch) ---

export async function chatCompletion(
  { apiKey, baseUrl, model }: Settings,
  messages: RequestMessage[],
): Promise<string> {
  if (isTauri()) {
    const res = await invoke<ProxyResponse>('llm_chat_completion', {
      baseUrl,
      apiKey: normalizeKey(apiKey),
      body: buildBody(model, messages),
    })
    return contentFromProxy(res)
  } else {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    const trimmedKey = apiKey.trim()
    if (trimmedKey) {
      headers['Authorization'] = `Bearer ${trimmedKey}`
    }

    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildBody(model, messages)),
    })

    const bodyText = await response.text()
    const proxyResponse: ProxyResponse = {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: bodyText,
    }
    return contentFromProxy(proxyResponse)
  }
}

export async function chatCompletionWithStyle(
  { apiKey, baseUrl, model }: Settings,
  messages: RequestMessage[],
  tags: ParsedTag[],
  activeSection: string,
): Promise<string> {
  if (isTauri()) {
    const res = await invoke<ProxyResponse>('llm_authoring_completion', {
      baseUrl,
      apiKey: normalizeKey(apiKey),
      body: buildBody(model, messages),
      tags,
      activeSection,
    })
    return contentFromProxy(res)
  } else {
    const body = buildBody(model, messages)
    const reference = buildStyleReferenceInBrowser(tags, activeSection)
    if (reference) {
      injectIntoSystem(body, reference)
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    const trimmedKey = apiKey.trim()
    if (trimmedKey) {
      headers['Authorization'] = `Bearer ${trimmedKey}`
    }

    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    const bodyText = await response.text()
    const proxyResponse: ProxyResponse = {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: bodyText,
    }
    return contentFromProxy(proxyResponse)
  }
}

function extractModelIds(json: unknown): string[] {
  const ids: string[] = []

  const processValue = (val: unknown) => {
    if (typeof val === 'string' && val.trim()) {
      ids.push(val.trim())
    } else if (typeof val === 'object' && val !== null) {
      const obj = val as Record<string, unknown>
      for (const key of ['id', 'name', 'model']) {
        if (typeof obj[key] === 'string' && (obj[key] as string).trim()) {
          ids.push((obj[key] as string).trim())
          return
        }
      }
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'string' && (obj[key] as string).trim()) {
          ids.push((obj[key] as string).trim())
          return
        }
      }
    }
  }

  if (Array.isArray(json)) {
    json.forEach(processValue)
  } else if (typeof json === 'object' && json !== null) {
    const obj = json as Record<string, unknown>
    const arrays: unknown[][] = []
    if (Array.isArray(obj.data)) {
      arrays.push(obj.data)
    }
    if (Array.isArray(obj.models)) {
      arrays.push(obj.models)
    }
    for (const key of Object.keys(obj)) {
      if (key !== 'data' && key !== 'models' && Array.isArray(obj[key])) {
        arrays.push(obj[key] as unknown[])
      }
    }
    for (const arr of arrays) {
      arr.forEach(processValue)
    }
  }

  return Array.from(new Set(ids)).sort()
}

export async function fetchModels(
  baseUrl: string,
  apiKey: string,
): Promise<string[]> {
  if (isTauri()) {
    const res = await invoke<ProxyResponse>('llm_list_models', {
      baseUrl,
      apiKey: normalizeKey(apiKey),
    })

    if (!res.ok) {
      throw new Error(`Request failed (${res.status} ${res.statusText})${res.body ? `: ${res.body}` : ''}`)
    }

    let data: unknown
    try {
      data = JSON.parse(res.body)
    } catch (err) {
      const bodySnippet = res.body ? (res.body.length > 300 ? res.body.slice(0, 300) + '...' : res.body) : '(empty body)'
      throw new Error(`Failed to parse models response as JSON: ${bodySnippet}`)
    }

    return extractModelIds(data)
  } else {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    const trimmedKey = apiKey.trim()
    if (trimmedKey) {
      headers['Authorization'] = `Bearer ${trimmedKey}`
    }

    const url = `${baseUrl.replace(/\/$/, '')}/models`
    const response = await fetch(url, {
      method: 'GET',
      headers,
    })

    if (!response.ok) {
      const bodyText = await response.text()
      throw new Error(`Request failed (${response.status} ${response.statusText})${bodyText ? `: ${bodyText}` : ''}`)
    }

    const bodyText = await response.text()
    let data: unknown
    try {
      data = JSON.parse(bodyText)
    } catch (err) {
      const bodySnippet = bodyText ? (bodyText.length > 300 ? bodyText.slice(0, 300) + '...' : bodyText) : '(empty body)'
      throw new Error(`Failed to parse models response as JSON: ${bodySnippet}`)
    }

    return extractModelIds(data)
  }
}
