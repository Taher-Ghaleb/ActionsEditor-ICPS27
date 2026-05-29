// ============================================================
// AI provider adapters — "bring your own key" design
// ============================================================
//
// Nothing here stores a user's API key or conversation anywhere
// this application controls. Keys live only in the browser's
// localStorage (see AIPanel.jsx), and every function in this file
// either calls the provider directly from the browser (Gemini) or
// forwards a single request through a stateless proxy that
// discards it immediately after replying (the "custom" / OpenAI-
// compatible path — see backend/server.py's /api/ai/chat handler).

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

// ------------------------------------------------------------
// Google Gemini — called directly from the browser.
// ------------------------------------------------------------
// Gemini keys support HTTP-referrer restriction (lock the key to
// your own domain in Google AI Studio / Cloud Console), which is
// what makes direct browser calls a reasonable pattern for this
// provider specifically, unlike most others.
//
// UPDATED: Google replaced the REST
// surface this talks to. The old shape —
// POST /models/{model}:generateContent?key=..., body {contents:[...]},
// response candidates[0].content.parts — is being retired in favor
// of a new "Interactions API": POST /interactions, the key sent as
// an x-goog-api-key HEADER (not a ?key= query param), body
// {model, input}, response steps[]. This was discovered because
// newer Gemini keys (an "AQ."-prefixed "Authentication Key" format)
// return 401 against the old shape; the new shape below was verified
// against a real request/response pair, not just documentation.

export function buildGeminiPayload({ model, systemPrompt, messages }) {
  // Interactions API multi-turn shape: `input` is an array of step
  // objects, not the old role-tagged {role, parts} list. A prior user
  // turn is a "user_input" step; a prior assistant reply is resent as
  // a "model_output" step (the same shape the API itself returns it
  // in) — this is how a stateless call reconstructs history without
  // Google keeping a server-side session for it.
  const input = (messages || []).filter(m => m && typeof m.content === 'string' && m.content.trim() !== '').map(m => ({
    type: m.role === 'assistant' ? 'model_output' : 'user_input',
    content: [{ type: 'text', text: m.content }],
  }))

  const payload = { model: model || 'gemini-flash-latest', input }
  if (systemPrompt) {
    payload.system_instruction = systemPrompt
  }
  return payload
}

// A real response looks like:
//   { status: "completed", steps: [
//       { type: "thought", signature: "..." },           // optional, thinking models only
//       { type: "model_output", content: [{ type: "text", text: "..." }] }
//   ], ... }
export function parseGeminiResponse(data) {
  if (data?.error) {
    throw new Error(data.error.message || 'Gemini API returned an error.')
  }
  const steps = Array.isArray(data?.steps) ? data.steps : []
  const text = steps
    .filter(s => s?.type === 'model_output')
    .flatMap(s => (Array.isArray(s.content) ? s.content : []))
    .filter(c => c?.type === 'text')
    .map(c => c.text || '')
    .join('')
  if (!text) {
    throw new Error('Gemini API returned an empty response.')
  }
  return text
}

export async function callGemini({ apiKey, model, systemPrompt, messages, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('Missing Gemini API key.')
  const url = `${GEMINI_API_BASE}/interactions`

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(buildGeminiPayload({ model, systemPrompt, messages })),
  })

  let data
  try {
    data = await res.json()
  } catch {
    throw new Error(`Gemini API returned a non-JSON response (HTTP ${res.status}).`)
  }
  if (!res.ok && !data?.error) {
    throw new Error(`Gemini API request failed (HTTP ${res.status}).`)
  }
  return parseGeminiResponse(data)
}

// ------------------------------------------------------------
// Google Gemini — streaming variant.
// ------------------------------------------------------------
// The non-streaming call above waits for the model to finish the
// entire reply before returning anything, which is what made the
// assistant feel slow to load — nothing appeared on screen until
// the whole answer was ready. This calls the Interactions endpoint
// with alt=sse and stream:true instead, and invokes
// onChunk(delta, fullTextSoFar) as each piece of text arrives, so
// the UI can render text incrementally. Falls back to the
// non-streaming call if the runtime's fetch doesn't expose a
// readable stream body (e.g. some test/mocking environments).
//
// CAVEAT (unlike the non-streaming path above, which was confirmed
// against a real response): the streamed event shape below —
// {event_type: "step.delta", delta: {type: "text", text: "..."}} —
// is built from Google's documentation, not a live-verified stream,
// because this environment couldn't make a live streaming request
// while writing this. Per the lesson from the original SSE bug:
// a shape that looks right on paper can
// still not match what the real API sends. If streaming silently
// produces "Gemini API returned an empty response" against a real
// key, that's the first thing to re-check with a live request.

export async function streamGemini({ apiKey, model, systemPrompt, messages, fetchImpl = fetch, onChunk }) {
  if (!apiKey) throw new Error('Missing Gemini API key.')
  const url = `${GEMINI_API_BASE}/interactions?alt=sse`

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ ...buildGeminiPayload({ model, systemPrompt, messages }), stream: true }),
  })

  if (!res.ok) {
    let data
    try { data = await res.json() } catch { /* body may not be JSON on some errors */ }
    throw new Error(data?.error?.message || `Gemini API request failed (HTTP ${res.status}).`)
  }

  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await callGemini({ apiKey, model, systemPrompt, messages, fetchImpl })
    onChunk?.(text, text)
    return text
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  // Standard SSE line-based parsing: process one complete line at a
  // time (split on a single "\n"), rather than requiring a blank-line
  // "\n\n" separator between events. Some proxies/environments don't
  // reliably emit the trailing blank line after every event, and
  // requiring it meant a chunk could sit in the buffer forever and
  // never get parsed — which is exactly how this returned "empty
  // response" despite the request succeeding, the first time around
  // (entry #9). A blank line (an empty trimmed line, or any line
  // that isn't a "data:" line) is simply skipped rather than treated
  // as meaningful.
  function consumeLine(line) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.startsWith('data:')) return
    const jsonStr = trimmed.slice(5).trim()
    if (!jsonStr) return

    let parsed
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      return // an incomplete/malformed line; skip rather than crash the stream
    }

    if (parsed.error) {
      throw new Error(parsed.error.message || 'Gemini API returned an error.')
    }

    // Only "step.delta" events carrying a text delta are rendered;
    // other event types (step.start/step.stop, thought deltas, the
    // final response object) are intentionally ignored.
    if (parsed.event_type === 'step.delta' && parsed.delta?.type === 'text' && typeof parsed.delta.text === 'string') {
      const delta = parsed.delta.text
      if (delta) {
        fullText += delta
        onChunk?.(delta, fullText)
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newlineIndex
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)
      consumeLine(line)
    }
  }
  // Flush anything left in the buffer with no trailing newline at all
  // (the last event of a stream that closes right after its data, with
  // no final "\n").
  if (buffer) consumeLine(buffer)

  if (!fullText) {
    throw new Error('Gemini API returned an empty response.')
  }
  return fullText
}

// ------------------------------------------------------------
// Custom / OpenAI-compatible provider — routed through the local
// stateless proxy (backend/server.py: POST /api/ai/chat) so that
// providers without browser CORS support (OpenAI, self-hosted
// OpenAI-compatible servers, etc.) can still be used. The proxy
// forwards the request and returns the reply; it does not persist
// the key, the messages, or the response anywhere.
// ------------------------------------------------------------

export function buildProxyPayload({ baseUrl, apiKey, model, systemPrompt, messages }) {
  const chatMessages = []
  if (systemPrompt) chatMessages.push({ role: 'system', content: systemPrompt })
  for (const m of messages || []) {
    chatMessages.push({ role: m.role, content: m.content })
  }
  return { baseUrl, apiKey, model, messages: chatMessages }
}

export function parseProxyResponse(data) {
  if (data?.error) {
    throw new Error(data.error)
  }
  const text = data?.text
  if (!text) {
    throw new Error('The AI proxy returned an empty response.')
  }
  return text
}

export async function callViaProxy({ baseUrl, apiKey, model, systemPrompt, messages, fetchImpl = fetch, proxyUrl = '/api/ai/chat' }) {
  if (!apiKey) throw new Error('Missing API key.')
  if (!baseUrl) throw new Error('Missing API base URL.')

  const res = await fetchImpl(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildProxyPayload({ baseUrl, apiKey, model, systemPrompt, messages })),
  })

  let data
  try {
    data = await res.json()
  } catch {
    throw new Error(`AI proxy returned a non-JSON response (HTTP ${res.status}). Is the local backend running ("npm run backend" or "npm run dev:full")?`)
  }
  if (!res.ok && !data?.error) {
    throw new Error(`AI proxy request failed (HTTP ${res.status}). Is the local backend running ("npm run backend" or "npm run dev:full")?`)
  }
  return parseProxyResponse(data)
}

// ------------------------------------------------------------
// Google Gemini — reviewer demo path, routed through
// api/ai-demo.js (a Vercel serverless function holding a
// maintainer-supplied key server-side). This exists ONLY so
// someone can try the AI panel on the public deployment without
// pasting in their own key first; it is not a replacement for the
// "bring your own key" design above, and the app only ever uses it
// when the user hasn't configured a Gemini key of their own — see
// AIPanel.jsx.
//
// Unlike callGemini/streamGemini, this never takes an apiKey
// argument — there is nothing for the client to hold, because the
// key never leaves the server. It's also non-streaming, for the
// same reason the OpenAI-compatible proxy below is non-streaming:
// forwarding a stream through a second hop is a bigger change than
// this feature warrants, and Gemini's direct/BYOK path already
// covers the case where streaming actually matters (a reviewer who
// adds their own key gets the fast, streamed experience).
// ------------------------------------------------------------

export function parseDemoResponse(data) {
  if (data?.error) {
    throw new Error(data.error)
  }
  const text = data?.text
  if (!text) {
    throw new Error('The demo AI endpoint returned an empty response.')
  }
  return text
}

export async function callGeminiDemo({ model, systemPrompt, messages, fetchImpl = fetch, demoUrl = '/api/ai-demo' }) {
  const res = await fetchImpl(demoUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, systemPrompt, messages }),
  })

  let data
  try {
    data = await res.json()
  } catch {
    throw new Error(`Demo AI endpoint returned a non-JSON response (HTTP ${res.status}).`)
  }
  if (!res.ok && !data?.error) {
    throw new Error(`Demo AI endpoint request failed (HTTP ${res.status}).`)
  }
  return parseDemoResponse(data)
}

// ------------------------------------------------------------
// Provider registry used by the settings panel
// ------------------------------------------------------------

// Preset Gemini models offered in the Settings dropdown. The same list is
// the allowlist for the shared demo key (api/_lib/geminiDemo.js keeps its
// own copy, since the serverless function cannot import from src/); a
// user's own key may use any model name through the "Custom…" option.
export const GEMINI_MODELS = [
  { id: 'gemini-flash-latest', label: 'Gemini Flash (latest)' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (fastest)' },
]

export const AI_PROVIDERS = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    mode: 'direct',
    defaultModel: 'gemini-flash-latest',
    models: GEMINI_MODELS,
    keyHelpUrl: 'https://aistudio.google.com/app/apikey',
    description: 'Called directly from your browser with your own API key. Restrict the key to your domain in Google AI Studio for safety.',
    // When true, the app may fall back to the rate-limited
    // maintainer-supplied demo key (api/ai-demo.js) if the user
    // hasn't entered their own key yet.
    demoAvailable: true,
  },
  custom: {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    mode: 'proxy',
    defaultModel: 'gpt-4o-mini',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyHelpUrl: 'https://platform.openai.com/api-keys',
    description: 'Routed through the local backend proxy (required — run "npm run dev:full"). Works with OpenAI or any OpenAI-compatible endpoint (Groq, Together, a local server, etc).',
  },
}
