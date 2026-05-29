import { useState, useRef, useEffect } from 'react'
import { AI_PROVIDERS, streamGemini, callViaProxy, callGeminiDemo } from '../utils/aiProviders.js'

// ============================================================
// AIPanel — "bring your own key" GitHub Actions assistant
// ============================================================
//
// No API key or conversation is ever stored anywhere this app's
// authors control. Provider settings (which provider, the user's
// own key, model, base URL) are persisted only in the browser's
// own localStorage, under STORAGE_KEY, so they survive a reload
// but never leave the user's machine except in the direct
// provider call itself. See src/config.js and src/utils/aiProviders.js
// for the full design.
//
// Exception: if Gemini is selected and the user hasn't entered a
// key of their own, the panel falls back to a rate-limited demo
// endpoint (api/ai-demo.js) backed by a maintainer-supplied key
// that lives only on the server — never sent to, or stored by,
// this browser. This is a convenience for trying the tool without
// setup (reviewers, first-time visitors), not a change to the BYOK
// design above.

const STORAGE_KEY = 'actions-editor:ai-config'

const CHIPS = [
  'Explain this workflow',
  'Fix lint errors',
  'Add caching step',
  'Add matrix strategy',
  'Best practices',
  'Add Docker build',
  'Make it faster',
]

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function saveConfig(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) — the
    // panel still works for the current page load, it just won't
    // remember settings on reload.
  }
}

function defaultConfigForProvider(providerId) {
  const provider = AI_PROVIDERS[providerId]
  return {
    apiKey: '',
    model: provider.defaultModel,
    baseUrl: provider.defaultBaseUrl || '',
  }
}

function initialConfig() {
  const stored = loadConfig()
  if (stored && AI_PROVIDERS[stored.provider]) return stored
  return {
    provider: 'gemini',
    gemini: defaultConfigForProvider('gemini'),
    custom: defaultConfigForProvider('custom'),
  }
}

export default function AIPanel({ yamlOutput, onClose }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "Hi! I'm your GitHub Actions assistant. I run on an AI provider you connect yourself — open Settings below to add your API key.\n\nGoogle Gemini also works out of the box on a shared, rate-limited demo key, so you can try me right now — add your own free Gemini key in Settings for unlimited, faster use.\n\nTry asking me something or click a suggestion below.",
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [config, setConfig] = useState(initialConfig)
  const messagesRef = useRef(null)

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages, loading])

  useEffect(() => {
    saveConfig(config)
  }, [config])

  const provider = AI_PROVIDERS[config.provider]
  const providerConfig = config[config.provider]
  const hasKey = Boolean(providerConfig?.apiKey)
  // Gemini only: no key configured, but the provider supports a
  // server-side demo fallback (api/ai-demo.js). Never true for the "custom" provider: there is no
  // demo path for arbitrary OpenAI-compatible endpoints, since
  // there's no single server-side key that could stand in for them.
  const useDemo = !hasKey && Boolean(provider.demoAvailable)
  const canSend = hasKey || useDemo

  function updateProviderConfig(patch) {
    setConfig(c => ({ ...c, [c.provider]: { ...c[c.provider], ...patch } }))
  }

  function switchProvider(providerId) {
    setConfig(c => ({ ...c, provider: providerId }))
  }

  // Appends a delta to the assistant message at the given index,
  // used while a streamed reply is arriving piece by piece.
  function appendToMessage(index, delta) {
    setMessages(m => {
      const next = [...m]
      next[index] = { ...next[index], content: next[index].content + delta }
      return next
    })
  }

  const send = async (text) => {
    const msg = (text || input).trim()
    if (!msg || loading) return

    if (!canSend) {
      setShowSettings(true)
      setMessages(m => [...m, {
        role: 'assistant',
        content: `Add your ${provider.label} API key in Settings before asking me anything — I don't ship with one.`,
      }])
      return
    }

    setInput('')
    const nextMessages = [...messages, { role: 'user', content: msg }]
    setMessages(nextMessages)
    setLoading(true)

    const systemPrompt = `You are a GitHub Actions expert assistant embedded in a YAML workflow editor.

Your role is to help developers with:
- Writing and debugging GitHub Actions workflows
- YAML syntax and structure
- Best practices for CI/CD pipelines (security, performance, reliability)
- Explaining GitHub Actions concepts
- Suggesting improvements and fixes

Current workflow being edited:
\`\`\`yaml
${yamlOutput || '(empty workflow)'}
\`\`\`

Keep responses concise and practical. When suggesting YAML, use code blocks. Highlight potential security issues or best practice violations.`

    // Only real conversation goes back to the model: the panel's own
    // "⚠️ …" error bubbles and any empty bubble (left behind when a
    // streamed reply failed before its first chunk) are UI state, and an
    // empty text part is rejected by Gemini ("Missing text in content of
    // type text") — which, left in, broke every later message too.
    const history = nextMessages
      .filter(m => m.content && m.content.trim() !== '' && !(m.role === 'assistant' && m.content.startsWith('⚠️')))
      .slice(-8)
      .map(m => ({ role: m.role, content: m.content }))

    try {
      if (useDemo) {
        // Demo path: no key on this browser at all, so there's nothing
        // to stream with — the reply comes back from api/ai-demo.js in
        // one piece (see aiProviders.js's callGeminiDemo for why that
        // endpoint is non-streaming). Still shows a "Thinking…"
        // indicator via the existing `loading` state below, same as
        // the proxy path.
        const reply = await callGeminiDemo({
          model: providerConfig.model,
          systemPrompt,
          messages: history,
        })
        setMessages(m => [...m, { role: 'assistant', content: reply }])
      } else if (provider.mode === 'direct') {
        // Streamed: an empty assistant bubble appears immediately and
        // fills in as text arrives, instead of the whole panel sitting
        // on "Thinking…" until the entire reply is ready. The index is
        // computed from nextMessages.length directly (rather than read
        // back from a setState updater) so it's correct regardless of
        // when React actually processes the queued update.
        const assistantIndex = nextMessages.length
        setMessages(m => [...m, { role: 'assistant', content: '' }])
        await streamGemini({
          apiKey: providerConfig.apiKey,
          model: providerConfig.model,
          systemPrompt,
          messages: history,
          onChunk: delta => appendToMessage(assistantIndex, delta),
        })
      } else {
        const reply = await callViaProxy({
          baseUrl: providerConfig.baseUrl,
          apiKey: providerConfig.apiKey,
          model: providerConfig.model,
          systemPrompt,
          messages: history,
        })
        setMessages(m => [...m, { role: 'assistant', content: reply }])
      }
    } catch (err) {
      setMessages(m => {
        // Drop the empty placeholder bubble a failed stream leaves behind
        const last = m[m.length - 1]
        const base = last && last.role === 'assistant' && last.content === '' ? m.slice(0, -1) : m
        return [...base, { role: 'assistant', content: `⚠️ ${err.message}` }]
      })
    }
    setLoading(false)
  }

  return (
    <div className="ai-panel">
      <div className="ai-panel__header">
        <span>🤖</span>
        <span>AI Assistant</span>
        <span className="ai-panel__badge">{provider.label}</span>
        {useDemo && (
          <span className="ai-panel__badge ai-panel__badge--demo" title="Using a shared, rate-limited demo key — add your own in Settings (⚙) for unrestricted use">
            Demo
          </span>
        )}
        <button
          className="ai-panel__close"
          onClick={() => setShowSettings(s => !s)}
          title="AI provider settings"
        >⚙</button>
        <button className="ai-panel__close" onClick={onClose} title="Close AI panel">×</button>
      </div>

      {showSettings && (
        <div className="ai-panel__settings">
          <p className="ai-panel__settings-note">
            No key is stored on any server — it's kept only in this browser's
            local storage and sent straight to the provider you pick below.
          </p>

          <div className="field-row">
            <label className="field-label">Provider</label>
            <select
              className="field-select"
              value={config.provider}
              onChange={e => switchProvider(e.target.value)}
            >
              {Object.values(AI_PROVIDERS).map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          <p className="ai-panel__settings-description">{provider.description}</p>

          <div className="field-row">
            <label className="field-label">API key</label>
            <input
              className="field-input field-input--mono"
              type="password"
              value={providerConfig.apiKey}
              onChange={e => updateProviderConfig({ apiKey: e.target.value })}
              placeholder={provider.demoAvailable ? 'Blank = shared demo key' : 'Paste your API key'}
            />
          </div>

          {useDemo && (
            <p className="ai-panel__settings-note">
              No key entered — using a shared, rate-limited demo key for now.
              It's held server-side and never touches this browser. Add your
              own key above for unlimited, faster use.
            </p>
          )}

          <div className="field-row">
            <label className="field-label">Model</label>
            {provider.models ? (
              <select
                className="field-select"
                value={provider.models.some(m => m.id === providerConfig.model) ? providerConfig.model : '__custom__'}
                onChange={e => updateProviderConfig({ model: e.target.value === '__custom__' ? '' : e.target.value })}
              >
                {provider.models.map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
                <option value="__custom__">Custom…</option>
              </select>
            ) : (
              <input
                className="field-input field-input--mono"
                type="text"
                value={providerConfig.model}
                onChange={e => updateProviderConfig({ model: e.target.value })}
              />
            )}
          </div>

          {provider.models && !provider.models.some(m => m.id === providerConfig.model) && (
            <div className="field-row">
              <label className="field-label">Custom model</label>
              <input
                className="field-input field-input--mono"
                type="text"
                value={providerConfig.model}
                placeholder="Enter a model name your key can use"
                onChange={e => updateProviderConfig({ model: e.target.value })}
              />
            </div>
          )}

          {useDemo && provider.models && !provider.models.some(m => m.id === providerConfig.model) && (
            <p className="ai-panel__settings-note">
              The shared demo key only serves the listed models, so a custom
              model name is used only with your own key.
            </p>
          )}

          {provider.mode === 'proxy' && (
            <>
              <div className="field-row">
                <label className="field-label">Base URL</label>
                <input
                  className="field-input field-input--mono"
                  type="text"
                  value={providerConfig.baseUrl}
                  onChange={e => updateProviderConfig({ baseUrl: e.target.value })}
                />
              </div>
              <p className="ai-panel__settings-note">
                Requires the local backend running ("npm run backend" or "npm run dev:full").
              </p>
            </>
          )}

          <a className="ai-panel__settings-link" href={provider.keyHelpUrl} target="_blank" rel="noreferrer">
            Get a {provider.label} API key ↗
          </a>
        </div>
      )}

      <div className="ai-panel__messages" ref={messagesRef}>
        {messages.map((msg, i) => (
          <div key={i} className={`ai-msg ai-msg--${msg.role}`}>
            {msg.content}
          </div>
        ))}
        {loading && (
          <div className="ai-msg ai-msg--assistant ai-msg--loading">
            <div className="progress-bar" />
            Thinking…
          </div>
        )}
      </div>

      <div className="ai-panel__chips">
        {CHIPS.map(chip => (
          <button key={chip} className="ai-chip" onClick={() => send(chip)}>{chip}</button>
        ))}
      </div>

      <div className="ai-panel__input-row">
        <textarea
          className="ai-panel__input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={canSend ? 'Ask about your workflow…' : 'Add an API key in Settings (⚙) first…'}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          rows={1}
        />
        <button
          className="ai-panel__send"
          onClick={() => send()}
          disabled={loading || !input.trim()}
          title="Send (Enter)"
        >↑</button>
      </div>
    </div>
  )
}
