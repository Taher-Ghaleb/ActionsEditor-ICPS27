import jsyaml from 'js-yaml'

// ============================================================
// YAML Parser — YAML string → workflow object
// ============================================================

export function parseYAMLToWorkflow(yamlStr) {
  try {
    const parsed = jsyaml.load(yamlStr)
    if (!parsed || typeof parsed !== 'object') return null

    const workflow = {
      name: parsed.name || '',
      env: parsed.env || {},
      permissions: parsed.permissions || {},
      triggers: [],
      concurrency: null,
      jobs: [],
    }

    // concurrency
    if (parsed.concurrency) {
      // GitHub Actions accepts "concurrency:" as either a map
      // ({ group, cancel-in-progress }) or a bare string that is the group name.
      // Reading ".group" off a string silently produced an empty group.
      if (typeof parsed.concurrency === 'string') {
        workflow.concurrency = { group: parsed.concurrency, cancelInProgress: false }
      } else {
        workflow.concurrency = {
          group: parsed.concurrency.group || '',
          cancelInProgress: parsed.concurrency['cancel-in-progress'] ?? false,
        }
      }
    }

    // on: triggers
    const on = parsed.on
    if (on) {
      if (typeof on === 'string') {
        workflow.triggers = [{ id: uid(), type: on }]
      } else if (Array.isArray(on)) {
        workflow.triggers = on.map(t => ({ id: uid(), type: String(t) }))
      } else {
        for (const [type, conf] of Object.entries(on)) {
          const t = { id: uid(), type }
          if (conf && typeof conf === 'object') {
            if (conf.branches) t.branches = toArray(conf.branches)
            if (conf['branches-ignore']) t.branchesIgnore = toArray(conf['branches-ignore'])
            if (conf.paths) t.paths = toArray(conf.paths)
            if (conf['paths-ignore']) t.pathsIgnore = toArray(conf['paths-ignore'])
            if (conf.tags) t.tags = toArray(conf.tags)
            if (conf['tags-ignore']) t.tagsIgnore = toArray(conf['tags-ignore'])
            if (conf.types) t.types = toArray(conf.types)
            // The "schedule" trigger's YAML shape is different from every
            // other trigger type: "on.schedule" is ITSELF the array of cron
            // entries (on: { schedule: [{cron: "..."}] }), not an object that
            // has a nested ".schedule" key. The previous check here looked
            // for `conf.schedule`, which is always undefined for this type
            // (conf IS the array), so every scheduled trigger silently lost
            // its cron expression on load.
            //
            // "schedule" may list several cron entries. t.schedule keeps the
            // first one (what the design panel's single Cron field edits);
            // t.schedules keeps the full list so the rest are not lost on save.
            if (type === 'schedule' && Array.isArray(conf)) {
              t.schedules = conf.map(entry => entry?.cron).filter(Boolean).map(String)
              t.schedule = t.schedules[0] || ''
            }
            if (conf.inputs) t.inputs = conf.inputs
          }
          workflow.triggers.push(t)
        }
      }
    }

    // jobs
    if (parsed.jobs && typeof parsed.jobs === 'object') {
      for (const [jobId, jobConf] of Object.entries(parsed.jobs)) {
        if (!jobConf) continue
        const runsOn = jobConf['runs-on']

        const job = {
          _key: uid(),
          id: jobId,
          name: jobConf.name || jobId,
          // A list of labels is shown/edited as one comma-separated string
          // (generateYAML splits it back into a list). The object form
          // ({ group, labels }) is kept as-is. A missing runs-on stays empty
          // — it used to be silently filled in with 'ubuntu-latest', which
          // hid the "missing runs-on" lint error and injected a runner into
          // reusable-workflow call jobs, which must not have one.
          runsOn: Array.isArray(runsOn) ? runsOn.join(', ') : (runsOn || ''),
          needs: jobConf.needs ? toArray(jobConf.needs) : [],
          condition: jobConf.if ? String(jobConf.if) : '',
          env: jobConf.env || {},
          permissions: jobConf.permissions || {},
          timeout: jobConf['timeout-minutes'] || '',
          continueOnError: jobConf['continue-on-error'] || false,
          container: typeof jobConf.container === 'string'
            ? jobConf.container
            : (jobConf.container?.image || ''),
          outputs: jobConf.outputs || {},
          services: jobConf.services || {},
          strategy: null,
          environment: '',
          collapsed: false,
          steps: [],
        }

        // A job that calls a reusable workflow (jobs.<id>.uses / with / secrets)
        // has no runs-on or steps of its own. These three fields are carried
        // through unchanged so they survive a load + save; the design panel
        // does not edit them.
        if (jobConf.uses) {
          job.uses = String(jobConf.uses)
          if (jobConf.with) job.with = jobConf.with
          if (jobConf.secrets !== undefined && jobConf.secrets !== null) job.secrets = jobConf.secrets
        }

        // environment
        if (jobConf.environment) {
          if (typeof jobConf.environment === 'string') {
            job.environment = jobConf.environment
          } else {
            job.environment = {
              name: jobConf.environment.name || '',
              url: jobConf.environment.url || '',
            }
          }
        }

        // strategy
        if (jobConf.strategy) {
          job.strategy = {
            failFast: jobConf.strategy['fail-fast'] ?? null,
            maxParallel: jobConf.strategy['max-parallel'] || '',
            matrix: jobConf.strategy.matrix || {},
          }
        }

        // steps
        if (Array.isArray(jobConf.steps)) {
          job.steps = jobConf.steps.map(s => ({
            _key: uid(),
            id: s.id || '',
            name: s.name || '',
            uses: s.uses || '',
            run: s.run ? String(s.run) : '',
            shell: s.shell || '',
            condition: s.if ? String(s.if) : '',
            with: s.with || {},
            env: s.env || {},
            timeout: s['timeout-minutes'] || '',
            continueOnError: s['continue-on-error'] || false,
            workingDirectory: s['working-directory'] || '',
          }))
        }

        workflow.jobs.push(job)
      }
    }

    return workflow
  } catch (e) {
    console.warn('YAML parse error:', e.message)
    return null
  }
}

// ---- helpers ----
let _id = 1
function uid() { return `id_${Date.now()}_${_id++}` }

function toArray(val) {
  if (Array.isArray(val)) return val.map(String)
  if (typeof val === 'string') return [val]
  return []
}
