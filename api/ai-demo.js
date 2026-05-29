// ============================================================
// api/ai-demo.js — Vercel serverless function
// ============================================================
//
// Reviewer-facing Gemini demo endpoint. Lets someone try the AI panel
// on the public deployment without pasting in their own API key. It
// exists ALONGSIDE the "bring your own key" design in
// src/utils/aiProviders.js, not instead of it.
//
// Security shape, stated plainly:
//   - The Gemini key lives only in this function's environment
//     (the GEMINI_API_KEY variable, set in the Vercel project's
//     Environment Variables settings — never committed to the repo,
//     never present in the client bundle).
//   - The browser never talks to Google's API for this path; it only
//     ever calls this same-origin /api/ai-demo endpoint, so the key
//     never appears in the browser's network tab, localStorage, or
//     any client-side code, regardless of how closely a reviewer
//     inspects the page.
//   - Nothing about the request (messages, IP, reply) is logged or
//     written to any datastore. The only state this function keeps
//     is the in-memory rate-limit counter in api/_lib/geminiDemo.js,
//     which holds timestamps only, not request content.
//
// This is a thin handler on purpose: request building, response
// parsing, and rate limiting are all pure/testable functions in
// api/_lib/geminiDemo.js (see tests/aiDemo.test.mjs), mirroring the
// build_forward_request / extract_reply_text split already used in
// backend/server.py for the OpenAI-compatible proxy.

import {
  buildDemoRequest,
  parseDemoResponse,
  checkRateLimit,
  getClientIp,
  DemoValidationError,
  FALLBACK_MODEL,
  isOverloadStatus,
} from './_lib/geminiDemo.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({
      error: '/api/ai-demo only accepts POST requests. This route is called by the app itself.',
    })
    return
  }

  const ip = getClientIp(req)
  const { limited } = checkRateLimit(ip)
  if (limited) {
    res.status(429).json({
      error: 'The shared demo key has hit its rate limit for now. Add your own free Gemini key in Settings (⚙) for unrestricted use — see the "Get a Google Gemini API key" link there.',
    })
    return
  }

  const body = req.body || {}

  let url, headers, payload
  try {
    ;({ url, headers, payload } = buildDemoRequest({
      apiKey: process.env.GEMINI_API_KEY,
      model: body.model,
      systemPrompt: body.systemPrompt,
      messages: body.messages,
    }))
  } catch (err) {
    if (err instanceof DemoValidationError && err.message === 'missing_server_key') {
      // The deployment itself isn't configured (no GEMINI_API_KEY env
      // var set) — not the reviewer's fault, so 503 rather than 400.
      res.status(503).json({
        error: 'The demo AI key is not configured on this deployment. Add your own Gemini key in Settings (⚙) instead.',
      })
      return
    }
    res.status(400).json({ error: err.message })
    return
  }

  // Google answers 429/503 ("high demand") for short spikes. Retry the
  // requested model once, then try the fallback model once, so the reviewer
  // rarely has to retry by hand. `usedModel` reports which model answered.
  const tryModels = payload.model === FALLBACK_MODEL ? [FALLBACK_MODEL] : [payload.model, FALLBACK_MODEL]
  let upstream, data
  for (let i = 0; i < tryModels.length; i++) {
    payload.model = tryModels[i]
    const attempts = i === 0 ? 2 : 1
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        upstream = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        })
      } catch (err) {
        res.status(502).json({ error: `Could not reach Gemini: ${err.message}` })
        return
      }
      try {
        data = await upstream.json()
      } catch {
        res.status(502).json({ error: `Gemini returned a non-JSON response (HTTP ${upstream.status}).` })
        return
      }
      if (isOverloadStatus(upstream.status) && attempt < attempts - 1) {
        await new Promise(r => setTimeout(r, 1200))
        continue
      }
      break
    }
    if (!isOverloadStatus(upstream.status)) break
  }
  const usedModel = payload.model

  let text
  try {
    text = parseDemoResponse(data)
  } catch (err) {
    const status = upstream.ok ? 502 : (upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502)
    res.status(status).json({ error: err.message })
    return
  }

  res.status(200).json({ text, model: usedModel })
}
