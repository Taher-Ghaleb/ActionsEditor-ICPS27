import React from 'react'

// ============================================================
// YAML Syntax Highlighter
// Returns React spans with token class names
// ============================================================

export function highlightYAMLLine(line) {
  if (!line && line !== '') return <span>&nbsp;</span>
  if (!line.trim()) return <span>&nbsp;</span>

  // Comment
  if (/^\s*#/.test(line)) {
    return <span className="token-comment">{line}</span>
  }

  // Key: value
  const kvMatch = line.match(/^(\s*)([\w\-.]+)(\s*:\s*)(.*)$/)
  if (kvMatch) {
    const [, indent, key, colon, val] = kvMatch
    return (
      <>
        <span>{indent}</span>
        <span className="token-key">{key}</span>
        <span className="token-comment">{colon}</span>
        {renderValue(val)}
      </>
    )
  }

  // List item
  const listMatch = line.match(/^(\s*)(- )(.*)$/)
  if (listMatch) {
    const [, indent, dash, val] = listMatch
    return (
      <>
        <span>{indent}</span>
        <span className="token-dash">{dash}</span>
        {renderValue(val)}
      </>
    )
  }

  // Fallback
  return <span className="token-val">{line}</span>
}

function renderValue(val) {
  const v = val.trim()
  if (!v) return <span></span>

  if (v === 'true' || v === 'false') return <span className="token-bool">{val}</span>
  if (v === 'null' || v === '~') return <span className="token-bool">{val}</span>
  if (/^\d+(\.\d+)?$/.test(v)) return <span className="token-num">{val}</span>
  if (v.startsWith('"') || v.startsWith("'")) return <span className="token-str">{val}</span>
  if (v.startsWith('${{')) return <span className="token-special">{val}</span>
  if (v === '|' || v === '|-' || v === '>' || v === '>-') return <span className="token-special">{val}</span>

  return <span className="token-val">{val}</span>
}
