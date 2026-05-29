// ============================================================
// Feature flags
// ============================================================

// The AI assistant panel (src/components/AIPanel.jsx) originally
// called the Anthropic API directly from the browser with a
// hardcoded, unauthenticated request — every call failed, and a
// "fixed" version would have meant shipping an API key in
// client-side JavaScript on a public deployment, which is a real
// credential-exposure risk. It was disabled for the Week 1
// revision.
//
// It has since been redesigned around a "bring your own key"
// model: the user supplies their own API key for a provider they
// already have, the key lives only in their browser's
// localStorage, and it is never sent to or stored on any server
// this project controls.
//   - Google Gemini is called directly from the browser (Gemini
//     keys support HTTP-referrer restriction, which is what makes
//     this safe for a provider that explicitly supports it).
//   - Any OpenAI-compatible provider (OpenAI itself, or a
//     self-hosted/local server) is routed through a stateless
//     proxy endpoint on the optional local backend
//     (backend/server.py: POST /api/ai/chat), since those
//     providers don't support calling their API directly from a
//     browser. The proxy forwards the request and forgets it —
//     see the comment above that endpoint.
export const AI_ASSISTANT_ENABLED = true
