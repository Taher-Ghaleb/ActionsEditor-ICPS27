// ============================================================
// api/_lib/geminiDemo.js — pure helpers for the reviewer demo endpoint
// ============================================================
//
// These are kept separate from api/ai-demo.js (the thin Vercel
// handler) and written as pure, side-effect-free functions wherever
// possible, mirroring the split already used in backend/server.py
// (build_forward_request / extract_reply_text) — it's what makes
// both testable without spinning up a real server or a real API key.
//
// The request/response shape below looks different from what an older
// Gemini integration might expect:
// Google replaced the REST surface this talks to (the
// generateContent/contents/parts shape) with a new "Interactions
// API" (POST /v1beta/interactions, key sent as an x-goog-api-key
// header instead of a ?key= query param, request body
// {model, input}, response steps[]) sometime after this codebase's
// AI panel was first built. The shape here was confirmed against a
// real request/response pair, not just documentation — see entry #11
// for the actual JSON that came back.

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
// A model alias, not a wire-format detail — left as-is across the
// API surface change since there's no evidence it needs to change.
// If it turns out not to resolve under the new API, Google's current
// docs use "gemini-3.8-flash" as their concrete example model.
export const DEFAULT_MODEL = 'gemini-flash-latest'
// The shared demo key serves only these models (same ids as GEMINI_MODELS in
// src/utils/aiProviders.js), so a visitor cannot pick an arbitrary — possibly
// expensive — model on the maintainer's key. Anything else falls back to the
// default. FALLBACK_MODEL is tried once when the requested model stays
// overloaded (HTTP 503/429) after its retries.
export const DEMO_MODELS = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']
export const FALLBACK_MODEL = 'gemini-3.5-flash-lite'

export function resolveDemoModel(model) {
  return DEMO_MODELS.includes(model) ? model : DEFAULT_MODEL
}

export function isOverloadStatus(status) {
  return status === 503 || status === 429
}

// ------------------------------------------------------------
// Request validation + payload building
// ------------------------------------------------------------

export class DemoValidationError extends Error {}

export function buildDemoRequest({ apiKey, model, systemPrompt, messages }) {
  if (!apiKey) {
    // Not a client error — this means the deployment's GEMINI_API_KEY
    // env var isn't set. Kept as a distinct error type so the handler
    // can return 503 (service not configured) instead of 400 (bad
    // request), which is a more honest status for "the reviewer did
    // nothing wrong, the deployment isn't set up yet."
    throw new DemoValidationError('missing_server_key')
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new DemoValidationError('Missing messages')
  }

  const modelId = resolveDemoModel(model)

  // Earlier turns are folded into ONE plain-text user_input step
  // instead of being replayed as separate model_output steps. The
  // endpoint is stateless, and replaying assistant turns as structured
  // steps was rejected by Google ("Missing text in content of type
  // text") once the history held an assistant turn. Empty messages and
  // the panel's own "⚠️ …" error bubbles are dropped: they are UI
  // state, not conversation, and an empty text part is invalid.
  const turns = messages
    .filter(m => m && typeof m.content === 'string' && m.content.trim() !== '')
    .filter(m => !(m.role === 'assistant' && m.content.startsWith('⚠️')))
  const last = turns[turns.length - 1]
  if (!last || last.role === 'assistant') {
    throw new DemoValidationError('Missing messages')
  }
  const earlier = turns.slice(0, -1)
  const text = earlier.length === 0
    ? last.content
    : 'Conversation so far:\n' +
      earlier.map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`).join('\n\n') +
      '\n\nLatest user message:\n' + last.content
  const input = [{ type: 'user_input', content: [{ type: 'text', text }] }]

  const payload = { model: modelId, input }
  if (systemPrompt) payload.system_instruction = systemPrompt

  const url = `${GEMINI_API_BASE}/interactions`
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }
  return { url, headers, payload }
}

// ------------------------------------------------------------
// Response parsing
// ------------------------------------------------------------
//
// A real response from this endpoint looks like:
//   { status: "completed", steps: [
//       { type: "thought", signature: "..." },
//       { type: "model_output", content: [{ type: "text", text: "OK" }] }
//   ], ... }
// A model that doesn't use extended thinking may omit the "thought"
// step entirely — this only ever looks at "model_output" steps, so
// either shape works.

export function parseDemoResponse(data) {
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

// ------------------------------------------------------------
// Best-effort rate limiting
// ------------------------------------------------------------
//
// This is intentionally simple: a fixed-window counter keyed by
// client IP, held in memory. It is NOT a strict, globally-correct
// rate limit — Vercel may run multiple warm instances of this
// function concurrently, each with its own independent counter, and
// any instance resets to zero on a cold start. What it IS: a cheap
// backstop so a single heavy session (or a leaked link) can't
// silently run the shared demo key's free-tier quota to zero for
// every other reviewer in one sitting.
//
// If this key ends up needing a real guarantee (evidence of abuse,
// or the demo period running long), the correct upgrade is a shared
// counter in Vercel KV or Upstash Redis — not a bigger in-memory
// window. That's a deliberate scope decision, not an oversight.
//
// store is injected (defaults to a module-level Map) so tests can
// pass in a fresh one instead of sharing state across test cases.
export const defaultRateLimitStore = new Map()

export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
export const RATE_LIMIT_MAX_PER_WINDOW = 20 // requests per IP, per warm instance, per window

export function checkRateLimit(ip, { store = defaultRateLimitStore, now = Date.now(), windowMs = RATE_LIMIT_WINDOW_MS, max = RATE_LIMIT_MAX_PER_WINDOW } = {}) {
  const key = ip || 'unknown'
  const timestamps = (store.get(key) || []).filter(t => now - t < windowMs)
  const limited = timestamps.length >= max
  if (!limited) {
    timestamps.push(now)
    store.set(key, timestamps)
  }
  return { limited, count: timestamps.length, max }
}

export function getClientIp(req) {
  const fwd = req.headers?.['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}
