// ============================================================
// Toast — notification system
// ============================================================

const ICONS = { success: '✓', error: '✗', warning: '⚠', info: 'ℹ' }

export default function Toast({ toasts }) {
  if (toasts.length === 0) return null
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast--${t.type}`}>
          <span className="toast__icon">{ICONS[t.type] || 'ℹ'}</span>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  )
}
