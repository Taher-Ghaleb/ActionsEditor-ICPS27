import { useEffect, useRef, useState } from 'react'

// ============================================================
// ProjectBar — top-level repository/project tabs
// ============================================================

function ProjectBarTab({ project, isActive, onSelect, onRename }) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftName, setDraftName] = useState(project.name)
  const inputRef = useRef(null)

  useEffect(() => {
    setDraftName(project.name)
  }, [project.name])

  useEffect(() => {
    if (!isEditing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isEditing])

  const submitRename = () => {
    const trimmedName = draftName.trim()
    if (trimmedName && trimmedName !== project.name) {
      onRename(project.id, trimmedName)
    } else {
      setDraftName(project.name)
    }
    setIsEditing(false)
  }

  return (
    <div
      className={`projectbar__tab${isActive ? ' projectbar__tab--active' : ''}${isEditing ? ' projectbar__tab--editing' : ''}`}
      onClick={() => !isEditing && onSelect(project.id)}
      onDoubleClick={() => setIsEditing(true)}
      onKeyDown={e => {
        if (isEditing) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(project.id)
        }
      }}
      title={isEditing ? project.name : `${project.name} (double-click to rename)`}
      role="button"
      tabIndex={0}
    >
      <span className="projectbar__icon">{project.kind === 'github' ? 'GH' : 'LO'}</span>
      {isEditing ? (
        <input
          ref={inputRef}
          className="projectbar__input"
          value={draftName}
          onChange={e => setDraftName(e.target.value)}
          onBlur={submitRename}
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key === 'Enter') submitRename()
            if (e.key === 'Escape') {
              setDraftName(project.name)
              setIsEditing(false)
            }
          }}
        />
      ) : (
        <span className="projectbar__name">{project.name}</span>
      )}
    </div>
  )
}

export default function ProjectBar({ projects, activeId, onSelect, onRename }) {
  return (
    <div className="projectbar">
      {projects.map(project => (
        <ProjectBarTab
          key={project.id}
          project={project}
          isActive={project.id === activeId}
          onSelect={onSelect}
          onRename={onRename}
        />
      ))}
    </div>
  )
}
