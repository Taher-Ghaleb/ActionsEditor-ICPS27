import { useState, useEffect, useCallback } from 'react'
import { AI_ASSISTANT_ENABLED } from '../config.js'

// ============================================================
// TopBar — menu bar with File/Edit/Insert/View/GitHub menus
// ============================================================

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/>
      <path d="M9 18c-4.51 2-5-2-7-2"/>
    </svg>
  )
}

function MenuDropdown({ items, onClose }) {
  return (
    <div className="menu-dropdown" onClick={e => e.stopPropagation()}>
      {items.map((item, i) => {
        if (item.sep) return <div key={i} className="menu-dropdown__sep" />
        if (item.sub) return <div key={i} className="menu-dropdown__sub">{item.sub}</div>
        return (
          <div
            key={i}
            className={`menu-dropdown__item${item.danger ? ' menu-dropdown__item--danger' : ''}${item.disabled ? ' menu-dropdown__item--disabled' : ''}`}
            onClick={() => { item.action?.(); onClose() }}
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="menu-dropdown__shortcut">{item.shortcut}</span>}
          </div>
        )
      })}
    </div>
  )
}

export default function TopBar({
  theme, onToggleTheme,
  githubUser,
  canUndo, canRedo,
  onUndo, onRedo,
  onNewFile, onImport, onSave, onCopyYAML,
  onOpenGitHubConnect, onImportFromGitHub, onSaveToGitHub,
  onOpenRating,
  onAddTrigger, onAddConcurrency, onAddPermissions, onAddJob,
  onAddStepToFirst,
  onSetView,
  onToggleAI,
  aiVisible,
}) {
  const [open, setOpen] = useState(null)

  const close = useCallback(() => setOpen(null), [])

  useEffect(() => {
    const handler = () => close()
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [close])

  const menus = [
    {
      name: 'File',
      items: [
        { label: 'New File',            shortcut: 'Ctrl+N', action: onNewFile },
        { label: 'Import YAML File',    shortcut: 'Ctrl+O', action: onImport },
        { sep: true },
        { label: 'Import from GitHub',  action: onImportFromGitHub },
        { label: 'Save File',           shortcut: 'Ctrl+S', action: onSave },
        { label: 'Save to GitHub',      action: onSaveToGitHub },
        { sep: true },
        { label: 'Copy YAML',           action: onCopyYAML },
      ],
    },
    {
      name: 'Edit',
      items: [
        { label: 'Undo', shortcut: 'Ctrl+Z', action: onUndo, disabled: !canUndo },
        { label: 'Redo', shortcut: 'Ctrl+Y', action: onRedo, disabled: !canRedo },
        { sep: true },
        ...(AI_ASSISTANT_ENABLED ? [{ label: `${aiVisible ? 'Hide' : 'Show'} AI Assistant`, action: onToggleAI }] : []),
      ],
    },
    {
      name: 'Insert',
      items: [
        { sub: 'Workflow' },
        { label: 'Add Trigger',     action: onAddTrigger },
        { label: 'Add Concurrency', action: onAddConcurrency },
        { label: 'Add Permissions', action: onAddPermissions },
        { sep: true },
        { sub: 'Job' },
        { label: 'New Job',         action: onAddJob },
        { sep: true },
        { sub: 'Step (into first job)' },
        { label: 'Add "uses" Step', action: () => onAddStepToFirst('uses') },
        { label: 'Add "run" Step',  action: () => onAddStepToFirst('run') },
      ],
    },
    {
      name: 'View',
      items: [
        { label: 'Editor',           action: () => onSetView('editor') },
        { label: 'Visual Designer',  action: () => onSetView('design') },
        { label: 'Visual Graph',     action: () => onSetView('visual') },
        { label: 'YAML Preview',     action: () => onSetView('preview') },
        { label: 'Templates',        action: () => onSetView('templates') },
        { label: 'Diff',             action: () => onSetView('diff') },
      ],
    },
    {
      name: 'GitHub',
      items: [
        {
          label: githubUser ? `● Connected: ${githubUser.login}` : 'Connect GitHub Account',
          action: onOpenGitHubConnect,
        },
        { label: 'Import from Repository', action: onImportFromGitHub },
        { label: 'Save to Repository',     action: onSaveToGitHub },
        ...(githubUser ? [
          { sep: true },
          { label: 'Disconnect', action: onOpenGitHubConnect, danger: true },
        ] : []),
      ],
    },
  ]

  return (
    <header className="topbar" onClick={e => e.stopPropagation()}>
      <div className="topbar__logo">
        <GitHubIcon />
        Actions Editor
      </div>

      <nav className="topbar-menu" style={{ display: 'flex', gap: 1 }}>
        {menus.map(menu => (
          <div key={menu.name} className="menu-trigger">
            <button
              className={`menu-trigger__btn${open === menu.name ? ' open' : ''}`}
              onClick={e => { e.stopPropagation(); setOpen(o => o === menu.name ? null : menu.name) }}
            >
              {menu.name}
            </button>
            {open === menu.name && (
              <MenuDropdown items={menu.items} onClose={close} />
            )}
          </div>
        ))}
      </nav>

      <div className="topbar__right">
        {githubUser && (
          <span className="topbar__github-status">{githubUser.login}</span>
        )}
        <button className="btn btn--ghost btn--icon" onClick={onImport} title="Import YAML">
          📂 Import
        </button>
        <button className="btn btn--ghost btn--icon" onClick={onImportFromGitHub} title="Import from GitHub">
          ⬇ From GitHub
        </button>
        <button className="btn btn--primary btn--icon" onClick={onSave} title="Save file (Ctrl+S)">
          💾 Save
        </button>
        <button className="btn btn--green btn--icon" onClick={onSaveToGitHub} title="Push to GitHub">
          🚀 Push
        </button>
        <button className="btn btn--ghost btn--icon" onClick={onOpenRating} title="Rate Actions Editor">
          Rate Us
        </button>
        <button
          className="btn btn--ghost btn--icon"
          onClick={onToggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          style={{ fontSize: 15 }}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>
    </header>
  )
}
