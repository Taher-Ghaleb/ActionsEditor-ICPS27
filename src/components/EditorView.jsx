import { useEffect, useRef } from 'react'
import { highlightYAMLLine } from '../utils/highlighter.jsx'

// ============================================================
// EditorView — syntax-highlighted YAML display with line gutter
// ============================================================

export default function EditorView({ yamlLines, zoom, lintIssues, selectedLine, onSelectLine, onContextMenu }) {
  const linesRef = useRef(null)
  const gutterRef = useRef(null)

  const errorLines = new Set(lintIssues.filter(i => i.line && i.type === 'error').map(i => i.line))
  const warningLines = new Set(lintIssues.filter(i => i.line && i.type !== 'error').map(i => i.line))

  // Sync scroll between gutter and lines
  const handleScroll = () => {
    if (gutterRef.current && linesRef.current) {
      gutterRef.current.scrollTop = linesRef.current.scrollTop
    }
  }

  const fontSize = Math.round(13 * zoom / 100)
  const lineHeight = Math.round(22 * zoom / 100)

  // Bring the selected line into view (e.g. after clicking a problem).
  useEffect(() => {
    const box = linesRef.current
    if (!box || !selectedLine) return
    const top = (selectedLine - 1) * lineHeight
    if (top < box.scrollTop || top + lineHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = Math.max(0, top - box.clientHeight / 3)
    }
  }, [selectedLine, lineHeight])

  return (
    <div className="editor-area">
      {/* Line Gutter */}
      <div
        ref={gutterRef}
        className="line-gutter"
        style={{ overflow: 'hidden', fontSize: Math.round(11.5 * zoom / 100) }}
      >
        {yamlLines.map((_, i) => (
          <div
            key={i}
            className="line-gutter__row"
            style={{ height: lineHeight }}
            onClick={() => onSelectLine(i + 1)}
          >
            <button
              className="line-gutter__add"
              title="Insert line below"
              onClick={e => { e.stopPropagation() /* TODO: insert snippet */ }}
            >
              +
            </button>
            {i + 1}
          </div>
        ))}
      </div>

      {/* Lines */}
      <div
        ref={linesRef}
        className="editor-lines"
        tabIndex={0}
        onScroll={handleScroll}
        style={{ fontSize, lineHeight: `${lineHeight}px` }}
      >
        {yamlLines.map((line, i) => {
          const lineNum = i + 1
          const isSelected = selectedLine === lineNum
          const hasError = errorLines.has(lineNum)
          let cls = 'editor-line'
          if (isSelected) cls += ' editor-line--selected'
          if (hasError) cls += ' editor-line--error'
          else if (warningLines.has(lineNum)) cls += ' editor-line--warning'

          return (
            <div
              key={i}
              className={cls}
              style={{ height: lineHeight }}
              onClick={() => onSelectLine(lineNum)}
              onContextMenu={e => { e.preventDefault(); onContextMenu(e, lineNum) }}
            >
              {highlightYAMLLine(line)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
