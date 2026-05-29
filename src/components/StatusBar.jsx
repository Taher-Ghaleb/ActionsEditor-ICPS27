// ============================================================
// StatusBar — bottom status row
// ============================================================

export default function StatusBar({ filename, lineCount, jobCount, triggerCount, lintIssues, zoom, githubUser }) {
  const errCount  = lintIssues.filter(i => i.type === 'error').length
  const warnCount = lintIssues.filter(i => i.type === 'warning').length

  return (
    <div className="statusbar">
      <div className="statusbar__item">
        <span
          className="statusbar__dot"
          style={{ background: errCount > 0 ? 'var(--red)' : warnCount > 0 ? 'var(--orange)' : 'var(--green)' }}
        />
        <span style={{ color: errCount > 0 ? 'var(--red)' : warnCount > 0 ? 'var(--orange)' : 'var(--green)' }}>
          {errCount  > 0 ? `${errCount} error${errCount  !== 1 ? 's' : ''}` :
           warnCount > 0 ? `${warnCount} warning${warnCount !== 1 ? 's' : ''}` :
           'Valid YAML'}
        </span>
      </div>
      <span className="statusbar__item">📄 {filename}</span>
      <span className="statusbar__item">{lineCount} lines</span>
      <span className="statusbar__item">{jobCount} job{jobCount !== 1 ? 's' : ''}</span>
      <span className="statusbar__item">{triggerCount} trigger{triggerCount !== 1 ? 's' : ''}</span>

      <div className="statusbar__right">
        {githubUser && (
          <span className="statusbar__github">● GitHub: {githubUser.login}</span>
        )}
        <span>Zoom: {zoom}%</span>
        <span>YAML</span>
      </div>
    </div>
  )
}
