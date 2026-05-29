import jsyaml from 'js-yaml'
import { scheduleCrons, splitRunsOnLabels } from './yamlGenerator.js'
import { buildLineLocator } from './lineLocator.js'

// ============================================================
// Workflow Linter
// Checks YAML syntax + GitHub Actions best practices
// ============================================================

export function lintWorkflow(yamlStr, workflow) {
  const issues = []

  // 1. YAML syntax
  try {
    jsyaml.load(yamlStr)
  } catch (e) {
    issues.push({
      type: 'error',
      msg: `YAML syntax error: ${e.message}`,
      line: e.mark?.line + 1 || 1,
    })
    return issues // can't continue if YAML is broken
  }

  if (!workflow) return issues

  // 2. Workflow name
  if (!workflow.name) {
    issues.push({ type: 'warning', msg: 'Workflow is missing a "name". Add a descriptive name for better readability in the Actions UI.', line: 1 })
  }

  // 3. Triggers
  if (!workflow.triggers || workflow.triggers.length === 0) {
    issues.push({ type: 'error', msg: 'No triggers defined. Add at least one event trigger using "on:".', line: 1 })
  }

  for (const t of workflow.triggers || []) {
    // An ignore filter (branches-ignore / tags-ignore / paths-ignore) also
    // narrows a push trigger, so it counts as a filter here.
    const hasIgnoreFilter = [t.branchesIgnore, t.tagsIgnore, t.pathsIgnore].some(a => Array.isArray(a) && a.length > 0)
    if (t.type === 'push' && !t.branches && !t.tags && !t.paths && !hasIgnoreFilter) {
      issues.push({ type: 'warning', msg: `Trigger "push" has no branch/tag/path filter. This will trigger on pushes to ALL branches. Consider adding "branches:" to limit scope.`, line: 1, at: { trigger: t.type } })
    }
    // branches-ignore is also a branch filter for pull_request.
    if (t.type === 'pull_request' && !t.branches && !(Array.isArray(t.branchesIgnore) && t.branchesIgnore.length > 0)) {
      issues.push({ type: 'warning', msg: `Trigger "pull_request" has no branch filter. Consider specifying target branches.`, line: 1, at: { trigger: t.type } })
    }
    for (const cron of scheduleCrons(t)) {
      if (!isValidCron(cron)) {
        issues.push({ type: 'error', msg: `Invalid cron expression: "${cron}". Expected 5-field cron format (e.g. "0 0 * * *").`, line: 1, at: { trigger: t.type, text: cron } })
      }
    }

    // glob pattern validation on branch/tag/path filters
    for (const [filterLabel, patterns] of [['branch', t.branches], ['tag', t.tags], ['path', t.paths]]) {
      for (const pattern of patterns || []) {
        for (const problem of validateGlobPattern(pattern)) {
          issues.push({ type: 'warning', msg: `Trigger "${t.type}" has an invalid ${filterLabel} filter pattern "${pattern}": ${problem}`, line: 1, at: { trigger: t.type, text: pattern } })
        }
      }
    }
  }

  // 4. Jobs
  if (!workflow.jobs || workflow.jobs.length === 0) {
    issues.push({ type: 'error', msg: 'No jobs defined. A workflow must have at least one job.', line: 1, at: { top: 'jobs' } })
  }

  const jobIds = new Set()
  for (const job of workflow.jobs || []) {
    if (!job.id) {
      issues.push({ type: 'error', msg: 'A job is missing an ID.', line: 1 })
      continue
    }

    // job ID naming
    if (!/^[a-zA-Z_][a-zA-Z0-9_\-]*$/.test(job.id)) {
      issues.push({ type: 'warning', msg: `Job ID "${job.id}" should start with a letter or underscore, and contain only alphanumeric characters, hyphens, or underscores.`, line: 1, at: { job: job.id } })
    }
    if (jobIds.has(job.id)) {
      issues.push({ type: 'error', msg: `Duplicate job ID "${job.id}". Job IDs must be unique.`, line: 1, at: { job: job.id } })
    }
    jobIds.add(job.id)

    // A job that calls a reusable workflow ("uses:" at job level) has no
    // runs-on or steps of its own; those checks apply to every other job.
    if (job.uses) {
      if (job.steps && job.steps.length > 0) {
        issues.push({ type: 'error', msg: `Job "${job.id}" calls a reusable workflow ("uses") and also defines steps. A job can do one or the other.`, line: 1, at: { job: job.id, key: 'uses' } })
      }
    } else {
      if (!job.runsOn) {
        issues.push({ type: 'error', msg: `Job "${job.id}" is missing "runs-on". Specify a runner (e.g. "ubuntu-latest").`, line: 1, at: { job: job.id } })
      } else {
        for (const problem of validateRunnerLabel(job.runsOn)) {
          issues.push({ type: 'warning', msg: `Job "${job.id}" ${problem}`, line: 1, at: { job: job.id, key: 'runs-on' } })
        }
      }

      if (!job.steps || job.steps.length === 0) {
        issues.push({ type: 'warning', msg: `Job "${job.id}" has no steps defined.`, line: 1, at: { job: job.id } })
      }
    }

    // needs validation
    for (const needed of job.needs || []) {
      if (!workflow.jobs.find(j => j.id === needed)) {
        issues.push({ type: 'error', msg: `Job "${job.id}" needs "${needed}", but no job with that ID exists.`, line: 1, at: { job: job.id, key: 'needs' } })
      }
      if (needed === job.id) {
        issues.push({ type: 'error', msg: `Job "${job.id}" cannot depend on itself.`, line: 1, at: { job: job.id, key: 'needs' } })
      }
    }

    // job-level conditional expression
    if (job.condition) {
      for (const problem of validateExpression(job.condition)) {
        issues.push({ type: 'error', msg: `Job "${job.id}" has an invalid conditional expression ("${job.condition}"): ${problem}`, line: 1, at: { job: job.id, key: 'if' } })
      }
    }

    // hardcoded credentials in job-level env
    for (const [k, v] of Object.entries(job.env || {})) {
      for (const problem of findCredentialLeak(k, v)) {
        issues.push({ type: 'error', msg: `Job "${job.id}" env variable "${k}" ${problem}`, line: 1, at: { job: job.id, key: 'env', sub: k } })
      }
    }

    // step validation
    const stepIds = new Set()
    for (const [si, step] of (job.steps || []).entries()) {
      if (!step.name) {
        issues.push({ type: 'warning', msg: `A step in job "${job.id}" has no name. Add a descriptive name for clarity.`, line: 1, at: { job: job.id, step: si } })
      }
      if (step.uses && step.run) {
        issues.push({ type: 'error', msg: `Step "${step.name || '(unnamed)'}" in job "${job.id}" has both "uses" and "run". A step can only have one.`, line: 1, at: { job: job.id, step: si } })
      }
      if (!step.uses && !step.run) {
        issues.push({ type: 'error', msg: `Step "${step.name || '(unnamed)'}" in job "${job.id}" has neither "uses" nor "run". Add one.`, line: 1, at: { job: job.id, step: si } })
      }

      // action version pinning
      if (step.uses) {
        if (!step.uses.includes('@')) {
          issues.push({ type: 'warning', msg: `Step "${step.name || step.uses}" uses "${step.uses}" without a version pin. Pin to a version tag (e.g. @v4) for reproducibility.`, line: 1, at: { job: job.id, step: si, key: 'uses' } })
        } else if (/\@(master|main|HEAD)$/.test(step.uses)) {
          issues.push({ type: 'warning', msg: `Step "${step.name || step.uses}" is pinned to a mutable Git ref (${step.uses.split('@')[1]}). For security, pin to a version tag or commit SHA.`, line: 1, at: { job: job.id, step: si, key: 'uses' } })
        }
      }

      // duplicate step ids
      if (step.id) {
        if (stepIds.has(step.id)) {
          issues.push({ type: 'warning', msg: `Duplicate step ID "${step.id}" in job "${job.id}".`, line: 1, at: { job: job.id, step: si, key: 'id' } })
        }
        stepIds.add(step.id)
      }

      // step-level conditional expression
      if (step.condition) {
        for (const problem of validateExpression(step.condition)) {
          issues.push({ type: 'error', msg: `Step "${step.name || '(unnamed)'}" in job "${job.id}" has an invalid conditional expression ("${step.condition}"): ${problem}`, line: 1, at: { job: job.id, step: si, key: 'if' } })
        }
      }

      // script injection: untrusted context values interpolated directly into run:
      if (step.run) {
        for (const problem of findScriptInjectionRisk(step.run)) {
          issues.push({ type: 'error', msg: `Step "${step.name || '(unnamed)'}" in job "${job.id}" ${problem}`, line: 1, at: { job: job.id, step: si, key: 'run' } })
        }
      }

      // hardcoded credentials in step env / with
      for (const [k, v] of Object.entries(step.env || {})) {
        for (const problem of findCredentialLeak(k, v)) {
          issues.push({ type: 'error', msg: `Step "${step.name || '(unnamed)'}" in job "${job.id}" env variable "${k}" ${problem}`, line: 1, at: { job: job.id, step: si, key: 'env', sub: k } })
        }
      }
      for (const [k, v] of Object.entries(step.with || {})) {
        for (const problem of findCredentialLeak(k, v)) {
          issues.push({ type: 'error', msg: `Step "${step.name || '(unnamed)'}" in job "${job.id}" input "${k}" ${problem}`, line: 1, at: { job: job.id, step: si, key: 'with', sub: k } })
        }
      }
      if (step.run) {
        for (const problem of findHardcodedSecretPattern(step.run)) {
          issues.push({ type: 'error', msg: `Step "${step.name || '(unnamed)'}" in job "${job.id}" ${problem}`, line: 1, at: { job: job.id, step: si, key: 'run' } })
        }
      }
    }
  }

  // 5. Circular dependency detection
  //
  // Built as a directed graph of job -> needs[] and walked with a
  // three-color DFS (white/gray/black). A gray node reached again
  // during the same DFS walk means the path back to it is a cycle.
  // Edges to a nonexistent job are skipped here since the "needs"
  // validation above already reports those separately.
  if (workflow.jobs && workflow.jobs.length > 0) {
    for (const cycle of findDependencyCycles(workflow.jobs)) {
      issues.push({
        type: 'error',
        msg: `Circular dependency detected: ${cycle.join(' → ')}. A job cannot depend, directly or indirectly, on itself.`,
        line: 1,
        at: { job: cycle[0], key: 'needs' },
      })
    }
  }

  // Resolve each finding's structural location (`at`) to a real line in the
  // YAML shown in the editor; findings without one stay at line 1.
  const locator = buildLineLocator(yamlStr)
  for (const issue of issues) {
    if (issue.at) {
      issue.line = locator.locate(issue.at)
      delete issue.at
    }
  }

  return issues
}

function isValidCron(expr) {
  if (!expr) return false
  const parts = expr.trim().split(/\s+/)
  return parts.length === 5
}

// ------------------------------------------------------------
// Circular dependency detection
// ------------------------------------------------------------

export function findDependencyCycles(jobs) {
  const graph = new Map(jobs.map(j => [j.id, j.needs || []]))
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map([...graph.keys()].map(id => [id, WHITE]))
  const cycles = []
  const reported = new Set()

  function reportCycle(path, closingId) {
    const start = path.indexOf(closingId)
    const cycle = path.slice(start).concat(closingId)
    const key = [...new Set(cycle)].sort().join(',')
    if (reported.has(key)) return
    reported.add(key)
    cycles.push(cycle)
  }

  function visit(id, path) {
    color.set(id, GRAY)
    path.push(id)
    for (const dep of graph.get(id) || []) {
      if (!graph.has(dep)) continue // nonexistent job, reported elsewhere
      if (color.get(dep) === GRAY) {
        reportCycle(path, dep)
        continue
      }
      if (color.get(dep) === WHITE) {
        visit(dep, path)
      }
    }
    path.pop()
    color.set(id, BLACK)
  }

  for (const id of graph.keys()) {
    if (color.get(id) === WHITE) visit(id, [])
  }

  return cycles
}

// ------------------------------------------------------------
// Conditional expression validation
// ------------------------------------------------------------
//
// This is intentionally lightweight rather than a full GitHub
// Actions expression-grammar parser (that's what actionlint's
// expression type-checker does, at much greater cost). It catches
// the mistakes most likely to slip through: an unbalanced "${{ }}"
// wrapper, unbalanced parentheses, and a reference to a context
// name that GitHub Actions doesn't define.

const KNOWN_CONTEXTS = [
  'github', 'env', 'vars', 'job', 'jobs', 'steps', 'runner',
  'secrets', 'strategy', 'matrix', 'needs', 'inputs',
]

export function validateExpression(rawExpr) {
  const problems = []
  const expr = String(rawExpr).trim()
  if (!expr) return problems

  let body = expr

  // If the expression uses the ${{ ... }} wrapper, it must be
  // balanced and wrap the entire condition.
  if (expr.includes('${{') || expr.includes('}}')) {
    const match = /^\$\{\{([\s\S]*)\}\}$/.exec(expr)
    if (!match) {
      problems.push('malformed "${{ ... }}" wrapper (it must open with "${{" and close with "}}" around the whole condition)')
      return problems
    }
    body = match[1].trim()
  }

  // Balanced parentheses.
  let depth = 0
  let unbalanced = false
  for (const ch of body) {
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth < 0) { unbalanced = true; break }
    }
  }
  if (unbalanced || depth !== 0) {
    problems.push('unbalanced parentheses')
  }

  // Context references, e.g. "github.event_name" or "steps.build.outputs.x".
  // Skip anything that looks like a string literal so we don't flag
  // words inside quotes (e.g. == 'refs/heads/main').
  const withoutStringLiterals = body.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '')
  // Identifier segments (context roots, step/job ids, input/output names)
  // commonly contain hyphens in real workflows (e.g. "steps.use-old-whl",
  // "needs.get-changed-files"). The character classes below include "-"
  // so a hyphenated id is matched whole, rather than the regex losing sync
  // at the hyphen and re-matching starting mid-identifier — which used to
  // misreport the tail fragment after the last hyphen (e.g. "whl") as an
  // unknown context root.
  const contextRefs = withoutStringLiterals.match(/\b[a-zA-Z_][a-zA-Z0-9_-]*\.[a-zA-Z0-9_.-]+/g) || []
  const unknownRoots = new Set()
  for (const ref of contextRefs) {
    const root = ref.split('.')[0]
    if (!KNOWN_CONTEXTS.includes(root)) {
      unknownRoots.add(root)
    }
  }
  for (const root of unknownRoots) {
    problems.push(`unknown context "${root}" (expected one of: ${KNOWN_CONTEXTS.join(', ')})`)
  }

  return problems
}

// ------------------------------------------------------------
// Glob pattern validation (branches / tags / paths filters)
// ------------------------------------------------------------
//
// Not a full re-implementation of GitHub's filter-pattern cheat
// sheet — just the structural mistakes that are easy to make and
// silently produce a filter that never matches what the author
// intended: unbalanced [...] character classes, unbalanced {...}
// brace-expansion groups, and an empty pattern string.

export function validateGlobPattern(pattern) {
  const problems = []
  const str = String(pattern)

  if (str.trim() === '') {
    problems.push('pattern is empty')
    return problems
  }

  const brackets = (str.match(/\[/g) || []).length - (str.match(/\]/g) || []).length
  if (brackets !== 0) {
    problems.push('unbalanced "[" / "]" in character class')
  }

  const braces = (str.match(/\{/g) || []).length - (str.match(/\}/g) || []).length
  if (braces !== 0) {
    problems.push('unbalanced "{" / "}" in brace expansion')
  }

  return problems
}

// ------------------------------------------------------------
// Runner label validation (job.runs-on)
// ------------------------------------------------------------
//
// GitHub-hosted runner labels change over time (new OS versions
// are added, old ones eventually retired), so this list is not
// meant to be exhaustive or kept perfectly current — it exists to
// catch the common mistake of a typo'd label (e.g.
// "ubuntu-latest-typo" or "unbuntu-latest") rather than to be an
// authoritative registry. A self-hosted runner, or a matrix
// expression that resolves the value at run time, is intentionally
// not second-guessed.

const KNOWN_GITHUB_HOSTED_RUNNERS = new Set([
  'ubuntu-latest', 'ubuntu-24.04', 'ubuntu-22.04', 'ubuntu-20.04',
  'windows-latest', 'windows-2025', 'windows-2022', 'windows-2019',
  'macos-latest', 'macos-latest-xlarge',
  'macos-15', 'macos-15-xlarge', 'macos-14', 'macos-14-xlarge',
  'macos-13', 'macos-13-xlarge', 'macos-12',
])

export function validateRunnerLabel(runsOn) {
  const problems = []
  // { group, labels } (runner groups) can't be checked against a label list.
  if (runsOn && typeof runsOn === 'object' && !Array.isArray(runsOn)) return problems
  // The parser shows a list of labels as one comma-separated string.
  const labels = Array.isArray(runsOn) ? runsOn : splitRunsOnLabels(runsOn)

  for (const label of labels) {
    const str = String(label)
    if (str.includes('${{')) continue // resolved at run time (e.g. matrix.os)
    if (str === 'self-hosted') continue
    if (labels.includes('self-hosted')) continue // e.g. ['self-hosted', 'linux', 'x64']
    if (KNOWN_GITHUB_HOSTED_RUNNERS.has(str)) continue
    problems.push(`uses runner label "${str}", which is not a recognized GitHub-hosted runner. If this is a self-hosted runner, include the "self-hosted" label; otherwise check for a typo.`)
  }

  return problems
}

// ------------------------------------------------------------
// Script injection risk (run: steps)
// ------------------------------------------------------------
//
// Modeled on actionlint's security analysis: GitHub Actions
// contexts that carry attacker-controlled, free-text content
// (an issue/PR title or body, a review or comment body, a commit
// message, a fork's branch name) are unsafe to interpolate
// directly into a `run:` shell script with `${{ ... }}`, because
// the expression is substituted before the shell ever sees the
// line — arbitrary shell syntax in that field runs as code. The
// documented fix is to pass the value through `env:` and reference
// it as an environment variable, which the shell treats as inert
// data instead of as script text.

const UNTRUSTED_EXPRESSION_ROOTS = [
  /github\.event\.issue\.title/i,
  /github\.event\.issue\.body/i,
  /github\.event\.pull_request\.title/i,
  /github\.event\.pull_request\.body/i,
  /github\.event\.comment\.body/i,
  /github\.event\.review\.body/i,
  /github\.event\.review_comment\.body/i,
  /github\.event\.discussion\.title/i,
  /github\.event\.discussion\.body/i,
  /github\.event\.head_commit\.message/i,
  /github\.event\.head_commit\.author\.(name|email)/i,
  /github\.event\.pages\b/i,
  /github\.event\.commits\b/i,
  /github\.head_ref\b/i,
]

// Wrap each root pattern so the match captures the whole "${{ ... }}"
// expression (for a readable error message) rather than stopping at
// the field name.
const UNTRUSTED_EXPRESSION_PATTERNS = UNTRUSTED_EXPRESSION_ROOTS.map(
  root => new RegExp(`\\$\\{\\{[^}]*${root.source}[^}]*\\}\\}`, 'i')
)

export function findScriptInjectionRisk(runScript) {
  const problems = []
  const str = String(runScript)

  for (const pattern of UNTRUSTED_EXPRESSION_PATTERNS) {
    const match = pattern.exec(str)
    if (match) {
      problems.push(`interpolates an attacker-controllable value (${match[0]}) directly into a "run:" script. This is a known script-injection risk — pass it through an "env:" variable and reference the environment variable (e.g. "$MY_VAR") instead of interpolating "\${{ ... }}" inline.`)
    }
  }

  return problems
}

// ------------------------------------------------------------
// Hardcoded credential detection
// ------------------------------------------------------------
//
// Two independent checks: (1) a value assigned to a key whose name
// looks security-sensitive (password/token/secret/api key/etc.)
// that is a literal string rather than a reference to `secrets.*`
// or `vars.*`; (2) a small set of well-known secret value shapes
// (AWS access key IDs, PEM private key headers, generic
// "sk-"-style API tokens) matched wherever they appear, regardless
// of the surrounding key name. Neither is a substitute for a
// dedicated secret-scanning tool, but both catch the common,
// easy-to-make mistake of pasting a literal credential into a
// workflow file instead of using GitHub's encrypted secrets.

const SENSITIVE_KEY_NAME = /pass(word)?|secret|token|api[_-]?key|credential|private[_-]?key/i
const KNOWN_SECRET_VALUE_PATTERNS = [
  { name: 'an AWS access key ID', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'a PEM private key block', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'an OpenAI-style secret key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'a GitHub personal access token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
]

export function findCredentialLeak(key, value) {
  const problems = []
  const str = value === undefined || value === null ? '' : String(value)

  // Only string values can plausibly BE a hardcoded credential literal.
  // A sensitively-named key holding a boolean or number is virtually
  // always a flag/option, not a secret — e.g. actions/checkout's
  // "persist-credentials: false" was being flagged here before this
  // check, purely because its key name contains "credential".
  if (typeof value === 'string' && SENSITIVE_KEY_NAME.test(key) && str !== '' && !str.includes('${{')) {
    problems.push(`looks like a hardcoded credential (a literal value assigned to a sensitively-named key). Use "\${{ secrets.${toSecretName(key)} }}" instead of a literal value.`)
  }

  for (const { name, re } of KNOWN_SECRET_VALUE_PATTERNS) {
    if (re.test(str)) {
      problems.push(`contains what looks like ${name}. Move it to a GitHub encrypted secret and reference it with "\${{ secrets.* }}" instead of hardcoding it.`)
    }
  }

  return problems
}

export function findHardcodedSecretPattern(text) {
  const problems = []
  const str = String(text)
  for (const { name, re } of KNOWN_SECRET_VALUE_PATTERNS) {
    if (re.test(str)) {
      problems.push(`contains what looks like ${name} directly in a "run:" script. Move it to a GitHub encrypted secret and reference it with "\${{ secrets.* }}" instead of hardcoding it.`)
    }
  }
  return problems
}

function toSecretName(key) {
  return String(key).toUpperCase().replace(/[^A-Z0-9_]/g, '_')
}
