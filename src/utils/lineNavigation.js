export const NAV_IDS = {
  section: (key) => `nav-section-${key}`,
  trigger: (id) => `nav-trigger-${id}`,
  job: (key) => `nav-job-${key}`,
  step: (jobKey, stepKey) => `nav-step-${jobKey}-${stepKey}`,
}

export function buildLineNavigation(workflow) {
  const lineTargets = []
  let lineNumber = 1

  const addLine = (target, count = 1) => {
    for (let i = 0; i < count; i += 1) {
      lineTargets[lineNumber] = target
      lineNumber += 1
    }
  }

  const workflowSettingsTarget = createSectionTarget('workflow-settings')
  const workflowEnvTarget = createSectionTarget('workflow-env')
  const triggersTarget = createSectionTarget('triggers')
  const permissionsTarget = createSectionTarget('workflow-permissions')
  const concurrencyTarget = createSectionTarget('concurrency')

  if (workflow.name) addLine(workflowSettingsTarget)

  if (hasEntries(workflow.env)) {
    addLine(workflowEnvTarget)
    addLine(workflowEnvTarget, Object.entries(workflow.env).length)
  }

  const triggers = workflow.triggers || []
  if (triggers.length === 1 && !hasTriggerConfig(triggers[0])) {
    addLine(createTriggerTarget(triggers[0]))
  } else if (triggers.length > 0) {
    addLine(triggersTarget)

    for (const trigger of triggers) {
      const triggerTarget = createTriggerTarget(trigger)
      addLine(triggerTarget)

      if (hasList(trigger.branches)) {
        addLine(triggerTarget)
        addLine(triggerTarget, trigger.branches.length)
      }

      if (hasList(trigger.paths)) {
        addLine(triggerTarget)
        addLine(triggerTarget, trigger.paths.length)
      }

      if (hasList(trigger.tags)) {
        addLine(triggerTarget)
        addLine(triggerTarget, trigger.tags.length)
      }

      if (hasList(trigger.types)) {
        addLine(triggerTarget)
        addLine(triggerTarget, trigger.types.length)
      }

      if (trigger.schedule) addLine(triggerTarget)

      if (hasEntries(trigger.inputs)) {
        addLine(triggerTarget)

        for (const [, input] of Object.entries(trigger.inputs)) {
          addLine(triggerTarget)
          addLine(triggerTarget, input.default !== undefined ? 3 : 2)
        }
      }
    }
  }

  if (hasEntries(workflow.permissions)) {
    addLine(permissionsTarget)
    addLine(permissionsTarget, Object.entries(workflow.permissions).length)
  }

  if (workflow.concurrency) {
    addLine(concurrencyTarget)
    addLine(concurrencyTarget, 2)
  }

  const jobs = workflow.jobs || []
  if (jobs.length > 0) {
    addLine(createJobTarget(jobs[0]))

    for (const job of jobs) {
      const jobTarget = createJobTarget(job)
      addLine(jobTarget)

      if (job.name && job.name !== job.id) addLine(jobTarget)

      if (hasList(job.needs)) {
        if (job.needs.length === 1) addLine(jobTarget)
        else {
          addLine(jobTarget)
          addLine(jobTarget, job.needs.length)
        }
      }

      if (job.condition) addLine(jobTarget)
      if (job.runsOn) addLine(jobTarget)

      if (job.environment) {
        if (typeof job.environment === 'string') addLine(jobTarget)
        else {
          addLine(jobTarget)
          addLine(jobTarget)
          if (job.environment.url) addLine(jobTarget)
        }
      }

      if (job.strategy) {
        addLine(jobTarget)
        if (job.strategy.failFast !== undefined && job.strategy.failFast !== null) addLine(jobTarget)
        if (job.strategy.maxParallel) addLine(jobTarget)

        if (hasEntries(job.strategy.matrix)) {
          addLine(jobTarget)
          addLine(jobTarget, Object.entries(job.strategy.matrix).length)
        }
      }

      if (hasEntries(job.permissions)) {
        addLine(jobTarget)
        addLine(jobTarget, Object.entries(job.permissions).length)
      }

      if (hasEntries(job.env)) {
        addLine(jobTarget)
        addLine(jobTarget, Object.entries(job.env).length)
      }

      if (job.timeout) addLine(jobTarget)
      if (job.continueOnError) addLine(jobTarget)

      if (job.container) {
        addLine(jobTarget)
        addLine(jobTarget)
      }

      if (hasEntries(job.services)) {
        addLine(jobTarget)

        for (const [, service] of Object.entries(job.services)) {
          addLine(jobTarget, 2)

          if (hasList(service.ports)) {
            addLine(jobTarget)
            addLine(jobTarget, service.ports.length)
          }

          if (hasEntries(service.env)) {
            addLine(jobTarget)
            addLine(jobTarget, Object.entries(service.env).length)
          }
        }
      }

      if (hasEntries(job.outputs)) {
        addLine(jobTarget)
        addLine(jobTarget, Object.entries(job.outputs).length)
      }

      const steps = job.steps || []
      if (steps.length > 0) {
        addLine(jobTarget)

        for (const step of steps) {
          const stepTarget = createStepTarget(job, step)
          addLine(stepTarget)

          if (step.id) addLine(stepTarget)
          if (step.condition) addLine(stepTarget)

          if (step.uses) {
            addLine(stepTarget)

            if (hasEntries(step.with)) {
              addLine(stepTarget)
              addLine(stepTarget, Object.entries(step.with).length)
            }
          } else if (step.run) {
            const runLines = step.run.split('\n')

            if (runLines.length > 1) {
              addLine(stepTarget)
              addLine(stepTarget, runLines.length)
            } else {
              addLine(stepTarget)
            }

            if (step.shell && step.shell !== 'bash') addLine(stepTarget)
          }

          if (hasEntries(step.env)) {
            addLine(stepTarget)
            addLine(stepTarget, Object.entries(step.env).length)
          }

          if (step.workingDirectory) addLine(stepTarget)
          if (step.timeout) addLine(stepTarget)
          if (step.continueOnError) addLine(stepTarget)
        }
      }
    }
  }

  return lineTargets
}

export function getLineTarget(lineTargets, lineNumber) {
  return lineTargets[lineNumber] || null
}

function createSectionTarget(sectionId) {
  return {
    sectionId,
    navId: NAV_IDS.section(sectionId),
  }
}

function createTriggerTarget(trigger) {
  return {
    sectionId: 'triggers',
    navId: NAV_IDS.trigger(trigger.id),
    triggerId: trigger.id,
  }
}

function createJobTarget(job) {
  return {
    sectionId: 'jobs',
    navId: NAV_IDS.job(job._key),
    jobKey: job._key,
  }
}

function createStepTarget(job, step) {
  return {
    sectionId: 'jobs',
    navId: NAV_IDS.step(job._key, step._key),
    jobKey: job._key,
    stepKey: step._key,
  }
}

function hasEntries(value) {
  return !!value && Object.keys(value).length > 0
}

function hasList(value) {
  return Array.isArray(value) && value.length > 0
}

function hasTriggerConfig(trigger) {
  return (
    hasList(trigger.branches) ||
    hasList(trigger.paths) ||
    hasList(trigger.tags) ||
    hasList(trigger.types) ||
    !!trigger.schedule
  )
}
