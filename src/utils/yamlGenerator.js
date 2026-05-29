// ============================================================
// YAML Generator — workflow object → YAML string
// ============================================================
//
// Scalar values that come from free-text user input (names, run
// commands, env values, condition expressions, etc.) are passed
// through quoteYAMLScalar() before being interpolated into a line.
// This prevents characters that are significant in YAML's plain
// scalar syntax (a colon followed by whitespace, a leading
// indicator character such as "!", "&", "*", "#", "%%", a value
// that collides with a YAML boolean/null/number, etc.) from
// silently producing invalid or misinterpreted YAML.

export function generateYAML(workflow) {
  const lines = []

  // name
  if (workflow.name) lines.push(`name: ${quoteYAMLScalar(workflow.name)}`)

  // env (workflow-level)
  if (workflow.env && Object.keys(workflow.env).length > 0) {
    lines.push('env:')
    for (const [k, v] of Object.entries(workflow.env)) {
      lines.push(`  ${k}: ${emitScalar(v)}`)
    }
  }

  // on: triggers
  const triggers = workflow.triggers || []
  if (triggers.length === 1 && !hasTriggerConfig(triggers[0])) {
    lines.push(`on: ${triggers[0].type}`)
  } else if (triggers.length > 0) {
    lines.push('on:')
    for (const t of triggers) {
      lines.push(`  ${t.type}:`)
      if (t.branches && t.branches.length > 0) {
        lines.push('    branches:')
        for (const b of t.branches) lines.push(`      - ${quoteYAMLScalar(b)}`)
      }
      if (t.paths && t.paths.length > 0) {
        lines.push('    paths:')
        for (const p of t.paths) lines.push(`      - ${quoteYAMLScalar(p)}`)
      }
      if (t.tags && t.tags.length > 0) {
        lines.push('    tags:')
        for (const tag of t.tags) lines.push(`      - ${quoteYAMLScalar(tag)}`)
      }
      // The *-ignore filters were parsed (yamlParser.js) but never written
      // back, so a trigger such as "pull_request: branches-ignore: [nightly]"
      // silently turned into a bare "pull_request:" on save, widening it to
      // every branch.
      if (t.branchesIgnore && t.branchesIgnore.length > 0) {
        lines.push('    branches-ignore:')
        for (const b of t.branchesIgnore) lines.push(`      - ${quoteYAMLScalar(b)}`)
      }
      if (t.pathsIgnore && t.pathsIgnore.length > 0) {
        lines.push('    paths-ignore:')
        for (const p of t.pathsIgnore) lines.push(`      - ${quoteYAMLScalar(p)}`)
      }
      if (t.tagsIgnore && t.tagsIgnore.length > 0) {
        lines.push('    tags-ignore:')
        for (const tag of t.tagsIgnore) lines.push(`      - ${quoteYAMLScalar(tag)}`)
      }
      if (t.types && t.types.length > 0) {
        lines.push('    types:')
        for (const tp of t.types) lines.push(`      - ${quoteYAMLScalar(tp)}`)
      }
      // t.schedule is the first cron (the one the design panel edits);
      // t.schedules (from the parser) carries any further entries.
      for (const cron of scheduleCrons(t)) {
        lines.push(`    - cron: ${quoteYAMLScalar(cron)}`)
      }
      if (t.inputs && Object.keys(t.inputs).length > 0) {
        lines.push('    inputs:')
        for (const [k, v] of Object.entries(t.inputs)) {
          lines.push(`      ${k}:`)
          // Only emit "description:" when the source actually had one —
          // writing it unconditionally (as an empty string) added a key
          // that wasn't in the original file.
          if (v.description) lines.push(`        description: ${quoteYAMLScalar(v.description)}`)
          // "type:" (string/boolean/number/choice/environment) was being
          // dropped entirely here. It matters for workflow_call inputs in
          // particular, where the type affects how the caller must pass
          // the value and how the UI should render/validate it.
          if (v.type) lines.push(`        type: ${v.type}`)
          lines.push(`        required: ${v.required || false}`)
          if (v.default !== undefined) {
            // Only string defaults need quoteYAMLScalar's escaping. A
            // boolean or number default (common for type: boolean / type:
            // number inputs) was being force-quoted into a string (e.g.
            // `default: true` -> `default: "true"`), which silently
            // changes the input's effective type on the very next save.
            const defaultOut = typeof v.default === 'boolean' || typeof v.default === 'number'
              ? v.default
              : quoteYAMLScalar(v.default)
            lines.push(`        default: ${defaultOut}`)
          }
        }
      }
    }
  }

  // permissions (workflow-level)
  // GitHub Actions allows "permissions:" to be either a map of scope: level
  // pairs, OR a bare shorthand string ("read-all" / "write-all" / "{}").
  // yamlParser.js passes a string value straight through unchanged, so it
  // must be handled here as a string — treating it as a map (the old code
  // did `Object.entries(workflow.permissions)` unconditionally) silently
  // spells the string out as a character-indexed map (e.g. "read-all" ->
  // "0: r", "1: e", ...), corrupting the file on the very next save.
  if (typeof workflow.permissions === 'string' && workflow.permissions) {
    lines.push(`permissions: ${workflow.permissions}`)
  } else if (workflow.permissions && Object.keys(workflow.permissions).length > 0) {
    lines.push('permissions:')
    for (const [k, v] of Object.entries(workflow.permissions)) {
      lines.push(`  ${k}: ${v}`)
    }
  }

  // concurrency
  if (workflow.concurrency) {
    lines.push('concurrency:')
    lines.push(`  group: ${quoteYAMLScalar(workflow.concurrency.group)}`)
    lines.push(`  cancel-in-progress: ${workflow.concurrency.cancelInProgress}`)
  }

  // jobs
  const jobs = workflow.jobs || []
  if (jobs.length > 0) {
    lines.push('jobs:')
    for (const job of jobs) {
      lines.push(`  ${job.id}:`)
      if (job.name && job.name !== job.id) lines.push(`    name: ${quoteYAMLScalar(job.name)}`)
      if (job.needs && job.needs.length > 0) {
        if (job.needs.length === 1) lines.push(`    needs: ${quoteYAMLScalar(job.needs[0])}`)
        else {
          lines.push('    needs:')
          for (const n of job.needs) lines.push(`      - ${quoteYAMLScalar(n)}`)
        }
      }
      if (job.condition) lines.push(`    if: ${quoteYAMLScalar(job.condition)}`)

      // A job that calls a reusable workflow: uses / with / secrets, carried
      // through unchanged from the parser (no runs-on or steps on such a job).
      if (job.uses) {
        lines.push(`    uses: ${quoteYAMLScalar(job.uses)}`)
        if (job.with && Object.keys(job.with).length > 0) {
          lines.push('    with:')
          for (const [k, v] of Object.entries(job.with)) {
            lines.push(`      ${k}: ${emitScalar(v)}`)
          }
        }
        if (typeof job.secrets === 'string' && job.secrets) {
          lines.push(`    secrets: ${quoteYAMLScalar(job.secrets)}`)
        } else if (job.secrets && typeof job.secrets === 'object' && Object.keys(job.secrets).length > 0) {
          lines.push('    secrets:')
          for (const [k, v] of Object.entries(job.secrets)) {
            lines.push(`      ${k}: ${emitScalar(v)}`)
          }
        }
      }

      // runs-on
      // The parser shows a list of labels as one comma-separated string, so
      // split it back into a YAML list here; otherwise "[self-hosted, linux]"
      // became the single label "self-hosted, linux" on save. The object form
      // ({ group, labels }) is written as a flow mapping.
      if (job.runsOn) {
        const labels = Array.isArray(job.runsOn) ? job.runsOn : splitRunsOnLabels(job.runsOn)
        if (typeof job.runsOn === 'object' && !Array.isArray(job.runsOn)) {
          lines.push(`    runs-on: ${JSON.stringify(job.runsOn)}`)
        } else if (labels.length > 1) {
          lines.push(`    runs-on: [${labels.map(r => quoteYAMLFlowScalar(r)).join(', ')}]`)
        } else {
          lines.push(`    runs-on: ${quoteYAMLScalar(labels[0] ?? job.runsOn)}`)
        }
      }

      // environment
      if (job.environment) {
        if (typeof job.environment === 'string') {
          lines.push(`    environment: ${quoteYAMLScalar(job.environment)}`)
        } else {
          lines.push('    environment:')
          lines.push(`      name: ${quoteYAMLScalar(job.environment.name)}`)
          if (job.environment.url) lines.push(`      url: ${quoteYAMLScalar(job.environment.url)}`)
        }
      }

      // strategy
      if (job.strategy) {
        lines.push('    strategy:')
        if (job.strategy.failFast !== undefined && job.strategy.failFast !== null) {
          lines.push(`      fail-fast: ${job.strategy.failFast}`)
        }
        if (job.strategy.maxParallel) {
          lines.push(`      max-parallel: ${job.strategy.maxParallel}`)
        }
        if (typeof job.strategy.matrix === 'string' && job.strategy.matrix) {
          // matrix given as a whole expression, e.g. ${{ fromJSON(needs.x.outputs.m) }}.
          // Object.entries() on a string spells it out character by character.
          lines.push(`      matrix: ${quoteYAMLScalar(job.strategy.matrix)}`)
        } else if (job.strategy.matrix && typeof job.strategy.matrix === 'object' && Object.keys(job.strategy.matrix).length > 0) {
          lines.push('      matrix:')
          for (const [k, v] of Object.entries(job.strategy.matrix)) {
            if (Array.isArray(v)) {
              lines.push(`        ${k}: [${v.map(x => JSON.stringify(x)).join(', ')}]`)
            } else if (v !== null && typeof v === 'object') {
              lines.push(`        ${k}: ${JSON.stringify(v)}`)
            } else {
              lines.push(`        ${k}: ${emitScalar(v)}`)
            }
          }
        }
      }

      // permissions (job-level)
      // Same shorthand-string case as the workflow-level permissions above.
      if (typeof job.permissions === 'string' && job.permissions) {
        lines.push(`    permissions: ${job.permissions}`)
      } else if (job.permissions && Object.keys(job.permissions).length > 0) {
        lines.push('    permissions:')
        for (const [k, v] of Object.entries(job.permissions)) {
          lines.push(`      ${k}: ${v}`)
        }
      }

      // env (job-level)
      if (job.env && Object.keys(job.env).length > 0) {
        lines.push('    env:')
        for (const [k, v] of Object.entries(job.env)) {
          lines.push(`      ${k}: ${emitScalar(v)}`)
        }
      }

      if (job.timeout) lines.push(`    timeout-minutes: ${job.timeout}`)
      if (job.continueOnError) lines.push(`    continue-on-error: ${job.continueOnError}`)
      if (job.container) {
        lines.push('    container:')
        lines.push(`      image: ${quoteYAMLScalar(job.container)}`)
      }

      // services
      if (job.services && Object.keys(job.services).length > 0) {
        lines.push('    services:')
        for (const [sName, sCfg] of Object.entries(job.services)) {
          lines.push(`      ${sName}:`)
          lines.push(`        image: ${quoteYAMLScalar(sCfg.image)}`)
          if (sCfg.ports && sCfg.ports.length > 0) {
            lines.push('        ports:')
            for (const p of sCfg.ports) lines.push(`          - ${p}`)
          }
          if (sCfg.env && Object.keys(sCfg.env).length > 0) {
            lines.push('        env:')
            for (const [k, v] of Object.entries(sCfg.env)) lines.push(`          ${k}: ${emitScalar(v)}`)
          }
        }
      }

      // outputs
      if (job.outputs && Object.keys(job.outputs).length > 0) {
        lines.push('    outputs:')
        for (const [k, v] of Object.entries(job.outputs)) {
          lines.push(`      ${k}: ${quoteYAMLScalar(v)}`)
        }
      }

      // steps
      const steps = job.steps || []
      if (steps.length > 0) {
        lines.push('    steps:')
        for (const step of steps) {
          lines.push(`      - name: ${quoteYAMLScalar(step.name || 'Unnamed step')}`)
          if (step.id) lines.push(`        id: ${quoteYAMLScalar(step.id)}`)
          if (step.condition) lines.push(`        if: ${quoteYAMLScalar(step.condition)}`)

          if (step.uses) {
            lines.push(`        uses: ${quoteYAMLScalar(step.uses)}`)
            if (step.with && Object.keys(step.with).length > 0) {
              lines.push('        with:')
              for (const [k, v] of Object.entries(step.with)) {
                lines.push(`          ${k}: ${emitScalar(v)}`)
              }
            }
          } else if (step.run) {
            const runLines = step.run.split('\n')
            if (runLines.length > 1) {
              // A first line that starts with whitespace needs an explicit
              // indentation indicator, or YAML would take that whitespace as
              // the block's indentation and mis-read every following line.
              lines.push(/^\s/.test(runLines[0]) ? '        run: |2' : '        run: |')
              for (const l of runLines) lines.push(`          ${l}`)
            } else {
              lines.push(`        run: ${quoteYAMLScalar(step.run)}`)
            }
            if (step.shell && step.shell !== 'bash') {
              lines.push(`        shell: ${quoteYAMLScalar(step.shell)}`)
            }
          }

          // step env
          if (step.env && Object.keys(step.env).length > 0) {
            lines.push('        env:')
            for (const [k, v] of Object.entries(step.env)) {
              lines.push(`          ${k}: ${emitScalar(v)}`)
            }
          }

          if (step.workingDirectory) lines.push(`        working-directory: ${quoteYAMLScalar(step.workingDirectory)}`)
          if (step.timeout) lines.push(`        timeout-minutes: ${step.timeout}`)
          if (step.continueOnError) lines.push(`        continue-on-error: ${step.continueOnError}`)
        }
      }
    }
  }

  return lines.join('\n')
}

function hasTriggerConfig(t) {
  return (
    (t.branches && t.branches.length > 0) ||
    (t.paths && t.paths.length > 0) ||
    (t.tags && t.tags.length > 0) ||
    (t.types && t.types.length > 0) ||
    t.schedule ||
    (t.schedules && t.schedules.length > 0) ||
    (t.branchesIgnore && t.branchesIgnore.length > 0) ||
    (t.pathsIgnore && t.pathsIgnore.length > 0) ||
    (t.tagsIgnore && t.tagsIgnore.length > 0) ||
    // Missing this meant a sole workflow_call/workflow_dispatch trigger
    // whose only configuration was an "inputs:" schema got collapsed to
    // the bare "on: workflow_call" shorthand, silently discarding every
    // input's name/type/required/default/description — which is most of
    // the point of a reusable workflow definition.
    (t.inputs && Object.keys(t.inputs).length > 0)
  )
}

// ------------------------------------------------------------
// YAML scalar quoting
// ------------------------------------------------------------
// Implements the subset of the YAML 1.1/1.2 "plain scalar" rules
// that matter for values Actions Editor emits: a plain (unquoted)
// scalar cannot start with an indicator character, cannot contain
// ": " (colon-space) or a line-ending colon, cannot contain " #"
// (space-hash), can't be empty, and must not collide with the
// implicit typing of booleans/null/numbers or the reader will
// silently interpret it as something other than a string.
// When any of these hold, the value is emitted as a double-quoted
// scalar with backslashes/quotes/newlines escaped.

const YAML_RESERVED_WORDS = new Set([
  'true', 'false', 'null', 'yes', 'no', 'on', 'off', '~',
  'True', 'False', 'Null', 'Yes', 'No', 'On', 'Off',
  'TRUE', 'FALSE', 'NULL', 'YES', 'NO', 'ON', 'OFF',
])

const YAML_LEADING_INDICATOR_CHARS = /^[-?:,[\]{}#&*!|>'"%@`]/
const YAML_NUMBER_LIKE = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/

export function needsYAMLQuoting(value) {
  const str = String(value)
  if (str === '') return true
  if (/^\s|\s$/.test(str)) return true
  if (YAML_LEADING_INDICATOR_CHARS.test(str)) return true
  if (/:(\s|$)/.test(str)) return true
  if (/\s#/.test(str)) return true
  if (/[\n\t]/.test(str)) return true
  if (YAML_RESERVED_WORDS.has(str)) return true
  if (YAML_NUMBER_LIKE.test(str)) return true
  return false
}

export function quoteYAMLScalar(value) {
  if (value === undefined || value === null) return ''
  const str = String(value)
  if (!needsYAMLQuoting(str)) return str
  const escaped = str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
  return `"${escaped}"`
}

// A flow-sequence item ("[a, b]") additionally cannot contain , [ ] { } in
// a plain scalar, so those force quoting too (e.g. "${{ matrix.os }}").
export function quoteYAMLFlowScalar(value) {
  const str = value === undefined || value === null ? '' : String(value)
  if (/[,[\]{}]/.test(str)) {
    const escaped = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')
    return `"${escaped}"`
  }
  return quoteYAMLScalar(str)
}

// env / with / matrix values come from the parser with their original YAML
// types. A boolean or number must be written back as one — quoting it
// ("true", "1") changed its type on every save. Strings go through the
// normal quoting rules; a string that merely looks like a boolean/number is
// still quoted by quoteYAMLScalar, so a typed-in "true" stays a string.
export function emitScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  return quoteYAMLScalar(value)
}

// The cron expressions of a schedule trigger, first (design-panel) one first.
export function scheduleCrons(t) {
  const rest = Array.isArray(t.schedules) ? t.schedules.slice(1) : []
  return [t.schedule, ...rest].filter(Boolean)
}

// Splits the parser's comma-separated runs-on string back into labels,
// ignoring commas inside a ${{ ... }} expression (e.g. fromJSON('["a","b"]')).
export function splitRunsOnLabels(runsOn) {
  const str = String(runsOn)
  const parts = []
  let depth = 0
  let current = ''
  for (let i = 0; i < str.length; i++) {
    if (str.startsWith('${{', i)) { depth++; current += '${{'; i += 2; continue }
    if (depth > 0 && str.startsWith('}}', i)) { depth--; current += '}}'; i += 1; continue }
    if (str[i] === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue }
    current += str[i]
  }
  parts.push(current.trim())
  return parts.filter(Boolean)
}
