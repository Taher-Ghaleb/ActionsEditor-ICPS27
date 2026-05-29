import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGeminiPayload, parseGeminiResponse, callGemini, streamGemini,
  buildProxyPayload, parseProxyResponse, callViaProxy,
} from '../src/utils/aiProviders.js'

// ------------------------------------------------------------
// Gemini payload / response shape
// ------------------------------------------------------------
// NOTE: Google replaced the REST shape
// this talks to (generateContent/contents/parts, key as a ?key=
// query param) with a new "Interactions API" (POST /interactions,
// key as an x-goog-api-key header, body {model, input}, response
// steps[]). These tests were rewritten to match — the old shape's
// tests are gone, not just extended, because the old shape doesn't
// work against current keys at all (401s), so testing it would be
// testing something the app can no longer actually do.

test('buildGeminiPayload maps assistant -> model_output / user -> user_input, and includes system_instruction', () => {
  // INPUT: a system prompt and a short back-and-forth history
  // EXPECTED: the Interactions API's { model, input, system_instruction }
  // shape, with roles mapped to step types
  const payload = buildGeminiPayload({
    model: 'gemini-flash-latest',
    systemPrompt: 'Be helpful.',
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ],
  })
  assert.deepEqual(payload, {
    model: 'gemini-flash-latest',
    system_instruction: 'Be helpful.',
    input: [
      { type: 'user_input', content: [{ type: 'text', text: 'hi' }] },
      { type: 'model_output', content: [{ type: 'text', text: 'hello' }] },
    ],
  })
})

test('buildGeminiPayload drops empty messages so Gemini never receives an empty text part', () => {
  // INPUT: history with an empty assistant bubble (what a failed stream leaves behind)
  // EXPECTED: only the non-empty turns are sent
  const payload = buildGeminiPayload({
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'again' },
    ],
  })
  assert.equal(payload.input.length, 2)
  assert.ok(payload.input.every(step => step.content[0].text.length > 0))
})

test('buildGeminiPayload defaults to gemini-flash-latest when no model is given', () => {
  const payload = buildGeminiPayload({ messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(payload.model, 'gemini-flash-latest')
})

test('parseGeminiResponse extracts the reply text from a real-shaped response (including a thought step)', () => {
  // INPUT: the actual JSON shape returned by a live request made
  // during development (a thinking model, so a "thought" step
  // precedes "model_output")
  const text = parseGeminiResponse({
    status: 'completed',
    steps: [
      { type: 'thought', signature: 'opaque-signature-not-text' },
      { type: 'model_output', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }] },
    ],
  })
  assert.equal(text, 'Hello world')
})

test('parseGeminiResponse works without any thought step (non-thinking model)', () => {
  const text = parseGeminiResponse({
    steps: [{ type: 'model_output', content: [{ type: 'text', text: 'ok!' }] }],
  })
  assert.equal(text, 'ok!')
})

test('parseGeminiResponse throws on an API error payload', () => {
  // INPUT: { error: { message: '...' } }
  // EXPECTED: throws with that message
  assert.throws(
    () => parseGeminiResponse({ error: { message: 'API key not valid' } }),
    /API key not valid/
  )
})

test('parseGeminiResponse throws on an empty response', () => {
  // INPUT: no steps at all
  // EXPECTED: throws
  assert.throws(() => parseGeminiResponse({}), /empty/)
})

test('callGemini sends the key as an x-goog-api-key header (not a query param) and returns the parsed text', async () => {
  // INPUT: a fake fetch that echoes back a valid Interactions API
  // response and records the URL + headers it was called with
  let calledUrl = null
  let calledHeaders = null
  const fakeFetch = async (url, opts) => {
    calledUrl = url
    calledHeaders = opts.headers
    return {
      ok: true,
      status: 200,
      json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'ok!' }] }] }),
    }
  }
  const text = await callGemini({
    apiKey: 'MY-KEY',
    model: 'gemini-flash-latest',
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl: fakeFetch,
  })
  assert.equal(text, 'ok!')
  assert.equal(calledUrl, 'https://generativelanguage.googleapis.com/v1beta/interactions')
  assert.equal(calledHeaders['x-goog-api-key'], 'MY-KEY')
  // the key must never end up in the URL — that's the old, now-rejected auth style
  assert.equal(calledUrl.includes('MY-KEY'), false)
})

test('callGemini throws a clear error when no key is provided', async () => {
  // INPUT: no apiKey
  // EXPECTED: throws before ever calling fetch
  await assert.rejects(
    () => callGemini({ apiKey: '', messages: [] }),
    /Missing Gemini API key/
  )
})

test('callGemini surfaces a provider error message from a non-ok response', async () => {
  // INPUT: fetch resolves with ok:false and an { error } body (how
  // Gemini reports a bad key)
  const fakeFetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { message: 'API key not valid' } }),
  })
  await assert.rejects(
    () => callGemini({ apiKey: 'bad-key', messages: [], fetchImpl: fakeFetch }),
    /API key not valid/
  )
})

// ------------------------------------------------------------
// Proxy payload / response shape (unaffected by the Gemini API
// change above — this path talks to backend/server.py, not Google)
// ------------------------------------------------------------

test('buildProxyPayload prepends the system message OpenAI-style', () => {
  // INPUT: a system prompt and one user message
  // EXPECTED: { baseUrl, apiKey, model, messages: [system, user] }
  const payload = buildProxyPayload({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-x',
    model: 'gpt-4o-mini',
    systemPrompt: 'Be helpful.',
    messages: [{ role: 'user', content: 'hi' }],
  })
  assert.deepEqual(payload, {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-x',
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'Be helpful.' },
      { role: 'user', content: 'hi' },
    ],
  })
})

test('parseProxyResponse extracts text and surfaces proxy errors', () => {
  // INPUT: a normal { text } response, and an { error } response
  // EXPECTED: text returned, error thrown respectively
  assert.equal(parseProxyResponse({ text: 'hi there' }), 'hi there')
  assert.throws(() => parseProxyResponse({ error: 'Missing apiKey' }), /Missing apiKey/)
})

test('callViaProxy posts to the local proxy endpoint and returns the text', async () => {
  // INPUT: a fake fetch standing in for our own backend
  let calledUrl = null
  let calledBody = null
  const fakeFetch = async (url, opts) => {
    calledUrl = url
    calledBody = JSON.parse(opts.body)
    return { ok: true, status: 200, json: async () => ({ text: 'proxied reply' }) }
  }
  const text = await callViaProxy({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-x',
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl: fakeFetch,
  })
  assert.equal(text, 'proxied reply')
  assert.equal(calledUrl, '/api/ai/chat')
  assert.equal(calledBody.apiKey, 'sk-x')
})

test('callViaProxy throws without hitting the network when baseUrl is missing', async () => {
  await assert.rejects(
    () => callViaProxy({ apiKey: 'sk-x', messages: [] }),
    /Missing API base URL/
  )
})

// ------------------------------------------------------------
// Gemini streaming
// ------------------------------------------------------------
// CAVEAT: the SSE event shape asserted below ({event_type:
// "step.delta", delta: {type: "text", text: "..."}}) is built from
// Google's current documentation, not a live-verified stream — see
// the caveat comment on streamGemini itself in aiProviders.js. These
// tests confirm the parser behaves correctly IF that's the real
// shape; they can't confirm the shape itself the way the
// non-streaming tests above can (those assert against a
// live-confirmed response).

// Builds a fake fetch Response whose body is a ReadableStream-like
// object emitting the given SSE (Server-Sent Events) text in one
// or more chunks, so streamGemini's incremental parsing can be
// tested without a real network connection.
function fakeSseResponse(sseText, { chunked = false } = {}) {
  const encoder = new TextEncoder()
  const pieces = chunked
    ? sseText.match(/[\s\S]{1,20}/g) || [sseText] // split into small arbitrary chunks
    : [sseText]
  let i = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            if (i >= pieces.length) return { done: true, value: undefined }
            const value = encoder.encode(pieces[i])
            i += 1
            return { done: false, value }
          },
        }
      },
    },
  }
}

function sseEvent(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`
}

test('streamGemini invokes onChunk incrementally and returns the full text', async () => {
  // INPUT: an SSE stream with two step.delta text events, delivered
  // in one fetch chunk
  const sse = [
    sseEvent({ event_type: 'step.delta', delta: { type: 'text', text: 'Hello ' } }),
    sseEvent({ event_type: 'step.delta', delta: { type: 'text', text: 'world' } }),
  ].join('')
  const fakeFetch = async () => fakeSseResponse(sse)

  const chunksSeen = []
  const finalText = await streamGemini({
    apiKey: 'MY-KEY',
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl: fakeFetch,
    onChunk: (delta, fullSoFar) => chunksSeen.push({ delta, fullSoFar }),
  })

  assert.equal(finalText, 'Hello world')
  assert.deepEqual(chunksSeen, [
    { delta: 'Hello ', fullSoFar: 'Hello ' },
    { delta: 'world', fullSoFar: 'Hello world' },
  ])
})

test('streamGemini ignores non-text-delta events (step.start/stop, thought deltas)', async () => {
  // INPUT: a stream that includes step lifecycle and "thought" delta
  // events interleaved with the real text deltas
  // EXPECTED: only the step.delta/text events contribute to the
  // final text
  const sse = [
    sseEvent({ event_type: 'step.start', step: { type: 'thought' } }),
    sseEvent({ event_type: 'step.delta', delta: { type: 'thought_signature', signature: 'xyz' } }),
    sseEvent({ event_type: 'step.stop' }),
    sseEvent({ event_type: 'step.start', step: { type: 'model_output' } }),
    sseEvent({ event_type: 'step.delta', delta: { type: 'text', text: 'OK' } }),
    sseEvent({ event_type: 'step.stop' }),
  ].join('')
  const fakeFetch = async () => fakeSseResponse(sse)

  const finalText = await streamGemini({
    apiKey: 'MY-KEY',
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl: fakeFetch,
    onChunk: () => {},
  })
  assert.equal(finalText, 'OK')
})

test('streamGemini reassembles an SSE event split across multiple fetch chunks', async () => {
  // INPUT: the same two-event stream, but delivered in small,
  // arbitrary byte chunks that split events and even JSON tokens
  // across chunk boundaries — this is what a real network stream
  // looks like, unlike the single-chunk test above
  const sse = [
    sseEvent({ event_type: 'step.delta', delta: { type: 'text', text: 'Hello ' } }),
    sseEvent({ event_type: 'step.delta', delta: { type: 'text', text: 'world' } }),
  ].join('')
  const fakeFetch = async () => fakeSseResponse(sse, { chunked: true })

  const finalText = await streamGemini({
    apiKey: 'MY-KEY',
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl: fakeFetch,
    onChunk: () => {},
  })

  assert.equal(finalText, 'Hello world')
})

test('streamGemini throws on an error event mid-stream', async () => {
  // INPUT: an SSE stream whose single event is an error payload
  // EXPECTED: throws with that message, no text returned
  const sse = sseEvent({ error: { message: 'quota exceeded' } })
  const fakeFetch = async () => fakeSseResponse(sse)

  await assert.rejects(
    () => streamGemini({ apiKey: 'MY-KEY', messages: [{ role: 'user', content: 'hi' }], fetchImpl: fakeFetch }),
    /quota exceeded/
  )
})

test('streamGemini falls back to the non-streaming call when the fetch mock has no readable body', async () => {
  // INPUT: a fetch mock shaped like callGemini's (a plain .json()
  // response, no .body.getReader) — simulates an environment
  // without streaming support
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'fallback reply' }] }] }),
  })
  const chunksSeen = []
  const text = await streamGemini({
    apiKey: 'MY-KEY',
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl: fakeFetch,
    onChunk: (delta, full) => chunksSeen.push(full),
  })
  assert.equal(text, 'fallback reply')
  assert.deepEqual(chunksSeen, ['fallback reply'])
})

test('streamGemini handles events separated by a single newline (no blank line)', async () => {
  // INPUT: two SSE events separated by ONE "\n" instead of a blank
  // line ("\n\n") — this is the exact shape that caused the real
  // "Gemini API returned an empty response" bug against the old API
  // (entry #9), since the old parser only ever looked for a
  // blank-line separator. The line-based parser here handles both
  // shapes identically, regardless of which API surface is in use.
  const sse = [
    'data: ' + JSON.stringify({ event_type: 'step.delta', delta: { type: 'text', text: 'Hello ' } }) + '\n',
    'data: ' + JSON.stringify({ event_type: 'step.delta', delta: { type: 'text', text: 'world' } }) + '\n',
  ].join('')
  const fakeFetch = async () => fakeSseResponse(sse)

  const finalText = await streamGemini({
    apiKey: 'MY-KEY',
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl: fakeFetch,
    onChunk: () => {},
  })
  assert.equal(finalText, 'Hello world')
})

test('streamGemini flushes a final event with no trailing newline at all', async () => {
  // INPUT: the stream closes immediately after the last event's
  // data, with no newline of any kind at the end
  const sse = 'data: ' + JSON.stringify({ event_type: 'step.delta', delta: { type: 'text', text: 'final answer, no trailing newline' } })
  const fakeFetch = async () => fakeSseResponse(sse)

  const finalText = await streamGemini({
    apiKey: 'MY-KEY',
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl: fakeFetch,
    onChunk: () => {},
  })
  assert.equal(finalText, 'final answer, no trailing newline')
})
