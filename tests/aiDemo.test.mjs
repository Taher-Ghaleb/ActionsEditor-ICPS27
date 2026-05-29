import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDemoRequest, parseDemoResponse, checkRateLimit, getClientIp, DemoValidationError,
  DEMO_MODELS, FALLBACK_MODEL, resolveDemoModel,
} from '../api/_lib/geminiDemo.js'
import { callGeminiDemo } from '../src/utils/aiProviders.js'

// ------------------------------------------------------------
// buildDemoRequest
// ------------------------------------------------------------

test('buildDemoRequest throws a DemoValidationError("missing_server_key") when no server key is configured', () => {
  // INPUT: no apiKey (simulates GEMINI_API_KEY not set in the
  // deployment's environment)
  // EXPECTED: a distinct error the handler can turn into a 503
  // ("deployment not configured"), not a 400 ("reviewer's fault")
  assert.throws(
    () => buildDemoRequest({ apiKey: '', messages: [{ role: 'user', content: 'hi' }] }),
    err => err instanceof DemoValidationError && err.message === 'missing_server_key'
  )
})

test('buildDemoRequest throws on missing messages', () => {
  // INPUT: a server key but no messages
  // EXPECTED: throws
  assert.throws(
    () => buildDemoRequest({ apiKey: 'server-key', messages: [] }),
    /Missing messages/
  )
})

test('buildDemoRequest sends the key as an x-goog-api-key header, not a URL query param', () => {
  // INPUT: a server key
  // EXPECTED: the Interactions API endpoint, with the key only in a
  // header — this is the fix for entry #11 (Google now rejects the
  // old ?key=... query-param auth style for these newer keys)
  const { url, headers } = buildDemoRequest({ apiKey: 'server-key', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions')
  assert.equal(headers['x-goog-api-key'], 'server-key')
  assert.equal(url.includes('server-key'), false)
})

test('buildDemoRequest sends a single user_input step and a system_instruction', () => {
  // INPUT: a server key + one user message + system prompt
  // EXPECTED: one "user_input" step with a text part, system_instruction as a plain string
  const { payload } = buildDemoRequest({
    apiKey: 'server-key',
    model: 'gemini-flash-latest',
    systemPrompt: 'Be helpful.',
    messages: [{ role: 'user', content: 'hi' }],
  })
  assert.deepEqual(payload, {
    model: 'gemini-flash-latest',
    system_instruction: 'Be helpful.',
    input: [{ type: 'user_input', content: [{ type: 'text', text: 'hi' }] }],
  })
})

test('buildDemoRequest folds earlier turns into one text step and drops empty and error bubbles', () => {
  // INPUT: greeting, a question, a "⚠️" error bubble, an empty bubble, a new question
  // EXPECTED: exactly one user_input step; no model_output steps; no empty text parts;
  // the error/empty bubbles are absent; the latest question is last
  const { payload } = buildDemoRequest({
    apiKey: 'k',
    messages: [
      { role: 'assistant', content: 'Hi! I am your assistant.' },
      { role: 'user', content: 'Explain this workflow' },
      { role: 'assistant', content: '⚠️ gemini-flash-latest is currently experiencing high demand' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'Explain this workflow' },
    ],
  })
  assert.equal(payload.input.length, 1)
  assert.equal(payload.input[0].type, 'user_input')
  const text = payload.input[0].content[0].text
  assert.ok(text.length > 0)
  assert.ok(text.includes('Assistant: Hi! I am your assistant.'))
  assert.equal(text.includes('⚠️'), false)
  assert.ok(text.endsWith('Latest user message:\nExplain this workflow'))
})

test('buildDemoRequest throws when no user message is left after filtering', () => {
  assert.throws(
    () => buildDemoRequest({ apiKey: 'k', messages: [{ role: 'assistant', content: 'hi' }, { role: 'user', content: '  ' }] }),
    err => err instanceof DemoValidationError,
  )
})

test('buildDemoRequest defaults to gemini-flash-latest when no model is given', () => {
  const { payload } = buildDemoRequest({ apiKey: 'k', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(payload.model, 'gemini-flash-latest')
})

// ------------------------------------------------------------
// parseDemoResponse
// ------------------------------------------------------------

test('parseDemoResponse extracts reply text from a real-shaped response (including a thought step)', () => {
  // INPUT: this is the actual JSON shape returned by a live request
  // during development (a thinking model, so a "thought" step
  // precedes the "model_output" step) — trimmed to the fields that
  // matter for parsing
  const text = parseDemoResponse({
    id: 'v1_abc',
    status: 'completed',
    steps: [
      { type: 'thought', signature: 'opaque-signature-not-text' },
      { type: 'model_output', content: [{ type: 'text', text: 'OK' }] },
    ],
    object: 'interaction',
    model: 'gemini-3.8-flash',
  })
  assert.equal(text, 'OK')
})

test('parseDemoResponse works without any thought step (non-thinking model)', () => {
  const text = parseDemoResponse({
    steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }] }],
  })
  assert.equal(text, 'Hello world')
})

test('parseDemoResponse throws on an upstream Gemini error payload', () => {
  assert.throws(
    () => parseDemoResponse({ error: { message: 'API key not valid' } }),
    /API key not valid/
  )
})

test('parseDemoResponse throws on an empty response', () => {
  assert.throws(() => parseDemoResponse({}), /empty/)
})

test('parseDemoResponse throws if steps only contain non-model_output entries', () => {
  // e.g. a response that's still in-progress, or only produced a
  // thought step with no visible output yet
  assert.throws(() => parseDemoResponse({ steps: [{ type: 'thought', signature: 'x' }] }), /empty/)
})

// ------------------------------------------------------------
// checkRateLimit — a fresh store per test so cases don't share state
// ------------------------------------------------------------

test('checkRateLimit allows requests under the limit and blocks at the limit', () => {
  const store = new Map()
  const opts = { store, max: 3, windowMs: 60_000, now: 1_000 }
  assert.equal(checkRateLimit('1.2.3.4', opts).limited, false)
  assert.equal(checkRateLimit('1.2.3.4', opts).limited, false)
  assert.equal(checkRateLimit('1.2.3.4', opts).limited, false)
  // 4th request in the same window, same IP: over the max of 3
  assert.equal(checkRateLimit('1.2.3.4', opts).limited, true)
})

test('checkRateLimit tracks each IP independently', () => {
  const store = new Map()
  const opts = { store, max: 1, windowMs: 60_000, now: 1_000 }
  assert.equal(checkRateLimit('1.1.1.1', opts).limited, false)
  // a different IP has its own, unused budget
  assert.equal(checkRateLimit('2.2.2.2', opts).limited, false)
  // 1.1.1.1 is now over its own budget
  assert.equal(checkRateLimit('1.1.1.1', opts).limited, true)
})

test('checkRateLimit lets old requests fall out of the window', () => {
  const store = new Map()
  assert.equal(checkRateLimit('1.2.3.4', { store, max: 1, windowMs: 1000, now: 0 }).limited, false)
  // same window: blocked
  assert.equal(checkRateLimit('1.2.3.4', { store, max: 1, windowMs: 1000, now: 500 }).limited, true)
  // well past the window: allowed again
  assert.equal(checkRateLimit('1.2.3.4', { store, max: 1, windowMs: 1000, now: 5000 }).limited, false)
})

// ------------------------------------------------------------
// getClientIp
// ------------------------------------------------------------

test('getClientIp prefers the first entry of x-forwarded-for', () => {
  const req = { headers: { 'x-forwarded-for': '9.9.9.9, 1.1.1.1' }, socket: { remoteAddress: '127.0.0.1' } }
  assert.equal(getClientIp(req), '9.9.9.9')
})

test('getClientIp falls back to the socket address when no x-forwarded-for header is present', () => {
  const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } }
  assert.equal(getClientIp(req), '127.0.0.1')
})

// ------------------------------------------------------------
// callGeminiDemo — the browser-side client of api/ai-demo.js
// ------------------------------------------------------------

test('callGeminiDemo posts to /api/ai-demo with no apiKey field, and returns the reply text', async () => {
  // INPUT: a fake fetch that records what it was called with and
  // returns a successful demo response
  let calledUrl = null
  let calledBody = null
  const fakeFetch = async (url, opts) => {
    calledUrl = url
    calledBody = JSON.parse(opts.body)
    return { ok: true, status: 200, json: async () => ({ text: 'demo reply' }) }
  }
  const text = await callGeminiDemo({
    model: 'gemini-flash-latest',
    systemPrompt: 'sys',
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl: fakeFetch,
  })
  assert.equal(text, 'demo reply')
  assert.equal(calledUrl, '/api/ai-demo')
  // the client never sends (or has) an apiKey — the whole point of
  // this endpoint is that the key lives only on the server
  assert.equal('apiKey' in calledBody, false)
})

test('callGeminiDemo surfaces a rate-limit error message from the endpoint', async () => {
  // INPUT: a fake fetch simulating the 429 the handler returns once
  // checkRateLimit reports `limited`
  const fakeFetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: 'The shared demo key has hit its rate limit for now.' }),
  })
  await assert.rejects(
    callGeminiDemo({ messages: [{ role: 'user', content: 'hi' }], fetchImpl: fakeFetch }),
    /rate limit/
  )
})


// ------------------------------------------------------------
// Model allowlist and overload fallback
// ------------------------------------------------------------

test('the demo allowlist matches the Settings dropdown presets and includes the fallback', async () => {
  const { GEMINI_MODELS } = await import('../src/utils/aiProviders.js')
  assert.deepEqual(DEMO_MODELS, GEMINI_MODELS.map(m => m.id))
  assert.ok(DEMO_MODELS.includes(FALLBACK_MODEL))
})

test('resolveDemoModel keeps allowlisted models and replaces anything else with the default', () => {
  assert.equal(resolveDemoModel('gemini-3.8-flash'), 'gemini-3.8-flash')
  assert.equal(resolveDemoModel('some-expensive-model'), 'gemini-flash-latest')
  assert.equal(resolveDemoModel(undefined), 'gemini-flash-latest')
})

test('buildDemoRequest never sends a non-allowlisted model with the shared key', () => {
  const { payload } = buildDemoRequest({ apiKey: 'k', model: 'some-expensive-model', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(payload.model, 'gemini-flash-latest')
})

async function runHandler(fetchStub, body) {
  const { default: handler } = await import('../api/ai-demo.js')
  process.env.GEMINI_API_KEY = 'test-key'
  const realFetch = globalThis.fetch
  globalThis.fetch = fetchStub
  const result = {}
  const res = {
    setHeader() {}, end() {},
    status(c) { result.status = c; return this },
    json(b) { result.body = b },
  }
  try {
    await handler({ method: 'POST', headers: { 'x-forwarded-for': `9.9.9.${Math.floor(Math.random() * 250)}` }, socket: {}, body }, res)
  } finally {
    globalThis.fetch = realFetch
  }
  return result
}

test('handler retries an overloaded model once, then answers from the fallback model', async () => {
  const calls = []
  const stub = async (url, opts) => {
    const model = JSON.parse(opts.body).model
    calls.push(model)
    if (model !== FALLBACK_MODEL) return { ok: false, status: 503, json: async () => ({ error: { message: 'high demand' } }) }
    return { ok: true, status: 200, json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'hello' }] }] }) }
  }
  const r = await runHandler(stub, { model: 'gemini-flash-latest', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(r.status, 200)
  assert.equal(r.body.text, 'hello')
  assert.equal(r.body.model, FALLBACK_MODEL)
  assert.deepEqual(calls, ['gemini-flash-latest', 'gemini-flash-latest', FALLBACK_MODEL])
})

test('handler returns the overload error when the fallback is overloaded too', async () => {
  const stub = async () => ({ ok: false, status: 503, json: async () => ({ error: { message: 'high demand' } }) })
  const r = await runHandler(stub, { model: 'gemini-flash-latest', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(r.status, 503)
  assert.ok(r.body.error.includes('high demand'))
})
