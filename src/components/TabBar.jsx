import { useEffect, useRef, useState } from 'react'

// ============================================================
// TabBar — file tabs
// ============================================================

function FileTab({ tab, isActive, onSelect, onClose, onRename }) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftName, setDraftName] = useState(tab.name.split('/').pop())
  const inputRef = useRef(null)

  useEffect(() => {
    setDraftName(tab.name.split('/').pop())
  }, [tab.name])

  useEffect(() => {
    if (!isEditing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isEditing])

  const submitRename = () => {
    const trimmedName = draftName.trim()
    if (trimmedName && trimmedName !== tab.name.split('/').pop()) {
      onRename(tab.id, trimmedName)
    } else {
      setDraftName(tab.name.split('/').pop())
    }
    setIsEditing(false)
  }

  return (
    <div
      className={`tabbar__tab${isActive ? ' tabbar__tab--active' : ''}${isEditing ? ' tabbar__tab--editing' : ''}`}
      onClick={() => !isEditing && onSelect(tab.id)}
      onDoubleClick={() => setIsEditing(true)}
      title={isEditing ? tab.name : `${tab.name} (double-click to rename)`}
    >
      <span className="tabbar__tab-icon">⚙</span>
      {isEditing ? (
        <input
          ref={inputRef}
          className="tabbar__input"
          value={draftName}
          onChange={e => setDraftName(e.target.value)}
          onBlur={submitRename}
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key === 'Enter') submitRename()
            if (e.key === 'Escape') {
              setDraftName(tab.name.split('/').pop())
              setIsEditing(false)
            }
          }}
        />
      ) : (
        <span className="tabbar__tab-name">{tab.name.split('/').pop()}</span>
      )}
      {tab.modified && <span className="tabbar__tab-dot" title="Unsaved changes" />}
      <button
        className="tabbar__tab-close"
        onClick={e => { e.stopPropagation(); onClose(tab.id) }}
        title="Close tab"
      >
        ×
      </button>
    </div>
  )
}

export default function TabBar({ tabs, activeId, onSelect, onClose, onNew, onRename }) {
  return (
    <div className="tabbar">
      {tabs.map(tab => (
        <FileTab
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeId}
          onSelect={onSelect}
          onClose={onClose}
          onRename={onRename}
        />
      ))}
      <button className="tabbar__new" onClick={onNew} title="New file">+</button>
    </div>
  )
}
