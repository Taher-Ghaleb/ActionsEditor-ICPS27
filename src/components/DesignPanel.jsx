import { useEffect, useRef, useState } from 'react'
import { TRIGGERS, RUNNERS, SHELLS, PERMISSIONS, PERMISSION_VALUES, COMMON_ACTIONS } from '../data/constants.js'
import { NAV_IDS } from '../utils/lineNavigation.js'

// ============================================================
// DesignPanel — visual drag-and-drop workflow builder
// ============================================================

export default function DesignPanel({ workflow, onUpdate, focusTarget, onRequestConfirm }) {
  const [dragItem, setDragItem] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  const rootRef = useRef(null)
  const activeNavId = focusTarget?.navId || null

  useEffect(() => {
    if (!focusTarget?.navId) return

    const targetNode = document.getElementById(focusTarget.navId)
    if (!targetNode || !rootRef.current?.contains(targetNode)) return

    targetNode.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })

    const field = targetNode.querySelector('input, textarea, select, button')
    if (field && typeof field.focus === 'function') {
      field.focus({ preventScroll: true })
    }
  }, [focusTarget?.requestKey, focusTarget?.navId])

  /* ---- workflow-level helpers ---- */
  const setField = (field, value) => onUpdate(w => ({ ...w, [field]: value }))
  const confirmAction = (config, action) => {
    if (onRequestConfirm) {
      onRequestConfirm({ ...config, onConfirm: action })
      return
    }

    action()
  }

  /* ---- trigger helpers ---- */
  const addTrigger = () => onUpdate(w => ({
    ...w,
    triggers: [...w.triggers, { id: `t_${Date.now()}`, type: 'push', branches: ['main'] }],
  }))
  const updateTrigger = (id, field, value) => onUpdate(w => ({
    ...w,
    triggers: w.triggers.map(t => t.id === id ? { ...t, [field]: value } : t),
  }))
  const removeTrigger = id => confirmAction({
    icon: '🗑',
    title: 'Delete Trigger',
    desc: 'Remove this trigger from the workflow?',
    confirmLabel: 'Delete Trigger',
  }, () => onUpdate(w => ({ ...w, triggers: w.triggers.filter(t => t.id !== id) })))
  const csv = val => val.split(',').map(s => s.trim()).filter(Boolean)

  /* ---- permission helpers ---- */
  const addPerm = () => {
    const existing = Object.keys(workflow.permissions || {})
    const next = PERMISSIONS.find(p => !existing.includes(p)) || 'contents'
    onUpdate(w => ({ ...w, permissions: { ...w.permissions, [next]: 'read' } }))
  }
  const removePerm = key => confirmAction({
    icon: '🗑',
    title: 'Delete Permission',
    desc: `Remove the "${key}" permission from this workflow?`,
    confirmLabel: 'Delete Permission',
  }, () => {
    const p = { ...workflow.permissions }
    delete p[key]
    onUpdate(w => ({ ...w, permissions: p }))
  })
  const removeConcurrency = () => confirmAction({
    icon: '🗑',
    title: 'Delete Concurrency',
    desc: 'Remove the workflow concurrency settings?',
    confirmLabel: 'Delete Concurrency',
  }, () => setField('concurrency', null))

  /* ---- job helpers ---- */
  const addJob = () => {
    const id = `job_${Date.now()}`
    onUpdate(w => ({
      ...w,
      jobs: [...w.jobs, {
        _key: id, id: 'new-job', name: 'New Job',
        runsOn: 'ubuntu-latest', needs: [], condition: '', env: {}, permissions: {},
        timeout: '', continueOnError: false, container: '',
        outputs: {}, services: {}, strategy: null, environment: '',
        collapsed: false, steps: [],
      }],
    }))
  }
  const updateJob = (key, field, value) => onUpdate(w => ({
    ...w,
    jobs: w.jobs.map(j => j._key === key ? { ...j, [field]: value } : j),
  }))
  const removeJob = key => confirmAction({
    icon: '🗑',
    title: 'Delete Job',
    desc: `Delete the "${workflow.jobs.find(job => job._key === key)?.id || 'job'}" job and all of its steps?`,
    confirmLabel: 'Delete Job',
  }, () => onUpdate(w => ({ ...w, jobs: w.jobs.filter(j => j._key !== key) })))
  const toggleJob = key => updateJob(key, 'collapsed', !workflow.jobs.find(j => j._key === key)?.collapsed)

  /* ---- step helpers ---- */
  const addStep = (jobKey, type) => {
    const step = {
      _key: `s_${Date.now()}`,
      id: '', name: type === 'uses' ? 'New Action Step' : 'New Run Step',
      uses: type === 'uses' ? 'actions/checkout@v4' : '',
      run: type === 'run' ? 'echo "Hello"' : '',
      shell: type === 'run' ? 'bash' : '', condition: '',
      with: {}, env: {}, timeout: '', continueOnError: false, workingDirectory: '',
    }
    onUpdate(w => ({
      ...w,
      jobs: w.jobs.map(j => j._key === jobKey ? { ...j, steps: [...j.steps, step] } : j),
    }))
  }
  const updateStep = (jobKey, stepKey, field, value) => onUpdate(w => ({
    ...w,
    jobs: w.jobs.map(j => j._key === jobKey
      ? { ...j, steps: j.steps.map(s => s._key === stepKey ? { ...s, [field]: value } : s) }
      : j),
  }))
  const removeStep = (jobKey, stepKey) => confirmAction({
    icon: '🗑',
    title: 'Delete Step',
    desc: `Delete the "${workflow.jobs.find(job => job._key === jobKey)?.steps.find(step => step._key === stepKey)?.name || 'step'}" step?`,
    confirmLabel: 'Delete Step',
  }, () => onUpdate(w => ({
    ...w,
    jobs: w.jobs.map(j => j._key === jobKey
      ? { ...j, steps: j.steps.filter(s => s._key !== stepKey) }
      : j),
  })))

  /* ---- drag-and-drop (steps) ---- */
  const onStepDragStart = (jobKey, stepKey) => setDragItem({ type: 'step', jobKey, key: stepKey })
  const onStepDragOver  = (e, jobKey, stepKey) => { e.preventDefault(); setDragOver(`${jobKey}:${stepKey}`) }
  const onStepDrop      = (jobKey, targetKey) => {
    if (!dragItem || dragItem.key === targetKey || dragItem.jobKey !== jobKey) {
      setDragItem(null); setDragOver(null); return
    }
    onUpdate(w => ({
      ...w,
      jobs: w.jobs.map(j => {
        if (j._key !== jobKey) return j
        const steps = [...j.steps]
        const fi = steps.findIndex(s => s._key === dragItem.key)
        const ti = steps.findIndex(s => s._key === targetKey)
        if (fi < 0 || ti < 0) return j
        const [moved] = steps.splice(fi, 1)
        steps.splice(ti, 0, moved)
        return { ...j, steps }
      }),
    }))
    setDragItem(null); setDragOver(null)
  }

  /* ---- drag-and-drop (jobs) ---- */
  const onJobDragStart = key => setDragItem({ type: 'job', key })
  const onJobDragOver  = (e, key) => { e.preventDefault(); setDragOver(`job:${key}`) }
  const onJobDrop      = targetKey => {
    if (!dragItem || dragItem.key === targetKey) { setDragItem(null); setDragOver(null); return }
    onUpdate(w => {
      const jobs = [...w.jobs]
      const fi = jobs.findIndex(j => j._key === dragItem.key)
      const ti = jobs.findIndex(j => j._key === targetKey)
      if (fi < 0 || ti < 0) return w
      const [m] = jobs.splice(fi, 1)
      jobs.splice(ti, 0, m)
      return { ...w, jobs }
    })
    setDragItem(null); setDragOver(null)
  }

  const kvToText = obj => Object.entries(obj || {}).map(([k, v]) => `${k}: ${v}`).join('\n')
  const textToKV = text => {
    const out = {}
    text.split('\n').forEach(line => {
      const m = line.match(/^([^:]+):\s*(.*)$/)
      if (m) out[m[1].trim()] = m[2].trim()
    })
    return out
  }

  const isSectionActive = sectionId => activeNavId === NAV_IDS.section(sectionId)
  const isTriggerActive = triggerId => activeNavId === NAV_IDS.trigger(triggerId)
  const isJobActive = jobKey => activeNavId === NAV_IDS.job(jobKey)
  const isStepActive = (jobKey, stepKey) => activeNavId === NAV_IDS.step(jobKey, stepKey)

  return (
    <div ref={rootRef} className="design-panel">

      {/* ---- Workflow Settings ---- */}
      <Section
        icon="⚙️"
        title="Workflow Settings"
        defaultOpen
        navId={NAV_IDS.section('workflow-settings')}
        isActive={isSectionActive('workflow-settings')}
        forceOpen={isSectionActive('workflow-settings')}
      >
        <Field label="Name">
          <input className="field-input" value={workflow.name}
            onChange={e => setField('name', e.target.value)} placeholder="My Workflow" />
        </Field>
      </Section>

      {/* ---- Triggers ---- */}
      <Section
        icon="⚡"
        title={`Triggers (${workflow.triggers?.length || 0})`}
        defaultOpen
        navId={NAV_IDS.section('triggers')}
        isActive={isSectionActive('triggers')}
        forceOpen={focusTarget?.sectionId === 'triggers'}
      >
        {(workflow.triggers || []).map(t => (
          <TriggerRow
            key={t.id}
            trigger={t}
            navId={NAV_IDS.trigger(t.id)}
            isActive={isTriggerActive(t.id)}
            onUpdate={updateTrigger}
            onRemove={removeTrigger}
            csv={csv}
          />
        ))}
        <button className="field-add-btn" onClick={addTrigger}>+ Add Trigger</button>
      </Section>

      {/* ---- Concurrency ---- */}
      <Section
        icon="🔄"
        title="Concurrency"
        navId={NAV_IDS.section('concurrency')}
        isActive={isSectionActive('concurrency')}
        forceOpen={isSectionActive('concurrency')}
      >
        {workflow.concurrency ? (
          <>
            <Field label="Group">
              <input className="field-input field-input--mono"
                value={workflow.concurrency.group}
                onChange={e => setField('concurrency', { ...workflow.concurrency, group: e.target.value })}
                placeholder='${{ github.workflow }}-${{ github.ref }}'
              />
            </Field>
            <Field label="Cancel in progress">
              <select className="field-select"
                value={String(workflow.concurrency.cancelInProgress)}
                onChange={e => setField('concurrency', { ...workflow.concurrency, cancelInProgress: e.target.value === 'true' })}>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
              <button className="btn btn--ghost btn--icon" style={{ marginLeft: 6 }}
                onClick={removeConcurrency}>🗑</button>
            </Field>
          </>
        ) : (
          <button className="field-add-btn" onClick={() => setField('concurrency', { group: '${{ github.workflow }}-${{ github.ref }}', cancelInProgress: true })}>
            + Add Concurrency
          </button>
        )}
      </Section>

      {/* ---- Permissions ---- */}
      <Section
        icon="🔐"
        title="Permissions (workflow-level)"
        navId={NAV_IDS.section('workflow-permissions')}
        isActive={isSectionActive('workflow-permissions')}
        forceOpen={isSectionActive('workflow-permissions')}
      >
        {Object.entries(workflow.permissions || {}).map(([k, v]) => (
          <Field key={k} label="">
            <select className="field-select" value={k}
              onChange={e => {
                const p = { ...workflow.permissions }
                const val = p[k]; delete p[k]; p[e.target.value] = val
                setField('permissions', p)
              }}>
              {PERMISSIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select className="field-select" style={{ marginLeft: 6, width: 80, flex: 'none' }}
              value={v}
              onChange={e => setField('permissions', { ...workflow.permissions, [k]: e.target.value })}>
              {PERMISSION_VALUES.map(pv => <option key={pv} value={pv}>{pv}</option>)}
            </select>
            <button className="btn btn--ghost btn--icon" style={{ marginLeft: 6 }}
              onClick={() => removePerm(k)}>🗑</button>
          </Field>
        ))}
        <button className="field-add-btn" onClick={addPerm}>+ Add Permission</button>
      </Section>

      {/* ---- Env (workflow-level) ---- */}
      <Section
        icon="🌍"
        title="Environment Variables (workflow-level)"
        navId={NAV_IDS.section('workflow-env')}
        isActive={isSectionActive('workflow-env')}
        forceOpen={isSectionActive('workflow-env')}
      >
        <Field label="Variables">
          <textarea
            className="field-textarea field-textarea--mono"
            value={kvToText(workflow.env)}
            onChange={e => setField('env', textToKV(e.target.value))}
            placeholder="KEY: value&#10;ANOTHER_KEY: value2"
          />
        </Field>
      </Section>

      {/* ---- Jobs ---- */}
      {(workflow.jobs || []).map(job => (
        <JobCard
          key={job._key}
          job={job}
          allJobs={workflow.jobs}
          onUpdate={updateJob}
          onRemove={removeJob}
          onToggle={toggleJob}
          onAddStep={addStep}
          onUpdateStep={updateStep}
          onRemoveStep={removeStep}
          onDragStart={onJobDragStart}
          onDragOver={onJobDragOver}
          onDrop={onJobDrop}
          onStepDragStart={onStepDragStart}
          onStepDragOver={onStepDragOver}
          onStepDrop={onStepDrop}
          dragOver={dragOver}
          isDragging={dragItem?.key === job._key}
          navId={NAV_IDS.job(job._key)}
          isActive={isJobActive(job._key)}
          forceExpanded={focusTarget?.jobKey === job._key}
          activeStepKey={focusTarget?.jobKey === job._key ? focusTarget.stepKey : null}
          kvToText={kvToText}
          textToKV={textToKV}
          isStepActive={isStepActive}
        />
      ))}
      <button className="field-add-btn" style={{ marginTop: 4 }} onClick={addJob}>+ Add Job</button>
    </div>
  )
}

/* ---- Sub-components ---- */

function Section({ icon, title, children, defaultOpen = false, navId, isActive = false, forceOpen = false }) {
  const [manualOpen, setManualOpen] = useState(defaultOpen)
  const open = forceOpen || manualOpen

  return (
    <div id={navId} className={`design-card${isActive ? ' design-target--active' : ''}`}>
      <div className="design-card__header" onClick={() => setManualOpen(o => !o)}>
        <span>{icon}</span>
        <span className="design-card__header-title">{title}</span>
        <span className={`design-card__chevron${open ? ' design-card__chevron--open' : ''}`}>▶</span>
      </div>
      {open && <div className="design-card__body">{children}</div>}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div className="field-row">
      {label !== '' && <label className="field-label">{label}</label>}
      {children}
    </div>
  )
}

function TriggerRow({ trigger: t, navId, isActive, onUpdate, onRemove, csv }) {
  return (
    <div
      id={navId}
      className={`trigger-card${isActive ? ' design-target--active' : ''}`}
    >
      <Field label="Event">
        <select className="field-select" value={t.type}
          onChange={e => onUpdate(t.id, 'type', e.target.value)}>
          {TRIGGERS.map(tr => <option key={tr.value} value={tr.value}>{tr.label}</option>)}
        </select>
        <button className="btn btn--ghost btn--icon" style={{ marginLeft: 6 }}
          onClick={() => onRemove(t.id)}>🗑</button>
      </Field>

      {(t.type === 'push' || t.type === 'pull_request' || t.type === 'pull_request_target') && (
        <Field label="Branches">
          <input className="field-input" value={(t.branches || []).join(', ')}
            onChange={e => onUpdate(t.id, 'branches', csv(e.target.value))}
            placeholder="main, master" />
        </Field>
      )}
      {t.type === 'push' && (
        <Field label="Tags">
          <input className="field-input" value={(t.tags || []).join(', ')}
            onChange={e => onUpdate(t.id, 'tags', csv(e.target.value))}
            placeholder="v*, v1.*" />
        </Field>
      )}
      {(t.type === 'push' || t.type === 'pull_request') && (
        <Field label="Paths">
          <input className="field-input" value={(t.paths || []).join(', ')}
            onChange={e => onUpdate(t.id, 'paths', csv(e.target.value))}
            placeholder="src/**, *.ts" />
        </Field>
      )}
      {t.type === 'schedule' && (
        <Field label="Cron">
          <input className="field-input field-input--mono" value={t.schedule || ''}
            onChange={e => onUpdate(t.id, 'schedule', e.target.value)}
            placeholder="0 0 * * *" />
        </Field>
      )}
      {(t.type === 'release' || t.type === 'issues' || t.type === 'pull_request') && (
        <Field label="Types">
          <input className="field-input" value={(t.types || []).join(', ')}
            onChange={e => onUpdate(t.id, 'types', csv(e.target.value))}
            placeholder="opened, closed" />
        </Field>
      )}
    </div>
  )
}

function JobCard({
  job, allJobs, onUpdate, onRemove, onToggle,
  onAddStep, onUpdateStep, onRemoveStep,
  onDragStart, onDragOver, onDrop,
  onStepDragStart, onStepDragOver, onStepDrop,
  dragOver, isDragging, navId, isActive, forceExpanded, activeStepKey,
  kvToText, textToKV,
  isStepActive,
}) {
  const [openStepKey, setOpenStepKey] = useState(null)
  const isJobDragOver = dragOver === `job:${job._key}`
  const isOpen = forceExpanded || !job.collapsed

  return (
    <div
      id={navId}
      className={`job-card${isDragging ? ' job-card--dragging' : ''}${isJobDragOver ? ' job-card--drag-over' : ''}${isActive ? ' design-target--active' : ''}`}
      draggable
      onDragStart={() => onDragStart(job._key)}
      onDragOver={e => onDragOver(e, job._key)}
      onDrop={() => onDrop(job._key)}
    >
      {/* Header */}
      <div className="job-card__header" onClick={() => onToggle(job._key)}>
        <span className="job-card__drag" onClick={e => e.stopPropagation()} title="Drag to reorder">⠿</span>
        <span className="job-badge">JOB</span>
        <input
          className="job-card__id-input"
          value={job.id}
          onChange={e => onUpdate(job._key, 'id', e.target.value.replace(/[^a-zA-Z0-9_\-]/g, ''))}
          onClick={e => e.stopPropagation()}
          placeholder="job-id"
          title="Job ID — alphanumeric, hyphens, underscores only"
        />
        <span className="job-card__meta">{job.steps.length} step{job.steps.length !== 1 ? 's' : ''}</span>
        <button
          className="step-item__delete"
          onClick={e => { e.stopPropagation(); onRemove(job._key) }}
          title="Delete job"
        >🗑</button>
        <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--text-muted)' }}>
          {isOpen ? '▼' : '▶'}
        </span>
      </div>

      {isOpen && (
        <div className="job-card__body">
          <div className="field-row">
            <label className="field-label">Display name</label>
            <input className="field-input" value={job.name}
              onChange={e => onUpdate(job._key, 'name', e.target.value)}
              placeholder="Job display name" />
          </div>
          <div className="field-row">
            <label className="field-label">Runs on</label>
            <select className="field-select" value={RUNNERS.includes(job.runsOn) ? job.runsOn : 'self-hosted'}
              onChange={e => onUpdate(job._key, 'runsOn', e.target.value)}>
              {RUNNERS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          {!RUNNERS.includes(job.runsOn) && (
            <div className="field-row">
              <label className="field-label">Custom runner</label>
              <input className="field-input field-input--mono" value={job.runsOn}
                onChange={e => onUpdate(job._key, 'runsOn', e.target.value)}
                placeholder="self-hosted, linux, x64" />
            </div>
          )}
          <div className="field-row">
            <label className="field-label">Needs</label>
            <input className="field-input" value={(job.needs || []).join(', ')}
              onChange={e => onUpdate(job._key, 'needs', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
              placeholder="other-job-id" />
          </div>
          <div className="field-row">
            <label className="field-label">Condition (if)</label>
            <input className="field-input field-input--mono" value={job.condition}
              onChange={e => onUpdate(job._key, 'condition', e.target.value)}
              placeholder="github.event_name == 'push'" />
          </div>
          <div className="field-row">
            <label className="field-label">Timeout (min)</label>
            <input className="field-input field-small" type="number" value={job.timeout}
              onChange={e => onUpdate(job._key, 'timeout', e.target.value)}
              placeholder="360" />
            <label className="field-label" style={{ marginLeft: 10 }}>Continue on error</label>
            <select className="field-select" style={{ width: 80, flex: 'none' }}
              value={String(job.continueOnError)}
              onChange={e => onUpdate(job._key, 'continueOnError', e.target.value === 'true')}>
              <option value="false">false</option>
              <option value="true">true</option>
            </select>
          </div>
          <div className="field-row">
            <label className="field-label">Environment</label>
            <input className="field-input" value={typeof job.environment === 'string' ? job.environment : (job.environment?.name || '')}
              onChange={e => onUpdate(job._key, 'environment', e.target.value)}
              placeholder="production" />
          </div>
          <div className="field-row">
            <label className="field-label">Container</label>
            <input className="field-input field-input--mono" value={job.container}
              onChange={e => onUpdate(job._key, 'container', e.target.value)}
              placeholder="node:18-alpine" />
          </div>
          <div className="field-row">
            <label className="field-label">Env vars</label>
            <textarea className="field-textarea field-textarea--mono"
              value={kvToText(job.env)}
              onChange={e => onUpdate(job._key, 'env', textToKV(e.target.value))}
              placeholder="KEY: value" />
          </div>

          {/* Steps */}
          <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-muted)', marginBottom: 8 }}>
              Steps ({job.steps.length})
            </div>
            {job.steps.map(step => (
              <StepItem
                key={step._key}
                step={step}
                jobKey={job._key}
                expanded={openStepKey === step._key}
                onToggle={() => setOpenStepKey(k => k === step._key ? null : step._key)}
                onUpdate={onUpdateStep}
                onRemove={onRemoveStep}
                onDragStart={() => onStepDragStart(job._key, step._key)}
                onDragOver={e => onStepDragOver(e, job._key, step._key)}
                onDrop={() => onStepDrop(job._key, step._key)}
                isDragOver={dragOver === `${job._key}:${step._key}`}
                navId={NAV_IDS.step(job._key, step._key)}
                isActive={isStepActive(job._key, step._key)}
                forceExpanded={activeStepKey === step._key}
                kvToText={kvToText}
                textToKV={textToKV}
              />
            ))}
            <div className="step-add-row">
              <button className="field-add-btn" onClick={() => onAddStep(job._key, 'uses')}>+ uses (action)</button>
              <button className="field-add-btn" onClick={() => onAddStep(job._key, 'run')}>+ run (command)</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StepItem({
  step, jobKey, expanded, navId, isActive, forceExpanded,
  onToggle, onUpdate, onRemove, onDragStart, onDragOver, onDrop,
  isDragOver, kvToText, textToKV,
}) {
  const isUses = !!step.uses
  const isOpen = forceExpanded || expanded

  return (
    <div
      id={navId}
      className={`step-item${isDragOver ? ' step-item--drag-over' : ''}${isActive ? ' design-target--active' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="step-item__header" onClick={onToggle}>
        <span className="step-item__drag" title="Drag to reorder">⠿</span>
        <span className={`step-badge ${isUses ? 'step-badge--uses' : 'step-badge--run'}`}>
          {isUses ? 'uses' : 'run'}
        </span>
        <input
          className="step-item__name-input"
          value={step.name}
          onChange={e => onUpdate(jobKey, step._key, 'name', e.target.value)}
          onClick={e => e.stopPropagation()}
          placeholder="Step name"
        />
        <span className={`step-item__toggle${isOpen ? ' step-item__toggle--open' : ''}`}>▶</span>
        <button className="step-item__delete"
          onClick={e => { e.stopPropagation(); onRemove(jobKey, step._key) }}
          title="Delete step">🗑</button>
      </div>

      {isOpen && (
        <div className="step-item__body">
          {/* Type switcher */}
          <div className="field-row">
            <label className="field-label">Type</label>
            <select className="field-select" value={isUses ? 'uses' : 'run'}
              onChange={e => {
                if (e.target.value === 'uses') {
                  onUpdate(jobKey, step._key, 'uses', 'actions/checkout@v4')
                  onUpdate(jobKey, step._key, 'run', '')
                } else {
                  onUpdate(jobKey, step._key, 'uses', '')
                  onUpdate(jobKey, step._key, 'run', 'echo "Hello"')
                }
              }}>
              <option value="run">run — execute a shell command</option>
              <option value="uses">uses — call a GitHub Action</option>
            </select>
          </div>

          {isUses ? (
            <>
              <div className="field-row">
                <label className="field-label">Action</label>
                <input
                  list={`actions-${step._key}`}
                  className="field-input field-input--mono"
                  value={step.uses}
                  onChange={e => onUpdate(jobKey, step._key, 'uses', e.target.value)}
                  placeholder="owner/repo@version"
                />
                <datalist id={`actions-${step._key}`}>
                  {COMMON_ACTIONS.map(a => <option key={a} value={a} />)}
                </datalist>
              </div>
              <div className="field-row">
                <label className="field-label">with (params)</label>
                <textarea
                  className="field-textarea field-textarea--mono"
                  value={kvToText(step.with)}
                  onChange={e => onUpdate(jobKey, step._key, 'with', textToKV(e.target.value))}
                  placeholder="node-version: 20&#10;cache: npm"
                />
              </div>
            </>
          ) : (
            <>
              <div className="field-row">
                <label className="field-label">Command</label>
                <textarea
                  className="field-textarea field-textarea--mono"
                  value={step.run}
                  onChange={e => onUpdate(jobKey, step._key, 'run', e.target.value)}
                  placeholder="npm ci&#10;npm test"
                />
              </div>
              <div className="field-row">
                <label className="field-label">Shell</label>
                <select className="field-select" value={step.shell || 'bash'}
                  onChange={e => onUpdate(jobKey, step._key, 'shell', e.target.value)}>
                  {SHELLS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </>
          )}

          <div className="field-row">
            <label className="field-label">Step ID</label>
            <input className="field-input field-input--mono" value={step.id}
              onChange={e => onUpdate(jobKey, step._key, 'id', e.target.value)}
              placeholder="my-step-id" />
          </div>
          <div className="field-row">
            <label className="field-label">Condition (if)</label>
            <input className="field-input field-input--mono" value={step.condition}
              onChange={e => onUpdate(jobKey, step._key, 'condition', e.target.value)}
              placeholder="failure() || always()" />
          </div>
          <div className="field-row">
            <label className="field-label">Working dir</label>
            <input className="field-input" value={step.workingDirectory}
              onChange={e => onUpdate(jobKey, step._key, 'workingDirectory', e.target.value)}
              placeholder="./subdir" />
          </div>
          <div className="field-row">
            <label className="field-label">Env vars</label>
            <textarea className="field-textarea field-textarea--mono"
              value={kvToText(step.env)}
              onChange={e => onUpdate(jobKey, step._key, 'env', textToKV(e.target.value))}
              placeholder="KEY: value" />
          </div>
          <div className="field-row">
            <label className="field-label">Timeout (min)</label>
            <input className="field-input field-small" type="number" value={step.timeout}
              onChange={e => onUpdate(jobKey, step._key, 'timeout', e.target.value)}
              placeholder="30" />
            <label className="field-label" style={{ marginLeft: 8 }}>Continue on error</label>
            <select className="field-select" style={{ width: 80, flex: 'none' }}
              value={String(step.continueOnError)}
              onChange={e => onUpdate(jobKey, step._key, 'continueOnError', e.target.value === 'true')}>
              <option value="false">false</option>
              <option value="true">true</option>
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
