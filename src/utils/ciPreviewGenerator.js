import { generateYAML } from './yamlGenerator.js'

export const PREVIEW_FORMATS = [
  { id: 'github', label: 'GitHub Actions' },
  { id: 'circleci', label: 'CircleCI' },
  { id: 'travis', label: 'Travis CI' },
]

export function generatePreviewConfig(workflow, format = 'github') {
  if (format === 'circleci') return generateCircleCIConfig(workflow)
  if (format === 'travis') return generateTravisConfig(workflow)
  return generateYAML(workflow)
}

export function getPreviewDownloadName(activeFilename, format = 'github') {
  if (format === 'circleci') return 'circleci-config.yml'
  if (format === 'travis') return '.travis.yml'
  return activeFilename || 'workflow.yml'
}

export function getPreviewNotice(format = 'github') {
  if (format === 'circleci') {
    return 'CircleCI output is a best-effort preview, not a verified conversion. Our tool does not allow editing CircleCI yet, but you can preview, copy, and download this config as a starting point.'
  }

  if (format === 'travis') {
    return 'Travis CI output is a best-effort preview, not a verified conversion. Our tool does not allow editing Travis CI yet, but you can preview, copy, and download this config as a starting point.'
  }

  return ''
}

function generateCircleCIConfig(workflow) {
  const lines = []
  const jobs = workflow.jobs || []
  const workflowId = sanitizeId(workflow.name || 'workflow')
  const triggers = describeTriggers(workflow.triggers || [])
  const levels = getJobLevels(jobs)

  lines.push('# Best-effort preview generated from the GitHub Actions workflow editor (not a verified conversion).')
  lines.push(`# Source workflow: ${workflow.name || 'Untitled workflow'}`)
  if (triggers) lines.push(`# Triggers: ${triggers}`)
  lines.push('version: 2.1')
  lines.push('')
  lines.push('jobs:')

  if (jobs.length === 0) {
    lines.push('  placeholder:')
    lines.push('    docker:')
    lines.push('      - image: cimg/base:stable')
    lines.push('    steps:')
    lines.push('      - run: echo "Add jobs in the editor to generate a CircleCI config preview."')
  } else {
    jobs.forEach(job => {
      lines.push(`  ${sanitizeId(job.id)}:`)
      lines.push('    docker:')
      lines.push('      - image: cimg/base:stable')

      if (hasEntries(workflow.env) || hasEntries(job.env)) {
        lines.push('    environment:')
        appendObject(lines, { ...workflow.env, ...job.env }, 6)
      }

      if (job.container) {
        lines.push(`    # Original container image: ${job.container}`)
      }

      lines.push('    steps:')

      const steps = createCircleSteps(job.steps || [])
      steps.forEach(stepLines => stepLines.forEach(line => lines.push(line)))
    })
  }

  lines.push('')
  lines.push('workflows:')
  lines.push(`  ${workflowId}:`)
  lines.push('    jobs:')

  if (jobs.length === 0) {
    lines.push('      - placeholder')
  } else {
    jobs.forEach(job => {
      const jobId = sanitizeId(job.id)
      if (job.needs?.length > 0) {
        lines.push(`      - ${jobId}:`)
        lines.push('          requires:')
        job.needs.forEach(need => lines.push(`            - ${sanitizeId(need)}`))
      } else {
        lines.push(`      - ${jobId}`)
      }

      const level = levels.get(job._key)
      if (level > 1) {
        lines.push(`        # Approximate dependency stage: ${level}`)
      }
    })
  }

  return lines.join('\n')
}

function generateTravisConfig(workflow) {
  const lines = []
  const jobs = workflow.jobs || []
  const triggers = describeTriggers(workflow.triggers || [])
  const levels = getJobLevels(jobs)
  const orderedStages = Array.from(new Set(jobs.map(job => levels.get(job._key))))
    .sort((a, b) => a - b)
    .map(level => `stage_${level}`)

  lines.push('# Best-effort preview generated from the GitHub Actions workflow editor (not a verified conversion).')
  lines.push(`# Source workflow: ${workflow.name || 'Untitled workflow'}`)
  if (triggers) lines.push(`# Triggers: ${triggers}`)
  lines.push('language: minimal')
  lines.push('dist: jammy')

  if (hasEntries(workflow.env)) {
    lines.push('env:')
    lines.push('  global:')
    Object.entries(workflow.env).forEach(([key, value]) => {
      lines.push(`    - ${key}=${stringifyValue(value)}`)
    })
  }

  lines.push('')
  lines.push('stages:')

  if (orderedStages.length === 0) {
    lines.push('  - preview')
  } else {
    orderedStages.forEach(stage => lines.push(`  - ${stage}`))
  }

  lines.push('')
  lines.push('jobs:')
  lines.push('  include:')

  if (jobs.length === 0) {
    lines.push('    - stage: preview')
    lines.push('      name: Placeholder Job')
    lines.push('      script:')
    lines.push('        - echo "Add jobs in the editor to generate a Travis CI config preview."')
  } else {
    jobs.forEach(job => {
      const stage = `stage_${levels.get(job._key)}`
      lines.push(`    - stage: ${stage}`)
      lines.push(`      name: ${quoteString(job.name || job.id)}`)

      if (hasEntries(job.env)) {
        lines.push('      env:')
        Object.entries(job.env).forEach(([key, value]) => {
          lines.push(`        - ${key}=${stringifyValue(value)}`)
        })
      }

      lines.push('      script:')
      createTravisScript(job.steps || []).forEach(line => lines.push(`        - ${line}`))
    })
  }

  return lines.join('\n')
}

function createCircleSteps(steps) {
  if (steps.length === 0) {
    return [[
      '      - run:',
      '          name: Placeholder',
      '          command: echo "Add steps in Design to generate a richer CircleCI preview."',
    ]]
  }

  return steps.map(step => {
    if (step.uses === 'actions/checkout@v4') {
      return ['      - checkout']
    }

    if (step.run) {
      const lines = [
        '      - run:',
        `          name: ${quoteString(step.name || 'Run Command')}`,
      ]

      if (step.run.includes('\n')) {
        lines.push('          command: |')
        step.run.split('\n').forEach(runLine => lines.push(`            ${runLine}`))
      } else {
        lines.push(`          command: ${quoteString(step.run)}`)
      }

      return lines
    }

    return [
      '      - run:',
      `          name: ${quoteString(step.name || 'GitHub Action Step')}`,
      `          command: ${quoteString(`echo "Manually replace GitHub Action step: ${step.uses || 'unsupported action'}"`)}`
    ]
  })
}

function createTravisScript(steps) {
  if (steps.length === 0) {
    return ['echo "Add steps in Design to generate a richer Travis CI preview."']
  }

  return steps.flatMap(step => {
    if (step.uses === 'actions/checkout@v4') {
      return ['echo "Repository checkout is handled automatically by Travis CI"']
    }

    if (step.run) {
      return step.run.split('\n')
    }

    return [`echo "Manually replace GitHub Action step: ${step.uses || 'unsupported action'}"`]
  })
}

function appendObject(lines, obj, indent) {
  Object.entries(obj || {}).forEach(([key, value]) => {
    lines.push(`${' '.repeat(indent)}${key}: ${stringifyValue(value)}`)
  })
}

function getJobLevels(jobs) {
  const jobMap = new Map(jobs.map(job => [job.id, job]))
  const cache = new Map()

  const getLevel = (job, trail = new Set()) => {
    if (cache.has(job._key)) return cache.get(job._key)
    if (trail.has(job._key)) return 1

    const nextTrail = new Set(trail)
    nextTrail.add(job._key)

    const level = Math.max(
      1,
      ...(job.needs || [])
        .map(needId => jobMap.get(needId))
        .filter(Boolean)
        .map(needJob => getLevel(needJob, nextTrail) + 1)
    )

    cache.set(job._key, level)
    return level
  }

  jobs.forEach(job => getLevel(job))
  return cache
}

function describeTriggers(triggers) {
  return triggers.map(trigger => {
    const details = []
    if (trigger.branches?.length) details.push(`branches=${trigger.branches.join(', ')}`)
    if (trigger.tags?.length) details.push(`tags=${trigger.tags.join(', ')}`)
    if (trigger.schedule) details.push(`cron=${trigger.schedule}`)
    return details.length > 0 ? `${trigger.type} (${details.join('; ')})` : trigger.type
  }).join(', ')
}

function sanitizeId(value) {
  return String(value || 'job')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'job'
}

function quoteString(value) {
  return JSON.stringify(String(value ?? ''))
}

function stringifyValue(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  return String(value ?? '')
}

function hasEntries(value) {
  return !!value && Object.keys(value).length > 0
}
