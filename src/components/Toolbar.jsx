import { AI_ASSISTANT_ENABLED } from '../config.js'

// ============================================================
// Toolbar — undo, redo, zoom, quick actions
// ============================================================

export default function Toolbar({
  canUndo, canRedo, onUndo, onRedo,
  zoom, onZoomIn, onZoomOut, onZoomReset,
  onImport, onSave, onCopyYAML,
  onAddJob, onAddTrigger,
  onToggleAI, aiVisible,
}) {
  return (
    <div className="toolbar">
      <button className="btn btn--ghost btn--icon" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        ↩ Undo
      </button>
      <button className="btn btn--ghost btn--icon" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)">
        ↪ Redo
      </button>

      <div className="toolbar__sep" />

      <button className="btn btn--ghost btn--icon" onClick={onImport} title="Import YAML file">
        📂 Import
      </button>
      <button className="btn btn--ghost btn--icon" onClick={onSave} title="Save file">
        💾 Save
      </button>
      <button className="btn btn--ghost btn--icon" onClick={onCopyYAML} title="Copy YAML to clipboard">
        📋 Copy YAML
      </button>

      <div className="toolbar__sep" />

      <button className="btn btn--ghost btn--icon" onClick={onAddJob} title="Add new job">
        + Job
      </button>
      <button className="btn btn--ghost btn--icon" onClick={onAddTrigger} title="Add trigger">
        + Trigger
      </button>

      <div className="toolbar__sep" />

      {AI_ASSISTANT_ENABLED && (
        <button
          className="btn btn--ghost btn--icon"
          onClick={onToggleAI}
          style={{ color: 'var(--accent)' }}
          title="Toggle AI assistant"
        >
          🤖 AI {aiVisible ? '▼' : '▶'}
        </button>
      )}

      <div className="toolbar__spacer" />

      <div className="toolbar__zoom">
        <button className="btn btn--ghost btn--icon" onClick={onZoomOut} title="Zoom out" style={{ padding: '2px 8px' }}>−</button>
        <span className="toolbar__zoom-level">{zoom}%</span>
        <button className="btn btn--ghost btn--icon" onClick={onZoomIn}  title="Zoom in"  style={{ padding: '2px 8px' }}>+</button>
        <button className="btn btn--ghost btn--icon" onClick={onZoomReset} title="Reset zoom" style={{ padding: '2px 6px', fontSize: 10 }}>⊙</button>
      </div>
    </div>
  )
}
