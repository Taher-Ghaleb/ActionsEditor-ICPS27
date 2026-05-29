import { useState } from 'react'

// ============================================================
// Sidebar — file explorer, job list, lint summary
// ============================================================

export default function Sidebar({ tab, workflow, lintIssues, activeView, onSetView, onAddJob, lineCount, onSelectLine, side = 'left' }) {
  const [sections, setSections] = useState({
    workflowFile: true,
    jobs: true,
    problems: true,
    insights: true,
  })

  const errCount  = lintIssues.filter(i => i.type === 'error').length
  const warnCount = lintIssues.filter(i => i.type === 'warning').length
  const jobs = workflow?.jobs || []
  const triggers = workflow?.triggers || []
  const jobCount = jobs.length
  const stepCount = jobs.reduce((sum, job) => sum + (job.steps?.length || 0), 0)
  const outputCount = jobs.reduce((sum, job) => sum + Object.keys(job.outputs || {}).length, 0)
  const dependencyCount = jobs.reduce((sum, job) => sum + (job.needs?.length || 0), 0)
  const entryJobCount = jobs.filter(job => !job.needs || job.needs.length === 0).length
  const emptyJobCount = jobs.filter(job => !job.steps || job.steps.length === 0).length
  const healthScore = Math.max(0, 100 - (errCount * 18) - (warnCount * 7) - (emptyJobCount * 8))
  const healthTone = errCount > 0 ? 'critical' : warnCount > 0 ? 'watch' : 'good'
  const flowSummary = `${triggers.length || 0} trigger${triggers.length === 1 ? '' : 's'} -> ${jobCount} job${jobCount === 1 ? '' : 's'} -> ${outputCount} output${outputCount === 1 ? '' : 's'}`
  const healthSummary = errCount > 0
    ? `${errCount} error${errCount === 1 ? '' : 's'} blocking the pipeline`
    : warnCount > 0
      ? `${warnCount} warning${warnCount === 1 ? '' : 's'} worth reviewing`
      : 'No issues detected in the current pipeline'
  const performanceSummary = dependencyCount > 0
    ? `${entryJobCount || 1} entry job${entryJobCount === 1 ? '' : 's'} and ${dependencyCount} dependency link${dependencyCount === 1 ? '' : 's'}`
    : 'All jobs can start immediately in parallel'
  const toggleSection = key => setSections(prev => ({ ...prev, [key]: !prev[key] }))

  return (
    <aside className={`sidebar sidebar--${side}`}>
      <div className="sidebar__title">
        <span>Explorer</span>
        <span style={{ display: 'flex', gap: 6 }}>
          {errCount  > 0 && <span style={{ color: 'var(--red)',    fontSize: 11 }}>✗{errCount}</span>}
          {warnCount > 0 && <span style={{ color: 'var(--orange)', fontSize: 11 }}>⚠{warnCount}</span>}
        </span>
      </div>

      <div className="sidebar__body">
        {/* Active File */}
        <div className="sidebar__section">
          <button className="sidebar__section-hd" onClick={() => toggleSection('workflowFile')}>
            <span>Workflow File</span>
            <span className={`sidebar__chevron${sections.workflowFile ? ' sidebar__chevron--open' : ''}`}>▶</span>
          </button>
          {sections.workflowFile && (
            <div className="sidebar__section-content">
              <div
                className={`sidebar__item${activeView === 'editor' ? ' sidebar__item--active' : ''}`}
                onClick={() => onSetView('editor')}
                title={tab?.name}
              >
                <span className="sidebar__item-icon">📄</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {tab?.name?.split('/').pop() || 'workflow.yml'}
                </span>
                {tab?.modified && (
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--orange)', flexShrink: 0 }} />
                )}
              </div>
              <div
                className={`sidebar__item${activeView === 'visual' ? ' sidebar__item--active' : ''}`}
                onClick={() => onSetView('visual')}
                title="Open workflow graph"
              >
                <span className="sidebar__item-icon">🕸</span>
                <span>Visual Graph</span>
              </div>
            </div>
          )}
        </div>

        {/* Jobs */}
        <div className="sidebar__section">
          <button className="sidebar__section-hd" onClick={() => toggleSection('jobs')}>
            <span>Jobs <span className="badge">{workflow?.jobs?.length || 0}</span></span>
            <span className={`sidebar__chevron${sections.jobs ? ' sidebar__chevron--open' : ''}`}>▶</span>
          </button>
          {sections.jobs && (
            <div className="sidebar__section-content">
              {(workflow?.jobs || []).map(job => (
                <div
                  key={job._key}
                  className="sidebar__item"
                  onClick={() => onSetView('design')}
                  title={`${job.id} — ${job.steps.length} steps`}
                >
                  <span className="sidebar__item-icon">🔧</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {job.id}
                  </span>
                  <span className="badge">{job.steps.length}</span>
                </div>
              ))}
              <div
                className="sidebar__item"
                style={{ color: 'var(--accent)', cursor: 'pointer' }}
                onClick={onAddJob}
              >
                <span className="sidebar__item-icon">+</span>
                <span>Add Job</span>
              </div>
            </div>
          )}
        </div>

        {/* Lint */}
        <div className="sidebar__section">
          <button className="sidebar__section-hd" onClick={() => toggleSection('problems')}>
            <span>Problems <span className="badge">{lintIssues.length}</span></span>
            <span className={`sidebar__chevron${sections.problems ? ' sidebar__chevron--open' : ''}`}>▶</span>
          </button>
          {sections.problems && (
            <div className="sidebar__section-content sidebar__section-content--problems">
              {lintIssues.length === 0 ? (
                <div style={{ padding: '6px 14px', fontSize: 11, color: 'var(--green)' }}>✓ No issues</div>
              ) : (
                lintIssues.slice(0, 20).map((issue, i) => (
                  <div
                    key={i}
                    title={issue.line ? `Go to line ${issue.line}` : undefined}
                    onClick={() => issue.line && onSelectLine?.(issue.line)}
                    style={{
                      padding: '4px 14px 4px 22px',
                      fontSize: 11,
                      color: issue.type === 'error' ? 'var(--red)' : 'var(--orange)',
                      lineHeight: 1.5,
                      display: 'flex',
                      gap: 5,
                      alignItems: 'flex-start',
                      cursor: issue.line ? 'pointer' : 'default',
                    }}
                  >
                    <span style={{ flexShrink: 0 }}>{issue.type === 'error' ? '✗' : '⚠'}</span>
                    <span style={{ flex: 1 }}>{issue.msg}</span>
                    {issue.line && <span style={{ flexShrink: 0, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>L{issue.line}</span>}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="sidebar__section">
          <button className="sidebar__section-hd" onClick={() => toggleSection('insights')}>
            <span>Insights</span>
            <span className={`sidebar__chevron${sections.insights ? ' sidebar__chevron--open' : ''}`}>▶</span>
          </button>

          {sections.insights && (
            <div className="sidebar__section-content">
              <div className="sidebar__insights">
                <div className="sidebar__card sidebar__card--structure">
                  <div className="sidebar__card-label">Jobs + Steps</div>
                  <div className="sidebar__card-value">{jobCount} / {stepCount}</div>
                  <div className="sidebar__card-meta">
                    {jobCount} job{jobCount === 1 ? '' : 's'} with {stepCount} total step{stepCount === 1 ? '' : 's'}
                  </div>
                </div>

                <div className="sidebar__card sidebar__card--flow">
                  <div className="sidebar__card-label">Workflow Flow</div>
                  <div className="sidebar__card-value sidebar__card-value--flow">{flowSummary}</div>
                  <div className="sidebar__card-meta">
                    {dependencyCount > 0
                      ? `${dependencyCount} dependency link${dependencyCount === 1 ? '' : 's'} shape the execution order`
                      : 'No dependencies yet, so jobs are fully parallel'}
                  </div>
                </div>

                <div className={`sidebar__card sidebar__card--health sidebar__card--${healthTone}`}>
                  <div className="sidebar__card-label">Performance + Health</div>
                  <div className="sidebar__card-value">{healthScore}%</div>
                  <div className="sidebar__card-meta">{healthSummary}</div>
                  <div className="sidebar__card-submeta">{performanceSummary}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="sidebar__footer">
        <span>{lineCount} lines</span>
        <span>•</span>
        <span>{workflow?.jobs?.length || 0} jobs</span>
        <span>•</span>
        <span>{workflow?.triggers?.length || 0} triggers</span>
      </div>
    </aside>
  )
}
