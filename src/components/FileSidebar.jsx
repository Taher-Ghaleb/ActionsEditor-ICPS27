import { useEffect, useRef, useState } from 'react'

function ProjectItem({
  project,
  files,
  isActive,
  isExpanded,
  onToggleExpanded,
  onSelect,
  onRename,
  onDelete,
  onNewFile,
  activeTabId,
  onSelectTab,
  onRenameTab,
  onCloseTab,
}) {
  const [isEditingProject, setIsEditingProject] = useState(false)
  const [projectDraft, setProjectDraft] = useState(project.name)
  const projectInputRef = useRef(null)

  useEffect(() => {
    setProjectDraft(project.name)
  }, [project.name])

  useEffect(() => {
    if (!isEditingProject) return
    projectInputRef.current?.focus()
    projectInputRef.current?.select()
  }, [isEditingProject])

  const submitProjectRename = () => {
    const trimmedName = projectDraft.trim()
    if (trimmedName && trimmedName !== project.name) {
      onRename(project.id, trimmedName)
    } else {
      setProjectDraft(project.name)
    }
    setIsEditingProject(false)
  }

  return (
    <section className={`file-sidebar__project${isActive ? ' file-sidebar__project--active' : ''}`}>
      <div
        className="file-sidebar__project-header"
        onClick={() => onSelect(project.id)}
        onDoubleClick={() => setIsEditingProject(true)}
        title={isEditingProject ? project.name : `${project.name} (double-click to rename)`}
      >
        <button
          className={`file-sidebar__chevron${isExpanded ? ' file-sidebar__chevron--open' : ''}`}
          onClick={e => {
            e.stopPropagation()
            onToggleExpanded(project.id)
          }}
          title={isExpanded ? 'Collapse project' : 'Expand project'}
        >
          ▶
        </button>
        <span className="file-sidebar__project-icon">{project.kind === 'github' ? 'GH' : 'LO'}</span>
        {isEditingProject ? (
          <input
            ref={projectInputRef}
            className="file-sidebar__project-input"
            value={projectDraft}
            onChange={e => setProjectDraft(e.target.value)}
            onClick={e => e.stopPropagation()}
            onDoubleClick={e => e.stopPropagation()}
            onBlur={submitProjectRename}
            onKeyDown={e => {
              if (e.key === 'Enter') submitProjectRename()
              if (e.key === 'Escape') {
                setProjectDraft(project.name)
                setIsEditingProject(false)
              }
            }}
          />
        ) : (
          <span className="file-sidebar__project-name">{project.name}</span>
        )}
        <span className="badge">{files.length}</span>
        <button
          className="file-sidebar__icon-btn file-sidebar__icon-btn--danger"
          onClick={e => {
            e.stopPropagation()
            onDelete(project.id)
          }}
          title={`Delete ${project.name}`}
        >
          🗑
        </button>
        <button
          className="file-sidebar__icon-btn"
          onClick={e => {
            e.stopPropagation()
            onNewFile(project.id)
          }}
          title={`New file in ${project.name}`}
        >
          +
        </button>
      </div>

      {isExpanded && (
        <div className="file-sidebar__files">
          {files.map(tab => (
            <FileItem
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onSelectTab={onSelectTab}
              onRenameTab={onRenameTab}
              onCloseTab={onCloseTab}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function FileItem({ tab, isActive, onSelectTab, onRenameTab, onCloseTab }) {
  const [isEditingFile, setIsEditingFile] = useState(false)
  const [fileDraft, setFileDraft] = useState(tab.name.split('/').pop())
  const fileInputRef = useRef(null)

  useEffect(() => {
    setFileDraft(tab.name.split('/').pop())
  }, [tab.name])

  useEffect(() => {
    if (!isEditingFile) return
    fileInputRef.current?.focus()
    fileInputRef.current?.select()
  }, [isEditingFile])

  const submitFileRename = () => {
    const trimmedName = fileDraft.trim()
    const currentName = tab.name.split('/').pop()

    if (trimmedName && trimmedName !== currentName) {
      onRenameTab(tab.id, trimmedName)
    } else {
      setFileDraft(currentName)
    }
    setIsEditingFile(false)
  }

  return (
    <div
      className={`file-sidebar__file${isActive ? ' file-sidebar__file--active' : ''}`}
      onClick={() => !isEditingFile && onSelectTab(tab.id)}
      onDoubleClick={() => setIsEditingFile(true)}
      title={isEditingFile ? tab.name : `${tab.name} (double-click to rename)`}
    >
      <span className="file-sidebar__file-icon">📄</span>
      {isEditingFile ? (
        <input
          ref={fileInputRef}
          className="file-sidebar__file-input"
          value={fileDraft}
          onChange={e => setFileDraft(e.target.value)}
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
          onBlur={submitFileRename}
          onKeyDown={e => {
            if (e.key === 'Enter') submitFileRename()
            if (e.key === 'Escape') {
              setFileDraft(tab.name.split('/').pop())
              setIsEditingFile(false)
            }
          }}
        />
      ) : (
        <span className="file-sidebar__file-name">{tab.name.split('/').pop()}</span>
      )}
      {tab.modified && <span className="file-sidebar__modified-dot" title="Unsaved changes" />}
      <button
        className="file-sidebar__icon-btn"
        onClick={e => {
          e.stopPropagation()
          onCloseTab(tab.id)
        }}
        title="Close file"
      >
        ×
      </button>
    </div>
  )
}

export default function FileSidebar({
  projects,
  tabs,
  activeProjectId,
  activeTabId,
  onSelectProject,
  onSelectTab,
  onRenameProject,
  onDeleteProject,
  onRenameTab,
  onCloseTab,
  onNewFile,
}) {
  const [expandedProjects, setExpandedProjects] = useState(() => (
    Object.fromEntries(projects.map(project => [project.id, true]))
  ))

  useEffect(() => {
    setExpandedProjects(prev => {
      const next = { ...prev }

      projects.forEach(project => {
        if (!(project.id in next)) {
          next[project.id] = true
        }
      })

      Object.keys(next).forEach(key => {
        if (!projects.some(project => project.id === Number(key))) {
          delete next[key]
        }
      })

      return next
    })
  }, [projects])

  useEffect(() => {
    if (!activeProjectId) return
    setExpandedProjects(prev => ({ ...prev, [activeProjectId]: true }))
  }, [activeProjectId])

  const toggleExpanded = projectId => {
    setExpandedProjects(prev => ({
      ...prev,
      [projectId]: !prev[projectId],
    }))
  }

  return (
    <aside className="file-sidebar">
      <div className="file-sidebar__title">
        <span>Files</span>
        <button
          className="file-sidebar__add-btn"
          onClick={() => onNewFile(activeProjectId)}
          title="New YAML file"
        >
          + New
        </button>
      </div>

      <div className="file-sidebar__body">
        {projects.map(project => {
          const projectFiles = tabs.filter(tab => tab.projectId === project.id)

          return (
            <ProjectItem
              key={project.id}
              project={project}
              files={projectFiles}
              isActive={project.id === activeProjectId}
              isExpanded={expandedProjects[project.id] !== false}
              onToggleExpanded={toggleExpanded}
              onSelect={onSelectProject}
              onRename={onRenameProject}
              onDelete={onDeleteProject}
              onNewFile={onNewFile}
              activeTabId={activeTabId}
              onSelectTab={onSelectTab}
              onRenameTab={onRenameTab}
              onCloseTab={onCloseTab}
            />
          )
        })}
      </div>

      <div className="file-sidebar__footer">
        <span>{projects.length} project{projects.length === 1 ? '' : 's'}</span>
        <span>•</span>
        <span>{tabs.length} file{tabs.length === 1 ? '' : 's'}</span>
      </div>
    </aside>
  )
}
