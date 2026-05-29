import { highlightYAMLLine } from '../utils/highlighter.jsx'
import { TEMPLATES } from '../data/templates.js'

// ============================================================
// PreviewView — syntax-highlighted read-only YAML
// ============================================================
export function PreviewView({
  yamlLines,
  format,
  formats,
  noticeMessage,
  onFormatChange,
  onCopy,
  onSave,
}) {
  return (
    <div className="preview-view">
      <div className="preview-view__header">
        <span>📄 Preview — {yamlLines.length} lines</span>
        <div className="preview-view__formats">
          {formats.map(option => (
            <button
              key={option.id}
              className={`btn btn--icon ${format === option.id ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => onFormatChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="preview-view__actions">
          <button className="btn btn--ghost btn--icon" onClick={onCopy}>📋 Copy</button>
          <button className="btn btn--ghost btn--icon" onClick={onSave}>💾 Save</button>
        </div>
      </div>
      {noticeMessage && (
        <div className="preview-view__notice">
          {noticeMessage}
        </div>
      )}
      <div className="yaml-preview">
        {yamlLines.map((line, i) => (
          <span key={i} className="yaml-preview__line">
            {highlightYAMLLine(line)}
          </span>
        ))}
      </div>
    </div>
  )
}

// ============================================================
// TemplatesView — template gallery
// ============================================================
export function TemplatesView({ onLoad }) {
  return (
    <div className="templates-view">
      <div className="templates-view__heading">
        GitHub Actions Templates
        <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 8, color: 'var(--text-muted)' }}>
          Click any template to open it in a new tab
        </span>
      </div>
      <div className="templates-grid">
        {TEMPLATES.map(t => (
          <div key={t.id} className="template-card" onClick={() => onLoad(t)}>
            <div className="template-card__icon">{t.icon}</div>
            <div className="template-card__name">{t.name}</div>
            <div className="template-card__desc">{t.desc}</div>
            <span className="template-card__badge">{t.lang}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================
// DiffView — shows diff between first undo state and current
// ============================================================
export function DiffView({ originalYAML, currentYAML }) {
  if (!originalYAML) {
    return (
      <div className="diff-view" style={{ padding: 20, color: 'var(--text-muted)' }}>
        No diff available yet. Make some edits to see changes here.
      </div>
    )
  }

  const aLines = originalYAML.split('\n')
  const bLines = currentYAML.split('\n')
  const maxLen = Math.max(aLines.length, bLines.length)
  const rows = []

  for (let i = 0; i < maxLen; i++) {
    const a = aLines[i]
    const b = bLines[i]
    if (a === b) {
      rows.push(<span key={i} className="diff-line--context">{`  ${b ?? ''}`}</span>)
    } else {
      if (a !== undefined) rows.push(<span key={`a${i}`} className="diff-line--removed">{`- ${a}`}</span>)
      if (b !== undefined) rows.push(<span key={`b${i}`} className="diff-line--added">{`+ ${b}`}</span>)
    }
  }

  return <div className="diff-view">{rows}</div>
}

// ============================================================
// LintPanel — problems panel at the bottom
// ============================================================
export function LintPanel({ issues, onSelectLine }) {
  const errCount  = issues.filter(i => i.type === 'error').length
  const warnCount = issues.filter(i => i.type === 'warning').length

  return (
    <div className="lint-panel">
      <div className="lint-panel__header">
        <span>Problems</span>
        {errCount  > 0 && <span className="lint-badge lint-badge--error">✗ {errCount} error{errCount !== 1 ? 's' : ''}</span>}
        {warnCount > 0 && <span className="lint-badge lint-badge--warning">⚠ {warnCount} warning{warnCount !== 1 ? 's' : ''}</span>}
        {errCount === 0 && warnCount === 0 && <span className="lint-badge lint-badge--ok">✓ Valid</span>}
      </div>
      <div className="lint-panel__list">
        {issues.length === 0 ? (
          <div className="lint-item">
            <span className="lint-item__icon" style={{ color: 'var(--green)' }}>✓</span>
            <span className="lint-item__msg" style={{ color: 'var(--text-muted)' }}>No problems detected</span>
          </div>
        ) : (
          issues.map((issue, i) => (
            <div
              key={i}
              className={`lint-item lint-item--${issue.type}`}
              title={issue.line ? `Go to line ${issue.line}` : undefined}
              onClick={() => issue.line && onSelectLine?.(issue.line)}
            >
              <span className="lint-item__icon">{issue.type === 'error' ? '✗' : '⚠'}</span>
              <span className="lint-item__msg">{issue.msg}</span>
              {issue.line && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                  L{issue.line}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
