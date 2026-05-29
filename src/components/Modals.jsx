import { useState } from 'react'

// ============================================================
// Modal primitives
// ============================================================

export function ModalOverlay({ children, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}>{children}</div>
    </div>
  )
}

function Modal({ title, children, footer, onClose, size = '' }) {
  return (
    <div className={`modal${size ? ` modal--${size}` : ''}`}>
      <div className="modal__header">
        <span className="modal__title">{title}</span>
        <button className="modal__close" onClick={onClose}>×</button>
      </div>
      <div className="modal__body">{children}</div>
      {footer && <div className="modal__footer">{footer}</div>}
    </div>
  )
}

// ============================================================
// GitHubConnectModal
// ============================================================
export function GitHubConnectModal({ status, onConnect, onClose }) {
  const [pat, setPat] = useState('')

  const isLoading = status === 'loading'
  const isError   = status.startsWith('error:')
  const isSuccess = status === 'success'

  return (
    <Modal
      title="Connect GitHub Account"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={() => onConnect(pat)} disabled={isLoading}>
            {isLoading ? 'Connecting…' : 'Connect'}
          </button>
        </>
      }
    >
      <div className="info-box">
        Connect using a <strong>Personal Access Token (PAT)</strong> to access private repositories,
        commit changes, and manage workflow files.<br /><br />
        Required scopes: <span className="scope-tag">repo</span> <span className="scope-tag">workflow</span><br />
        Create a token at:{' '}
        <a href="https://github.com/settings/tokens/new?scopes=repo,workflow" target="_blank" rel="noopener noreferrer"
          style={{ color: 'var(--accent)' }}>
          github.com/settings/tokens
        </a>
      </div>

      <div className="input-group">
        <label className="input-label">Personal Access Token</label>
        <input
          type="password"
          className="full-input"
          value={pat}
          onChange={e => setPat(e.target.value)}
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          onKeyDown={e => e.key === 'Enter' && onConnect(pat)}
          autoFocus
        />
      </div>

      {isLoading && (
        <div className="validation-msg validation-msg--loading">
          🔄 Verifying token and checking scopes…
        </div>
      )}
      {isError && (
        <div className="validation-msg validation-msg--error">
          ✗ {status.slice(6)}
        </div>
      )}
      {isSuccess && (
        <div className="validation-msg validation-msg--success">
          ✓ Connected successfully
        </div>
      )}
    </Modal>
  )
}

// ============================================================
// ImportGitHubModal
// ============================================================
export function ImportGitHubModal({ githubUser, status, onImport, onConnectFirst, onClose }) {
  const [url, setUrl] = useState('')

  const isLoading = status === 'loading'
  const isError   = status.startsWith('error:')

  return (
    <Modal
      title="Import from GitHub Repository"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={() => onImport(url)} disabled={isLoading || !url.trim()}>
            {isLoading ? 'Importing…' : 'Import'}
          </button>
        </>
      }
    >
      <div className="info-box">
        <strong>Public repositories</strong> can be imported without authentication.<br />
        For <strong>private repositories</strong>, connect your GitHub account first.
        Paste a repository URL to import all workflow files from <code style={{ fontFamily: 'var(--font-mono)' }}>.github/workflows/</code>.
        Paste a workflow file URL to import only that file.
      </div>

      {githubUser ? (
        <div style={{ fontSize: 12, color: 'var(--green)', marginBottom: 12 }}>
          ✓ Authenticated as <strong>{githubUser.login}</strong>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--orange)', marginBottom: 12 }}>
          ⚠ Not connected.{' '}
          <button className="btn btn--ghost btn--icon" style={{ fontSize: 11 }} onClick={onConnectFirst}>
            Connect GitHub Account
          </button>{' '}
          for private repository access.
        </div>
      )}

      <div className="input-group">
        <label className="input-label">Repository URL</label>
        <input
          className="full-input"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repository or .../blob/main/.github/workflows/file.yml"
          onKeyDown={e => e.key === 'Enter' && onImport(url)}
          autoFocus
        />
      </div>

      {isLoading && (
        <div className="validation-msg validation-msg--loading">🔄 Fetching workflow files…</div>
      )}
      {isError && (
        <div className="validation-msg validation-msg--error">✗ {status.slice(6)}</div>
      )}
    </Modal>
  )
}

// ============================================================
// SaveGitHubModal
// ============================================================
export function SaveGitHubModal({ githubUser, filename, status, onSave, onClose }) {
  const [repoUrl, setRepoUrl] = useState('')
  const [commitMsg, setCommitMsg] = useState('Update workflow via GitHub Actions Editor')

  const isLoading = status === 'loading'
  const isError   = status.startsWith('error:')

  return (
    <Modal
      title="Save to GitHub Repository"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--green" onClick={() => onSave({ repoUrl, commitMsg })} disabled={isLoading || !repoUrl.trim()}>
            {isLoading ? 'Pushing…' : '🚀 Push to GitHub'}
          </button>
        </>
      }
    >
      {githubUser && (
        <div style={{ fontSize: 12, color: 'var(--green)', marginBottom: 12 }}>
          ✓ Authenticated as <strong>{githubUser.login}</strong>
        </div>
      )}

      <div className="input-group">
        <label className="input-label">Repository URL</label>
        <input className="full-input" value={repoUrl} onChange={e => setRepoUrl(e.target.value)}
          placeholder="https://github.com/owner/repository" autoFocus />
      </div>
      <div className="input-group">
        <label className="input-label">Commit Message</label>
        <input className="full-input" value={commitMsg} onChange={e => setCommitMsg(e.target.value)} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Will be saved to:{' '}
        <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
          .github/workflows/{filename}
        </code>
      </div>

      {isLoading && <div className="validation-msg validation-msg--loading">🔄 Pushing to repository…</div>}
      {isError   && <div className="validation-msg validation-msg--error">✗ {status.slice(6)}</div>}
    </Modal>
  )
}

// ============================================================
// ConfirmModal — generic confirm dialog
// ============================================================
export function ConfirmModal({ icon, title, desc, confirmLabel, confirmClass = 'btn--danger', onConfirm, onClose }) {
  return (
    <ModalOverlay onClose={onClose}>
      <div className="modal modal--sm">
        <div className="modal__confirm">
          <div className="modal__confirm-icon">{icon}</div>
          <div className="modal__confirm-title">{title}</div>
          <div className="modal__confirm-desc">{desc}</div>
          <div className="modal__confirm-btns">
            <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
            <button className={`btn ${confirmClass}`} onClick={onConfirm}>{confirmLabel}</button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ============================================================
// UnsavedModal — ask to save before closing/new
// ============================================================
export function UnsavedModal({ filename, onSave, onDiscard, onClose }) {
  return (
    <ModalOverlay onClose={onClose}>
      <div className="modal modal--sm">
        <div className="modal__confirm">
          <div className="modal__confirm-icon">💾</div>
          <div className="modal__confirm-title">Unsaved Changes</div>
          <div className="modal__confirm-desc">
            <strong>{filename}</strong> has unsaved changes. Would you like to save before continuing?
          </div>
          <div className="modal__confirm-btns">
            <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn--ghost" onClick={onDiscard}>Don't Save</button>
            <button className="btn btn--primary" onClick={onSave}>Save</button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  )
}
