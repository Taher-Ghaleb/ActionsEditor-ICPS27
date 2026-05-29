// Regression tests for bugs found while running the Week 2 evaluation
// corpus (tests/fixtures/corpus/, real workflow files from checkstyle/checkstyle
// and pytorch/pytorch) through the linter and the parse->generate->parse
// round trip. Each test here reproduces the exact real-world shape
// that exposed the bug, minimized to the smallest input that still fails
// without the fix.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateExpression, findCredentialLeak, lintWorkflow } from '../src/utils/linter.js'
import { parseYAMLToWorkflow } from '../src/utils/yamlParser.js'
import { generateYAML } from '../src/utils/yamlGenerator.js'
import jsyaml from 'js-yaml'

// ------------------------------------------------------------
// Bug 1: validateExpression mis-parsed hyphenated step/job ids
// ------------------------------------------------------------
// Found via pytorch/pytorch's _linux-build.yml, e.g.
// "steps.use-old-whl.outputs.reuse" — the context-reference regex didn't
// include "-" in its identifier character class, so it lost sync at the
// hyphen and re-matched starting at "whl", reporting "whl" as an unknown
// context root.

test('validateExpression does not choke on hyphenated step/job ids', () => {
  assert.deepEqual(
    validateExpression("steps.use-old-whl.outputs.reuse != 'true'"),
    []
  )
  assert.deepEqual(
    validateExpression("needs.get-changed-files.outputs.changed-files == '*'"),
    []
  )
  assert.deepEqual(
    validateExpression("steps.aws-creds.outcome == 'success'"),
    []
  )
})

test('validateExpression still catches a genuinely unknown context next to hyphenated ids', () => {
  const problems = validateExpression("steps.build-external-packages.outputs.x && foobar.thing")
  assert.equal(problems.length, 1)
  assert.match(problems[0], /foobar/)
})

// ------------------------------------------------------------
// Bug 2: findCredentialLeak flagged boolean-valued sensitive-named keys
// ------------------------------------------------------------
// Found via pytorch/pytorch's scorecards.yml: actions/checkout's
// "persist-credentials: false" was flagged as "looks like a hardcoded
// credential" purely because the key name contains "credential" — but the
// value is a boolean flag, not a literal secret.

test('findCredentialLeak does not flag a boolean value on a sensitively-named key', () => {
  assert.deepEqual(findCredentialLeak('persist-credentials', false), [])
  assert.deepEqual(findCredentialLeak('persist-credentials', true), [])
})

test('findCredentialLeak still flags an actual hardcoded string credential', () => {
  const problems = findCredentialLeak('api_key', 'sk-not-a-real-key-but-shaped-like-one')
  assert.equal(problems.length, 1)
})

// ------------------------------------------------------------
// Bug 3: schedule triggers silently lost their cron expression
// ------------------------------------------------------------
// Found via checkstyle/checkstyle's codeql-analysis.yml and two pytorch
// files. on.schedule's YAML shape is `schedule: [{cron: "..."}]` — the
// array itself IS the config, not an object with a nested ".schedule" key
// — so the old `conf.schedule` check was always undefined.

test('a schedule trigger keeps its cron expression through parse + generate', () => {
  const yaml = 'name: X\non:\n  schedule:\n    - cron: "29 2 * * 0"\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n'
  const workflow = parseYAMLToWorkflow(yaml)
  const scheduleTrigger = workflow.triggers.find(t => t.type === 'schedule')
  assert.equal(scheduleTrigger.schedule, '29 2 * * 0')

  const regenerated = generateYAML(workflow)
  const raw = jsyaml.load(regenerated)
  assert.deepEqual(raw.on.schedule, [{ cron: '29 2 * * 0' }])
})

// ------------------------------------------------------------
// Bug 4: string-form "permissions: read-all" corrupted into a
// character-indexed map on regeneration
// ------------------------------------------------------------
// Found via pytorch/pytorch's lint.yml (permissions: read-all) — the
// generator did `Object.entries(workflow.permissions)` unconditionally,
// and Object.entries on a STRING gives you its characters by index
// (permissions: read-all -> "0: r", "1: e", "2: a", ...), which isn't
// even valid YAML once re-parsed as a mapping.

test('a bare "permissions: read-all" string round-trips as itself, not a character map', () => {
  const yaml = 'name: X\non: push\npermissions: read-all\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n'
  const workflow = parseYAMLToWorkflow(yaml)
  assert.equal(workflow.permissions, 'read-all')

  const regenerated = generateYAML(workflow)
  const raw = jsyaml.load(regenerated)
  assert.equal(raw.permissions, 'read-all')
})

test('a job-level "permissions: write-all" string round-trips the same way', () => {
  const yaml = 'name: X\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    permissions: write-all\n    steps:\n      - run: echo hi\n'
  const workflow = parseYAMLToWorkflow(yaml)
  const regenerated = generateYAML(workflow)
  const raw = jsyaml.load(regenerated)
  assert.equal(raw.jobs.a.permissions, 'write-all')
})

// ------------------------------------------------------------
// Bug 5: a sole workflow_call/workflow_dispatch trigger with only an
// "inputs:" schema collapsed to the bare "on: workflow_call" shorthand
// ------------------------------------------------------------
// Found via pytorch/pytorch's _linux-build.yml. hasTriggerConfig() decides
// whether a single trigger can be written as the "on: push"-style bare
// shorthand; it didn't check t.inputs, so a reusable workflow's entire
// input schema (names, types, required/default/description for ~25
// inputs, in the real file) was silently discarded.

test('a workflow_call trigger with only an inputs schema keeps its inputs (not collapsed to bare "on: workflow_call")', () => {
  const yaml = [
    'name: X',
    'on:',
    '  workflow_call:',
    '    inputs:',
    '      build-environment:',
    '        required: true',
    '        type: string',
    'jobs:',
    '  a:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo hi',
    '',
  ].join('\n')
  const workflow = parseYAMLToWorkflow(yaml)
  const regenerated = generateYAML(workflow)
  const raw = jsyaml.load(regenerated)
  assert.equal(typeof raw.on, 'object', 'on: should not have collapsed to a bare string')
  assert.equal(raw.on.workflow_call.inputs['build-environment'].type, 'string')
  assert.equal(raw.on.workflow_call.inputs['build-environment'].required, true)
})

// ------------------------------------------------------------
// Bug 6: boolean/number input "default:" values were stringified
// ------------------------------------------------------------
// Found via pytorch/pytorch's _linux-build.yml, e.g.
// "build-generates-artifacts: { type: boolean, default: true }" ->
// regenerated as `default: "true"` (a string), which changes the
// effective type of a typed input.

test('a boolean input default stays a boolean, not a quoted string', () => {
  const yaml = [
    'name: X',
    'on:',
    '  workflow_call:',
    '    inputs:',
    '      flag:',
    '        type: boolean',
    '        default: true',
    'jobs:',
    '  a:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo hi',
    '',
  ].join('\n')
  const workflow = parseYAMLToWorkflow(yaml)
  const regenerated = generateYAML(workflow)
  const raw = jsyaml.load(regenerated)
  assert.strictEqual(raw.on.workflow_call.inputs.flag.default, true)
})

test('a number input default stays a number, not a quoted string', () => {
  const yaml = [
    'name: X',
    'on:',
    '  workflow_call:',
    '    inputs:',
    '      count:',
    '        type: number',
    '        default: 5',
    'jobs:',
    '  a:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo hi',
    '',
  ].join('\n')
  const workflow = parseYAMLToWorkflow(yaml)
  const regenerated = generateYAML(workflow)
  const raw = jsyaml.load(regenerated)
  assert.strictEqual(raw.on.workflow_call.inputs.count.default, 5)
})

// ============================================================
// Round-trip fixes made after the first evaluation pass.
// Each test loads a minimal YAML document,
// regenerates it, and compares the *values* js-yaml reads back.
// ============================================================

function roundTrip(yaml) {
  const regenerated = generateYAML(parseYAMLToWorkflow(yaml))
  return { original: jsyaml.load(yaml), regenerated: jsyaml.load(regenerated), text: regenerated }
}

const JOB = '  a:\n    runs-on: ubuntu-latest\n    steps:\n      - name: s\n        run: echo hi\n'

test('branches-ignore / paths-ignore / tags-ignore survive a round trip', () => {
  const yaml = 'name: t\non:\n  pull_request:\n    branches-ignore: [nightly]\n  push:\n    paths-ignore: ["docs/**"]\n    tags-ignore: ["v*"]\njobs:\n' + JOB
  const { original, regenerated } = roundTrip(yaml)
  assert.deepEqual(regenerated.on, original.on)
})

test('a whole-expression strategy.matrix is written back as one expression, not character by character', () => {
  const yaml = 'name: t\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix: ${{ fromJSON(needs.x.outputs.m) }}\n    steps:\n      - name: s\n        run: echo hi\n'
  const { original, regenerated } = roundTrip(yaml)
  assert.equal(regenerated.jobs.a.strategy.matrix, original.jobs.a.strategy.matrix)
})

test('a map-form strategy.matrix with include keeps its values and types', () => {
  const yaml = 'name: t\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    strategy:\n      fail-fast: false\n      matrix:\n        os: [a, b]\n        include:\n          - os: a\n            x: 1\n    steps:\n      - name: s\n        run: echo hi\n'
  const { original, regenerated } = roundTrip(yaml)
  assert.deepEqual(regenerated.jobs.a.strategy, original.jobs.a.strategy)
})

test('runs-on given as a list stays a list (and is not flagged as an unknown runner label)', () => {
  const yaml = 'name: t\non: push\njobs:\n  a:\n    runs-on: [self-hosted, linux]\n    steps:\n      - name: s\n        run: echo hi\n'
  const { original, regenerated } = roundTrip(yaml)
  assert.deepEqual(regenerated.jobs.a['runs-on'], original.jobs.a['runs-on'])
  const issues = lintWorkflow(yaml, parseYAMLToWorkflow(yaml))
  assert.equal(issues.filter(i => /runner label/.test(i.msg)).length, 0)
})

test('a runs-on list containing a ${{ }} expression keeps the expression intact', () => {
  const yaml = 'name: t\non: push\njobs:\n  a:\n    runs-on: [self-hosted, "${{ matrix.os }}"]\n    steps:\n      - name: s\n        run: echo hi\n'
  const { original, regenerated } = roundTrip(yaml)
  assert.deepEqual(regenerated.jobs.a['runs-on'], original.jobs.a['runs-on'])
  const single = 'name: t\non: push\njobs:\n  a:\n    runs-on: ${{ fromJSON(\'["a","b"]\') }}\n    steps:\n      - name: s\n        run: echo hi\n'
  const r2 = roundTrip(single)
  assert.equal(r2.regenerated.jobs.a['runs-on'], r2.original.jobs.a['runs-on'])
})

test('runs-on in { group, labels } object form is preserved', () => {
  const yaml = 'name: t\non: push\njobs:\n  a:\n    runs-on:\n      group: big\n      labels: [x]\n    steps:\n      - name: s\n        run: echo hi\n'
  const { original, regenerated } = roundTrip(yaml)
  assert.deepEqual(regenerated.jobs.a['runs-on'], original.jobs.a['runs-on'])
})

test('several cron entries under schedule are all kept', () => {
  const yaml = 'name: t\non:\n  schedule:\n    - cron: "0 1 * * *"\n    - cron: "0 2 * * 1"\njobs:\n' + JOB
  const { original, regenerated } = roundTrip(yaml)
  assert.deepEqual(regenerated.on, original.on)
})

test('every cron entry is validated, not just the first', () => {
  const yaml = 'name: t\non:\n  schedule:\n    - cron: "0 1 * * *"\n    - cron: "bad cron"\njobs:\n' + JOB
  const issues = lintWorkflow(yaml, parseYAMLToWorkflow(yaml))
  assert.equal(issues.filter(i => /Invalid cron/.test(i.msg)).length, 1)
})

test('a job that calls a reusable workflow keeps uses/with/secrets and gets no injected runs-on', () => {
  const yaml = 'name: t\non: push\njobs:\n  c:\n    uses: ./.github/workflows/x.yml\n    needs: []\n    with:\n      a: 1\n      b: true\n      c: "x: y"\n    secrets: inherit\n'
  const { original, regenerated } = roundTrip(yaml)
  assert.equal(regenerated.jobs.c['runs-on'], undefined)
  assert.equal(regenerated.jobs.c.uses, original.jobs.c.uses)
  assert.deepEqual(regenerated.jobs.c.with, original.jobs.c.with)
  assert.equal(regenerated.jobs.c.secrets, 'inherit')
})

test('a reusable-workflow call job produces no missing-runs-on or no-steps findings', () => {
  const yaml = 'name: t\non: push\njobs:\n  c:\n    uses: ./.github/workflows/x.yml\n    secrets:\n      T: ${{ secrets.T }}\n'
  const issues = lintWorkflow(yaml, parseYAMLToWorkflow(yaml))
  assert.equal(issues.filter(i => /runs-on|no steps/.test(i.msg)).length, 0)
  const { original, regenerated } = roundTrip(yaml)
  assert.deepEqual(regenerated.jobs.c.secrets, original.jobs.c.secrets)
})

test('a job with neither runs-on nor uses is reported as missing runs-on (no silent default)', () => {
  const yaml = 'name: t\non: push\njobs:\n  a:\n    steps:\n      - name: s\n        run: echo hi\n'
  const issues = lintWorkflow(yaml, parseYAMLToWorkflow(yaml))
  assert.equal(issues.filter(i => i.type === 'error' && /missing "runs-on"/.test(i.msg)).length, 1)
})

test('boolean and number values in env and with keep their type', () => {
  const yaml = 'name: t\non: push\nenv:\n  A: 1\n  B: true\n  C: "1"\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - name: s\n        uses: actions/x@v1\n        env:\n          N: 2\n        with:\n          fetch-depth: 0\n          flag: false\n          word: "yes"\n'
  const { original, regenerated } = roundTrip(yaml)
  assert.deepEqual(regenerated.env, original.env)
  assert.deepEqual(regenerated.jobs.a.steps[0].with, original.jobs.a.steps[0].with)
  assert.deepEqual(regenerated.jobs.a.steps[0].env, original.jobs.a.steps[0].env)
})

test('a concurrency given as a bare group-name string keeps its group', () => {
  const yaml = 'name: t\non: push\nconcurrency: my-group\njobs:\n' + JOB
  const { regenerated } = roundTrip(yaml)
  assert.equal(regenerated.concurrency.group, 'my-group')
})

test('a step id that looks like a number, and a multi-line run starting with whitespace, round-trip', () => {
  const yaml = 'name: t\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - name: s\n        id: "1"\n        run: |2\n            indented first\n          second\n'
  const { original, regenerated } = roundTrip(yaml)
  assert.equal(regenerated.jobs.a.steps[0].id, original.jobs.a.steps[0].id)
  assert.equal(regenerated.jobs.a.steps[0].run, original.jobs.a.steps[0].run)
})

test('a push trigger with only *-ignore filters is not reported as unfiltered', () => {
  // INPUT: push trigger with branches-ignore + paths-ignore + tags-ignore only
  // EXPECTED: no "has no branch/tag/path filter" warning (the ignore filters narrow the trigger)
  const yaml = `name: t
on:
  push:
    branches-ignore:
      - 'wip/**'
    paths-ignore:
      - 'docs/**'
jobs:
  b:
    runs-on: ubuntu-latest
    steps:
      - name: x
        run: echo hi
`
  const wf = parseYAMLToWorkflow(yaml)
  const msgs = lintWorkflow(generateYAML(wf), wf).map(i => i.msg)
  assert.equal(msgs.some(m => m.includes('no branch/tag/path filter')), false)
})

test('a push trigger with no filter at all is still reported', () => {
  const yaml = `name: t
on:
  push:
jobs:
  b:
    runs-on: ubuntu-latest
    steps:
      - name: x
        run: echo hi
`
  const wf = parseYAMLToWorkflow(yaml)
  const msgs = lintWorkflow(generateYAML(wf), wf).map(i => i.msg)
  assert.equal(msgs.some(m => m.includes('no branch/tag/path filter')), true)
})

test('a pull_request trigger with only branches-ignore is not reported as lacking a branch filter', () => {
  // INPUT: the shape used by pytorch/pytorch lint.yml (pull_request + branches-ignore: [nightly])
  // EXPECTED: no "has no branch filter" warning; a bare pull_request is still reported
  const make = trigger => `name: t
on:
${trigger}
jobs:
  b:
    runs-on: ubuntu-latest
    steps:
      - name: x
        run: echo hi
`
  const msgsFor = trigger => {
    const wf = parseYAMLToWorkflow(make(trigger))
    return lintWorkflow(generateYAML(wf), wf).map(i => i.msg)
  }
  assert.equal(msgsFor('  pull_request:\n    branches-ignore:\n      - nightly').some(m => m.includes('no branch filter')), false)
  assert.equal(msgsFor('  pull_request:').some(m => m.includes('no branch filter')), true)
})
